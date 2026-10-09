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
    assert.ok(foodFloorProposal({ ...base, animal: cow({ dist: 34 }) }), '17:37 live: cow@34b is now in range (radius 48)');
    const scoutOnly = (p) => !!(p && p.args[0].scout);   // 出界动物不直扑, 只能走有界侦察 (food≤6)
    assert.ok(scoutOnly(foodFloorProposal({ ...base, animal: cow({ dist: 60 }) })), 'far animal (>48) → scout, not a direct hunt');
    assert.ok(scoutOnly(foodFloorProposal({ ...base, animal: cow({ y: 68 }) })), 'dy>6 → scout, not a direct hunt');
    assert.ok(foodFloorProposal({ ...base, botPos: { x: 0, y: 76, z: 0 }, animal: cow({ x: 40, y: 81, z: 0, dist: 47.0 }) }), 'radius is horizontal (40b), dy 5 ok');
    assert.ok(scoutOnly(foodFloorProposal({ ...base, animal: cow({ age: 60000 }) })), 'stale sighting → scout, not a direct hunt');
    assert.equal(foodFloorProposal({ ...base, phase: 'night', animal: cow() }), null);
    assert.equal(foodFloorProposal({ ...base, actionable: 1, animal: cow() }), null);
    assert.equal(foodFloorProposal({ ...base, foodInstincts: true, animal: cow() }), null, 'GET_FOOD owns it when instincts on');
    assert.equal(foodFloorProposal({ ...base, food: 7, animal: cow() }), null);
    assert.equal(foodFloorProposal({ ...base, counts: { ...LIVE, bread: 1 }, animal: cow() }), null);
    const noAnimal = foodFloorProposal({ ...base, animal: null });
    assert.ok(noAnimal && noAnimal.args[0].scout, 'food≤6, no animal, no meat → bounded scout (监工拍板: 侦察只在 food≤6 时做)');
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
        const bot = { food: 6, entity: { position: V(0, 70, 0) }, entities: { 1: { name: 'cow', position: V(60, 70, 0) }, 2: { name: 'pig', position: V(3, 60, 0) } },
            pathfinder: { stop() {}, goto() { moved = true; } }, clearControlStates() {} };
        const ctx = { world: { getInventoryCounts: () => ({ coal: 7 }) },
            skills: { attackEntity: async () => { moved = true; }, pickupNearbyItems: async () => {}, customSkill: async () => {}, consume: async () => {} } };
        const t0 = Date.now();
        const r = await quickMeal(bot, ctx, { radius: 16, maxDy: 4, maxMs: 60000 });
        assert.equal(r.failed, true);
        assert.equal(moved, false, 'cow@60b and pig dy=10 are out of bounds — no chase');
        assert.ok(Date.now() - t0 < 1000);
    } finally { process.chdir(cwd); if (prevEnv !== undefined) process.env.MC_FOOD_INSTINCTS = prevEnv; }
});

test('T-0069 跟进: food≤3 且零可吃 → 剔除一切下矿提案 (按技能名) 并释放进行中的下矿承诺; food 7 照常下矿', () => {
    delete process.env.MC_FOOD_INSTINCTS;
    const kit = { ...LIVE, iron_chestplate: 0 };
    const starving = world({ food: 2 });
    starving.vitals.armor = 2;
    const props = proposeTasks(starving, fakeBot(kit));
    const descents = props.filter(p => /^(mineDown|mineDiamonds|mineOres|branchMine)$/.test(p.skill || ''));
    assert.deepEqual(descents.map(p => p.kind), [], 'no descent proposal while starving');
    for (const k of ['GET_DIAMOND', 'GO_UNDERGROUND', 'GET_IRON_TOOLS', 'DUSK_MINE_NIGHT'])
        assert.equal(isGoalDone(k, starving, fakeBot(kit)), true, `${k} released while starving`);
    const fed = world({ food: 7 });
    fed.vitals.armor = 2;
    const fedDesc = proposeTasks(fed, fakeBot(kit)).filter(p => /^(mineDown|mineDiamonds|mineOres)$/.test(p.skill || ''));
    assert.ok(fedDesc.length > 0, `not starving → descent still allowed (got ${fedDesc.map(p => p.kind)})`);
    assert.equal(isGoalDone('GET_DIAMOND', fed, fakeBot(kit)), false);
});

test('T-0069 跟进: 饿着在矿里 (无可见动物) → FOOD_FLOOR 先上浮 (surfaceFirst), 地面无动物则不提', () => {
    const base = { foodInstincts: false, overworld: true, phase: 'day', food: 2, actionable: 0, counts: LIVE, botY: 20, animal: null };
    const p = foodFloorProposal({ ...base, depthBand: 'mid' });
    assert.ok(p, 'proposed underground');
    assert.equal(p.args[0].surfaceFirst, true);
    const surf = foodFloorProposal({ ...base, depthBand: 'surface', botY: 70 });
    assert.ok(surf && surf.args[0].scout && !surf.args[0].surfaceFirst, 'on the surface with no animal → bounded scout (监工加急#2), not surfaceFirst');
    const f5 = foodFloorProposal({ ...base, food: 5, depthBand: 'mid' });
    assert.ok(f5 && !f5.args[0].surfaceFirst, 'not starving (food 5) → no forced surfacing (scout only)');
});

test('监工加急#2: 饿着在地面且 48 格内零动物 → FOOD_FLOOR 有界侦察 (≤96 格/≤90s), 不饿则不侦察', () => {
    const base = { foodInstincts: false, overworld: true, phase: 'day', food: 0, actionable: 0, counts: LIVE, botY: 63, depthBand: 'surface', animal: null };
    const p = foodFloorProposal(base);
    assert.ok(p, '17:43Z live: hp1 food0, no animal in 48b → must propose something');
    assert.equal(p.args[0].scout, true);
    assert.ok(p.args[0].scoutRadius <= 96 && p.args[0].scoutMs <= 90000);
    assert.equal(foodFloorProposal({ ...base, food: 7 }), null, 'food>6 (no session) → no scouting (no roaming)');
    assert.equal(foodFloorProposal({ ...base, phase: 'dusk' }), null, 'night chain owns dusk/night');
    assert.equal(foodFloorProposal({ ...base, actionable: 1 }), null);
});

test('监工加急#2: 侦察航点全在 96 格内, 有线索先朝线索; 16 格内有敌对立即判定危险', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qm2-'));
    fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
    const cwd = process.cwd(); process.chdir(home);
    try {
        const { scoutWaypoints, hostileWithin } = await import('../bots/_supervisor/skills/quickMeal.js');
        const o = { x: 81, y: 64, z: 54 };
        const pts = scoutWaypoints(o, 96, { x: 300, z: 54 });
        assert.ok(pts.every(p => Math.hypot(p.x - o.x, p.z - o.z) <= 96 + 1e-6), 'bounded radius');
        assert.ok(Math.abs(pts[0].x - (81 + 96)) < 1e-6, 'first leg heads toward the hint, clipped to 96');
        const V = (x, y, z) => ({ x, y, z, distanceTo(q) { return Math.hypot(this.x - q.x, this.y - q.y, this.z - q.z); } });
        assert.equal(hostileWithin({ entity: { position: V(0, 64, 0) }, entities: { 1: { name: 'zombie', position: V(10, 64, 0) } } }, 16), true);
        assert.equal(hostileWithin({ entity: { position: V(0, 64, 0) }, entities: { 1: { name: 'cow', position: V(10, 64, 0) } } }, 16), false);
    } finally { process.chdir(cwd); }
});

test('监工加急#3: y60(shallow) 饿着零动物 → 提案必须同时带 surfaceFirst+scout; quickMeal 先上浮(y<62)再侦察, 不直接失败', async () => {
    const p = foodFloorProposal({ foodInstincts: false, overworld: true, phase: 'day', food: 0, actionable: 0, counts: LIVE, botY: 60, depthBand: 'shallow', animal: null });
    assert.ok(p && p.args[0].surfaceFirst && p.args[0].scout, '17:57:41 live: surfaceFirst without scout → honest-fail x3 → cooldown');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qm3-'));
    fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
    const cwd = process.cwd(); process.chdir(home);
    try {
        const { default: quickMeal } = await import('../bots/_supervisor/skills/quickMeal.js');
        const V = (x, y, z) => ({ x, y, z, clone() { return V(this.x, this.y, this.z); }, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } });
        const calls = [], legs = [];
        const bot = { food: 0, entity: { position: V(81, 60, 54) }, entities: {},
            pathfinder: { stop() {}, setMovements() {}, goto: async (g) => { legs.push(g); } }, clearControlStates() {} };
        const ctx = { world: { getInventoryCounts: () => ({ coal: 60 }) },
            skills: { customSkill: async (_b, name) => { calls.push(name); if (name === 'surfaceUp') bot.entity.position = V(81, 71, 54); },
                attackEntity: async () => {}, pickupNearbyItems: async () => {}, consume: async () => {} } };
        const r = await quickMeal(bot, ctx, { ...p.args[0], scoutMs: 300 });
        assert.ok(calls.includes('surfaceUp'), 'surfaced first at y60');
        assert.ok(legs.length >= 1, 'then scouted');
        assert.notEqual(r.failed, true, 'surfacing is progress, not a strike');
    } finally { process.chdir(cwd); }
});

test('监工加急#3: GET_IRON_ARMOR_SET 饿着时不提且已承诺的被释放; 饥饿冻结给 FOOD_FLOOR/quickMeal 让路', () => {
    delete process.env.MC_FOOD_INSTINCTS;
    const w = world({ food: 0 });
    const props = proposeTasks(w, fakeBot(LIVE));
    assert.equal(props.find(p => p.kind === 'GET_IRON_ARMOR_SET'), undefined);
    assert.equal(isGoalDone('GET_IRON_ARMOR_SET', w, fakeBot(LIVE)), true);
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('function famineBodyFreeze'), src.indexOf('function famineForageActive'));
    assert.ok(/quickMeal/.test(fn), 'quickMeal whitelisted in famineBodyFreeze');
    assert.ok(/_commitment\.kind === 'FOOD_FLOOR'\) return false/.test(fn), 'FOOD_FLOOR commitment unfreezes the body');
});

test('18:04 实录: 41.7 格的羊 → quickMeal 必须先安全寻路贴近再出手 (attackEntity 对 >4 格目标直接放弃)', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qm4-'));
    fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
    const cwd = process.cwd(); process.chdir(home);
    try {
        const { default: quickMeal } = await import('../bots/_supervisor/skills/quickMeal.js');
        const V = (x, y, z) => ({ x, y, z, clone() { return V(this.x, this.y, this.z); }, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } });
        const inv = { coal: 60 };
        const sheep = { name: 'sheep', position: V(41.7, 73, 0) };
        const bot = { food: 0, entity: { position: V(0, 73, 0) }, entities: { 1: sheep },
            pathfinder: { stop() {}, setMovements() {}, goto: async () => { bot.entity.position = V(40, 73, 0); } }, clearControlStates() {} };
        const ctx = { world: { getInventoryCounts: () => ({ ...inv }) },
            skills: { attackEntity: async (_b, e) => { if (e.position.distanceTo(bot.entity.position) > 4) return false; inv.mutton = 1; return true; },
                pickupNearbyItems: async () => {}, customSkill: async () => {}, consume: async () => {} } };
        const r = await quickMeal(bot, ctx, { radius: 48, maxDy: 6, maxMs: 60000 });
        assert.equal(r.gotMeat, true, 'approached then killed');
    } finally { process.chdir(cwd); }
});

test('监工#5: 苦力怕 6-16 格不逼近 → 背离侦察; ≤6 格 → 收手且返回 deferred (不计 strike); FOOD_FLOOR 免 NO-OP 强制 migrate', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qm5-'));
    fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
    const cwd = process.cwd(); process.chdir(home);
    try {
        const { default: quickMeal, awayPoint } = await import('../bots/_supervisor/skills/quickMeal.js');
        const { isDispatchFailure, NOOP_EXEMPT_KIND } = await import('../bots/_supervisor/skills/kernelDriver.js');
        const ap = awayPoint({ x: 0, z: 0 }, { x: 10, z: 0 }, 24);
        assert.ok(ap.x < -23 && Math.abs(ap.z) < 1e-9, 'away = opposite side of the creeper');
        const V = (x, y, z) => ({ x, y, z, clone() { return V(this.x, this.y, this.z); }, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } });
        // (a) creeper at 10b, static → scout heads away (first goto target x < 0)
        const goals = [];
        const botA = { food: 0, entity: { position: V(0, 70, 0) }, entities: { 9: { name: 'creeper', position: V(10, 70, 0) } },
            pathfinder: { stop() {}, setMovements() {}, goto: async (g) => { goals.push(g); } }, clearControlStates() {} };
        const ctx = { world: { getInventoryCounts: () => ({ coal: 60 }) },
            skills: { customSkill: async () => {}, attackEntity: async () => {}, pickupNearbyItems: async () => {}, consume: async () => {} } };
        await quickMeal(botA, ctx, { radius: 48, maxDy: 6, maxMs: 60000, scout: true, scoutRadius: 96, scoutMs: 1500 });
        assert.ok(goals.length >= 1 && goals[0].x < 0, `first leg away from creeper (x=${goals[0] && goals[0].x})`);
        // (b) creeper at 2.7b (18:13 live) → defer, not a failure/strike
        const botB = { ...botA, entities: { 9: { name: 'creeper', position: V(2.7, 70, 0) } }, pathfinder: { stop() {}, setMovements() {}, goto: async () => {} } };
        const r = await quickMeal(botB, ctx, { radius: 48, maxDy: 6, maxMs: 60000, scout: true, scoutRadius: 96, scoutMs: 1200 });
        assert.equal(r.deferred, true);
        assert.equal(isDispatchFailure(r, false), false, 'hostile-near defer is not a strike');
        assert.ok(NOOP_EXEMPT_KIND.test('FOOD_FLOOR'));
    } finally { process.chdir(cwd); }
});

test('监工加急#6: hp<10 关下矿门 — 18:22:30 实录 food 12/hp 1 翻 GET_DIAMOND 带全套铁装下矿; hp≥10 放行', async () => {
    delete process.env.MC_FOOD_INSTINCTS;
    const { descentBlocked } = await import('../src/agent/framework/food_floor.js');
    const kit = { ...LIVE, cooked_beef: 1 };
    const w = world({ food: 12 }); w.vitals.hp = 1; w.vitals.armor = 2;
    const descents = proposeTasks(w, fakeBot(kit)).filter(p => /^(mineDown|mineDiamonds|mineOres|branchMine)$/.test(p.skill || ''));
    assert.deepEqual(descents.map(p => p.kind), [], 'hp 1 → no descent');
    for (const k of ['GET_DIAMOND', 'GO_UNDERGROUND', 'GET_IRON_ARMOR_SET']) assert.equal(isGoalDone(k, w, fakeBot(kit)), true, `${k} released at hp 1`);
    assert.equal(descentBlocked({ food: 12, counts: kit, hp: 9 }), true);
    assert.equal(descentBlocked({ food: 12, counts: kit, hp: 10 }), false);
    const ok = world({ food: 12 }); ok.vitals.hp = 14; ok.vitals.armor = 2;
    assert.equal(isGoalDone('GET_DIAMOND', ok, fakeBot(kit)), false, 'hp 14 → descent allowed');
});

test('监工拍板: FOOD_FLOOR 迟滞 — food≤6 触发, 补到 ≥18 且熟食≥4 才释放; 附近无动物时 ≥18 即释放; 会话最多 6 只', async () => {
    const { updateFoodFloorLatch, SESSION_KILL_CAP } = await import('../src/agent/framework/food_floor.js');
    let L = updateFoodFloorLatch(null, { food: 6, counts: {}, animalNear: true, now: 1 });
    assert.equal(L.active, true, 'trigger at 6');
    L = updateFoodFloorLatch(L, { food: 12, counts: { cooked_beef: 1 }, animalNear: true });
    assert.equal(L.active, true, '18:22:30 live: food 12 must NOT release (hp stays 1 below 18)');
    const p = foodFloorProposal({ foodInstincts: false, overworld: true, phase: 'day', food: 12, actionable: 0, counts: { ...LIVE, cooked_beef: 1 },
        animal: { x: 0, y: 76, z: 0, dist: 20, meta: 'pig', age: 1000 }, botY: 76, latch: L });
    assert.ok(p && !p.args[0].scout, 'keeps hunting nearby animals while latched (no scouting above 6)');
    assert.equal(foodFloorProposal({ foodInstincts: false, overworld: true, phase: 'day', food: 12, actionable: 0, counts: LIVE, animal: null, botY: 76, latch: L }), null, 'no scouting for stock above food 6');
    assert.equal(updateFoodFloorLatch(L, { food: 18, counts: { cooked_beef: 3 }, animalNear: true }).active, true, 'needs ≥4 cooked');
    assert.equal(updateFoodFloorLatch(L, { food: 18, counts: { cooked_beef: 4 }, animalNear: true }).active, false);
    assert.equal(updateFoodFloorLatch(L, { food: 18, counts: {}, animalNear: false }).active, false, 'no animal nearby → release at 18');
    assert.equal(updateFoodFloorLatch({ ...L, kills: SESSION_KILL_CAP }, { food: 10, counts: {}, animalNear: true }).active, false, 'kill cap');
    const w = world({ food: 12 });
    const bot = fakeBot({ ...LIVE, cooked_beef: 1 }); bot._foodFloorLatch = L;
    assert.equal(isGoalDone('FOOD_FLOOR', w, bot), false, 'commitment held while latched');
});

test('监工加急#6: 夜链 MINE_THROUGH_NIGHT 也受 hp<10 门 (否则剔掉夜挖后夜里无提案)', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const i = src.indexOf("decision: 'MINE_THROUGH_NIGHT', reason: `pickBudget");
    const line = src.slice(src.lastIndexOf('\n', i), i);
    assert.ok(/_hpOkForNightMine/.test(line), 'canMineWholeNight branch is hp-gated');
    const j = src.indexOf("keep mining, don't surface-bootstrap");
    assert.ok(/_hpOkForNightMine/.test(src.slice(src.lastIndexOf('\n', j), j)), 'alreadyDeepEnclosed branch is hp-gated');
    assert.ok(/import \{ DESCENT_MIN_HP \} from '\.\/framework\/food_floor\.js'/.test(src));
});

test('T-0134: 重启后锁存丢失也要能重建 — hp 1 / food 15 (回不了血) 必须开会话; hp 满 food 15 不开', async () => {
    const { updateFoodFloorLatch } = await import('../src/agent/framework/food_floor.js');
    assert.equal(updateFoodFloorLatch(null, { food: 15, counts: {}, animalNear: true, hp: 1 }).active, true, '18:38 restart live: hp1 food15 → session');
    assert.equal(updateFoodFloorLatch(null, { food: 15, counts: {}, animalNear: true, hp: 20 }).active, false, 'healthy → no session');
    const w = world({ food: 15 }); w.vitals.hp = 1;
    const bot = fakeBot(LIVE);
    w.landmarks.animal = { x: 60, y: 76, z: 33, dist: 10, meta: 'cow', age: 1000 };
    const ff = proposeTasks(w, bot).find(p => p.kind === 'FOOD_FLOOR');
    assert.ok(ff && !ff.args[0].scout, 'hunts the nearby cow (no scouting above food 6)');
});
