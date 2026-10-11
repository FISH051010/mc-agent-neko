// T-0249 (监工核对 2026-10-11): 铁阶段 pickStockPlan 囤 4 铁镐 (12 锭), triggerFloor 2 → 只剩 1 把有效铁镐就提 REPLENISH_KIT@62 (> GET_ARMOR@58),
// 承诺到 4 把才释放 — 无胸甲时与防护序 (盾 > 胸 > 腿) / 先甲后钻 抢铁。修: 胸甲档 + 盾 前铁镐只囤 2 把 (1 在手 + 1 备 = 6 锭), 之后囤满 4;
// 决策层定目标并经 args 传给 replenishKit (技能端不再写死 4)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ironpick-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.env.MC_FOOD_INSTINCTS = '0';
const { proposeTasks, isGoalDone, ironPickTarget } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

function mk(inv, { worn = [], offhand = null } = {}) {
    const items = Object.entries(inv).filter(([, c]) => c > 0).map(([name, count]) => ({ name, count, maxDurability: /pickaxe/.test(name) ? 250 : 0, durabilityUsed: 0 }));
    const slots = []; worn.forEach((n, i) => { slots[5 + i] = { name: n, count: 1 }; }); if (offhand) slots[45] = { name: offhand, count: 1 };
    const bot = { inventory: { items: () => items, slots }, game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 70, z: 0 } }, entities: {}, health: 20, food: 20 };
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD)); w.time = { ...w.time, phase: 'day', isDay: true }; w.vitals = { ...w.vitals, hp: 20, food: 20 };
    w.kit = { ...w.kit, picks: 4, pickTier: 'iron', sufficientForUnderground: true };
    return { bot, w };
}
const BASE = { iron_pickaxe: 2, stone_pickaxe: 2, iron_ingot: 9, coal: 4, crafting_table: 1, stick: 30, oak_planks: 64 };

test('T-0249: 铁镐目标 — 胸甲档 + 盾 前 2 把, 齐了 4 把', () => {
    assert.equal(ironPickTarget(mk(BASE).bot), 2);
    assert.equal(ironPickTarget(mk(BASE, { offhand: 'shield' }).bot), 2, 'shield alone is not enough');
    assert.equal(ironPickTarget(mk(BASE, { worn: ['iron_chestplate'] }).bot), 2, 'chest alone is not enough');
    assert.equal(ironPickTarget(mk(BASE, { worn: ['iron_chestplate'], offhand: 'shield' }).bot), 4);
});

test('T-0249: 2 把铁镐 + 9 锭 + 无胸甲 → 不再为囤镐提 REPLENISH_KIT (铁留给 GET_ARMOR); 胸甲+盾齐了才继续囤到 4', () => {
    const a = mk(BASE);
    assert.ok(!proposeTasks(a.w, a.bot).some(p => p.kind === 'REPLENISH_KIT'), 'no pick stockpiling while armorless');
    assert.equal(isGoalDone('REPLENISH_KIT', a.w, a.bot), true, 'committed stockpile released at 2');
    const b = mk({ ...BASE, iron_pickaxe: 1 }, { worn: ['iron_chestplate'], offhand: 'shield' });
    const p = proposeTasks(b.w, b.bot).find(x => x.kind === 'REPLENISH_KIT');
    assert.ok(p, 'armored + 1 iron pick → stock up');
    assert.equal(p.args[0].ironPickTarget, 4, 'target passed to the skill');
    const c = mk({ ...BASE, iron_pickaxe: 1 });
    const q = proposeTasks(c.w, c.bot).find(x => x.kind === 'REPLENISH_KIT');
    assert.ok(q && q.args[0].ironPickTarget === 2, `armorless + 1 iron pick → stock only to 2 (${JSON.stringify(q && q.args)})`);
});

test('T-0249: replenishKit 读 args.ironPickTarget, 不再写死 4 (源码同源断言)', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/replenishKit.js', import.meta.url), 'utf8');
    assert.match(src, /const IRON_PICK_TARGET = Number\.isFinite\(opts && opts\.ironPickTarget\) \? opts\.ironPickTarget : 4;/);
    assert.ok(!/effIronPicksN\(\) (<|>=) 4/.test(src), 'no hard-coded 4 left');
});
