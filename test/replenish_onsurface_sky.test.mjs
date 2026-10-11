import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { shouldClimbAt, SURFACE_Y } from '../src/agent/framework/surface_judge.js';

// Live 10-11 03:42:17Z (监工): replenishKit START at y72 on the surface under a spruce trunk → onSurface=false (logs count as
// a roof) → '① underground (y=72) → surfaceUp target 63' → 'y 72→72 (gain 0.0) onSurface=true' — a wasted round, and the
// commitment had flipped to GET_ARMOR 5s in: surfaceUp's fallback iteration (dig + pillarUp + 3 manual pillars) never
// checked its deadline, so it ran ~4.6s past the flip until the kernel force-halted it (T-0206).
// T-0258 folded the local shouldClimbForKit into surface_judge.shouldClimbToSurface — the cases still hold there.
test('T-0251: sky open, or at/above the climb target, or under a canopy (no rock roof) → no climb', () => {
    assert.equal(shouldClimbAt({ y: 50, sky: true, rockRoof: 3 }), false);
    assert.equal(shouldClimbAt({ y: 72, sky: false, rockRoof: null }), false, 'the live y72 spruce trunk');
    assert.equal(shouldClimbAt({ y: SURFACE_Y, sky: null, rockRoof: 4 }), false, 'nowhere to climb to');
});

test('T-0251: genuinely underground (rock roof, below target) → climb', () => {
    assert.equal(shouldClimbAt({ y: 40, sky: false, rockRoof: 2 }), true);
    assert.equal(shouldClimbAt({ y: 40, sky: null, rockRoof: 2 }), true);
});

test('T-0251: replenishKit uses the shared criterion for ①, and surfaceUp checks its deadline inside the fallback iteration', () => {
    const rk = fs.readFileSync(new URL('../bots/_supervisor/skills/replenishKit.js', import.meta.url), 'utf8');
    assert.match(rk, /const onSurface = \(\) => !shouldClimbToSurface\(bot\);/);
    const su = fs.readFileSync(new URL('../bots/_supervisor/skills/surfaceUp.js', import.meta.url), 'utf8');
    assert.match(su, /for \(let m = 0; m < 3 && !rose && !deadlineHit\(\); m\+\+\) rose = await manualPillar\(y0\);/);
    assert.match(su, /for \(let h = 2; h <= 4 && !deadlineHit\(\); h\+\+\) \{/);
    assert.match(su, /if \(deadlineHit\(\)\) break;   \/\/ ★T-0251/);
});
