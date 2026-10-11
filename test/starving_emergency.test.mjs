// T-0230 (监工加急, 2026-10-11): bot hp1 food0 卡 1h+。两个机理:
// ① 01:00-01:06Z 白天 food 6→0、hp 20→1: REPLENISH_KIT@67 粘性承诺握着身体 (surfaceUp 零升高), FOOD_FLOOR@70 抢不下 —
//    食物本能关 (用户令 MC_FOOD_INSTINCTS=0) 时 isEmergency 只认的 GET_FOOD 整条不提, 饥饿永远不是紧急。
// ② 00:23-00:36Z: 包里只剩 1 生鸡肉 + 0 煤 → quickMeal 不烤、不吃生鸡 → 零动作 "done food 0→0" ×3 → 冷却循环十几轮。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'starve-emerg-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.chdir(home);
process.env.MC_FOOD_INSTINCTS = '0';

const { commitGoal } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');
const { pickAutoEatFood } = await import('../src/agent/framework/healing_reflex.js');
const { default: quickMeal } = await import('../bots/_supervisor/skills/quickMeal.js');

const bot = (extra = {}) => ({ inventory: { items: () => [], slots: [] }, game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 19, z: 0 } }, health: 18, food: 2, ...extra });
const world = ({ phase = 'day', food = 2, hp = 18 } = {}) => { const w = JSON.parse(JSON.stringify(EMPTY_WORLD)); w.time = { ...w.time, phase, isDay: phase === 'day' };
    w.vitals = { ...w.vitals, food, hp }; w.kit = { ...w.kit, picks: 0 }; return w; };
const P = { RK: { kind: 'REPLENISH_KIT', priority: 67, skill: 'replenishKit' }, FF: { kind: 'FOOD_FLOOR', priority: 70, skill: 'quickMeal', args: [{}] },
    TU: { kind: 'TOOL_UPKEEP', priority: 94.5, skill: 'craftChain', args: [[]] } };

test('T-0230: 白天饿到 food≤3 (或回不了血) → FOOD_FLOOR 抢下粘住的 REPLENISH_KIT; 夜里/不饿时不抢', () => {
    const b = bot(); b._commitment = { kind: 'REPLENISH_KIT', skill: 'replenishKit', args: [], since: 0 };
    assert.equal(commitGoal(b, [P.FF, P.RK], world()).kind, 'FOOD_FLOOR', 'starving daytime → preempt');
    const b2 = bot(); b2._commitment = { kind: 'REPLENISH_KIT', skill: 'replenishKit', args: [], since: 0 };
    assert.equal(commitGoal(b2, [P.FF, P.RK], world({ food: 6, hp: 6 })).kind, 'FOOD_FLOOR', 'cannot regen (hp6 food6) → preempt');
    const b3 = bot(); b3._commitment = { kind: 'REPLENISH_KIT', skill: 'replenishKit', args: [], since: 0 };
    assert.equal(commitGoal(b3, [P.FF, P.RK], world({ phase: 'night' })).kind, 'REPLENISH_KIT', 'night: shelter beats a dark hunt');
    const b4 = bot(); b4._commitment = { kind: 'REPLENISH_KIT', skill: 'replenishKit', args: [], since: 0 };
    assert.equal(commitGoal(b4, [P.FF, P.RK], world({ food: 6, hp: 20 })).kind, 'REPLENISH_KIT', 'food 6 + full hp: not an emergency');
});

test('T-0230 护栏: 两个紧急不互抢 — 零镐补镐@94.5 抢下饥饿 FOOD_FLOOR, 反过来 FOOD_FLOOR 不抢回 (不每拍来回翻)', () => {
    // 有料造镐 (圆石 + 原木) → TOOL_UPKEEP 承诺不会提前判完成, 才真正走到"两个紧急互抢"分支
    const mats = [{ name: 'cobblestone', count: 12 }, { name: 'spruce_log', count: 4 }];
    const b = bot({ inventory: { items: () => mats, slots: [] } }); b._commitment = { kind: 'FOOD_FLOOR', skill: 'quickMeal', args: [{}], since: 0 };
    assert.equal(commitGoal(b, [P.TU, P.FF], world()).kind, 'TOOL_UPKEEP');
    assert.equal(commitGoal(b, [P.TU, P.FF], world()).kind, 'TOOL_UPKEEP', 'second tick: FOOD_FLOOR does not flip it back');
});

test('T-0230: food≤3 只剩生鸡 → auto_eat 吃生鸡; 不饿或有别的吃的 → 照旧不吃生鸡', () => {
    assert.equal(pickAutoEatFood([{ name: 'chicken', count: 1 }], { health: 1, food: 0 })?.name, 'chicken');
    assert.equal(pickAutoEatFood([{ name: 'chicken', count: 1 }], { health: 20, food: 10 }), null);
    assert.equal(pickAutoEatFood([{ name: 'chicken', count: 1 }, { name: 'rotten_flesh', count: 1 }], { health: 1, food: 0 }).name, 'rotten_flesh');
});

test('T-0230: quickMeal 包里 1 生鸡 + 0 煤 + food 0 → 吃生鸡 (不再零动作 "done food 0→0")', async () => {
    const inv = { chicken: 1 };
    const eaten = [];
    const b = { food: 0, health: 1, entity: { position: { x: 0, y: 70, z: 0, distanceTo() { return 99; } } }, entities: {},
        blockAt: () => ({ name: 'air', skyLight: 15 }), pathfinder: { stop() {}, setGoal() {}, setMovements() {}, goto: async () => {} }, clearControlStates() {} };
    const ctx = { world: { getInventoryCounts: () => ({ ...inv }) },
        skills: { customSkill: async () => {}, attackEntity: async () => {}, pickupNearbyItems: async () => {},
                  consume: async (_b, n) => { eaten.push(n); inv[n]--; if (!inv[n]) delete inv[n]; b.food += 2; } } };
    const r = await quickMeal(b, ctx, { radius: 48, maxDy: 6, maxMs: 60000 });
    assert.deepEqual(eaten, ['chicken']);
    assert.equal(r.ok, true, JSON.stringify(r));
});
