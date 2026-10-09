// T-0158: death #7 (2026-10-09 20:08:26, suffocation @y32) — mineDown in a gravel layer:
//   ① gravel "support" hanging over a cave collapsed when the cell above it was dug → 17-block fall (y49→32)
//   ② broke head+1/head gravel and walked forward before the column stopped falling → gravel in the head cell.
import test from 'node:test';
import assert from 'node:assert/strict';
import { supportCollapses, gravityPendingAbove } from '../bots/_supervisor/skills/mineDown.js';

test('T-0158: a gravel floor over a cave is not support', () => {
    assert.equal(supportCollapses('gravel', 'cave_air'), true);
    assert.equal(supportCollapses('sand', 'water'), true);
    assert.equal(supportCollapses('gravel', 'stone'), false, 'gravel resting on stone holds');
    assert.equal(supportCollapses('stone', 'air'), false, 'a stone ledge over a cave does not fall');
});

test('T-0158: do not step into a column that still has gravel coming down', () => {
    // column x=16,z=41: feet y31, head y32, clear y33 already dug (air)
    const world = (over) => (x, y, z) => ({ name: over[y] || (y <= 30 ? 'stone' : 'air') });
    // gravel two above the clear cell with air between → it will fall in
    assert.equal(gravityPendingAbove(world({ 35: 'gravel' }), 16, 31, 41), true);
    // a refilled cell (gravel landed in the head cell) → not clear
    assert.equal(gravityPendingAbove(world({ 32: 'gravel' }), 16, 31, 41), true);
    // stone roof right above the column holds whatever gravel sits on it
    assert.equal(gravityPendingAbove(world({ 34: 'stone', 35: 'gravel' }), 16, 31, 41), false);
    // nothing gravity overhead → safe
    assert.equal(gravityPendingAbove(world({ 34: 'stone' }), 16, 31, 41), false);
});
