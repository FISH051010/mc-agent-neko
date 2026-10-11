import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { chopOnSurface } from '../bots/_supervisor/skills/chopWood.js';

// Live 10-11 04:16:30-32Z @28,66,-10 (worker-tier 转, 零镐一阶): respawned with stick 4 / planks 2 / table 1, chopWood ×3 each
// returned in 0.4s with 0 logs → REPLENISH_KIT cooled: 'not-surface y=66 enclosed=false sky=false highSurface=false
// tree=13.3b unreachable → surfacing' → 'digToSurface NOPICK boxed cooldown' → 'surfacing hard-failed in no-pick stone box'.
// y66 is the surface; the sky probe counted the spruce canopy as a roof and _highOpenSurface needs y≥70. Same criterion as
// T-0251 (replenishKit): sky open (skyOpenAt) or at/above the climb target (63) and not enclosed = surface → walk to the tree.
test('T-0257: y66 under a canopy, not enclosed → on the surface (the live dead end)', () => {
    assert.equal(chopOnSurface({ y: 66, enclosed: false, skyProbe: false, skyLight: false, highSurface: false }), true);
});

test('T-0257: skyOpenAt true counts as surface even below 63', () => {
    assert.equal(chopOnSurface({ y: 59, enclosed: false, skyProbe: false, skyLight: true, highSurface: false }), true);
});

test('T-0257: enclosed or deep stays not-surface; the old probe still works in between', () => {
    assert.equal(chopOnSurface({ y: 66, enclosed: true, skyProbe: false, skyLight: false, highSurface: false }), false);
    assert.equal(chopOnSurface({ y: 40, enclosed: false, skyProbe: false, skyLight: null, highSurface: false }), false);
    assert.equal(chopOnSurface({ y: 60, enclosed: false, skyProbe: true, skyLight: null, highSurface: false }), true);
    assert.equal(chopOnSurface({ y: 72, enclosed: true, skyProbe: false, skyLight: false, highSurface: true }), true, 'high open surface verdict kept');
});

test('T-0257: chopWood _notSurface uses chopOnSurface with skyOpenAt', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/chopWood.js', import.meta.url), 'utf8');
    assert.match(src, /const _notSurface = !chopOnSurface\(\{ y: _yNow, enclosed: _enclosedNow, skyProbe: _skyAboveNow, skyLight: skyOpenAt\(bot\), highSurface: _highSurfaceLike \}\);/);
    assert.match(src, /import \{ skyOpenAt \} from '\.\.\/\.\.\/\.\.\/src\/agent\/framework\/food_floor\.js';/);
});
