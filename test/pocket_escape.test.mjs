import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';
import { planPocketEscape } from '../src/agent/mobility_geom.js';

// T-0036 / C305-A: the POCKET carve only scanned head-level (dy+1) walls. A bot in a 1-deep FOOT slot (foot-level
// walls stone, head-level all air) found nothing to dig → "carving a step out" spun ~4min with zero motion.

const STONY = /stone|deepslate|andesite|diorite|granite|tuff|_ore$|obsidian|cobble|terracotta|sandstone/;
const M = new Vec3(0, 64, 0);
// cells: map "dx,dy,dz" relative to M → block name ('air' default)
function world(cells, base = 'air') {
    return (p) => {
        const k = `${p.x - M.x},${p.y - M.y},${p.z - M.z}`;
        const name = cells[k] ?? base;
        return { name, boundingBox: /air|water|lava/.test(name) ? 'empty' : 'block', position: p };
    };
}
const opts = (o = {}) => ({ hasPick: true, enclosed: false, stonyRe: STONY, ...o });

test('T-0036: 1-deep foot slot (foot-level stone step, head-level air) → CLIMB onto the step, no digging', () => {
    const cells = {};
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { cells[`${dx},0,${dz}`] = 'stone'; cells[`${dx},-1,${dz}`] = 'stone'; }
    cells['0,-1,0'] = 'stone';
    const plan = planPocketEscape(world(cells), M, opts());
    assert.equal(plan.action.kind, 'climb');
});

test('C305-A: walled at foot AND head (no ready step) → dig the FOOT wall and clear the head cell above it', () => {
    const cells = { '0,-1,0': 'stone', '0,2,0': 'stone' };   // own head-room blocked → no climb
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { cells[`${dx},0,${dz}`] = 'dirt'; cells[`${dx},1,${dz}`] = 'dirt'; cells[`${dx},-1,${dz}`] = 'stone'; }
    const plan = planPocketEscape(world(cells), M, opts());
    assert.equal(plan.action.kind, 'dig');
    assert.equal(plan.action.wall.position.y, 64, 'foot level first (old code dug head only)');
    assert.equal(plan.action.other.position.y, 65);
});

test('C305-A: no-pick stone is gated in the open but allowed when enclosed (bare-hand breakout)', () => {
    const cells = { '0,-1,0': 'stone', '0,2,0': 'stone' };
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { cells[`${dx},0,${dz}`] = 'stone'; cells[`${dx},1,${dz}`] = 'stone'; cells[`${dx},-1,${dz}`] = 'stone'; }
    const open = planPocketEscape(world(cells), M, opts({ hasPick: false }));
    assert.equal(open.action, null);
    assert.equal(open.gated.length, 4);
    const sealed = planPocketEscape(world(cells), M, opts({ hasPick: false, enclosed: true }));
    assert.equal(sealed.action.kind, 'dig');
});

test('C305-A: never dig toward a void or fluid floor; never climb onto water', () => {
    const cells = { '0,-1,0': 'stone', '0,2,0': 'stone' };
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { cells[`${dx},0,${dz}`] = 'dirt'; cells[`${dx},1,${dz}`] = 'dirt'; cells[`${dx},-1,${dz}`] = 'water'; }
    assert.equal(planPocketEscape(world(cells), M, opts()).action, null);
});
