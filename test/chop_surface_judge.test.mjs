import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { shouldClimbAt } from '../src/agent/framework/surface_judge.js';

// Live 10-11 04:16:30-32Z @28,66,-10 (worker-tier 转, 零镐一阶): respawned with stick 4 / planks 2 / table 1, chopWood ×3 each
// returned in 0.4s with 0 logs → REPLENISH_KIT cooled: 'not-surface y=66 enclosed=false sky=false highSurface=false
// tree=13.3b unreachable → surfacing' → 'digToSurface NOPICK boxed cooldown' → 'surfacing hard-failed in no-pick stone box'.
// y66 is the surface; the sky probe counted the spruce canopy as a roof and _highOpenSurface needs y≥70.
// T-0258 replaced chopOnSurface (and three more hand-written tests in chopWood) with surface_judge.
test('T-0257: y66 under a canopy (no rock roof, open ring) → no climb, walk to the tree', () => {
    assert.equal(shouldClimbAt({ y: 66, sky: false, rockRoof: null, openRing: 8 }), false);
    assert.equal(shouldClimbAt({ y: 40, sky: false, rockRoof: 3 }), true, 'really underground still climbs');
});

test('T-0257/T-0258: every chopWood surface test goes through surface_judge', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/chopWood.js', import.meta.url), 'utf8');
    assert.match(src, /const _notSurface = !_highSurfaceLike && shouldClimbToSurface\(bot\);/);
    assert.match(src, /if \(surfaced < 3 && _notSurface\) \{/);
    assert.match(src, /const _trueSurfaceNow = \(\) => onSurfaceNow\(bot\);/);
    assert.match(src, /const _surfaced = onSurfaceNow\(bot\);/);
    assert.match(src, /import \{ skyOpenAt, onSurfaceNow, shouldClimbToSurface \} from '\.\.\/\.\.\/\.\.\/src\/agent\/framework\/surface_judge\.js';/);
});
