// T-0180 ①: death #12 — night branchMine broke into a dripstone cave holding mobs. A step that opens onto a natural
// cavity (and a hostile is around) must be plugged and abandoned, not walked into.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cavityBreach } from '../bots/_supervisor/skills/branchMine.js';

const p = { x: 0, y: 10, z: 0 };
const tunnelOnly = (x, y, z) => ({ name: (z === 0 && x <= 1 && (y === 10 || y === 11)) ? 'air' : 'stone' });
const cave = (x, y, z) => ({ name: (x >= 1 && x <= 4 && y >= 9 && y <= 13) ? 'cave_air' : 'stone' });

test('T-0180①: our own 1×2 tunnel is not a cavity', () => {
    assert.equal(cavityBreach(tunnelOnly, p, 1, 0), false);
});
test('T-0180①: a natural cave opening ahead is a breach', () => {
    assert.equal(cavityBreach(cave, p, 1, 0), true);
});