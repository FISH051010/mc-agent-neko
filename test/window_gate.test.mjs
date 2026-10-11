// T-0269 (2026-10-11 05:29:35Z 实录): craftChain 开着工作台窗口拍台合成时, auto_eat 进食卸盾 bot.unequip('off-hand') —
// mineflayer clickWindow 落在 bot.currentWindow (工作台) 上, 却按玩家背包编号点格 (45 在工作台窗口里是快捷栏) →
// 盾凭空消失 (副手空、包里也无, 栈 28→27), 70s 后无盾窒息死。修 = 窗口总闸 (同 T-0172 bot.dig 总闸): 包 equip/unequip/
// toss/tossStack, 容器窗口开着先等它关 (≤2.5s), 超时关掉残留窗口并写诊断, 之后才操作。
import test from 'node:test';
import assert from 'node:assert/strict';
import { installWindowGate, awaitContainerClosed } from '../src/agent/library/skills.js';

// 复刻 mineflayer 行为: 有容器窗口时, 按玩家背包编号的格子操作落在容器窗口上 → 盾丢 (模拟点错格的后果)
function fakeBot({ windowClosesAfterMs = null } = {}) {
    const slots = []; slots[45] = { name: 'shield', count: 1 };
    const pack = [];
    const bot = {
        currentWindow: { type: 'minecraft:crafting' },
        inventory: { slots, items: () => pack.slice() },
        closeWindow(w) { if (bot.currentWindow === w) bot.currentWindow = null; },
        async unequip(dest) {
            if (dest !== 'off-hand') return;
            const it = slots[45]; slots[45] = null;
            if (bot.currentWindow) return;          // 点在工作台窗口上: 盾进了合成格, 关窗即丢
            if (it) pack.push(it);
        },
        async equip(item, dest) {
            if (bot.currentWindow) throw new Error('invalid operation');
            const i = pack.indexOf(item); if (i >= 0) pack.splice(i, 1);
            if (dest === 'off-hand') slots[45] = item;
        },
        async toss() {}, async tossStack() {},
    };
    if (windowClosesAfterMs != null) setTimeout(() => { bot.currentWindow = null; }, windowClosesAfterMs);
    return bot;
}

async function eatShieldDance(bot) {
    // 同 skills._consumeOnce 的 EAT-VOID 第四刀: 吃前卸盾入包, 吃完回装
    await bot.unequip('off-hand');
    const sh = bot.inventory.items().find(i => i.name === 'shield');
    if (sh) await bot.equip(sh, 'off-hand');
}

test('T-0269: 复刻 — 无总闸时工作台窗口开着进食卸盾 → 盾凭空消失', async () => {
    const bot = fakeBot();
    await eatShieldDance(bot);
    assert.equal(bot.inventory.slots[45], null);
    assert.equal(bot.inventory.items().length, 0, 'shield gone (the live bug)');
});

test('T-0269: 窗口总闸 — 工作台窗口开着 + 进食卸盾: 等合成关窗再操作, 盾回副手不丢', async () => {
    const bot = fakeBot({ windowClosesAfterMs: 300 });
    assert.equal(installWindowGate(bot), true);
    await eatShieldDance(bot);
    assert.equal(bot.inventory.slots[45] && bot.inventory.slots[45].name, 'shield');
});

test('T-0269: 窗口总闸 — 容器窗口一直不关 (残留) → 超时关掉再操作, 不在容器窗口上点格; 玩家背包窗口不拦', async () => {
    const bot = fakeBot();
    installWindowGate(bot);
    const t0 = Date.now();
    await eatShieldDance(bot);
    assert.equal(bot.inventory.slots[45] && bot.inventory.slots[45].name, 'shield');
    assert.ok(Date.now() - t0 >= 2000, 'waited for the owner first');
    const inv = { currentWindow: { type: 'minecraft:inventory' }, closeWindow() { throw new Error('must not close the player inventory'); } };
    assert.deepEqual(await awaitContainerClosed(inv, 'equip'), { waited: 0, closed: false });
    assert.equal(installWindowGate(bot), false, 'idempotent');
});
