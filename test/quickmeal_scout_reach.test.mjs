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
