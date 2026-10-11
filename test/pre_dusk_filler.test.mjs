// T-0262 (监工, 2026-10-11 04:27:54Z 死亡): 重建后包里零填充方块, 入夜 bunkerDown cap/seal 全失败 → 拉怪跑 → 被溺尸打死。
// 黄昏前 (tod 9000-12000) 封坑填充 < 8 且有镐 → 就地下挖 ≤6 格取土石 (与 NIGHT_STONE_BOOTSTRAP 同一下挖目标, 不限木镐/不限夜里);
// 同窗口先吃 (dusk 补餐 FOOD_FLOOR@70) 再备料 (@69)。FILL_RE 收进 framework/filler.js 共用 (C280 不再两份)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'filler-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.env.MC_FOOD_INSTINCTS = '0';
const { sealFillerCount, SEAL_FILLER_MIN } = await import('../src/agent/framework/filler.js');
const { proposeTasks, isGoalDone, commitGoal, stoneBootstrapTargetY } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

const mkBot = (inv, food = 20) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 64, z: 0 } }, entities: {}, health: 20, food });
const mkWorld = (tod, food = 20) => { const w = JSON.parse(JSON.stringify(EMPTY_WORLD)); w.time = { tod, phase: 'day', isDay: true };
    w.vitals = { ...w.vitals, hp: 20, food }; w.kit = { ...w.kit, picks: 2, pickTier: 'wooden', sufficientForUnderground: true }; w.pos = { x: 0, y: 64, z: 0, depthBand: 'surface' }; return w; };
const BARE = { wooden_pickaxe: 2, stick: 4, spruce_planks: 12, spruce_log: 6, cooked_beef: 4 };

test('T-0262: 封坑填充计数不含木料 (木板/原木是稀缺料, 封坑路径本就排除木板)', () => {
    assert.equal(sealFillerCount(BARE), 0);
    assert.equal(sealFillerCount({ dirt: 5, cobblestone: 4, spruce_planks: 30 }), 9);
    assert.equal(SEAL_FILLER_MIN, 8);
});

test('T-0262: 黄昏前零填充 + 有镐 → PRE_DUSK_FILLER 就地下挖 (目标同 NIGHT_STONE_BOOTSTRAP); 填充够/窗口外不提', () => {
    const ps = proposeTasks(mkWorld(10000), mkBot(BARE));
    const p = ps.find(x => x.kind === 'PRE_DUSK_FILLER');
    assert.ok(p && p.skill === 'mineDown' && p.args[0].targetY === stoneBootstrapTargetY(mkWorld(10000)), JSON.stringify(ps.map(x => x.kind + '@' + x.priority)));
    assert.equal(p.args[0].targetY, 58);
    assert.ok(!proposeTasks(mkWorld(10000), mkBot({ ...BARE, cobblestone: 20 })).some(x => x.kind === 'PRE_DUSK_FILLER'), 'enough filler');
    assert.ok(!proposeTasks(mkWorld(5000), mkBot(BARE)).some(x => x.kind === 'PRE_DUSK_FILLER'), 'outside the pre-dusk window');
    assert.equal(isGoalDone('PRE_DUSK_FILLER', mkWorld(10000), mkBot({ ...BARE, cobblestone: 16 })), true, 'target reached');
    assert.equal(isGoalDone('PRE_DUSK_FILLER', mkWorld(10000), mkBot(BARE)), false);
});

test('T-0262: 同窗口先吃再备料 — 零可吃 food 9 时 FOOD_FLOOR 排在前面, 且能抢下已承诺的备料', () => {
    const bot = mkBot({ ...BARE, cooked_beef: 0 }, 9);
    const ps = proposeTasks(mkWorld(10000, 9), bot);
    const ff = ps.find(x => x.kind === 'FOOD_FLOOR'), fl = ps.find(x => x.kind === 'PRE_DUSK_FILLER');
    assert.ok(ff && fl && ff.priority > fl.priority, ps.map(x => x.kind + '@' + x.priority).join(' '));
    const b = mkBot({ ...BARE, cooked_beef: 0 }, 9); b._commitment = { kind: 'PRE_DUSK_FILLER', skill: 'mineDown', args: [{ targetY: 58 }], since: 0 };
    assert.equal(commitGoal(b, [ff, fl], mkWorld(10000, 9)).kind, 'FOOD_FLOOR');
});

test('T-0262: modes.js 不再有本地 FILL_RE 副本 (C280)', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    assert.ok(!/^const FILL_RE = /m.test(src));
    assert.match(src, /import \{ FILL_RE \} from '\.\/framework\/filler\.js';/);
});
