// T-0206 (death #16 01:43:33-41Z): commitment 每秒翻 GET_BED→MIGRATE "interrupt bedErrand" ×8, 子任务 8 秒不理 interrupt_code,
// 位置钉死 act/ctrl 皆空 (没人驾驶), 僵尸贴身打。①侦察/等待一律可被 interrupt_code 打断 (≤1s 退出);
// ②kernelDriver 翻转后子任务 2s 不退 → 强制 setGoal(null)+clearControlStates 交出身体。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'intr-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
fs.copyFileSync(path.join(repo, 'bots', '_supervisor', 'arbitration.json'), path.join(home, 'bots', '_supervisor', 'arbitration.json'));
process.env.MC_AGENT_HOME = home;
process.chdir(home);

const { default: quickMeal } = await import('../bots/_supervisor/skills/quickMeal.js');
const { default: bedErrand } = await import('../bots/_supervisor/skills/bedErrand.js');
const { default: kernelDriver, FLIP_FORCE_HALT_MS } = await import('../bots/_supervisor/skills/kernelDriver.js');

const V = (x, y, z) => ({ x, y, z, clone() { return V(this.x, this.y, this.z); }, offset(dx, dy, dz) { return V(this.x + dx, this.y + dy, this.z + dz); }, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } });
function hangingBot() {
    return { food: 14, health: 18, entity: { position: V(0, 66, 0) }, entities: {}, blockAt: () => ({ name: 'air', skyLight: 15 }),
        inventory: { items: () => [] },
        pathfinder: { stop() {}, setGoal() {}, setMovements() {}, goto: () => new Promise(() => {}) },   // 寻路永不返回 (live: 一段 20s)
        clearControlStates() {} };
}
const ctxOf = () => ({ world: { getInventoryCounts: () => ({}) }, skills: { customSkill: async () => false, attackEntity: async () => {}, consume: async () => {}, pickupNearbyItems: async () => {}, equip: async () => {} } });

test('T-0206: 侦察中 interrupt_code 置位 → quickMeal ≤1.5s 退出 (不等 20s 一段)', async () => {
    const bot = hangingBot(); bot.food = 3;
    setTimeout(() => { bot.interrupt_code = true; }, 300);
    const t0 = Date.now();
    await quickMeal(bot, ctxOf(), { radius: 48, maxDy: 12, maxMs: 60000, scout: true, scoutRadius: 96, scoutMs: 90000 });
    assert.ok(Date.now() - t0 < 1500, `exited in ${Date.now() - t0}ms`);
});

test('T-0206: bedErrand 侦察找羊中被打断 → ≤1.5s 退出', async () => {
    const bot = hangingBot();
    setTimeout(() => { bot.interrupt_code = true; }, 300);
    const t0 = Date.now();
    await bedErrand(bot, ctxOf());
    assert.ok(Date.now() - t0 < 1500, `exited in ${Date.now() - t0}ms`);
});

test('T-0206: kernelDriver — 承诺翻转后子任务 2s 不退 → 强制 setGoal(null)+clearControlStates 交出身体', async () => {
    assert.equal(FLIP_FORCE_HALT_MS, 2000);
    const halts = [];
    const bot = { game: { dimension: 'overworld' }, _mobility: { state: 'FREE' }, _world: { threat: { actionable: 0 }, vitals: { food: 17 } },
        _commitment: { kind: 'GET_BED', skill: 'bedErrand', args: [] }, entity: null,
        pathfinder: { setGoal: (g) => { if (g === null) halts.push(Date.now()); } }, clearControlStates() {} };
    let t0 = 0, childDone = 0, dispatched = 0;
    const ctx = {
        pace: async () => { if (dispatched) bot._supervisorCancelAt = Date.now(); },
        skills: {
            wait: async () => { if (dispatched) bot._supervisorCancelAt = Date.now(); },
            customSkill: async () => {
                dispatched++; t0 = Date.now();
                setTimeout(() => { bot._commitment = { kind: 'MIGRATE', skill: 'migrate', args: [] }; }, 100);   // 决策层翻向 MIGRATE
                await new Promise(r => setTimeout(r, 4500));   // 子任务不理 interrupt_code (live: 8s)
                childDone = Date.now();
                return false;
            },
        },
        world: { getInventoryCounts: () => ({}) },
    };
    await kernelDriver(bot, ctx);
    assert.ok(halts.length >= 1, 'body force-released');
    assert.ok(halts[0] < childDone, 'released BEFORE the stubborn child returned');
    assert.ok(halts[0] - t0 <= 4000, `released ${halts[0] - t0}ms after dispatch`);
});

test('T-0206 + 监工协调: 反射持身 (_bodyOwner.kind=mode, 如 self_defense 接战) → 不打断也不强制接管 (否则 defendSelf 见旗即 pvp.stop)', async () => {
    const halts = [];
    const bot = { game: { dimension: 'overworld' }, _mobility: { state: 'FREE' }, _world: { threat: { actionable: 0 }, vitals: { food: 17 } },
        _commitment: { kind: 'GET_BED', skill: 'bedErrand', args: [] }, entity: null,
        _bodyOwner: { name: 'mode:self_defense', kind: 'mode', since: Date.now() },
        pathfinder: { setGoal: (g) => { if (g === null) halts.push(Date.now()); } }, clearControlStates() {} };
    let dispatched = 0, sawInterrupt = false;
    const ctx = {
        pace: async () => { if (dispatched) bot._supervisorCancelAt = Date.now(); },
        skills: { wait: async () => { if (dispatched) bot._supervisorCancelAt = Date.now(); },
            customSkill: async () => {
                dispatched++;
                setTimeout(() => { bot._commitment = { kind: 'MIGRATE', skill: 'migrate', args: [] }; }, 100);
                for (let i = 0; i < 35; i++) { await new Promise(r => setTimeout(r, 100)); if (bot.interrupt_code) sawInterrupt = true; }
                return false;
            } },
        world: { getInventoryCounts: () => ({}) },
    };
    await kernelDriver(bot, ctx);
    assert.equal(halts.length, 0, 'no force halt while a reflex holds the body');
    assert.equal(sawInterrupt, false, 'no global interrupt raised while a reflex holds the body');
});

test('T-0206: 有可动敌对时不提 MIGRATE (death #16: 僵尸贴身 hp4 翻向长途迁移); 敌对清掉照常提', async () => {
    const { proposeTasks } = await import('../src/agent/framework/world_model.js');
    const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');
    const mk = (actionable) => { const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
        w.time = { ...w.time, phase: 'day', isDay: true }; w.threat = { ...w.threat, actionable };
        w.migration = { ...w.migration, recommend: true, inDeathZone: true }; return w; };
    const bot = { inventory: { items: () => [], slots: [] }, game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 70, z: 0 } } };
    assert.ok(!proposeTasks(mk(1), bot).some(p => p.kind === 'MIGRATE'), 'hostile near → no migrate');
    assert.ok(proposeTasks(mk(0), bot).some(p => p.kind === 'MIGRATE'), 'clear → migrate proposed');
});
