// T-0209 (监工拍板): 记住哪儿见过羊/牛/猪/鸡, 有目标地去 (≤200b), 替代盲目放大侦察半径。
// 证据: 第 3 天 18:04 约 41b 外见过羊 (bot 在 71,-2), 02:01/02:03 bedErrand 两轮 96b 盲搜都没找到。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.chdir(home);
delete process.env.MC_FOOD_INSTINCTS;

const { recordSightings, nearestSighting, scoutPlanToward, SIGHTING_MAX_AGE_MS } = await import('../src/agent/framework/animal_sightings.js');
const { proposeTasks } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

const ent = (name, x, z) => ({ name, position: { x, y: 64, z } });

test('T-0209: 登记目击 — 同种类同区块去重计数, 不同区块/种类分开, >24h 清掉; 不碰 animal landmark', () => {
    const lm = { 'animal@1,64,1': { kind: 'animal', x: 1, y: 64, z: 1, meta: 'cow' } };
    const now = 1_000_000_000;
    assert.equal(recordSightings(lm, { 1: ent('sheep', 112, 30), 2: ent('sheep', 115, 31), 3: ent('sheep', 140, 30), 4: ent('cow', 113, 30), 5: ent('zombie', 0, 0) }, now), true);
    const keys = Object.keys(lm).filter(k => k.startsWith('sighting:'));
    assert.equal(keys.length, 3, keys.join(','));
    assert.equal(lm['sighting:sheep@7,1'].count, 2);
    assert.ok(lm['animal@1,64,1'], 'existing animal landmark untouched');
    lm['sighting:pig@0,0'] = { kind: 'sighting', type: 'pig', x: 0, z: 0, ts: now - SIGHTING_MAX_AGE_MS - 1, count: 1 };
    recordSightings(lm, {}, now);
    assert.ok(!lm['sighting:pig@0,0'], 'stale (>24h) pruned');
});

test('T-0209: 最近目击查询按种类/距离 (≤200b)/新鲜度; 侦察计划有目击 → 朝它、半径够得着; 无目击 → 96b 盲搜', () => {
    const now = 2_000_000_000;
    const lm = {};
    recordSightings(lm, { 1: ent('sheep', 112, 30) }, now - 3600_000);
    recordSightings(lm, { 1: ent('sheep', 300, 300) }, now - 60_000);
    const s = nearestSighting(lm, /^sheep$/, { x: 0, y: 64, z: 0 }, { now });
    assert.ok(s && s.x === 112, JSON.stringify(s));
    assert.equal(nearestSighting(lm, /^cow$/, { x: 0, y: 64, z: 0 }, { now }), null);
    const plan = scoutPlanToward(s, 96);
    assert.deepEqual(plan.toward, { x: 112, z: 30 });
    assert.ok(plan.radius >= 116 && plan.radius <= 200, `radius ${plan.radius}`);
    assert.deepEqual(scoutPlanToward(null, 96), { toward: null, radius: 96, targeted: false });
});

test('T-0209: FOOD_FLOOR 侦察 (无新鲜猎物) → scoutToward 指向最近牲畜目击, 半径放宽', () => {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'day', isDay: true };
    w.vitals = { ...w.vitals, hp: 18, food: 3 };
    const lm = {}; recordSightings(lm, { 1: ent('cow', 150, 0) }, Date.now() - 600_000);
    const bot = { inventory: { items: () => [], slots: [] }, game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 70, z: 0 } }, health: 18, food: 3, _landmarks: lm, blockAt: () => ({ skyLight: 15 }) };
    const p = proposeTasks(w, bot).find(x => x.kind === 'FOOD_FLOOR');
    assert.ok(p && p.args[0].scout, JSON.stringify(p && p.args));
    assert.deepEqual(p.args[0].scoutToward, { x: 150, z: 0 });
    assert.ok(p.args[0].scoutRadius >= 166);
});

test('T-0209 + T-0208: 没羊退避期间, 若之后又目击到羊 → 不退避, 照常提 bedErrand', () => {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'day', isDay: true };
    w.kit = { ...w.kit, picks: 2, pickTier: 'stone', sufficientForUnderground: true };
    w.vitals = { ...w.vitals, hp: 18, food: 14 };
    const KIT = { stone_pickaxe: 2, stone_sword: 1, cobblestone: 50, crafting_table: 1, stick: 4 };
    const mk = (lm) => ({ inventory: { items: () => Object.entries(KIT).map(([name, count]) => ({ name, count })), slots: [] }, game: { dimension: 'overworld' },
        entity: { position: { x: 0, y: 66, z: 0 } }, entities: {}, _bedErrandNoSheepAt: Date.now() - 60_000, _landmarks: lm });
    const none = proposeTasks(w, mk({})).find(p => p.kind === 'GET_BED');
    assert.ok(!none || none.skill !== 'bedErrand', 'blind: backing off');
    const lm = {}; recordSightings(lm, { 1: ent('sheep', 60, 20) }, Date.now() - 10_000);
    assert.equal(proposeTasks(w, mk(lm)).find(p => p.kind === 'GET_BED').skill, 'bedErrand', 'fresh sighting → go');
});

test('T-0273: 亲眼看过空的近处目击删掉 (≤24b 没刷新到), 远处/本拍看到的保留 — 侦察不再在吃空的出生点打转', async () => {
    const { recordSightings: rec, nearestSighting: near, SIGHTING_CLEAR_R } = await import('../src/agent/framework/animal_sightings.js');
    const now = Date.now(), old = now - 4 * 3600 * 1000;
    const lm = {
        'sighting:chicken@0,-1': { kind: 'sighting', type: 'chicken', x: 10, y: 64, z: -2, ts: old, count: 1 },   // 早被吃掉
        'sighting:chicken@2,-2': { kind: 'sighting', type: 'chicken', x: 45, y: 64, z: -30, ts: old, count: 1 },  // 离 bot 远, 没看过
        'sighting:pig@-3,-2': { kind: 'sighting', type: 'pig', x: -47, y: 64, z: -26, ts: old, count: 1 },
    };
    const sheep = { 1: { name: 'sheep', position: { x: 4, y: 64, z: 3 } } };
    assert.equal(rec(lm, sheep, now, { x: 8, y: 64, z: -4 }), true);
    assert.equal(lm['sighting:chicken@0,-1'], undefined, 'stood next to it, nothing there → dropped');
    assert.ok(lm['sighting:chicken@2,-2'] && lm['sighting:pig@-3,-2'], 'far records kept');
    assert.ok(lm['sighting:sheep@0,0'], 'what is visible now is recorded');
    assert.equal(SIGHTING_CLEAR_R, 24);
    // 下一轮侦察指向下一个真没看过的点, 不再是那只被吃掉的鸡
    assert.notEqual(near(lm, /^(chicken|pig)$/, { x: 8, y: 64, z: -4 }).x, 10, 'never the eaten chicken again');   // ③ 权重下 4h 单只鸡几乎不算 → 去猪那边
    // 不传 observer (旧调用) 行为不变
    const lm2 = { 'sighting:chicken@0,-1': { kind: 'sighting', type: 'chicken', x: 10, y: 64, z: -2, ts: old, count: 1 } };
    rec(lm2, {}, now); assert.ok(lm2['sighting:chicken@0,-1']);
});

test('T-0273 ③: 目击按权重选 — 群体 (猪/牛/羊 ≥2) 优先, >2h 的单只鸡几乎不算; 同类同龄仍按距离', async () => {
    const { nearestSighting: near, sightingWeight } = await import('../src/agent/framework/animal_sightings.js');
    const now = Date.now(), H = 3600 * 1000;
    const lm = {
        a: { kind: 'sighting', type: 'chicken', x: 11, y: 64, z: 0, ts: now - 4 * H, count: 1 },    // 近, 4h 单只鸡
        b: { kind: 'sighting', type: 'pig', x: 67, y: 64, z: 0, ts: now - 1 * H, count: 3 },        // 远, 猪群
    };
    assert.equal(near(lm, /^(chicken|pig)$/, { x: 0, y: 64, z: 0 }, { now }).type, 'pig', 'herd beats a stale lone chicken');
    assert.ok(sightingWeight({ type: 'chicken', count: 1 }, 3 * H) < 0.1, 'lone chicken >2h barely counts');
    assert.ok(sightingWeight({ type: 'cow', count: 2 }, 0) > sightingWeight({ type: 'chicken', count: 1 }, 0));
    const fresh = { c: { kind: 'sighting', type: 'chicken', x: 10, y: 64, z: 0, ts: now, count: 1 }, d: { kind: 'sighting', type: 'chicken', x: 30, y: 64, z: 0, ts: now, count: 1 } };
    assert.equal(near(fresh, /^chicken$/, { x: 0, y: 64, z: 0 }, { now }).x, 10, 'same kind & age → nearest');
});

test('T-0273 ③: 权重边界 — 2 头就是群; 鸡群不等于家畜群; 将满 24h 的家畜群仍保底 (群体不会自己消失)', async () => {
    // worker-tests 变异 10-11: 群判据 '>=2'→'>2'、鸡群按家畜群算、去掉 0.25 衰减下限, 上一条均照绿
    const { nearestSighting: near, sightingWeight } = await import('../src/agent/framework/animal_sightings.js');
    const now = Date.now(), H = 3600 * 1000, at = { x: 0, y: 64, z: 0 };
    assert.ok(sightingWeight({ type: 'cow', count: 2 }, 0) > 2 * sightingWeight({ type: 'cow', count: 1 }, 0), 'a pair of cows is a herd');
    const pairs = { p: { kind: 'sighting', type: 'pig', x: 30, y: 64, z: 0, ts: now, count: 2 }, c: { kind: 'sighting', type: 'chicken', x: 25, y: 64, z: 0, ts: now, count: 2 } };
    assert.equal(near(pairs, /^(pig|chicken)$/, at, { now }).type, 'pig', 'pig pair a bit farther beats a chicken pair');
    const old = { h: { kind: 'sighting', type: 'pig', x: 10, y: 64, z: 0, ts: now - 23 * H, count: 3 }, s: { kind: 'sighting', type: 'cow', x: 30, y: 64, z: 0, ts: now, count: 1 } };
    assert.equal(near(old, /^(pig|cow)$/, at, { now }).type, 'pig', '23h-old herd close by still beats a fresh lone cow 3x farther');
});
