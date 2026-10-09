import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { planWaterStep } from '../src/agent/mobility_geom.js';

// Live 10-09 20:42:39→20:46:06 @-40,62,21: 1-deep pond (floor y61 dirt, water y62, air above), a 2-high spruce_log
// stump at +z. The swim reflex's pillar (placeBlockUnderFeet) needs feet ≥ 62.92 but a bot bobbing at the surface
// tops out ~62.83 → ~90× 'exhausted-retries' over 3.5min. A human drops a block into a NEIGHBOUR water cell and
// swims up onto it.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const k = (x, y, z) => `${x},${y},${z}`;
function pond(over = {}) {
    return (x, y, z) => {
        const o = over[k(x, y, z)];
        if (o) return { name: o, boundingBox: /water|air|grass/.test(o) ? 'empty' : 'block' };
        if (y <= 61) return { name: 'dirt', boundingBox: 'block' };
        if (y === 62) return { name: 'water', boundingBox: 'empty' };
        return { name: 'air', boundingBox: 'empty' };
    };
}
const feet = { x: -40, y: 62, z: 21 };

test('T-0165: in a 1-deep pond the step goes into a neighbour water cell with solid floor and 2 air above', () => {
    const bn = pond({ [k(-40, 62, 22)]: 'spruce_log', [k(-40, 63, 22)]: 'spruce_log' });
    const s = planWaterStep(bn, feet);
    assert.ok(s, 'a step exists');
    assert.equal(s.y, 62);
    assert.notDeepEqual([s.x, s.z], [-40, 22], 'not into the log');
    assert.equal(Math.abs(s.x - feet.x) + Math.abs(s.z - feet.z), 1, 'cardinal neighbour');
});

test('T-0165: the step prefers the shore direction', () => {
    const s = planWaterStep(pond(), feet, { x: -50, z: 21 });
    assert.deepEqual([s.x, s.z], [-41, 21]);
});

test('T-0165: no step over deep water (no floor), under a low ceiling, or with no headroom over the bot', () => {
    const deep = (x, y, z) => (y >= 63 ? { name: 'air', boundingBox: 'empty' } : { name: 'water', boundingBox: 'empty' });
    assert.equal(planWaterStep(deep, feet), null, 'nothing to place against → swim/pillar path');
    const ceil = {};
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ceil[k(-40 + dx, 64, 21 + dz)] = 'stone';
    assert.equal(planWaterStep(pond(ceil), feet), null, 'step needs 2 air above it to stand');
    assert.equal(planWaterStep(pond({ [k(-40, 64, 21)]: 'stone' }), feet), null, 'bot needs its own y+2 to rise onto the step');
});

test('T-0165: swim reflex tries the neighbour step before the (surface-infeasible) under-feet pillar', () => {
    const src = fs.readFileSync(path.join(root, 'src/agent/modes.js'), 'utf8');
    assert.match(src, /if \(await skills\.climbOutViaWaterStep\(bot, f, target\)\) \{/);
    const sk = fs.readFileSync(path.join(root, 'src/agent/library/skills.js'), 'utf8');
    assert.match(sk, /export async function climbOutViaWaterStep\(bot, item, prefer = null\)/);
});
