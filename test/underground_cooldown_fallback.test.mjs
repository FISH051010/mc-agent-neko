// T-0160: 20:22:08→20:23:02Z y44→y40 mineDown 三连 abort 'fluid (lava/water) near stair cell' / relocate failed →
// GO_UNDERGROUND 冷却 5min → FREE_PLAY 空等。bot 已在地下 (石镐 + 3 木镐 + 11 煤 + 1 粗铁), y40 本就在铁分布内:
// 下不去就在这一层横挖找铁 (branchMine), 而不是站着等冷却。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-cd-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
delete process.env.MC_FOOD_INSTINCTS;

const { proposeTasks } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

// 20:25Z live inventory
const LIVE = { stick: 4, raw_iron: 1, cobblestone: 93, spruce_planks: 5, spruce_log: 3, dirt: 50, stone_pickaxe: 1, wooden_pickaxe: 3, coal: 11, crafting_table: 1 };
const fakeBot = (y, cooldown) => ({
    inventory: { items: () => Object.entries(LIVE).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: { x: -39, y, z: 5 } }, health: 20, food: 19,
    _kindCooldownUntil: cooldown ? { GO_UNDERGROUND: Date.now() + 240000 } : undefined,
});
function world(y) {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'day', isDay: true };
    w.kit = { ...w.kit, picks: 4, pickTier: 'stone', sufficientForUnderground: true };
    w.vitals = { ...w.vitals, hp: 20, food: 19 };
    w.pos = { x: -39, y, z: 5, depthBand: y >= 62 ? 'surface' : (y >= 40 ? 'shallow' : 'mid') };
    return w;
}
const fallback = (ps) => ps.filter(p => p.kind === 'GET_IRON_TOOLS' && p.skill === 'branchMine');

test('T-0160: GO_UNDERGROUND 冷却中 + 已在地下 y40 + 石器无铁 → 原地 branchMine 找铁 (不 FREE_PLAY 空等)', () => {
    const ps = proposeTasks(world(40), fakeBot(40, true));
    assert.ok(!ps.some(p => p.kind === 'GO_UNDERGROUND'), 'cooled kind filtered');
    assert.equal(fallback(ps).length, 1, `got ${ps.map(p => p.kind + ':' + p.skill)}`);
});

test('T-0160: 未冷却 → 照常 GO_UNDERGROUND 下潜, 不提回退; 冷却但在地面 → 不提 (地面横挖无意义)', () => {
    const normal = proposeTasks(world(40), fakeBot(40, false));
    assert.ok(normal.some(p => p.kind === 'GO_UNDERGROUND'));
    assert.equal(fallback(normal).length, 0);
    assert.equal(fallback(proposeTasks(world(70), fakeBot(70, true))).length, 0);
});
