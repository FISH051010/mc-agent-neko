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
    assert.equal(callerKey(fake), 'Object.update@modes.js:4321 < tick@modes.js:9000', 'external call chain (T-0199 round 2)');
    assert.equal(callerKey('Error: stopProbe\n    at scoutForAnimalInner (/x/bots/_supervisor/skills/quickMeal.js:150:20)'), 'quickMeal(self)');
    // 侦察里被外部打断 → 汇总日志写出打断者
    const logp = path.join(process.cwd(), 'bots', '_supervisor', 'progress.txt');
    let stopRef = null;
    const bot = { food: 3, health: 18, entity: { position: V(0, 64, 0) }, entities: {}, blockAt: () => ({ name: 'air', skyLight: 15 }),
        pathfinder: { stop() {}, setGoal() {}, setMovements() {},
            // 入侵者从别的事件循环 (如 modes tick) 打断 — 栈里没有 quickMeal 帧
            goto: async function () { await new Promise(r => setImmediate(function intruder() { bot.pathfinder.stop(); r(); })); throw new Error('Path was stopped before it could be completed!'); } },
        clearControlStates() {} };
    stopRef = bot.pathfinder.stop;
    await quickMeal(bot, { world: { getInventoryCounts: () => ({}) }, skills: { customSkill: async () => {}, attackEntity: async () => {}, consume: async () => {} } },
        { radius: 48, maxDy: 12, maxMs: 60000, scout: true, scoutRadius: 24, scoutMs: 3000 });
    assert.equal(bot.pathfinder.stop, stopRef, 'restored');
    assert.ok(/scout interrupters \(T-0199 probe\)/.test(fs.readFileSync(logp, 'utf8')), 'summary logged');
});

test('T-0204: pathfinder.stop() 的延迟标志不再杀下一段 — 按真实库语义建模 (stop 置标志, 下次 setGoal 时才执行并拒掉新 goto)', async () => {
    // mineflayer-pathfinder: stop() → stopPathing=true; setGoal()/goto() 内 resetPath: if (stopPathing) stop() → 新 goto 拒 "Path was stopped"
    let stopPathing = false, gotos = 0, killed = 0;
    const cow = { name: 'cow', position: V(70, 64, 0), isValid: true };
    const bot = { food: 3, health: 18, entity: { position: V(0, 64, 0) }, entities: {}, blockAt: () => ({ name: 'air', skyLight: 15 }),
        pathfinder: {
            stop() { stopPathing = true; },
            setGoal(g) { if (stopPathing) { stopPathing = false; } },
            setMovements() {},
            goto: async function (g) {
                gotos++;
                if (stopPathing) { stopPathing = false; killed++; throw new Error('Path was stopped before it could be completed!'); }
                bot.entity.position = V(bot.entity.position.x + 20, 64, 0);   // 每段真走 20 格
                if (bot.entity.position.x >= 40) bot.entities = { 1: cow };
            } },
        clearControlStates() {} };
    await quickMeal(bot, { world: { getInventoryCounts: () => ({}) }, skills: { customSkill: async () => {}, attackEntity: async () => {}, consume: async () => {} } },
        { radius: 48, maxDy: 12, maxMs: 60000, scout: true, scoutRadius: 96, scoutMs: 90000 });
    assert.equal(killed, 0, `no leg killed by a stale stop flag (gotos=${gotos}, killed=${killed})`);
    assert.ok(bot.entity.position.x >= 40, 'actually walked out and saw the cow');
});

test('T-0211: 地下饿着要上浮, 但 16 格内有敌对 → 不上浮 (等 ≤15s, 仍在则延后不计 strike) — death #17 拂晓往僵尸堆里爬', async () => {
    const calls = [];
    const zombie = { name: 'zombie', position: V(5, 36, 0) };
    const bot = { food: 6, health: 20, entity: { position: V(0, 36, 0) }, entities: { 9: zombie }, blockAt: () => ({ name: 'stone', skyLight: 0 }),
        pathfinder: { stop() {}, setGoal() {}, setMovements() {}, goto: async () => {} }, clearControlStates() {} };
    const ctx = { world: { getInventoryCounts: () => ({}) }, skills: { customSkill: async (_b, n) => { calls.push(n); }, attackEntity: async () => {}, consume: async () => {} } };
    const t0 = Date.now();
    const realSetTimeout = global.setTimeout;
    const r = await quickMeal(bot, ctx, { radius: 48, maxDy: 12, maxMs: 60000, surfaceFirst: true, scout: true, scoutRadius: 96, scoutMs: 90000 });
    assert.ok(!calls.includes('surfaceUp'), `did not climb into the mob (calls=${calls})`);
    assert.equal(r.deferred, true, JSON.stringify(r));
    assert.ok(Date.now() - t0 < 17000);
});

test('T-0213: 定向侦察航点沿连线每 32b 一段走到目标 (145b), 再绕目标 16b 一圈, 不是一个够不着的直达点', async () => {
    const { scoutWaypoints } = await import('../bots/_supervisor/skills/quickMeal.js');
    const pts = scoutWaypoints({ x: 0, y: 64, z: 0 }, 162, { x: 145, z: 0 });
    const line = pts.slice(0, 5);
    assert.deepEqual(line.map(p => Math.round(p.x)), [32, 64, 96, 128, 145], 'stepwise along the line to the target');
    assert.ok(line.every(p => Math.abs(p.z) < 1e-6));
    const ring = pts.slice(5, 13);
    assert.equal(ring.length, 8);
    assert.ok(ring.every(p => Math.abs(Math.hypot(p.x - 145, p.z) - 16) < 1e-6), 'circle the target at 16b');
});
