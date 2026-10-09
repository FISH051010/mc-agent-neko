import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';
import { tablePlacedFromCarry, inConstrainedPocket } from '../src/agent/library/skills.js';

// T-0079: craftRecipeLocal (mobile emergency recraft) used to leave the table it placed from the bag —
// every abandoned table cost 4 scarce planks and dropped carried-table count to 0, so the next deep
// pick-recraft had no table (canRecraftPick=false) → picks drained → tier relapse to wood.

test('T-0079: reclaim only a table we placed from the carried stack, never a reused existing one', () => {
    const t = { position: new Vec3(1, 64, 0), name: 'crafting_table' };
    assert.equal(tablePlacedFromCarry({ table: t, tblBefore: 1, tblAfter: 0 }), true);
    assert.equal(tablePlacedFromCarry({ table: t, tblBefore: 1, tblAfter: 1 }), false, 'reused a nearby home table — leave it');
    assert.equal(tablePlacedFromCarry({ table: null, tblBefore: 1, tblAfter: 1 }), false);
});

// solid everywhere except listed open (feet+head) neighbour columns
function pocketBot(openDirs, mobility = null) {
    const open = new Set(openDirs.map(([dx, dz]) => `${dx},${dz}`));
    return {
        _mobility: mobility,
        entity: { position: new Vec3(0.5, 64, 0.5) },
        blockAt: (p) => ({ boundingBox: (p.y >= 64 && p.y <= 65 && (open.has(`${p.x},${p.z}`) || (p.x === 0 && p.z === 0))) ? 'empty' : 'block' }),
    };
}

test('fix#1 (07-07): in a dead-end pocket (<=1 opening) or MAROONED, do NOT break the table — drops bounce out of reach', () => {
    assert.equal(inConstrainedPocket(pocketBot([[1, 0]])), true, 'dead end');
    assert.equal(inConstrainedPocket(pocketBot([[1, 0], [-1, 0], [0, 1]], { state: 'MAROONED' })), true);
});

test('fix#1: a normal 1-wide tunnel (front+back open) still reclaims — T-0079 carried-table cycling unaffected', () => {
    assert.equal(inConstrainedPocket(pocketBot([[1, 0], [-1, 0]])), false);
});
