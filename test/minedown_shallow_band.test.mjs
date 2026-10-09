import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { descendTolerance } from '../bots/_supervisor/skills/mineDown.js';

// Live 10-09 23:06:36/48: NIGHT_STONE_BOOTSTRAP sent mineDown{targetY: y-6} (dig ≤6 down for cobble) and mineDown's
// at-band tolerance is also 6 → 'reached targetY=63 at step 0' at y69, surface branchMine found nothing → dug=0 failed ×2.
test('T-0187: a shallow request still descends; deep requests keep the 6-block band', () => {
    assert.equal(descendTolerance(69, 63), 2, 'y69→63 must dig down to ≤65');
    assert.ok(69 > 63 + descendTolerance(69, 63), 'not at band at the start');
    assert.equal(descendTolerance(69, 12), 6, 'deep descent unchanged');
    assert.equal(descendTolerance(20, 14), 2);
    assert.equal(descendTolerance(14, 14), 0, 'already at target');
    assert.equal(descendTolerance(10, 14), 0, 'below target');
});

test('T-0187: the at-band check uses the per-dispatch tolerance', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /const DESCEND_TOLERANCE = descendTolerance\(Math\.round\(bot\.entity\.position\.y\), targetY\);/);
    assert.match(src, /if \(cy <= targetY \+ DESCEND_TOLERANCE\) \{/);
});
