// T-0175 (监工指派, 第十四夜实录): -15,63,11 封坑过夜 (DIG_ONE_CAP), 背包 2 木镐 + 8 木板 + 3 原木, 整夜零产出 —
// canMineWholeNight 要 picksBudget≥200, 2 把木镐 ~118 不够。人类: 坑底往下挖几格拿圆石, 现做台造石镐(+石剑), 整夜靠石镐挖。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nsb-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
delete process.env.MC_FOOD_INSTINCTS;

const { proposeTasks, isGoalDone } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');
const { NIGHT_MINE_KIND_RE } = await import('../src/agent/framework/night_owner.js');

const LIVE = { spruce_log: 3, spruce_planks: 8, wooden_pickaxe: 2, dirt: 2 };   // 22:16Z live
const fakeBot = (inv) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: { x: -15, y: 63, z: 11 } }, health: 20, food: 20 });
function nightWorld(pickTier = 'wood') {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'night', isDay: false };
    w.kit = { ...w.kit, picks: 2, pickTier, sufficientForUnderground: false };
    w.vitals = { ...w.vitals, hp: 20, food: 20 };
    w.pos = { x: -15, y: 63, z: 11, depthBand: 'surface' };
    w.nightPlan = { decision: 'STONE_BOOTSTRAP' };
    return w;
}
const nsb = (w, inv) => proposeTasks(w, fakeBot(inv)).filter(p => p.kind === 'NIGHT_STONE_BOOTSTRAP');

test('T-0175: 0 圆石 → 就地 mineDown 下挖 ≤6 格取圆石 (y63 → 57), 夜带优先级', () => {
    const p = nsb(nightWorld(), LIVE);
    assert.equal(p.length, 1);
    assert.equal(p[0].skill, 'mineDown');
    assert.equal(p[0].args[0].targetY, 57);
    assert.ok(p[0].priority > 91 && p[0].priority < 94, `night band: ${p[0].priority}`);
});

test('T-0175: 挖到 ≥5 圆石 → 原地 craftChain 造石镐+石剑 (台用木板现做)', () => {
    const p = nsb(nightWorld(), { ...LIVE, cobblestone: 5 });
    assert.equal(p.length, 1);
    assert.equal(p[0].skill, 'craftChain');
    const names = p[0].args[0].map(x => x[0]);
    assert.ok(names.includes('crafting_table') && names.includes('stone_pickaxe') && names.includes('stone_sword'), JSON.stringify(names));
});

test('T-0175: 石镐到手或天亮即释放; 承诺算夜挖 (反射预防性封箱让位)', () => {
    assert.equal(isGoalDone('NIGHT_STONE_BOOTSTRAP', nightWorld('wood'), fakeBot(LIVE)), false);
    assert.equal(isGoalDone('NIGHT_STONE_BOOTSTRAP', nightWorld('stone'), fakeBot(LIVE)), true);
    const day = nightWorld(); day.time = { ...day.time, phase: 'day', isDay: true };
    assert.equal(isGoalDone('NIGHT_STONE_BOOTSTRAP', day, fakeBot(LIVE)), true);
    assert.ok(NIGHT_MINE_KIND_RE.test('NIGHT_STONE_BOOTSTRAP'));
});

test('T-0175: computeNightPlan 链序 — STONE_BOOTSTRAP 在整夜下矿之后、挖三填一之前, 带安全门', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('const computeNightPlan = () =>'));
    const iMine = fn.indexOf("decision: 'MINE_THROUGH_NIGHT'"), iBoot = fn.indexOf("{ decision: 'STONE_BOOTSTRAP',"), iDig = fn.indexOf("{ decision: 'DIG_ONE_CAP',");
    assert.ok(iMine > 0 && iBoot > iMine && iDig > iBoot, `order mine=${iMine} boot=${iBoot} dig=${iDig}`);
    const gate = fn.slice(iBoot, iDig);
    for (const g of ['!durablePick', 'hasTablePath', '_hpOkForNightMine', 'actionable === 0', '_gravityPitTrap()'])
        assert.ok(gate.includes(g), `gate has ${g}`);
});

test('T-0185/T-0186: computeNightPlan 整条链经 pickFirstNotCooled (按 bot._kindCooldownUntil 跳过冷却档)', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('const computeNightPlan = () =>'), src.indexOf('const computeNightPlan = () =>') + 12000);
    assert.ok(/return pickFirstNotCooled\(\[/.test(fn), 'chain wrapped');
    assert.ok(/\], bot\._kindCooldownUntil\);/.test(fn), 'cooldown map passed');
});
