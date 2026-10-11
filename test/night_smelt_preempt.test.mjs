// T-0250 (监工 2026-10-11 03:29Z 实录 71,15,-37): 夜里 raw_iron 3 + 0 煤 + 10 原木 + 200 圆石, 整段没有熔铁/造盾, 只有 mineDown。
// 根因不在燃料 (原木/木板早已计入): 入夜先承诺了 DUSK_MINE_NIGHT@94 (当时 raw_iron 1), 挖到第 3 块后给铁镐熔铁的 NIGHT_SMELT_IRON 也是 @94,
// 夜计划之间只有 ≥NIGHT_ARMOR_PRIORITY 能抢下整夜下矿 (T-0192) → 熔不了。修: 熔铁/合成两版与造甲版同优先级; 燃料统一 fuelUnits。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nsmelt-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.env.MC_FOOD_INSTINCTS = '0';
const { proposeTasks, commitGoal, NIGHT_ARMOR_PRIORITY } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');
const { fuelUnits, smeltableUnits } = await import('../src/agent/framework/kit_gate.js');

const LIVE = { raw_iron: 3, spruce_log: 10, spruce_planks: 2, cobblestone: 200, stone_pickaxe: 2, wooden_pickaxe: 2, cooked_beef: 4 };
const mkBot = (inv = LIVE) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: { x: 71, y: 15, z: -37 } }, entities: {}, health: 20, food: 20 });
function world(phase, decision) {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD)); w.time = { ...w.time, phase, isDay: phase === 'day' };
    w.vitals = { ...w.vitals, hp: 20, food: 20, armor: 0 }; w.kit = { ...w.kit, picks: 4, pickTier: 'stone', sufficientForUnderground: true };
    if (decision) w.nightPlan = { decision };
    return w;
}

test('T-0250: 燃料统一 — 煤 8 / 原木·木板 1.5; 合成要用的木板先扣 (不够从原木折)', () => {
    assert.equal(fuelUnits({ coal: 1 }), 8);
    assert.equal(fuelUnits({ spruce_log: 10 }), 15);
    assert.equal(fuelUnits({ spruce_log: 10, spruce_planks: 2 }, { reservePlanks: 6 }), 13, '6 shield planks: 2 from planks, 1 log → 4 planks (1 left over)');
    assert.equal(smeltableUnits(LIVE), 15, 'keeps the 2-log table reserve');
});

test('T-0250: 夜里 raw_iron 3 + 0 煤 + 10 原木 → NIGHT_SMELT_IRON@≥94.2 并抢下已承诺的 DUSK_MINE_NIGHT', () => {
    const w = world('night', 'SMELT_IRON');
    const bot = mkBot();
    const ps = proposeTasks(w, bot);
    const sm = ps.find(p => p.kind === 'NIGHT_SMELT_IRON');
    assert.ok(sm && sm.priority >= NIGHT_ARMOR_PRIORITY, JSON.stringify(ps.map(p => p.kind + '@' + p.priority)));
    bot._commitment = { kind: 'DUSK_MINE_NIGHT', skill: 'mineDown', args: [{ targetY: 12 }], since: 0 };
    const mine = { kind: 'DUSK_MINE_NIGHT', priority: 94, skill: 'mineDown', args: [{ targetY: 12 }] };
    assert.equal(commitGoal(bot, [sm, mine], w).kind, 'NIGHT_SMELT_IRON');
});

test('T-0250: 夜里已有 ≥3 锭 → 合成清单同白天 (盾 → 镐 → 剑, 含盾的木板)', () => {
    const w = world('night', 'SMELT_IRON');
    const p = proposeTasks(w, mkBot({ ...LIVE, raw_iron: 0, iron_ingot: 3 })).find(x => x.kind === 'NIGHT_SMELT_IRON');
    assert.ok(p && p.skill === 'craftChain' && p.priority >= NIGHT_ARMOR_PRIORITY);
    const names = p.args[0].map(x => x[0]);
    assert.ok(names.includes('shield') && names.indexOf('shield') < names.indexOf('iron_pickaxe'), JSON.stringify(names));
});

test('T-0250: 白天 raw_iron 3 + 0 煤 + 10 原木 + 圆石 → 提 GET_ARMOR 造盾 (燃料认木料)', () => {
    const p = proposeTasks(world('day'), mkBot()).find(x => x.kind === 'GET_ARMOR');
    assert.ok(p && p.skill === 'craftArmor');
});
