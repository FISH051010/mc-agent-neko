// T-0111: 离场收台在 kernel 切承诺 (interrupt 已置位) 的窗口里失效 — 台被敲掉但掉落物没捡 → 背包 0 台 →
// 下矿门关 (T-0060 死锁起点; 实录 10-10 16:00:55 `⑨ 离场台回收 → table=0`)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { reclaimTable } from '../bots/_supervisor/skills/replenishKit.js';

function fixture({ interrupt }) {
    const inv = { wooden_pickaxe: 3 };
    let placed = true, dropped = false;
    const bot = { interrupt_code: interrupt, death_abort: false };
    const world = {
        getInventoryCounts: () => ({ ...inv }),
        getNearestBlocksWhereAsync: async () => (placed ? [{ name: 'crafting_table', position: { x: 1, y: 64, z: 0 } }] : []),
    };
    const skills = {
        breakBlockAt: async () => { placed = false; dropped = true; },        // bot.dig ignores interrupt
        ensurePickupAt: async () => { if (bot.interrupt_code) return false; if (dropped) { inv.crafting_table = 1; dropped = false; } return true; },
        pickupNearbyItems: async () => { if (bot.interrupt_code) return false; if (dropped) { inv.crafting_table = 1; dropped = false; } return true; },
    };
    return { bot, inv, ctx: { skills, world } };
}

test('T-0111: kernel 切承诺 interrupt 已置位时, 离场收台仍把台捡回背包, 并恢复 interrupt', async () => {
    const { bot, inv, ctx } = fixture({ interrupt: true });
    const ok = await reclaimTable(bot, ctx, { maxMs: 1000 });
    assert.equal(ok, true);
    assert.equal(inv.crafting_table, 1, 'table must be back in the bag, not lying on the ground');
    assert.equal(bot.interrupt_code, true, 'the kernel interrupt is restored afterwards');
});

test('T-0111: 无 interrupt 时照常收台; 背包已有台则不动', async () => {
    const { bot, inv, ctx } = fixture({ interrupt: false });
    assert.equal(await reclaimTable(bot, ctx, { maxMs: 1000 }), true);
    assert.equal(inv.crafting_table, 1);
    assert.equal(bot.interrupt_code, false);
});

test('T-0111 复发: 台已被敲成掉落物 (6 格内无台方块) → 也要捡回台', async () => {
    const inv = { wooden_pickaxe: 1 };
    let dropped = true;
    const bot = { interrupt_code: true, death_abort: false };
    const ctx = {
        world: { getInventoryCounts: () => ({ ...inv }), getNearestBlocksWhereAsync: async () => [] },
        skills: {
            breakBlockAt: async () => {}, ensurePickupAt: async () => false,
            pickupNearbyItems: async () => { if (bot.interrupt_code) return false; if (dropped) { inv.crafting_table = 1; dropped = false; } return true; },
        },
    };
    assert.equal(await reclaimTable(bot, ctx, { maxMs: 1000 }), true);
    assert.equal(inv.crafting_table, 1);
    assert.equal(bot.interrupt_code, true);
});
