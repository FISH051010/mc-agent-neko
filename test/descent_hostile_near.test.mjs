// T-0243 (挂 T-0242, 监工拍板, 10-11 02:38:59Z 死亡): GET_IRON_ARMOR_SET 按 threat.actionable (可达/视线) 放行 — bot 刚往下挖 3 格, 地面僵尸被判不可达;
// mineDown 却按原始距离 "hostile within 4" 让位 → kernel 1.5s 后重派、mineDown 0 格又让位, 身体两头没人管, 6 只僵尸围死。
// 修: hostile_reach.hostileRawNear (4 格内原始敌对, 不看可达) — 决策层下挖类提案剔除/已承诺释放, mineDown 让位, 三处同一谓词。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'desc-hostile-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.env.MC_FOOD_INSTINCTS = '0';
const { hostileRawNear, DESCENT_HOSTILE_R } = await import('../src/agent/framework/hostile_reach.js');
const { proposeTasks, isGoalDone } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

const zombie = (x, y, z) => ({ name: 'zombie', type: 'hostile', position: new Vec3(x, y, z), height: 1.95 });
function mk(entities = {}) {
    const inv = { iron_ingot: 5, spruce_log: 14, stone_pickaxe: 2, crafting_table: 1, cooked_beef: 8 };
    const bot = { inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] }, game: { dimension: 'overworld' },
        entity: { position: new Vec3(0.5, 69, 0.5) }, entities, health: 20, food: 20,
        blockAt: (p) => (p.y >= 70 ? { name: 'dirt', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }) };   // 头顶是土: 地面僵尸无视线
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD)); w.time = { ...w.time, phase: 'day', isDay: true }; w.vitals = { ...w.vitals, hp: 20, food: 20, armor: 0 };
    w.kit = { ...w.kit, picks: 2, pickTier: 'stone', sufficientForUnderground: true }; w.threat = { ...w.threat, actionable: 0 };
    return { bot, w };
}
const DESCENT = /^(mineDown|mineDiamonds|mineOres|branchMine)$/;

test('T-0243: hostileRawNear — 4 格内原始敌对 (墙后/头顶隔土也算), 4 格外不算', () => {
    assert.equal(DESCENT_HOSTILE_R, 4);
    const { bot } = mk({ 1: zombie(2.5, 72, 0.5) });
    assert.equal(hostileRawNear(bot), 1, 'ground zombie 2b over, bot dug 3 down (3.6b) — counts though out of sight');
    const far = mk({ 1: zombie(6.5, 72, 0.5) }).bot;
    assert.equal(hostileRawNear(far), 0);
});

test('T-0243: 地面僵尸在 3 格内、bot 已往下挖 3 格 → 不提任何下挖; 已承诺的下挖类释放; 没怪时照提', () => {
    const quiet = mk();
    const ps0 = proposeTasks(quiet.w, quiet.bot);
    assert.ok(ps0.some(p => DESCENT.test(p.skill || '')), `baseline proposes a descent (${ps0.map(p => p.kind + ':' + p.skill).join(' ')})`);
    const near = mk({ 1: zombie(2.5, 72, 0.5) });
    const ps = proposeTasks(near.w, near.bot);
    assert.ok(!ps.some(p => DESCENT.test(p.skill || '')), ps.map(p => p.kind + ':' + p.skill).join(' '));
    assert.equal(isGoalDone('GO_UNDERGROUND', near.w, near.bot), true);
    assert.equal(isGoalDone('GET_IRON_ARMOR_SET', near.w, near.bot), true);
});

test('T-0243: mineDown 的让位判据改调同一谓词 (源码层同源断言)', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /const close = hostileRawNear\(bot, DESCENT_HOSTILE_R\) > 0;/);
});
