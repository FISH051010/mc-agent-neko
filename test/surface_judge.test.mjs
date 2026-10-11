import assert from 'node:assert/strict';
import test from 'node:test';
import { rockRoofAbove, onSurfaceAt, isCanopyBlock, SURFACE_LOW_Y, SURFACE_Y } from '../src/agent/framework/surface_judge.js';

// T-0258 审计 (监工): three bugs of one class — T-0189 (food_floor/quickMeal), T-0251 (replenishKit), T-0257 (chopWood) — each
// module had its own "am I on the surface" test and called a bot standing under a tree canopy "underground" (leaves/logs
// as a roof, skyLight dimmed <14). One predicate: a ROCK roof (non-canopy solid / fluid) above the head means underground;
// leaves, logs, vines, mangrove roots, azalea, bamboo never do. Sky light ≥14 is always surface.
const k = (x, y, z) => `${x},${y},${z}`;
function world(cells) {
    const M = new Map(Object.entries(cells));
    return (p) => {
        const n = M.get(k(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)));
        if (!n) return { name: 'air', boundingBox: 'empty' };
        return { name: n, boundingBox: /water|lava/.test(n) ? 'empty' : 'block' };
    };
}
const feet = { x: 0.5, y: 66, z: 0.5 };

test('T-0258: canopy blocks are not a roof', () => {
    for (const n of ['spruce_leaves', 'oak_log', 'stripped_birch_wood', 'crimson_stem', 'vine', 'mangrove_roots', 'azalea', 'flowering_azalea', 'bamboo']) assert.equal(isCanopyBlock({ name: n }), true, n);
    for (const n of ['stone', 'dirt', 'grass_block', 'deepslate', 'cobblestone', 'sand']) assert.equal(isCanopyBlock({ name: n }), false, n);
});

test('T-0258: under a spruce (logs + leaves overhead) there is no rock roof', () => {
    const bn = world({ [k(0, 68, 0)]: 'spruce_log', [k(0, 72, 0)]: 'spruce_leaves', [k(0, 73, 0)]: 'spruce_leaves' });
    assert.equal(rockRoofAbove(bn, feet), null);
});

test('T-0258: stone or water above the head is a roof; the first one is reported', () => {
    assert.equal(rockRoofAbove(world({ [k(0, 70, 0)]: 'stone' }), feet), 4);
    assert.equal(rockRoofAbove(world({ [k(0, 69, 0)]: 'oak_leaves', [k(0, 75, 0)]: 'water' }), feet), 9);
    assert.equal(rockRoofAbove(world({ [k(0, 80, 0)]: 'stone' }), feet, 10), null, 'beyond the scan height');
});

test('T-0258: verdict — sky light wins; else no rock roof and y ≥ SURFACE_LOW_Y', () => {
    assert.equal(SURFACE_Y, 63);
    assert.equal(onSurfaceAt({ y: 40, sky: true, rockRoof: 3 }), true, 'skyLight ≥14 is the surface');
    assert.equal(onSurfaceAt({ y: 66, sky: false, rockRoof: null }), true, 'T-0257 live: y66 under canopy');
    assert.equal(onSurfaceAt({ y: 72, sky: false, rockRoof: null }), true, 'T-0251 live: y72 under a spruce trunk');
    assert.equal(onSurfaceAt({ y: 72, sky: false, rockRoof: 5 }), false, 'mountain overhang / cave at y72');
    assert.equal(onSurfaceAt({ y: SURFACE_LOW_Y - 1, sky: null, rockRoof: null }), false, 'deep open pit / ravine');
    assert.equal(onSurfaceAt({ y: NaN, sky: null, rockRoof: null }), false);
});

test('T-0258: climb only when not on the surface and below SURFACE_Y', async () => {
    const { shouldClimbAt } = await import('../src/agent/framework/surface_judge.js');
    assert.equal(shouldClimbAt({ y: 40, sky: false, rockRoof: 3 }), true, 'in a mine');
    assert.equal(shouldClimbAt({ y: 66, sky: false, rockRoof: null }), false, 'under canopy');
    assert.equal(shouldClimbAt({ y: 72, sky: false, rockRoof: 5 }), false, 'overhang above 63: nowhere to climb (T-0251)');
    assert.equal(shouldClimbAt({ y: 50, sky: null, rockRoof: null }), true, 'open pit below 55');
});

test('T-0258: a skylight shaft in a cave (rock roof all around) is not the surface even with sky light; a canopy ring is', async () => {
    const { openRingCount, onSurfaceAt: v } = await import('../src/agent/framework/surface_judge.js');
    // rock ceiling at y70 over every ring column, nothing over the centre (the shaft)
    const cells = {};
    for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [4, 4], [4, -4], [-4, 4], [-4, -4]]) cells[k(dx, 70, dz)] = 'stone';
    assert.equal(openRingCount(world(cells), feet), 0);
    assert.equal(v({ y: 64, sky: true, rockRoof: null, openRing: 0 }), false, 'C32 y64 skylight-hole pin');
    const canopy = {};
    for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [4, 4], [4, -4], [-4, 4], [-4, -4]]) canopy[k(dx, 72, dz)] = 'oak_leaves';
    assert.equal(openRingCount(world(canopy), feet), 8);
    assert.equal(v({ y: 66, sky: false, rockRoof: null, openRing: 8 }), true);
    assert.equal(v({ y: 66, sky: false, rockRoof: null, openRing: 2 }), true, 'hillside: 2 open columns is enough');
    assert.equal(v({ y: 66, sky: false, rockRoof: null }), true, 'ring unknown → not required');
});

test('T-0258: no world data (no blockAt) → the old depth-only line y≥62', async () => {
    const { onSurfaceNow, shouldClimbToSurface, LEGACY_SURFACE_Y } = await import('../src/agent/framework/surface_judge.js');
    const bot = (y) => ({ entity: { position: { x: 0, y, z: 0 } } });
    assert.equal(LEGACY_SURFACE_Y, 62);
    assert.equal(onSurfaceNow(bot(64)), true);
    assert.equal(shouldClimbToSurface(bot(56)), true);
    assert.equal(shouldClimbToSurface(bot(62)), false);
});
