// T-0200 (death #14 2026-10-10 01:06:05): 苦力怕 7.8b 逼近, 地形可跑的方向全被 17b 外"大致同向"的另一只苦力怕
// 否决 → "creeper backoff gated … emergency bunker/hold" → 3s 后被炸。契约: 远处同向苦力怕只排序不否决;
// 近处苦力怕 ≤3.4b 且无路 → 先拿剑打退再重新选路, 不原地 bunker。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { creeperCorridorAssess, pickCreeperRunDir } from '../src/agent/mobility_geom.js';

const me = { x: 0, y: 70, z: 0 };
// 实录数值复刻: 目标苦力怕 7.8b 在西; 另一只 17.0b, 向东 toward=0.49, 东向 6 步投影 14.9
const target = { x: -7.8, y: 70, z: 0, isTarget: true };
const far = { x: 8.3, y: 70, z: 14.8, isTarget: false };
const fan = (dx, dz) => [0, 45, -45, 90, -90, 135, -135].map(deg => {
    const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    return [dx * ca - dz * sa, dx * sa + dz * ca];
});

test('T-0200: 实录几何 — 东向只有软风险 (17b 外同向苦力怕, 投影 14.9 ≥ 7.5), 不再否决', () => {
    const a = creeperCorridorAssess([target, far], me, 1, 0);
    assert.equal(a.hard, false);
    assert.equal(a.soft, true);
    assert.ok(Math.abs(creeperCorridorAssess([far], me, 1, 0).minProjected - 14.98) < 0.1, 'far creeper projection = logged proj=14.9');
    assert.ok(Math.abs(a.minProjected - 7.8) < 0.01, 'running away keeps the near one at ≥7.8b');
});

test('T-0200: 整个扇形都有软风险时 → 选投影最远的无硬风险方向, 不退化成 bunker', () => {
    const cands = fan(1, 0).map(dir => ({ dir, ok: true, assess: creeperCorridorAssess([target, far], me, dir[0], dir[1]) }));
    const pick = pickCreeperRunDir(cands);
    assert.ok(pick, 'a lane is chosen');
    assert.equal(pick.assess.hard, false);
    const towardTarget = (pick.dir[0] * (target.x - me.x) + pick.dir[1] * (target.z - me.z)) / 7.8;
    assert.ok(towardTarget < 0.25, 'never a lane that closes on the near creeper');
});

test('T-0200: 硬风险照旧否决 — 冲向 ≤5.5b 的目标 / 路过另一只 <7.5b', () => {
    const near = { x: -4, y: 70, z: 0, isTarget: true };
    assert.equal(creeperCorridorAssess([near], me, -1, 0).hard, true, 'run into the near creeper');
    const side = { x: 5, y: 70, z: 3, isTarget: false };
    assert.equal(creeperCorridorAssess([side], me, 1, 0).hard, true, 'lane passes within 7.5b of another creeper');
    assert.equal(pickCreeperRunDir([{ dir: [1, 0], ok: true, assess: { hard: true, soft: false, minProjected: 3 } }]), null);
    assert.equal(pickCreeperRunDir([{ dir: [1, 0], ok: false, assess: { hard: false, soft: false, minProjected: 20 } }]), null, 'terrain-bad lane never picked');
});

test('T-0200: self_preservation creeper backoff 接线 — 用分级判据; 无路且 ≤3.4b 先打退再选路, bunker 在其后; 落差 ≤3', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const i = src.indexOf('const maxDrop = 3;');
    assert.ok(i > 0, 'maxDrop 3 (≤3-block fall = 0 damage)');
    const seg = src.slice(i, src.indexOf('creeper backoff gated:', i));
    assert.match(seg, /pickCreeperRunDir\(/);
    assert.match(seg, /creeperCorridorAssess\(/);
    assert.match(seg, /3 \* Math\.PI \/ 4/, 'fan covers ±135°');
    const g = seg.indexOf('if (!runDir) {');
    assert.ok(g > 0);
    assert.match(seg.slice(g), /creeperPunchBack\(agent, c\)[\s\S]*continue;/, 'knock back then re-pick, not bunker');
});

test('T-0218: 8b 外未点燃的苦力怕不抢断武装近战接战 (death #19); ≤5b 或点燃 / 无武器 → 照旧后撤', async () => {
    const { creeperBackoffPreempts } = await import('../src/agent/mobility_geom.js');
    assert.equal(creeperBackoffPreempts({ creeperDist: 8, creeperFusing: false, meleeNearDist: 1.7, hasWeapon: true }), false, 'death #19: keep fighting the zombie');
    assert.equal(creeperBackoffPreempts({ creeperDist: 4.5, creeperFusing: false, meleeNearDist: 1.7, hasWeapon: true }), true, 'creeper close');
    assert.equal(creeperBackoffPreempts({ creeperDist: 8, creeperFusing: true, meleeNearDist: 1.7, hasWeapon: true }), true, 'fusing');
    assert.equal(creeperBackoffPreempts({ creeperDist: 8, creeperFusing: false, meleeNearDist: 1.7, hasWeapon: false }), true, 'unarmed → run');
    assert.equal(creeperBackoffPreempts({ creeperDist: 8, creeperFusing: false, meleeNearDist: Infinity, hasWeapon: true }), true, 'no melee fight to protect');
});

test('T-0218: 后撤方向背离 ≤3b 的近战怪 — 朝僵尸跑 / 擦身而过 = hard; 背离它不 hard', () => {
    const zombie = { x: 1.7, z: 0 };
    assert.equal(creeperCorridorAssess([], me, 1, 0, [zombie]).hard, true, 'straight into the zombie');
    assert.equal(creeperCorridorAssess([], me, -1, 0, [zombie]).hard, false, 'away from it');
    assert.equal(creeperCorridorAssess([], me, 0, 1, [{ x: 1, z: 1.2 }]).hard, true, 'brushes past within 1.5b');
    assert.equal(creeperCorridorAssess([], me, -1, 0, [{ x: 0.9, z: 0 }]).hard, false, 'a zombie at 0.9b behind does not veto running away');
    const m = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    assert.match(m, /creeperCorridorAssess\(_creepers, bot\.entity\.position, tx, tz, _melee\)/);
    assert.match(m, /else if \(this\.creeperBackoffTarget\(bot\) && \(\(\) => \{[\s\S]{0,1600}creeperBackoffPreempts\(/);
});