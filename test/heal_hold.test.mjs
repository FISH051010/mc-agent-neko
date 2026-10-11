// T-0237 养伤 (监工指派 2026-10-11): worker-death 复盘挂起期 #1/#3/#6/#8 — 死前 20-62min hp≤10 不回血 (food 17 不到 18 /
// food 0 饿到 1 血 / 带着生鸡饿死), 决策层照派 MIGRATE/REPLENISH_KIT/GET_PORTAL_KIT/reclaimFurnace; #3 hp1 被 migrate 带向骷髅。
// 修: hp<10 (同 descentBlocked 线) 锁存到 16 → HEAL@80 (healHold: 吃到 ≥18 原地等回血), 剔除并释放出门/迁移/远行类承诺;
// 生鸡放开线与腐肉同档 (food≤6 或回不了血)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.chdir(home);
process.env.MC_FOOD_INSTINCTS = '0';

const { proposeTasks, isGoalDone, commitGoal } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');
const { healLatchNext } = await import('../src/agent/framework/food_floor.js');
const { pickAutoEatFood } = await import('../src/agent/framework/healing_reflex.js');
const { default: healHold } = await import('../bots/_supervisor/skills/healHold.js');

const mkBot = (inv, { hp = 6, food = 17 } = {}) => ({ inventory: { items: () => Object.entries(inv).filter(([, c]) => c > 0).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 70, z: 0 } }, entities: {}, health: hp, food });
const mkWorld = ({ hp = 6, food = 17, phase = 'day' } = {}) => { const w = JSON.parse(JSON.stringify(EMPTY_WORLD)); w.time = { ...w.time, phase, isDay: phase === 'day' };
    w.vitals = { ...w.vitals, hp, food }; w.kit = { ...w.kit, picks: 2, pickTier: 'stone', sufficientForUnderground: true }; return w; };

test('T-0237: 养伤锁存 — hp<10 进入, 回到 16 才放手 (迟滞, 不在 9↔10 抖)', () => {
    assert.equal(healLatchNext(false, 9), true);
    assert.equal(healLatchNext(true, 12), true, 'still healing until 16');
    assert.equal(healLatchNext(false, 12), false, 'never entered → no latch');
    assert.equal(healLatchNext(true, 16), false);
});

test('T-0237: hp6 food17 (到不了 18 不回血) + 包里有熟食 → 提 HEAL@80 (healHold); 白天抢下 MIGRATE 承诺', () => {
    const bot = mkBot({ cooked_porkchop: 3, stone_pickaxe: 2 });
    const ps = proposeTasks(mkWorld(), bot);
    const heal = ps.find(p => p.kind === 'HEAL');
    assert.ok(heal && heal.skill === 'healHold' && heal.priority === 80, JSON.stringify(ps.map(p => p.kind)));
    bot._commitment = { kind: 'MIGRATE', skill: 'migrate', args: [], since: 0 };
    assert.equal(isGoalDone('MIGRATE', mkWorld(), bot), true, 'committed migrate released while healing');
    assert.equal(commitGoal(bot, ps, mkWorld()).kind, 'HEAL');
});

test('T-0237: 养伤期间剔除出门/迁移/远行类提案; hp 回到 16 后恢复', () => {
    const bot = mkBot({ cooked_porkchop: 3, stone_pickaxe: 2 });
    const ps = proposeTasks(mkWorld(), bot);
    for (const k of ['MIGRATE', 'REPLENISH_KIT', 'GET_PORTAL_KIT', 'RECLAIM_FURNACE', 'GET_BED']) assert.ok(!ps.some(p => p.kind === k), `${k} filtered`);
    bot.health = 16; proposeTasks(mkWorld({ hp: 16, food: 18 }), bot);
    assert.equal(bot._healLatch, false, 'latch released at 16');
    assert.equal(isGoalDone('HEAL', mkWorld({ hp: 16, food: 18 }), bot), true);
});

test('T-0237: 吃不饱 (包里零可吃, food<18) → 不提 HEAL, 交给 FOOD_FLOOR 去猎', () => {
    const bot = mkBot({ stone_pickaxe: 2 }, { hp: 5, food: 4 });
    const ps = proposeTasks(mkWorld({ hp: 5, food: 4 }), bot);
    assert.ok(!ps.some(p => p.kind === 'HEAL'));
    assert.ok(ps.some(p => p.kind === 'FOOD_FLOOR'), JSON.stringify(ps.map(p => p.kind)));
});

test('T-0237: 生鸡放开线与腐肉同档 — food≤6 或回不了血 (hp6 food17) 别无可吃就吃生鸡; 满血 food 8 不吃', () => {
    assert.equal(pickAutoEatFood([{ name: 'chicken', count: 2 }], { health: 20, food: 6 })?.name, 'chicken');
    assert.equal(pickAutoEatFood([{ name: 'chicken', count: 2 }], { health: 6, food: 17 })?.name, 'chicken');
    assert.equal(pickAutoEatFood([{ name: 'chicken', count: 2 }], { health: 20, food: 8 }), null);
});

test('T-0237: healHold — 吃到 18, 原地等到 hp≥16 返回 true; 包里没吃的 → {failed:no-food} 交 FOOD_FLOOR', async () => {
    const inv = { cooked_beef: 2 };
    const bot = { health: 6, food: 12, inventory: { items: () => Object.entries(inv).filter(([, c]) => c > 0).map(([name, count]) => ({ name, count })) },
        pathfinder: { setGoal() {} }, clearControlStates() {} };
    const ctx = { skills: { consume: async (_b, n) => { inv[n]--; bot.food = Math.min(20, bot.food + 8); } } };
    const timer = setInterval(() => { if (bot.food >= 18) bot.health = Math.min(20, bot.health + 2); }, 5);
    const r = await healHold(bot, ctx, { maxMs: 3000, stepMs: 5 });
    clearInterval(timer);
    assert.equal(r, true);
    assert.ok(bot.food >= 18 && bot.health >= 16);
    const hungry = { health: 6, food: 10, inventory: { items: () => [] }, pathfinder: { setGoal() {} }, clearControlStates() {} };
    const r2 = await healHold(hungry, { skills: { consume: async () => {} } }, { maxMs: 500, stepMs: 5 });
    assert.equal(r2.failed, true);
    assert.equal(r2.reason, 'no-food');
});
