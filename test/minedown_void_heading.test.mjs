import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { rememberAbortedHeading, rotateAwayFromAborted, ABORT_HEADING_TTL_MS } from '../bots/_supervisor/skills/mineDown.js';

// Live 10-10 02:58:23→26 @-3,43,-1: mineDown aborted 3× on 'no floor support under -4,41,-1 (air)' with dig=0 —
// the void abort never fed the heading memory, so each re-dispatch took the same heading into the same cave
// → GO_UNDERGROUND dispatch cooldown 5min.
const at = (x, z) => ({ entity: { position: { x, z } } });

test('T-0139: a void (no-floor) abort makes the next dispatch from here start on a different heading', () => {
    const bot = at(-3, -1);
    rememberAbortedHeading(bot, -1, 0, 1000);
    const r = rotateAwayFromAborted(bot._mineDownFluidAvoid, { x: -3, z: -1 }, -1, 0, 2000);
    assert.equal(r.rotated, true);
    assert.notDeepEqual([r.sx, r.sz], [-1, 0]);
});

test('T-0139: memory is local (8b) and TTL-bound; all four cardinals failed → exhausted (relocate path)', () => {
    const bot = at(0, 0);
    rememberAbortedHeading(bot, 1, 0, 0);
    assert.equal(rotateAwayFromAborted(bot._mineDownFluidAvoid, { x: 20, z: 0 }, 1, 0, 1).rotated, false, 'far away → not remembered');
    assert.equal(rotateAwayFromAborted(bot._mineDownFluidAvoid, { x: 0, z: 0 }, 1, 0, ABORT_HEADING_TTL_MS + 1).rotated, false, 'expired');
    for (const [sx, sz] of [[0, 1], [-1, 0], [0, -1]]) rememberAbortedHeading(bot, sx, sz, 0);
    assert.equal(rotateAwayFromAborted(bot._mineDownFluidAvoid, { x: 0, z: 0 }, 1, 0, 10).exhausted, true);
});

test('T-0139: mineDown wires the void abort into the shared heading memory', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /no floor support under [^\n]*rememberAbortedHeading\(bot, sx, sz\); break; \}/);
    assert.match(src, /const _rot = rotateAwayFromAborted\(bot\._mineDownFluidAvoid, p0, sx, sz\);/);
});
