// T-0202 床优先 (监工战略拍板): #13/#14/#15 45 分钟内三连死, #5/#15 裸装夜间重生即死 (T-0043 无床锚)。
// 石器到手 (石镐+剑) 后的白天、food≥10、无敌对 → GET_BED@66 (FOOD_FLOOR 70 之后、GET_ARMOR 58 之前) 派 bedErrand:
// 有界侦察找羊 (≤96b/120s), 剪/杀取 3 羊毛 → setBed (合成+放床+设重生)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bed-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.chdir(home);
delete process.env.MC_FOOD_INSTINCTS;

const { proposeTasks, isGoalDone, BED_ERRAND_PRIORITY } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');
const { default: bedErrand, bedMaterialsReady } = await import('../bots/_supervisor/skills/bedErrand.js');

const KIT = { stone_pickaxe: 2, stone_sword: 1, cobblestone: 50, crafting_table: 1, stick: 4, spruce_log: 6 };
const fakeBot = (inv) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 66, z: 0 } }, health: 18, food: 14, entities: {} });
function world({ phase = 'day', food = 14, actionable = 0 } = {}) {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase, isDay: phase === 'day' };
    w.kit = { ...w.kit, picks: 2, pickTier: 'stone', sufficientForUnderground: true };
    w.vitals = { ...w.vitals, hp: 18, food };
    w.threat = { ...w.threat, actionable };
    return w;
}
const bedProp = (w, inv) => proposeTasks(w, fakeBot(inv)).find(p => p.kind === 'GET_BED');

test('T-0202: 石镐+石剑, 白天, food≥10, 无敌对, 附近没羊 → GET_BED@66 派 bedErrand (FOOD_FLOOR 70 之后、GET_ARMOR 58 之前)', () => {
    const p = bedProp(world(), KIT);
    assert.ok(p && p.skill === 'bedErrand', JSON.stringify(p));
    assert.equal(p.priority, BED_ERRAND_PRIORITY);
    assert.ok(BED_ERRAND_PRIORITY < 70 && BED_ERRAND_PRIORITY > 58);
    assert.equal(isGoalDone('GET_BED', world(), fakeBot(KIT)), false, 'committed errand holds during the day');
});

test('T-0202: food<10 / 夜里 / 有敌对 / 无剑 → 不派 bedErrand; 夜里已承诺的释放', () => {
    for (const [w, inv, why] of [[world({ food: 8 }), KIT, 'food 8'], [world({ phase: 'night' }), KIT, 'night'], [world({ actionable: 1 }), KIT, 'hostile'],
                                  [world(), { ...KIT, stone_sword: 0 }, 'no sword']]) {
        const p = bedProp(w, inv);
        assert.ok(!p || p.skill !== 'bedErrand', `${why}: ${JSON.stringify(p)}`);
    }
    assert.equal(isGoalDone('GET_BED', world({ phase: 'night' }), fakeBot(KIT)), true);
});

const V = (x, y, z) => ({ x, y, z, clone() { return V(this.x, this.y, this.z); }, offset(dx, dy, dz) { return V(this.x + dx, this.y + dy, this.z + dz); }, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } });
function skillRig({ inv = {}, sheep = 0 }) {
    const calls = [];
    const entities = {}; for (let i = 0; i < sheep; i++) entities[i + 1] = { name: 'sheep', position: V(10 + i, 66, 0), isValid: true };
    const bot = { food: 14, health: 18, entity: { position: V(0, 66, 0) }, entities, blockAt: () => ({ name: 'air', skyLight: 15 }),
        inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })) },
        pathfinder: { stop() {}, setGoal() {}, setMovements() {}, goto: async () => {} }, clearControlStates() {} };
    const ctx = { world: { getInventoryCounts: () => ({ ...inv }) },
        skills: { customSkill: async (_b, name) => { calls.push(name); return name === 'setBed'; },
                  attackEntity: async (_b, s) => { calls.push('attack'); inv.white_wool = (inv.white_wool || 0) + 1; for (const k of Object.keys(entities)) if (entities[k] === s) delete entities[k]; },
                  pickupNearbyItems: async () => {}, equip: async () => {} } };
    return { bot, ctx, calls, inv };
}

test('T-0202 bedErrand: 包里已有 3 羊毛 → 直接 setBed; 附近 3 只羊 → 杀 3 只凑 3 羊毛 → setBed', async () => {
    assert.equal(bedMaterialsReady({ red_wool: 3 }), true);
    assert.equal(bedMaterialsReady({ white_wool: 2, string: 4 }), true);
    const a = skillRig({ inv: { white_wool: 3 } });
    assert.equal(await bedErrand(a.bot, a.ctx), true);
    assert.deepEqual(a.calls, ['setBed']);
    const b = skillRig({ sheep: 3 });
    assert.equal(await bedErrand(b.bot, b.ctx), true);
    assert.equal(b.calls.filter(c => c === 'attack').length, 3);
    assert.equal(b.calls[b.calls.length - 1], 'setBed');
});
