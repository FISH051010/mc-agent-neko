// T-0263 (监工指派): IDLE-DISPATCH 回放 10-09→10-11 15 段白天零派发 — 主任务 3 连败冷却后其余提案也冷却/被门挡, 只剩 skill 为空的
// FREE_PLAY → 原地空站 3-10min (如 10-10 13:18 hp4 food14 FOOD_FLOOR 冷却 → TOOL_UPKEEP 完成 → FREE_PLAY 空站 5min)。
// 通用规则: 白天、无可动威胁、不在养伤、admin 任务没在跑、除 FREE_PLAY 外无可派 → 原地有界的兜底活 (缺木砍木 / 料不足攒土石 / 原地浅挖), 绝不侦察漫游 (07-08 令);
// FOOD_FLOOR 回不了血时冷却同钳 30s。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfb-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.env.MC_FOOD_INSTINCTS = '0';
const { proposeTasks, dayFallbackTask } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD, PROPOSAL_KIND } = await import('../src/agent/framework/contracts.js');

const mkBot = (inv, extra = {}) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) }, entities: {}, health: 20, food: 20, ...extra });
const mkWorld = (phase = 'day') => { const w = JSON.parse(JSON.stringify(EMPTY_WORLD)); w.time = { tod: 4000, phase, isDay: phase === 'day' };
    w.vitals = { ...w.vitals, hp: 20, food: 20 }; w.kit = { ...w.kit, picks: 2, pickTier: 'stone', sufficientForUnderground: true }; w.pos = { x: 0, y: 64, z: 0, depthBand: 'surface' }; return w; };
const allCooled = () => { const now = Date.now(), cd = {}; for (const k of [...Object.values(PROPOSAL_KIND), 'NIGHT_SMELT_IRON', 'NIGHT_STONE_BOOTSTRAP', 'PRE_DUSK_FILLER', 'OPENING_SCOUT', 'OPENING_VILLAGE', 'RECLAIM_FURNACE'])
    if (k !== 'IDLE_FALLBACK' && k !== 'FREE_PLAY') cd[k] = now + 300000; return cd; };
const KIT = { stone_pickaxe: 2, spruce_log: 10, cobblestone: 30, cooked_beef: 8, crafting_table: 1 };

test('T-0263: 兜底活按需选 — 缺木砍木 / 料不足 (有镐浅挖, 零镐挖泥) / 其余原地浅挖或砍木, 从不侦察', () => {
    assert.equal(dayFallbackTask(mkWorld(), mkBot({ stone_pickaxe: 1 })).skill, 'chopWood');
    assert.equal(dayFallbackTask(mkWorld(), mkBot({ stone_pickaxe: 1, spruce_log: 10 })).skill, 'mineDown');
    assert.equal(dayFallbackTask(mkWorld(), mkBot({ spruce_log: 10 })).skill, 'gatherDirt');
    assert.equal(dayFallbackTask(mkWorld(), mkBot(KIT)).skill, 'mineDown');
    assert.equal(dayFallbackTask(mkWorld(), mkBot({ spruce_log: 20, cobblestone: 30 })).skill, 'chopWood', 'pickless, stocked: chop more, no roaming');
    for (const inv of [{}, { stone_pickaxe: 1 }, KIT, { spruce_log: 20, cobblestone: 30 }]) assert.notEqual(dayFallbackTask(mkWorld(), mkBot(inv)).skill, 'scoutResources');
});

test('T-0263: 白天所有提案都冷却 → 提 IDLE_FALLBACK (不再只剩空 FREE_PLAY); 夜里/养伤/兜底自身冷却时不提', () => {
    const b = mkBot(KIT); b._kindCooldownUntil = allCooled();
    const ps = proposeTasks(mkWorld(), b);
    assert.ok(!ps.some(p => p.kind !== 'FREE_PLAY' && p.kind !== 'IDLE_FALLBACK'), 'test setup: everything else cooled: ' + ps.map(p => p.kind).join(' '));
    const fb = ps.find(p => p.kind === 'IDLE_FALLBACK');
    assert.ok(fb && fb.skill === 'mineDown' && fb.priority === 2, JSON.stringify(ps.map(p => p.kind + ':' + p.skill)));
    const a = mkBot(KIT); a._kindCooldownUntil = allCooled(); a._adminMission = { active: true };
    assert.ok(!proposeTasks(mkWorld(), a).some(p => p.kind === 'IDLE_FALLBACK'), 'admin mission running: no fallback');
    const x = mkBot(KIT); x._kindCooldownUntil = allCooled(); x._extIntentUntil = Date.now() + 60000;
    assert.ok(!proposeTasks(mkWorld(), x).some(p => p.kind === 'IDLE_FALLBACK'), 'admin-exclusive window: no fallback');
    const n = mkBot(KIT); n._kindCooldownUntil = allCooled();
    assert.ok(!proposeTasks(mkWorld('night'), n).some(p => p.kind === 'IDLE_FALLBACK'), 'night: no fallback');
    const c = mkBot(KIT); c._kindCooldownUntil = { ...allCooled(), IDLE_FALLBACK: Date.now() + 300000 };
    assert.ok(!proposeTasks(mkWorld(), c).some(p => p.kind === 'IDLE_FALLBACK'), 'fallback itself cooled');
});

test('T-0263: 兜底选到下挖但 4 格内有怪 → 不派 (过 T-0243 下挖门, 不退成漫游)', () => {
    const z = { name: 'zombie', type: 'hostile', position: new Vec3(2, 64, 0), height: 1.95 };
    const b = mkBot({ stone_pickaxe: 1, spruce_log: 10, cooked_beef: 8 }, { entities: { 1: z }, blockAt: () => ({ name: 'stone', boundingBox: 'block' }) });
    b._kindCooldownUntil = allCooled();
    const fb = proposeTasks(mkWorld(), b).find(p => p.kind === 'IDLE_FALLBACK');
    assert.equal(fb, undefined, JSON.stringify(fb));
});

test('T-0271: 兜底 chopWood 正在跑, 零镐零木 REPLENISH_KIT 冷却到期成头号 → 不打断 (同样先砍木), 兜底跑完再切; 紧急照抢', async () => {
    const { commitGoal } = await import('../src/agent/framework/world_model.js');
    const fb = { kind: 'IDLE_FALLBACK', skill: 'chopWood', args: [8] };
    const rk = { kind: 'REPLENISH_KIT', priority: 67, skill: 'replenishKit', args: [] };
    // 05:45:52Z 现场: 零镐零木, 兜底砍木中
    const b = mkBot({ dirt: 3 }); b._commitment = { ...fb, since: Date.now() }; b._currentSkill = 'chopWood';
    const r = commitGoal(b, [rk], mkWorld());
    assert.equal(r.kind, 'IDLE_FALLBACK', JSON.stringify(r));
    assert.equal(b._commitment.kind, 'IDLE_FALLBACK', 'commitment not flipped → kernel does not interrupt chopWood');
    // 子技能跑完 (_currentSkill 清掉) → 切到 REPLENISH_KIT
    b._currentSkill = null;
    assert.equal(commitGoal(b, [rk], mkWorld()).kind, 'REPLENISH_KIT');
    // 木够了 (补给缺的是镐不是木) → 不算同活, 照切
    const w2 = mkBot({ spruce_log: 6 }); w2._commitment = { ...fb, since: Date.now() }; w2._currentSkill = 'chopWood';
    assert.equal(commitGoal(w2, [rk], mkWorld()).kind, 'REPLENISH_KIT');
    // 紧急 (饿) 照抢
    const e = mkBot({ dirt: 3 }); e._commitment = { ...fb, since: Date.now() }; e._currentSkill = 'chopWood';
    const w = mkWorld(); w.vitals = { ...w.vitals, food: 2, hp: 20 };
    const ff = { kind: 'FOOD_FLOOR', priority: 89, skill: 'quickMeal', args: [] };
    assert.equal(commitGoal(e, [ff, rk], w).kind, 'FOOD_FLOOR');
});

test('T-0271: 同活但紧急 — 零镐 TOOL_UPKEEP@PICKLESS (原地造镐几秒) 抢下兜底砍木; 非紧急的 TOOL_UPKEEP@47 照等兜底跑完', async () => {
    // worker-tests 变异 10-11: 删掉 hold 分支的 isEmergency 豁免上一条照绿 — 它的紧急例 FOOD_FLOOR/quickMeal 本就不算同活,
    // 到不了那个判断。真会撞上的是零镐造镐: TOOL_UPKEEP 既算同活 (木<16) 又是紧急, 没豁免就一直砍木不造镐。
    const { commitGoal, PICKLESS_UPKEEP_PRIORITY } = await import('../src/agent/framework/world_model.js');
    const fb = { kind: 'IDLE_FALLBACK', skill: 'chopWood', args: [8] };
    const mk = () => { const b = mkBot({ oak_planks: 8, stick: 4 }); b._commitment = { ...fb, since: Date.now() }; b._currentSkill = 'chopWood'; return b; };
    const urgent = { kind: 'TOOL_UPKEEP', priority: PICKLESS_UPKEEP_PRIORITY, skill: 'craftChain', args: ['wooden_pickaxe', 1] };
    assert.equal(commitGoal(mk(), [urgent], mkWorld()).kind, 'TOOL_UPKEEP', 'pickless craft-in-place preempts the fallback chop');
    const routine = { ...urgent, priority: 47 };
    assert.equal(commitGoal(mk(), [routine], mkWorld()).kind, 'IDLE_FALLBACK', 'routine upkeep is the same work → waits for the chop');
});
