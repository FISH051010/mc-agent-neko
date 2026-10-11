// T-0263 (监工指派): IDLE-DISPATCH 回放 10-09→10-11 15 段白天零派发 — 主任务 3 连败冷却后其余提案也冷却/被门挡, 只剩 skill 为空的
// FREE_PLAY → 原地空站 3-10min (如 10-10 13:18 hp4 food14 FOOD_FLOOR 冷却 → TOOL_UPKEEP 完成 → FREE_PLAY 空站 5min)。
// 通用规则: 白天、无可动威胁、不在养伤、除 FREE_PLAY 外无可派 → 兜底活 (缺木砍木 / 料不足攒土石 / 侦察); FOOD_FLOOR 回不了血时冷却同钳 30s。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfb-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.env.MC_FOOD_INSTINCTS = '0';
const { proposeTasks, dayFallbackTask } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD, PROPOSAL_KIND } = await import('../src/agent/framework/contracts.js');

const mkBot = (inv, extra = {}) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) }, entities: {}, health: 20, food: 20, ...extra });
const mkWorld = (phase = 'day') => { const w = JSON.parse(JSON.stringify(EMPTY_WORLD)); w.time = { tod: 4000, phase, isDay: phase === 'day' };
    w.vitals = { ...w.vitals, hp: 20, food: 20 }; w.kit = { ...w.kit, picks: 2, pickTier: 'stone', sufficientForUnderground: true }; w.pos = { x: 0, y: 64, z: 0, depthBand: 'surface' }; return w; };
const allCooled = () => { const now = Date.now(), cd = {}; for (const k of [...Object.values(PROPOSAL_KIND), 'NIGHT_SMELT_IRON', 'NIGHT_STONE_BOOTSTRAP', 'PRE_DUSK_FILLER', 'OPENING_SCOUT', 'OPENING_VILLAGE', 'RECLAIM_FURNACE'])
    if (k !== 'IDLE_FALLBACK' && k !== 'FREE_PLAY') cd[k] = now + 300000; return cd; };
const KIT = { stone_pickaxe: 2, spruce_log: 10, cobblestone: 30, cooked_beef: 8, crafting_table: 1 };

test('T-0263: 兜底活按需选 — 缺木砍木 / 料不足 (有镐浅挖, 零镐挖泥) / 其余侦察', () => {
    assert.equal(dayFallbackTask(mkWorld(), mkBot({ stone_pickaxe: 1 })).skill, 'chopWood');
    assert.equal(dayFallbackTask(mkWorld(), mkBot({ stone_pickaxe: 1, spruce_log: 10 })).skill, 'mineDown');
    assert.equal(dayFallbackTask(mkWorld(), mkBot({ spruce_log: 10 })).skill, 'gatherDirt');
    assert.equal(dayFallbackTask(mkWorld(), mkBot(KIT)).skill, 'scoutResources');
});

test('T-0263: 白天所有提案都冷却 → 提 IDLE_FALLBACK (不再只剩空 FREE_PLAY); 夜里/养伤/兜底自身冷却时不提', () => {
    const b = mkBot(KIT); b._kindCooldownUntil = allCooled();
    const ps = proposeTasks(mkWorld(), b);
    assert.ok(!ps.some(p => p.kind !== 'FREE_PLAY' && p.kind !== 'IDLE_FALLBACK'), 'test setup: everything else cooled: ' + ps.map(p => p.kind).join(' '));
    const fb = ps.find(p => p.kind === 'IDLE_FALLBACK');
    assert.ok(fb && fb.skill === 'scoutResources' && fb.priority === 2, JSON.stringify(ps.map(p => p.kind + ':' + p.skill)));
    const n = mkBot(KIT); n._kindCooldownUntil = allCooled();
    assert.ok(!proposeTasks(mkWorld('night'), n).some(p => p.kind === 'IDLE_FALLBACK'), 'night: no fallback');
    const c = mkBot(KIT); c._kindCooldownUntil = { ...allCooled(), IDLE_FALLBACK: Date.now() + 300000 };
    assert.ok(!proposeTasks(mkWorld(), c).some(p => p.kind === 'IDLE_FALLBACK'), 'fallback itself cooled');
});

test('T-0263: 兜底选到下挖但 4 格内有怪 → 退为侦察 (过 T-0243 下挖门)', () => {
    const z = { name: 'zombie', type: 'hostile', position: new Vec3(2, 64, 0), height: 1.95 };
    const b = mkBot({ stone_pickaxe: 1, spruce_log: 10, cooked_beef: 8 }, { entities: { 1: z }, blockAt: () => ({ name: 'stone', boundingBox: 'block' }) });
    b._kindCooldownUntil = allCooled();
    const fb = proposeTasks(mkWorld(), b).find(p => p.kind === 'IDLE_FALLBACK');
    assert.ok(fb && fb.skill === 'scoutResources', JSON.stringify(fb));
});
