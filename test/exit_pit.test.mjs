// T-0215 (监工高优先, 2026-10-10 03:01:50-55Z): 拂晓 bot 还封在过夜坑里, quickMeal 直接侦察 →
// "6 legs in a row without moving (sealed pit) — stop early" ×3 → FOOD_FLOOR 冷却; food=8 不够 bedErrand 门 → 下矿一整天没碰床。
// T-0214 说"坑交给 mobility 挖开", 实际白天没人挖。修: quickMeal / bedErrand 侦察前若封闭 (ENTOMBED/POCKET 或四周无出口)
// 先出坑 (临时允许挖方块寻路几格), 出坑算进展 (ok, 不计 strike)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const registry = require('minecraft-data')('1.21.4');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'exit-pit-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.chdir(home);
const { default: quickMeal, sealedNow, exitPitIfSealed, EXIT_AVOID_COST } = await import('../bots/_supervisor/skills/quickMeal.js');
const { default: bedErrand } = await import('../bots/_supervisor/skills/bedErrand.js');

const V = (x, y, z) => ({ x, y, z, clone() { return V(this.x, this.y, this.z); }, offset(dx, dy, dz) { return V(this.x + dx, this.y + dy, this.z + dz); }, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } });

// 封闭坑: 只有允许挖方块的寻路才走得出去 (挖开一格 → 走到 6 格外); 不许挖 → goto 秒回零移动 (实录的 "0 unreachable / no move")。
function rig({ mobility, inv = {}, digWorks = true, walkable = false, wallX = null, entities = {}, skyLight = 0, dropOnDig = false }) {
    const legs = [];
    let canDig = false;
    const bot = { food: 8, health: 18, registry, entity: { position: V(0, 40, 0) }, entities, _mobility: mobility,
        blockAt: (q) => (wallX != null && Math.floor(q.x) === wallX) ? { name: 'stone', skyLight, boundingBox: 'block' } : { name: 'stone', skyLight },
        inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
        pathfinder: { stop() {}, setGoal() {},
            setMovements(mv) { canDig = !!mv.canDig; (bot._mvs = bot._mvs || []).push(mv); },
            goto: async (g) => {
                legs.push({ canDig, goal: g.constructor.name });
                if (canDig && !digWorks) return;
                if (canDig && dropOnDig && g.x !== undefined) { bot.entity.position = V(g.x, 36, g.z); return; }   // 横移中掉进下方洞穴
                // 允许挖时只有出坑那种近距离/往上的目标挖得通 (远处侦察航点挖也到不了 — T-0230 侦察挖掘重试之后仍走强制出坑这条路)
                if (canDig && Math.hypot(bot.entity.position.x, bot.entity.position.z) < 1 && bot.entity.position.y < 41 && (g.x === undefined || Math.hypot(g.x, g.z) <= 7)) { bot.entity.position = g.x !== undefined ? V(g.x, 41, g.z) : V(0, g.y, 0); return; }
                if (walkable && !canDig && g.x !== undefined) { bot.entity.position = V(g.x, 41, g.z); return; }
                // 坑外 (或仍在坑里不许挖): 侦察段无处可去, 原地不动
            } },
        clearControlStates() {} };
    const ctx = { world: { getInventoryCounts: () => ({ ...inv }) },
        skills: { customSkill: async () => false, attackEntity: async () => {}, pickupNearbyItems: async () => {}, consume: async () => {}, equip: async () => {} } };
    return { bot, ctx, legs, canDigNow: () => canDig };
}

test('T-0215: 封闭判据 = ENTOMBED/POCKET 或四周无出口; enclosed(头顶有遮盖=在地下) 本身不算, 水里不算', () => {
    assert.equal(sealedNow({ _mobility: { state: 'ENTOMBED', enclosed: true, exits: [] } }), true);
    assert.equal(sealedNow({ _mobility: { state: 'POCKET', enclosed: true, exits: [] } }), true);
    assert.equal(sealedNow({ _mobility: { state: 'FREE', enclosed: false, exits: [] } }), true, 'open-top deep pit');
    assert.equal(sealedNow({ _mobility: { state: 'FREE', enclosed: true, exits: [[1, 0]] } }), false, 'cave with exits');
    assert.equal(sealedNow({ _mobility: { state: 'SWIM', enclosed: false, exits: [] } }), false);
    assert.equal(sealedNow({}), false);
});

test('T-0215: quickMeal 封在坑里 → 先挖路出坑再侦察; 侦察没找到动物也算进展 (ok, 不计 strike), 出坑后恢复不挖的安全寻路', async () => {
    const r = rig({ mobility: { state: 'ENTOMBED', enclosed: true, exits: [] } });
    const res = await quickMeal(r.bot, r.ctx, { radius: 48, maxDy: 12, maxMs: 60000, scout: true, scoutRadius: 96, scoutMs: 20000 });
    assert.equal(r.legs[0].canDig, true, `first leg is a dig-allowed exit (legs=${JSON.stringify(r.legs.slice(0, 3))})`);
    assert.ok(r.bot.entity.position.y >= 41, 'climbed out of the pit (underground → rise first)');
    assert.equal(r.legs[0].goal, 'GoalRiseBy', 'underground (no sky) → first exit leg digs upward');
    assert.ok(r.legs.slice(1, 7).every(l => !l.canDig), 'scout legs start on safe (no-dig) movements (T-0230: dig retry only after 6 motionless legs)');
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.exitedPit, true);
    const log = fs.readFileSync(path.join(home, 'bots', '_supervisor', 'progress.txt'), 'utf8');
    assert.match(log, /exit pit: out/);
});

test('T-0215: 不封闭 (有出口) 且侦察走得动 → 不出坑, 行为照旧 (找不到 = 诚实失败)', async () => {
    const r = rig({ mobility: { state: 'FREE', enclosed: true, exits: [[1, 0], [0, 1]] }, walkable: true });
    const res = await quickMeal(r.bot, r.ctx, { radius: 48, maxDy: 12, maxMs: 60000, scout: true, scoutRadius: 96, scoutMs: 20000 });
    assert.ok(r.legs.every(l => !l.canDig), 'never digs out when not sealed');
    assert.equal(res.failed, true, JSON.stringify(res));
});

test('T-0215: bedErrand 封在坑里 → 先出坑再找羊; 没找到羊也返回 ok(exitedPit) 不计 strike, 仍记 no-sheep 退避', async () => {
    const r = rig({ mobility: { state: 'ENTOMBED', enclosed: true, exits: [] } });
    const res = await bedErrand(r.bot, r.ctx);
    assert.equal(r.legs[0].canDig, true);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.exitedPit, true);
    assert.ok(r.bot._bedErrandNoSheepAt > 0);
});

test('T-0215 补 (03:18:37Z): 判据漏判 (FREE exits=[[0,-1]] 死胡同, 头顶重力柱) → 侦察零位移 → 强制出坑再侦察一轮, 算进展', async () => {
    const r = rig({ mobility: { state: 'FREE', enclosed: true, exits: [[0, -1]] } });
    const res = await quickMeal(r.bot, r.ctx, { radius: 48, maxDy: 12, maxMs: 60000, scout: true, scoutRadius: 96, scoutMs: 20000 });
    const firstDig = r.legs.findIndex(l => l.canDig);
    assert.ok(firstDig > 0, `scouted first (no-dig), then forced exit (legs=${JSON.stringify(r.legs.slice(0, 8))})`);
    assert.ok(r.bot.entity.position.y >= 41, 'climbed out');
    assert.ok(r.legs.slice(firstDig + 1).some(l => !l.canDig), 'scouted again after exit');
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.exitedPit, true);
});

test('T-0215 补: bedErrand 侦察零位移 → 强制出坑, 出来了返回 ok 且不记 no-sheep 退避 (这轮没真搜); 挖不出 → 照旧 failed', async () => {
    const r = rig({ mobility: { state: 'FREE', enclosed: true, exits: [[0, -1]] } });
    const res = await bedErrand(r.bot, r.ctx);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.exitedPit, true);
    assert.ok(!r.bot._bedErrandNoSheepAt, 'no backoff: scout never actually searched');
    const r2 = rig({ mobility: { state: 'FREE', enclosed: true, exits: [[0, -1]] }, digWorks: false });
    const res2 = await bedErrand(r2.bot, r2.ctx);
    assert.equal(res2.failed, true, JSON.stringify(res2));
});

test('T-0222: 墙后够不着的骷髅 (无视线, 6b) 不挡出坑 — 照常挖出去; 同一只骷髅有视线 → 等/延后 (不往射击线里爬)', async () => {
    const sk = { name: 'skeleton', type: 'hostile', position: V(6.5, 40, 0.5), height: 1.95 };
    const walled = rig({ mobility: { state: 'ENTOMBED', enclosed: true, exits: [] }, wallX: 3, entities: { 7: sk } });
    const r1 = await quickMeal(walled.bot, walled.ctx, { radius: 48, maxDy: 12, maxMs: 60000, scout: true, scoutRadius: 96, scoutMs: 20000 });
    assert.equal(walled.legs[0] && walled.legs[0].canDig, true, `dug out despite the walled skeleton (${JSON.stringify(r1)})`);
    assert.notEqual(r1.deferred, true);
    const open = rig({ mobility: { state: 'ENTOMBED', enclosed: true, exits: [] }, entities: { 7: { ...sk } } });
    const r2 = await exitPitIfSealed(open.bot, { legMs: 50 });
    assert.equal(r2.hostile, true, 'skeleton in view → wait then defer');
});

test('T-0215 补2 (death #20): 地下出坑只往上挖 (+8 再 +4), 绝不走横向段; 都挖不上去 → 未出坑', async () => {
    const r = rig({ mobility: { state: 'ENTOMBED', enclosed: true, exits: [] }, digWorks: false });
    const ex = await exitPitIfSealed(r.bot, { legMs: 50 });
    assert.equal(ex.exited, false);
    const dig = r.legs.filter(l => l.canDig);
    assert.deepEqual(dig.map(l => l.goal), ['GoalRiseBy', 'GoalRiseBy'], JSON.stringify(r.legs));
});

test('T-0215 补2 (04:22:02Z "moved 2.7b, dy -4.0"): 地表开顶坑横向段横移但往下掉 4 格 → 不算出坑, 继续试其余方向', async () => {
    const r = rig({ mobility: { state: 'FREE', enclosed: false, exits: [] }, skyLight: 15, dropOnDig: true });
    const ex = await exitPitIfSealed(r.bot, { legMs: 50 });
    assert.equal(ex.exited, false, JSON.stringify(ex));
});

test('T-0215 补3 (death #21): 出坑时 16 格内敌对 (墙后无视线也算) 周围划回避区 — 远程 8 格内不许挖、走 +1000; 没有敌对就不加', async () => {
    const sk = { name: 'skeleton', type: 'hostile', position: V(6.5, 40, 0.5), height: 1.95 };
    const r = rig({ mobility: { state: 'ENTOMBED', enclosed: true, exits: [] }, wallX: 3, entities: { 7: sk } });
    await exitPitIfSealed(r.bot, { legMs: 50 });
    const mv = r.bot._mvs.find(m => m.canDig);
    assert.ok(mv && mv.exclusionAreasStep.length === 1 && mv.exclusionAreasBreak.length === 1, 'avoid zone installed');
    const near = { position: V(6, 44, 0) }, far = { position: V(-10, 48, 0) };
    assert.equal(mv.exclusionAreasBreak[0](near), EXIT_AVOID_COST, 'cannot dig within 8b of the skeleton');
    assert.equal(mv.exclusionAreasStep[0](far), 0);
    const quiet = rig({ mobility: { state: 'ENTOMBED', enclosed: true, exits: [] } });
    await exitPitIfSealed(quiet.bot, { legMs: 50 });
    assert.equal(quiet.bot._mvs.find(m => m.canDig).exclusionAreasStep.length, 0);
});
