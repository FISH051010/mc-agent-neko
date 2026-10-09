// T-0172: death #9 (2026-10-09 21:46:15, suffocation @y46) — surfaceUp fallback dug straight up into a
// gravel column; the gravel refilled into the bot's own cells and pillarUp jumped into it (10s of
// continuous suffocation). Never climb a shaft with gravity blocks overhead; sidestep to a clean column.
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { gravityAboveShaft, sidestepOutOfGravity } from '../bots/_supervisor/skills/surfaceUp.js';

// stone everywhere at y<=45, the shaft (x0,z0) and an open side cell (x1,z0) dug at y45..46, gravel over the shaft
function world({ gravelOver = true, sideOpen = true, sideGravel = false } = {}) {
    return (p) => {
        if (p.x === 0 && p.z === 0 && (p.y === 45 || p.y === 46)) return { name: 'air', boundingBox: 'empty' };
        if (p.x === 0 && p.z === 0 && p.y >= 47 && p.y <= 49 && gravelOver) return { name: 'gravel', boundingBox: 'block' };
        if (p.x === 1 && p.z === 0 && (p.y === 45 || p.y === 46) && sideOpen) return { name: 'air', boundingBox: 'empty' };
        if (p.x === 1 && p.z === 0 && p.y === 48 && sideGravel) return { name: 'gravel', boundingBox: 'block' };
        return { name: 'stone', boundingBox: 'block' };
    };
}
const feet = new Vec3(0, 45, 0);

test('T-0172: gravel over the shaft → do not dig up / pillar here', () => {
    assert.equal(gravityAboveShaft(world(), feet), true);
    assert.equal(gravityAboveShaft(world({ gravelOver: false }), feet), false);
});

test('T-0172: sidestep picks a neighbouring column with nothing gravity overhead (open cells preferred)', () => {
    assert.deepEqual(sidestepOutOfGravity(world(), feet), [1, 0]);
    // the open side also has gravel overhead → choose a stone side to dig into instead
    const d = sidestepOutOfGravity(world({ sideGravel: true }), feet);
    assert.ok(d && !(d[0] === 1 && d[1] === 0), `must avoid the gravel-capped side, got ${d}`);
});
