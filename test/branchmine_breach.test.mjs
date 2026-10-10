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
test('T-0180: branchMine reads the abort memory it writes — same cavity heading at the same spot is not retried (02:22:50/02:23:43 -35,36,-64 heading -1,0 ×2)', async () => {
    const { rotateAwayFromAborted } = await import('../bots/_supervisor/skills/mineDown.js');
    const now = 1_000_000;
    const avoid = [{ x: -35, z: -64, sx: -1, sz: 0, at: now - 50000 }];
    const r = rotateAwayFromAborted(avoid, { x: -35.5, z: -63.5 }, -1, 0, now);
    assert.equal(r.rotated, true);
    assert.notDeepEqual([r.sx, r.sz], [-1, 0]);
    const all = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([sx, sz]) => ({ x: -35, z: -64, sx, sz, at: now - 1000 }));
    assert.equal(rotateAwayFromAborted(all, { x: -35, z: -64 }, 1, 0, now).exhausted, true);
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/branchMine.js', import.meta.url), 'utf8');
    const h = src.slice(src.indexOf("let dx, dz, headingSrc = 'yaw';"), src.indexOf('log(bot, `branchMine heading'));
    assert.match(h, /rotateAwayFromAborted\(bot\._mineDownFluidAvoid, bot\.entity\.position, dx, dz\)/, 'tunnel heading consults the avoid memory');
    assert.match(h, /_r\.exhausted[\s\S]*return runProgress\(\)/, 'every heading aborted here → do not tunnel');
});