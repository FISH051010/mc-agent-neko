import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { trunkGrounded, pickGroundedFirst, HIGH_TREE_DEFER_MAX } from '../bots/_supervisor/skills/chopWood.js';

// T-0256 (监工加急, 一阶停滞): death #53 respawn in a tall-spruce wood, 04:03-04:07Z — ~4 minutes of daylight for 1 log.
// The 'nearest' log was spruce_log@19,72,-10 straight above the bot (y66): the bottom of that trunk had been chopped, the
// rest hangs +6y. _trunkBase stops at the lowest log (still +6y), riskyTree's high-tree needs dy≥8 → it stayed the target:
// 'near-high-tree … surface/climb (try 1..4)', 'defer blacklist … (high tree +6y; climb first)' every pass (deferred while
// stale≤6), 'pinned-stair-climb blocked … no-step' rotating. Meanwhile the 16-candidate scan was mostly that one trunk.
// A human chops a tree whose trunk stands on the ground; a dangling trunk is the last resort; two failed climbs → next tree.
const k = (x, y, z) => `${x},${y},${z}`;
const world = (solid = [], logs = [], leaves = []) => {
    const S = new Set(solid.map(p => k(...p))), L = new Set(logs.map(p => k(...p))), V = new Set(leaves.map(p => k(...p)));
    return (p) => {
        const key = k(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
        if (L.has(key)) return { name: 'spruce_log', boundingBox: 'block' };
        if (V.has(key)) return { name: 'spruce_leaves', boundingBox: 'block' };
        if (S.has(key)) return { name: 'grass_block', boundingBox: 'block' };
        return { name: 'air', boundingBox: 'empty' };
    };
};

test('T-0256: a trunk standing on the ground is grounded; a chopped-off dangling trunk is not', () => {
    assert.equal(trunkGrounded(world([[0, 65, 0]]), { x: 0.5, y: 66, z: 0.5 }), true);
    assert.equal(trunkGrounded(world([[0, 65, 0]]), { x: 0.5, y: 72, z: 0.5 }), false, 'air under the base log');
    assert.equal(trunkGrounded(world([], [], [[0, 71, 0]]), { x: 0.5, y: 72, z: 0.5 }), false, 'resting on leaves is not ground');
});

test('T-0256: grounded tree wins over a nearer dangling trunk; dangling only when no grounded tree is in range', () => {
    const g = { d: 14.8, key: 'g' }, f = { d: 6.0, key: 'f' };
    assert.equal(pickGroundedFirst(g, f), g);
    assert.equal(pickGroundedFirst(null, f), f);
    assert.equal(pickGroundedFirst({ d: 60, key: 'far' }, f), f, 'a grounded tree 60b away does not beat a dangling one at 6b');
    assert.equal(pickGroundedFirst(g, null), g);
});

test('T-0256: a high tree gets at most HIGH_TREE_DEFER_MAX deferred (climb-first) passes, then is blacklisted', () => {
    assert.equal(HIGH_TREE_DEFER_MAX, 2);
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/chopWood.js', import.meta.url), 'utf8');
    assert.match(src, /&& \(_highDefer\.get\(_colKey\(nearest\.key\)\) \|\| 0\) < HIGH_TREE_DEFER_MAX;/);
    assert.match(src, /_highDefer\.set\(_colKey\(nearest\.key\), \(_highDefer\.get\(_colKey\(nearest\.key\)\) \|\| 0\) \+ 1\);/);
});

test('T-0256: the candidate scan sees more trees, dedupes columns and ranks grounded first', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/chopWood.js', import.meta.url), 'utf8');
    assert.match(src, /getNearestBlocksWhereAsync\(bot, logIds, _stages\[_si\], 48\)/);
    assert.match(src, /if \(_seenCols\.has\(_ck0\)\) continue; _seenCols\.add\(_ck0\);/);
    assert.match(src, /const _picked = pickGroundedFirst\(_nearG, _nearF\);/);
});
