import assert from 'node:assert/strict';
import test from 'node:test';
import { scaffoldIdsFromInventory, pickPathMode } from '../src/agent/library/skills.js';

// T-0052 / T-0053: in mesa/pocket terrain goToPosition threw "refusing blind destructive navigation" for EVERY
// caller — destructive A* could only dig (no scaffolding → can't pillar/bridge out of a pit), and anything but a
// 'success' pre-check was discarded even when a real partial route existed (live: nd=partial/len14, d=partial → none).

test('T-0053/C320: partial routes are followed (executor re-plans); complete beats partial, walking beats digging', () => {
    assert.equal(pickPathMode('partial', 'partial'), 'nd', 'live 00:14: both partial → selected=none → stuck');
    assert.equal(pickPathMode('noPath', 'partial'), 'd');
    assert.equal(pickPathMode('partial', 'success'), 'd', 'a complete destructive route beats a partial walk');
    assert.equal(pickPathMode('success', null), 'nd');
    assert.equal(pickPathMode('noPath', 'noPath'), null, 'genuine no path still throws');
    assert.equal(pickPathMode('timeout', 'timeout'), null);
});

test('T-0052/C319: the destructive fallback may build with fillers we actually carry (and only those)', () => {
    const ids = { cobblestone: 1, dirt: 2, red_terracotta: 3, oak_planks: 4, red_sand: 5 };
    const got = scaffoldIdsFromInventory(
        [{ name: 'cobblestone' }, { name: 'cobblestone' }, { name: 'red_terracotta' }, { name: 'oak_planks' }, { name: 'iron_pickaxe' }, { name: 'red_sand' }],
        (n) => ids[n]);
    assert.deepEqual(got.sort(), [1, 3, 5], 'deduped; planks/tools are never scaffolding');
    assert.deepEqual(scaffoldIdsFromInventory([], (n) => ids[n]), []);
});
