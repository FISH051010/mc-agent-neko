import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { shouldClimbForKit, SURFACE_UP_TARGET_Y } from '../bots/_supervisor/skills/replenishKit.js';

// Live 10-11 03:42:17Z (监工): replenishKit START at y72 on the surface under a spruce trunk → onSurface=false (logs count as
// a roof) → '① underground (y=72) → surfaceUp target 63' → 'y 72→72 (gain 0.0) onSurface=true' — a wasted round, and the
// commitment had flipped to GET_ARMOR 5s in: surfaceUp's fallback iteration (dig + pillarUp + 3 manual pillars) never
// checked its deadline, so it ran ~4.6s past the flip until the kernel force-halted it (T-0206).
test('T-0251: sky open over the head counts as surface (same T-0189 skyOpenAt as food_floor)', () => {
    assert.equal(shouldClimbForKit({ y: 50, sky: true, oldSurface: false }), false);
});

test('T-0251: at or above the climb target there is nothing to climb to, whatever the roof', () => {
    assert.equal(shouldClimbForKit({ y: 72, sky: false, oldSurface: false }), false);
    assert.equal(shouldClimbForKit({ y: SURFACE_UP_TARGET_Y, sky: null, oldSurface: false }), false);
});

test('T-0251: genuinely underground (dark, below target, old roof check agrees) → climb', () => {
    assert.equal(shouldClimbForKit({ y: 40, sky: false, oldSurface: false }), true);
    assert.equal(shouldClimbForKit({ y: 40, sky: null, oldSurface: false }), true, 'no light data → old criterion');
    assert.equal(shouldClimbForKit({ y: 58, sky: false, oldSurface: true }), false, 'leaf canopy dims light: old criterion still says surface');
});

test('T-0251: replenishKit uses it for ①, and surfaceUp checks its deadline inside the fallback iteration', () => {
    const rk = fs.readFileSync(new URL('../bots/_supervisor/skills/replenishKit.js', import.meta.url), 'utf8');
    assert.match(rk, /const onSurface = \(\) => \{ try \{ return !shouldClimbForKit\(\{ y: bot\.entity\.position\.y, sky: skyOpenAt\(bot\), oldSurface: bot\.entity\.position\.y >= 55 && openAboveNoCanopy\(10\) \}\); \} catch \(e\) \{ return false; \} \};/);
    const su = fs.readFileSync(new URL('../bots/_supervisor/skills/surfaceUp.js', import.meta.url), 'utf8');
    assert.match(su, /for \(let m = 0; m < 3 && !rose && !deadlineHit\(\); m\+\+\) rose = await manualPillar\(y0\);/);
    assert.match(su, /for \(let h = 2; h <= 4 && !deadlineHit\(\); h\+\+\) \{/);
    assert.match(su, /if \(deadlineHit\(\)\) break;   \/\/ ★T-0251/);
});
