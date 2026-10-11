// T-0252 (监工拍板 2026-10-11): 03:38-03:45Z 白天熔铁造甲把 food 吃到 2, 黄昏才去找吃的, 被夜计划替换 → 饿着过夜。
// ① 零可吃且 food≤10 → 白天允许一次有界侦察 (复用 FOOD_FLOOR 96b/90s, 出发线 6→10);
// ② 打猎只能白天做, 熔铁/合成/造甲/下挖夜里也能做 → 白天 food≤10 时 FOOD_FLOOR 抢下这些'夜里也能做的活' (isEmergency 带 liveKind)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'forage-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.env.MC_FOOD_INSTINCTS = '0';
const { latchTrigger, foodFloorProposal, FORAGE_FOOD } = await import('../src/agent/framework/food_floor.js');
const { proposeTasks, commitGoal } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

const INV = { raw_iron: 12, coal: 6, spruce_log: 8, cobblestone: 100, stone_pickaxe: 2, crafting_table: 1, shield: 1 };
const mkBot = (food) => ({ inventory: { items: () => Object.entries(INV).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 70, z: 0 } }, entities: {}, health: 20, food, blockAt: () => ({ name: 'air', skyLight: 15 }) });
const mkWorld = (food, phase = 'day') => { const w = JSON.parse(JSON.stringify(EMPTY_WORLD)); w.time = { ...w.time, phase, isDay: phase === 'day' };
    w.vitals = { ...w.vitals, hp: 20, food, armor: 0 }; w.kit = { ...w.kit, picks: 2, pickTier: 'stone', sufficientForUnderground: true }; w.pos = { depthBand: 'surface' }; return w; };

test('T-0252: 零可吃且 food≤10 → forage 锁存 + 有界侦察 (看不见动物也去); food 11 不侦察', () => {
    assert.equal(FORAGE_FOOD, 10);
    assert.equal(latchTrigger({ food: 9, hp: 20, counts: {}, animalNear: false }), 'forage');
    assert.equal(latchTrigger({ food: 11, hp: 20, counts: {}, animalNear: false }), null);
    const p = foodFloorProposal({ foodInstincts: false, overworld: true, phase: 'day', food: 9, hp: 20, actionable: 0, counts: {}, animal: null,
        botY: 70, botPos: { x: 0, y: 70, z: 0 }, depthBand: 'surface', skyOpen: true, latch: { active: true, kills: 0, reason: 'forage' } });
    assert.ok(p && p.args[0].scout, JSON.stringify(p && p.args));
});

test('T-0252: 白天 零可吃 food 9 有 raw_iron+燃料 → FOOD_FLOOR 排在熔铁造甲前, 且抢下已承诺的 GET_ARMOR; 夜里/food 11 不抢', () => {
    const bot = mkBot(9);
    const ps = proposeTasks(mkWorld(9), bot);
    const ff = ps.find(p => p.kind === 'FOOD_FLOOR');
    assert.ok(ff && ff.args[0].scout, 'bounded scout proposed: ' + ps.map(p => p.kind + '@' + p.priority).join(' '));
    for (const k of ['GET_ARMOR', 'GET_IRON_TOOLS']) { const q = ps.find(p => p.kind === k); if (q) assert.ok(ff.priority > q.priority, k + ' ranks below forage'); }
    const armor = { kind: 'GET_ARMOR', priority: 58, skill: 'craftArmor', args: [{ order: 'protection' }] };
    const b1 = mkBot(9); b1._commitment = { kind: 'GET_ARMOR', skill: 'craftArmor', args: [{}], since: 0 };
    assert.equal(commitGoal(b1, [ff, armor], mkWorld(9)).kind, 'FOOD_FLOOR', 'day: forage preempts night-doable work');
    const b2 = mkBot(9); b2._commitment = { kind: 'GET_ARMOR', skill: 'craftArmor', args: [{}], since: 0 };
    assert.equal(commitGoal(b2, [ff, armor], mkWorld(11)).kind, 'GET_ARMOR', 'food 11: not yet');
    const b3 = mkBot(9); b3._commitment = { kind: 'GET_ARMOR', skill: 'craftArmor', args: [{}], since: 0 };
    assert.equal(commitGoal(b3, [ff, armor], mkWorld(9, 'night')).kind, 'GET_ARMOR', 'night: hunting is not the move');
});
