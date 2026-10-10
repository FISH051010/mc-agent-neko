import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { planRelocateTunnel } from '../bots/_supervisor/skills/mineDown.js';

// Live 10-10 04:23/04:26 @-39,40,5 (y40 aquifer): all four headings fluid/void/wedge-remembered → lever#1 relocate
// called skills.moveAway(10) → 'relocate failed (moved=0.0b …)' ×5 → GO_UNDERGROUND + DUSK_MINE_NIGHT cooled.
// Historically that pathfinder hop succeeded 0 times underground. Underground relocation = dig a short side tunnel.
const k = (x, y, z) => `${x},${y},${z}`;
function rock({ water = [], bedrock = [] } = {}) {
    const W = new Set(water.map(p => k(...p))), B = new Set(bedrock.map(p => k(...p)));
    return (x, y, z) => W.has(k(x, y, z)) ? { name: 'water', boundingBox: 'empty' }
        : B.has(k(x, y, z)) ? { name: 'bedrock', boundingBox: 'block' }
        : (x === -39 && z === 5 && (y === 40 || y === 41)) ? { name: 'air', boundingBox: 'empty' }   // the bot's cell
        : { name: 'stone', boundingBox: 'block' };
}

test('T-0161: in dry solid rock the relocation is a 9-cell side tunnel (≥8 clears the per-spot heading memory)', () => {
    const plan = planRelocateTunnel(rock(), -39, 40, 5);
    assert.ok(plan);
    assert.equal(plan.path.length, 9);
    const [lx, lz] = plan.path.at(-1);
    assert.ok(Math.hypot(lx + 39, lz - 5) >= 8);
});

test('T-0161: a line that would breach water (side neighbour or above) is skipped for a dry one', () => {
    const water = [];
    for (let d = 1; d <= 9; d++) water.push([-39 + d, 40, 6]);   // aquifer alongside the +x line
    const plan = planRelocateTunnel(rock({ water }), -39, 40, 5);
    assert.ok(plan);
    assert.notDeepEqual([plan.sx, plan.sz], [1, 0]);
    for (const [x, z] of plan.path) for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.notEqual(rock({ water })(x + ox, 40, z + oz).name, 'water');
});

test('T-0161: wet / unbreakable everywhere → null (honest fail instead of a doomed hop)', () => {
    const water = [], bedrock = [];
    for (let d = 1; d <= 3; d++) { water.push([-39, 42, 5 + d], [-39, 42, 5 - d]); }
    bedrock.push([-38, 40, 5], [-40, 40, 5]);
    assert.equal(planRelocateTunnel(rock({ water, bedrock }), -39, 40, 5), null);
});

test('T-0161: relocate tries the tunnel first and only falls back to pathfinder moveAway', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /const _tun = planRelocateTunnel\(bn, [^\n]*\);\s*\n(?:[^\n]*\n)?\s*if \(_tun\) \{\s*\n\s*const _ok = await walkDugPath\(/);   // (T-0193 adds `let _fbOk` between)
    assert.match(src, /await relocateFallback\(bot, skills, bn, log_, 'no dry solid 9-cell tunnel line at this level'\);/);   // ★T-0193: no bare moveAway underground
});
