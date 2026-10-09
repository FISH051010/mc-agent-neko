import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { planVoidHop } from '../bots/_supervisor/skills/mineDown.js';

// Live 10-10 03:03:06/27 @-3,43,-1 (heading -1,0): mineDown aborted in place on 'no floor support under
// -4,41,-1 (air)' (cave cavity), dug=0, every dispatch → cooldown. Spec (监工): turn or sidestep ≤4 blocks to a
// column with 3 solid below and restart the stair in the same dispatch, ≤3 times.
const k = (x, y, z) => `${x},${y},${z}`;
// world = stone everywhere at y<=42 except listed voids; air at y>=43 (the stair corridor level)
function world({ voids = [], fluids = [], solidAbove = [] } = {}) {
    const V = new Set(voids.map(([x, y, z]) => k(x, y, z))), F = new Set(fluids.map(([x, y, z]) => k(x, y, z)));
    const S = new Set(solidAbove.map(([x, y, z]) => k(x, y, z)));
    return (x, y, z) => {
        if (F.has(k(x, y, z))) return { name: 'water', boundingBox: 'empty' };
        if (V.has(k(x, y, z))) return { name: 'cave_air', boundingBox: 'empty' };
        if (y >= 43 && !S.has(k(x, y, z))) return { name: 'air', boundingBox: 'empty' };
        return { name: 'stone', boundingBox: 'block' };
    };
}
// a cave cavity under the whole -x/+z/-z ring of the bot, columns 2+ blocks east are intact
const caveRing = [];
for (let x = -6; x <= -2; x++) for (let z = -3; z <= 1; z++) for (let y = 38; y <= 41; y++) caveRing.push([x, y, z]);

test('T-0137②: void ahead but a sound cardinal right here → turn in place (no walking)', () => {
    const bn = world({ voids: [[-4, 41, -1], [-4, 40, -1]] });
    const plan = planVoidHop(bn, -3, 43, -1, -1, 0);
    assert.equal(plan.kind, 'turn');
    assert.notDeepEqual([plan.sx, plan.sz], [-1, 0]);
});

test('T-0137②: every cardinal here is over the cave → walk ≤4b to a column with 3 solid below and restart', () => {
    const bn = world({ voids: caveRing });
    const plan = planVoidHop(bn, -3, 43, -1, -1, 0);
    assert.equal(plan.kind, 'hop');
    assert.ok(plan.path.length >= 1 && plan.path.length <= 4);
    // the chosen column and the next stair cell from it are on solid ground 3 deep
    for (const y of [42, 41, 40]) assert.equal(bn(plan.x, y, plan.z).boundingBox, 'block');
});

test('T-0137②: no safe column within 4b (cave everywhere / water on the way) → null = honest abort', () => {
    const wide = [];
    for (let x = -12; x <= 6; x++) for (let z = -10; z <= 8; z++) for (let y = 38; y <= 41; y++) wide.push([x, y, z]);
    assert.equal(planVoidHop(world({ voids: wide }), -3, 43, -1, -1, 0), null);
    const fluidLine = [];
    for (let d = 1; d <= 4; d++) fluidLine.push([-3, 42, -1 - d], [-3, 42, -1 + d], [-3 + d, 42, -1]);
    assert.equal(planVoidHop(world({ voids: caveRing, fluids: fluidLine }), -3, 43, -1, -1, 0), null);
});

test('T-0137②: mineDown wires the void hop into the step loop (≤3 per dispatch, same dispatch continue)', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /if \(voidHops < 3\) \{[\s\S]{0,400}const plan = planVoidHop\(bn, cx, cy, cz, sx, sz, near\);/);
    assert.match(src, /sx = plan\.sx; sz = plan\.sz; noProg = 0;\s+continue;/);
});
