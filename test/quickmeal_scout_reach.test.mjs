// T-0189 (监工加急): 23:21:15-17Z 三次 quickMeal —
// ① "starving underground y=61 — surfaceUp first" → "surfaced y 61→61": y61 本在地表 (mob=FREE), y<62 误判地下, 上浮空转;
// ② "bounded scout ≤96b/90s" 0.15-0.4s 就 "found nothing": 航点 GoalNear 把目标 y 钉在起点, 远处地形高低不一 → 全不可达秒败。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-scout-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.chdir(home);
const { default: quickMeal } = await import('../bots/_supervisor/skills/quickMeal.js');
const { foodFloorProposal } = await import('../src/agent/framework/food_floor.js');

const V = (x, y, z) => ({ x, y, z, clone() { return V(this.x, this.y, this.z); }, offset(dx, dy, dz) { return V(this.x + dx, this.y + dy, this.z + dz); }, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } });

function rig({ skyLight = 15, unreachableLegs = 3 }) {
    const calls = [], goals = [];
    let leg = 0;
    const cow = { name: 'cow', position: V(80, 70, 0), isValid: true };
    const bot = { food: 5, health: 11, entity: { position: V(0, 61, 0) }, entities: {},
        blockAt: () => ({ name: 'air', skyLight }),
        pathfinder: { stop() {}, setMovements() {},
            goto: async (g) => {
                goals.push(g); leg++;
                if (leg <= unreachableLegs) throw new Error('No path to the goal!');
                bot.entity.position = V(60, 70, 0);   // 走到坡上, 牛进入 48 格
                bot.entities = { 1: cow };
            } },
        clearControlStates() {} };
    const ctx = { world: { getInventoryCounts: () => ({ coal: 21 }) },
        skills: { customSkill: async (_b, name) => { calls.push(name); }, attackEntity: async () => { calls.push('attack'); }, pickupNearbyItems: async () => {}, consume: async () => {} } };
    return { bot, ctx, calls, goals };
}

test('T-0189: y61 头顶见天 → 不上浮 (surfaceUp 空转); 侦察前几个航点不可达 → 换下一个点继续, 走到坡上看见牛', async () => {
    const { bot, ctx, calls, goals } = rig({ skyLight: 15, unreachableLegs: 3 });
    await quickMeal(bot, ctx, { radius: 48, maxDy: 12, maxMs: 60000, surfaceFirst: true, scout: true, scoutRadius: 96, scoutMs: 90000 });
    assert.ok(!calls.includes('surfaceUp'), `no pointless surfaceUp (calls=${calls})`);
    assert.ok(goals.length >= 4, `kept trying waypoints after failures (legs=${goals.length})`);
    assert.ok(calls.includes('attack'), 'found and hunted the cow');
});

test('T-0189: 侦察航点不限高度 (GoalNearXZ), 不再把目标 y 钉在起点', async () => {
    const { bot, ctx, goals } = rig({ skyLight: 15, unreachableLegs: 0 });
    await quickMeal(bot, ctx, { radius: 48, maxDy: 12, maxMs: 60000, scout: true, scoutRadius: 96, scoutMs: 90000 });
    assert.ok(goals.length >= 1);
    assert.equal(goals[0].constructor.name, 'GoalNearXZ');
});

test('T-0189: 头顶不见天 (skyLight 0) 的 y61 才上浮; 决策层 skyOpen=true 不算地下, false/未知回落旧口径', async () => {
    const { bot, ctx, calls } = rig({ skyLight: 0, unreachableLegs: 0 });
    await quickMeal(bot, ctx, { radius: 48, maxDy: 12, maxMs: 60000, surfaceFirst: true, scout: true, scoutRadius: 96, scoutMs: 90000 });
    assert.ok(calls.includes('surfaceUp'));
    const base = { foodInstincts: false, overworld: true, phase: 'day', food: 5, actionable: 0, counts: {}, animal: null, botY: 61, depthBand: 'shallow' };
    assert.ok(!foodFloorProposal({ ...base, skyOpen: true }).args[0].surfaceFirst, 'sky open → not underground');
    assert.ok(foodFloorProposal({ ...base, skyOpen: false }).args[0].surfaceFirst);
    assert.ok(foodFloorProposal({ ...base }).args[0].surfaceFirst, 'unknown → old y rule');
});

test('T-0189 补: 侦察段被反射叫停 ("Path was stopped") 不耗航点; 连续 3 次叫停且有敌对 → 延后返回 (不计 strike)', async () => {
    const goals = [];
    const creeper = { name: 'creeper', position: V(12, 61, 0) };
    const bot = { food: 3, health: 11, entity: { position: V(0, 61, 0) }, entities: { 9: creeper },
        blockAt: () => ({ name: 'air', skyLight: 15 }),
        pathfinder: { stop() {}, setMovements() {}, goto: async (g) => { goals.push(g); throw new Error('Path was stopped before it could be completed!'); } },
        clearControlStates() {} };
    const ctx = { world: { getInventoryCounts: () => ({}) }, skills: { customSkill: async () => {}, attackEntity: async () => {}, consume: async () => {} } };
    const r = await quickMeal(bot, ctx, { radius: 48, maxDy: 12, maxMs: 60000, scout: true, scoutRadius: 96, scoutMs: 90000 });
    assert.equal(r.deferred, true, JSON.stringify(r));
    assert.ok(goals.length <= 4, `did not burn through waypoints (${goals.length} legs)`);
});

test('T-0191: 危急 (food≤3) 猎到生猪排 → 先生吃一块再烤 (不让全部生肉进炉、包里零可吃)', async () => {
    const order = [];
    const inv = {};
    const pig = { name: 'pig', position: V(1, 61, 0), isValid: true };
    const bot = { food: 0, health: 5, entity: { position: V(0, 61, 0) }, entities: { 1: pig },
        blockAt: () => ({ name: 'air', skyLight: 15 }),
        pathfinder: { stop() {}, setMovements() {}, goto: async () => {} }, clearControlStates() {} };
    const ctx = { world: { getInventoryCounts: () => ({ coal: 30, ...inv }) },
        skills: { customSkill: async (_b, name) => { order.push(name); if (name === 'smeltSafe') { inv.cooked_porkchop = (inv.porkchop || 0); inv.porkchop = 0; } },
                  attackEntity: async () => { inv.porkchop = 3; }, pickupNearbyItems: async () => {},
                  consume: async (_b, item) => { order.push('eat:' + item); if (inv[item]) inv[item]--; bot.food += 3; } } };
    await quickMeal(bot, ctx, { radius: 48, maxDy: 12, maxMs: 60000 });
    const iEat = order.indexOf('eat:porkchop'), iCook = order.indexOf('smeltSafe');
    assert.ok(iEat >= 0 && (iCook < 0 || iEat < iCook), `ate raw before cooking: ${order}`);
});

test('T-0199 诊断: 侦察期间外部 pathfinder.stop 被归因到调用者; 自身 stop 不计; 结束后还原原函数', async () => {
    const { callerKey } = await import('../bots/_supervisor/skills/quickMeal.js');
    const fake = 'Error: stopProbe\n    at pf.stop (/x/bots/_supervisor/skills/quickMeal.js:110:9)\n    at Object.update (/x/src/agent/modes.js:4321:30)\n    at tick (/x/src/agent/modes.js:9000:5)';
    assert.equal(callerKey(fake), 'Object.update@modes.js:4321');
    assert.equal(callerKey('Error: stopProbe\n    at scoutForAnimalInner (/x/bots/_supervisor/skills/quickMeal.js:150:20)'), 'quickMeal(self)');
    // 侦察里被外部打断 → 汇总日志写出打断者
    const logp = path.join(process.cwd(), 'bots', '_supervisor', 'progress.txt');
    let stopRef = null;
    const bot = { food: 3, health: 18, entity: { position: V(0, 64, 0) }, entities: {}, blockAt: () => ({ name: 'air', skyLight: 15 }),
        pathfinder: { stop() {}, setGoal() {}, setMovements() {},
            goto: async function () { function intruder() { bot.pathfinder.stop(); } intruder(); throw new Error('Path was stopped before it could be completed!'); } },
        clearControlStates() {} };
    stopRef = bot.pathfinder.stop;
    await quickMeal(bot, { world: { getInventoryCounts: () => ({}) }, skills: { customSkill: async () => {}, attackEntity: async () => {}, consume: async () => {} } },
        { radius: 48, maxDy: 12, maxMs: 60000, scout: true, scoutRadius: 24, scoutMs: 3000 });
    assert.equal(bot.pathfinder.stop, stopRef, 'restored');
    assert.ok(/scout interrupters \(T-0199 probe\)/.test(fs.readFileSync(logp, 'utf8')), 'summary logged');
});
