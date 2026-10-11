import assert from 'node:assert/strict';
import test from 'node:test';
import { columnRoofed, ROOF_SCAN_DY } from '../src/agent/framework/surface_judge.js';

// T-0271 columnRoofed (ring check): a roof over a column = solid or fluid ABOVE an air gap; the column's own ground doesn't count.
// worker-tests mutation 10-11: the surface_judge T-0271 tests stayed green with `return !seenAir` → `return false` (a column of
// solid rock all the way up = "open") and with fluid dropped from the roof test — both flip a cave/underwater ring to "surface".
const column = (layers) => (p) => {
    // layers: [[fromDy, toDy, name]] relative to feetY = 60, x/z ignored
    const dy = p.y - 60;
    for (const [a, b, n] of layers) if (dy >= a && dy <= b) return { name: n, boundingBox: /water|lava|air/.test(n) ? 'empty' : 'block' };
    return { name: 'air', boundingBox: 'empty' };
};

test('T-0271: a column that never reaches air within the scan (inside a mountain) is roofed', () => {
    assert.equal(columnRoofed(column([[0, ROOF_SCAN_DY + 4, 'stone']]), 0, 60, 0), true);
});

test('T-0271: water (or lava) above the air gap is a roof — a pocket under a lake is not the surface', () => {
    assert.equal(columnRoofed(column([[0, 1, 'stone'], [6, 9, 'water']]), 0, 60, 0), true);
    assert.equal(columnRoofed(column([[0, 1, 'stone'], [6, 6, 'lava']]), 0, 60, 0), true);
});

test('T-0271: own ground then open sky / canopy only → not roofed (hillside neighbour, forest)', () => {
    assert.equal(columnRoofed(column([[0, 3, 'dirt']]), 0, 60, 0), false, 'hillside: ground rising above feet+2, then sky');
    assert.equal(columnRoofed(column([[0, 0, 'grass_block'], [5, 8, 'oak_leaves']]), 0, 60, 0), false, 'canopy is not a roof');
    assert.equal(columnRoofed(column([[0, 0, 'dirt'], [4, 4, 'stone']]), 0, 60, 0), true, 'rock after the gap is');
});
