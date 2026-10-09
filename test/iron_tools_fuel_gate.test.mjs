// T-0176: 22:25:59-22:26:16Z 石器 bot 7 粗铁, 0 煤 0 原木 1 木板 → GET_IRON_TOOLS 派 smeltSafe ×3 秒败 (consumed=0 produced=0) → 冷却。
// 铁律 2: 燃料熔不出凑满 3 锭的差额就不提熔炼, 已承诺的也要释放 (否则 holding commitment 续派旧 smeltSafe)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'itf-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
delete process.env.MC_FOOD_INSTINCTS;

const { proposeTasks, isGoalDone } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

const LIVE = { stone_pickaxe: 2, wooden_pickaxe: 2, stone_sword: 1, stick: 5, raw_iron: 7, cobblestone: 218, spruce_planks: 1, crafting_table: 1 };   // 22:26 live (+台)
const fakeBot = (inv) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 20, z: 0 } }, health: 20, food: 20 });
function dayWorld() {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'day', isDay: true };
    w.kit = { ...w.kit, picks: 4, pickTier: 'stone', sufficientForUnderground: true };
    w.vitals = { ...w.vitals, hp: 20, food: 20 };
    w.landmarks = { ...w.landmarks, woodKnownReach: false };
    return w;
}
const smelt = (inv) => proposeTasks(dayWorld(), fakeBot(inv)).filter(p => p.kind === 'GET_IRON_TOOLS' && p.skill === 'smeltSafe');

test('T-0176: 无燃料 (1 板) → 不提 smeltSafe, 已承诺的 GET_IRON_TOOLS 释放', () => {
    assert.equal(smelt(LIVE).length, 0);
    assert.equal(isGoalDone('GET_IRON_TOOLS', dayWorld(), fakeBot(LIVE)), true);
});

test('T-0176: 有煤 → 提 smeltSafe, 量按燃料封顶; 不释放', () => {
    const p = smelt({ ...LIVE, coal: 1 });
    assert.equal(p.length, 1);
    assert.equal(p[0].args[1], 5, '1 coal = 8 units ≥ min(7,5)');
    assert.equal(isGoalDone('GET_IRON_TOOLS', dayWorld(), fakeBot({ ...LIVE, coal: 1 })), false);
    const wood = smelt({ ...LIVE, spruce_log: 4 });   // (4-2)+1 = 3 件木料 ×1.5 = 4 units
    assert.ok(wood.length === 1 && wood[0].args[1] === 4, JSON.stringify(wood.map(x => x.args)));
});
