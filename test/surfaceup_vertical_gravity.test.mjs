import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Vec3 from 'vec3';
import { verticalBlockedByGravity } from '../bots/_supervisor/skills/surfaceUp.js';

// Live 10-11 03:03:23-26Z @-12,53,71 (y53, hp19 food4, day, hostiles16=0, worker-tier 转): replenishKit ① surfaceUp ×3 each
// returned in ~7ms with gain 0 → 'ZERO delta — honest false' → REPLENISH_KIT cooled 5min (quickMeal's surfaceUp the same).
// surfaceUp.log: 'vertical-first: overhead column clear/breachable → skip GoalY staircase' then 'fallback: gravity column over
// shaft … and no gravity-free side column — stop'. The vertical-first gate called gravel "breachable", the climb it handed to
// refuses to dig up under gravel (T-0172) — so neither the staircase nor the climb ran. One predicate for both.
const k = (p) => `${p.x},${p.y},${p.z}`;
function world({ gravel = [], air = [], water = [] } = {}) {
    const G = new Set(gravel.map(a => k(new Vec3(...a)))), A = new Set(air.map(a => k(new Vec3(...a)))), W = new Set(water.map(a => k(new Vec3(...a))));
    return (p) => G.has(k(p)) ? { name: 'gravel', boundingBox: 'block' }
        : W.has(k(p)) ? { name: 'water', boundingBox: 'empty' }
        : A.has(k(p)) ? { name: 'air', boundingBox: 'empty' }
        : { name: 'stone', boundingBox: 'block' };
}
const feet = new Vec3(0, 53, 0);
const body = [[0, 53, 0], [0, 54, 0]];

test('T-0244: gravel over the shaft and every side column gravel-capped → straight-up is NOT viable', () => {
    const gravel = [[0, 56, 0]];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) gravel.push([dx, 57, dz]);
    assert.equal(verticalBlockedByGravity(world({ gravel, air: body }), feet), true);
});

test('T-0244: gravel over the shaft but a gravity-free side column exists → the climb can sidestep (not blocked)', () => {
    assert.equal(verticalBlockedByGravity(world({ gravel: [[0, 56, 0]], air: body }), feet), false);
});

test('T-0244: no gravity overhead → not blocked', () => {
    assert.equal(verticalBlockedByGravity(world({ air: body }), feet), false);
});

test('T-0244: vertical-first gate and the zero-gain exit both use the shared predicate / reason', () => {
    const su = fs.readFileSync(new URL('../bots/_supervisor/skills/surfaceUp.js', import.meta.url), 'utf8');
    const i = su.indexOf('const straightUpViable = () => {');
    const j = su.indexOf('const _vFirst = straightUpViable();', i);
    assert.ok(i > 0 && j > i);
    assert.match(su.slice(i, j), /if \(verticalBlockedByGravity\(\(p\) => bot\.blockAt\(p\), cc\)\) return false;/);
    assert.match(su, /bot\._surfaceUpWhy = /);
    const rk = fs.readFileSync(new URL('../bots/_supervisor/skills/replenishKit.js', import.meta.url), 'utf8');
    assert.match(rk, /surfaceUp result y [^\n]*bot\._surfaceUpWhy/);
});
