// T-0069: MC_FOOD_INSTINCTS=0 (用户 07-08 令) 下没有任何提案能补食物 — 实录 10-10 铁器 bot food 13→6、背包零食物,
// keepInventory=false 饿到 hp1 一击即死丢铁装。有界兜底 FOOD_FLOOR: 16 格内一次短猎 + 就地烤, 不漫游。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { proposeTasks, isGoalDone } from '../src/agent/framework/world_model.js';
import { EMPTY_WORLD } from '../src/agent/framework/contracts.js';
import { foodFloorProposal, HUNT_RADIUS } from '../src/agent/framework/food_floor.js';

const LIVE = { iron_pickaxe: 3, iron_sword: 1, iron_helmet: 1, iron_boots: 1, cobblestone: 339, coal: 7, spruce_log: 18 };
const fakeBot = (inv, y = 76) => ({
    inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: { x: 53, y, z: 33 } }, health: 17, food: 6,
});
function world({ phase = 'day', food = 6, animal = null } = {}) {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase, isDay: phase === 'day' };
    w.vitals = { ...w.vitals, food, hp: 17 };
    w.kit = { ...w.kit, picks: 3, pickTier: 'iron', sufficientForUnderground: true };
    w.landmarks = { ...w.landmarks, animal };
    return w;
}
const prevEnv = process.env.MC_FOOD_INSTINCTS;

test('T-0069: 食物本能关 + food 6 + 零食物 + 12 格内有牛 → 提 FOOD_FLOOR(quickMeal), 且压过 tier 链', () => {
    delete process.env.MC_FOOD_INSTINCTS;
    const w = world({ animal: { x: 60, y: 75, z: 33, dist: 12, meta: 'cow', age: 3000 } });
    const props = proposeTasks(w, fakeBot(LIVE));
    const ff = props.find(p => p.kind === 'FOOD_FLOOR');
    assert.ok(ff, `FOOD_FLOOR proposed; got ${props.map(p => p.kind).join(',')}`);
    assert.equal(ff.skill, 'quickMeal');
    assert.equal(ff.args[0].radius, HUNT_RADIUS);
    for (const p of props) if (/GET_IRON|GO_UNDERGROUND|GET_DIAMOND|REPLENISH|TOOL_UPKEEP/.test(p.kind)) assert.ok(ff.priority > p.priority, `${p.kind}@${p.priority}`);
    assert.equal(isGoalDone('FOOD_FLOOR', w, fakeBot(LIVE)), false);
    assert.equal(isGoalDone('FOOD_FLOOR', w, fakeBot({ ...LIVE, cooked_beef: 2 })), true, 'edible in pack → done');
});

test('T-0069: 边界 — 动物 >16 格 / 高差 >4 / 夜里 / 有威胁 / 食物本能开 / food>6 / 背包有吃的 → 一律不提 (不漫游)', () => {
    const base = { foodInstincts: false, overworld: true, phase: 'day', food: 6, actionable: 0, counts: LIVE, botY: 76 };
    const cow = (o) => ({ x: 0, y: 76, z: 0, dist: 10, meta: 'cow', age: 1000, ...o });
    assert.ok(foodFloorProposal({ ...base, animal: cow() }));
    assert.equal(foodFloorProposal({ ...base, animal: cow({ dist: 20 }) }), null, 'far animal');
    assert.equal(foodFloorProposal({ ...base, animal: cow({ y: 70 }) }), null, 'dy>4');
    assert.equal(foodFloorProposal({ ...base, animal: cow({ age: 60000 }) }), null, 'stale sighting');
    assert.equal(foodFloorProposal({ ...base, phase: 'night', animal: cow() }), null);
    assert.equal(foodFloorProposal({ ...base, actionable: 1, animal: cow() }), null);
    assert.equal(foodFloorProposal({ ...base, foodInstincts: true, animal: cow() }), null, 'GET_FOOD owns it when instincts on');
    assert.equal(foodFloorProposal({ ...base, food: 7, animal: cow() }), null);
    assert.equal(foodFloorProposal({ ...base, counts: { ...LIVE, bread: 1 }, animal: cow() }), null);
    assert.equal(foodFloorProposal({ ...base, animal: null }), null, 'no animal, no meat → nothing to do');
    assert.ok(foodFloorProposal({ ...base, counts: { ...LIVE, beef: 2 }, animal: null }), 'raw meat in pack → cook/eat in place');
});

test('T-0069: quickMeal 找不到半径内动物 → 立刻如实失败, 绝不寻路去找', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-'));
    fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
    const cwd = process.cwd(); process.chdir(home);
    try {
        const { default: quickMeal } = await import('../bots/_supervisor/skills/quickMeal.js');
        const V = (x, y, z) => ({ x, y, z, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } });
        let moved = false;
        const bot = { food: 6, entity: { position: V(0, 70, 0) }, entities: { 1: { name: 'cow', position: V(30, 70, 0) }, 2: { name: 'pig', position: V(3, 60, 0) } },
            pathfinder: { stop() {}, goto() { moved = true; } }, clearControlStates() {} };
        const ctx = { world: { getInventoryCounts: () => ({ coal: 7 }) },
            skills: { attackEntity: async () => { moved = true; }, pickupNearbyItems: async () => {}, customSkill: async () => {}, consume: async () => {} } };
        const t0 = Date.now();
        const r = await quickMeal(bot, ctx, { radius: 16, maxDy: 4, maxMs: 60000 });
        assert.equal(r.failed, true);
        assert.equal(moved, false, 'cow@30b and pig dy=10 are out of bounds — no chase');
        assert.ok(Date.now() - t0 < 1000);
    } finally { process.chdir(cwd); if (prevEnv !== undefined) process.env.MC_FOOD_INSTINCTS = prevEnv; }
});
