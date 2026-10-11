import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { planVoidBridge, planVoidHop, VOID_SAFE_DROP } from '../bots/_supervisor/skills/mineDown.js';

// T-0139 reopened (监工, live 10-11 02:25-02:27Z @278..284,58,-41..-44): full hp/food, shield + iron pick, heading to y14
// for iron — every heading 'no floor support under x,56,z (air)', 7 dispatches → cooldown. A cave roof one block thick
// over a big cavity: the stair's new-feet cell is roof rock, the cell under it is cave air on three sides. Void hop /
// re-heading can't escape it, and the pack holds 414 cobblestone. A human places a block under the next step (挖三填一)
// or, when the cave floor is close, just steps down into the cave.
const k = (x, y, z) => `${x},${y},${z}`;
// bot stands at (0,58,0) (feet cell y58, floor y57). Cave air for y ≤ 56 everywhere except the bot's own column,
// down to a cave floor whose top block is at y=floorY (solid at floorY and below).
function cave({ floorY = 40, roof = 57, extraAir = [], water = [] } = {}) {
    const A = new Set(extraAir.map(p => k(...p))), W = new Set(water.map(p => k(...p)));
    return (x, y, z) => {
        if (W.has(k(x, y, z))) return { name: 'water', boundingBox: 'empty' };
        if (A.has(k(x, y, z))) return { name: 'air', boundingBox: 'empty' };
        if (x === 0 && z === 0 && (y === 58 || y === 59)) return { name: 'air', boundingBox: 'empty' };   // body
        if (y > roof) return { name: 'stone', boundingBox: 'block' };
        if (y === roof) return { name: 'stone', boundingBox: 'block' };     // the roof: new-feet cells are rock
        if (y <= floorY) return { name: 'stone', boundingBox: 'block' };
        return { name: 'cave_air', boundingBox: 'empty' };
    };
}

test('T-0139: three headings void below the next step and no hop column — reproduces the live dead end', () => {
    const bn = cave();
    // (bot column is solid below y57 only through y57; every neighbour column is cave air from y56 down)
    assert.equal(planVoidHop(bn, 0, 58, 0, 1, 0, [{ sx: 0, sz: 1 }, { sx: 0, sz: -1 }]), null);
});

test('T-0139: deep cave under a solid roof cell → place one support block against the roof underside', () => {
    const plan = planVoidBridge(cave({ floorY: 40 }), 0, 58, 0, 1, 0);
    assert.ok(plan, 'bridge planned');
    assert.equal(plan.kind, 'bridge');
    assert.deepEqual(plan.place, [{ x: 1, y: 56, z: 0, on: 'top' }]);
});

test('T-0139: new-feet cell already open (inside the cave) → place it from our floor first, then the support under it', () => {
    const plan = planVoidBridge(cave({ floorY: 40, extraAir: [[1, 57, 0]] }), 0, 58, 0, 1, 0);
    assert.ok(plan && plan.kind === 'bridge');
    assert.deepEqual(plan.place, [{ x: 1, y: 57, z: 0, on: 'west' }, { x: 1, y: 56, z: 0, on: 'top' }]);
});

test('T-0139: cave floor within a damage-free drop → just step down into the cave (no blocks)', () => {
    // new feet would be y57 (dug); support y56 air; floor top at y54 → land with feet at y55: a 2-block drop
    const plan = planVoidBridge(cave({ floorY: 54 }), 0, 58, 0, 1, 0);
    assert.deepEqual(plan, { kind: 'drop', depth: 2, landY: 55 });
    assert.ok(VOID_SAFE_DROP <= 3, 'fall damage starts above 3 blocks');
});

test('T-0139: never drop into water/lava, never bridge a non-air void', () => {
    assert.equal(planVoidBridge(cave({ floorY: 54, water: [[1, 55, 0]] }), 0, 58, 0, 1, 0).kind, 'bridge', 'wet landing → bridge instead');
    const lavaSupport = (x, y, z) => (x === 1 && y === 56 && z === 0) ? { name: 'lava', boundingBox: 'empty' } : cave()(x, y, z);
    assert.equal(planVoidBridge(lavaSupport, 0, 58, 0, 1, 0), null);
    const solidSupport = (x, y, z) => (x === 1 && y === 56 && z === 0) ? { name: 'stone', boundingBox: 'block' } : cave()(x, y, z);
    assert.equal(planVoidBridge(solidSupport, 0, 58, 0, 1, 0), null, 'nothing to do');
});

test('T-0139: no floor under us to build the new-feet cell from → no plan', () => {
    const bn = (x, y, z) => (x === 0 && z === 0 && y === 57) ? { name: 'air', boundingBox: 'empty' } : cave({ extraAir: [[1, 57, 0]] })(x, y, z);
    assert.equal(planVoidBridge(bn, 0, 58, 0, 1, 0), null);
});

test('T-0139: mineDown bridges/drops before the void hop and the no-floor abort', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const i = src.indexOf('const _supportCollapses = supportCollapses(');
    const j = src.indexOf('planVoidHop(bn, cx, cy, cz, sx, sz, near)', i);
    assert.ok(i > 0 && j > i);
    const seg = src.slice(i, j);
    assert.match(seg, /planVoidBridge\(bn, cx, cy, cz, sx, sz\)/);
    assert.match(seg, /skills\.placeBlock\(bot, _blk, p\.x, p\.y, p\.z, p\.on, true, \{ positioning: false \}\)/);
});
