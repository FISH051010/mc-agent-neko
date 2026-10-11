import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as geom from '../src/agent/mobility_geom.js';

// T-0285 (death #56, 10-11 07:07:06Z, y-12 cave, hp 9, four creepers): the creeper backoff loop counted stuckRun per
// 160ms step (moved < 0.12b). Hop-pressing into a wall (ground=false, vy 0.33) jitters >0.12b a step, so stuckRun kept
// resetting to 0 while the NET displacement over 2.5s was <0.5b (-78.7,-250 → -78.6,-249.8). The wedge branch
// (punch-back / interpose / emergency seal) never fired; creeper 464014 walked from 6.5m to 2.8m and detonated.
// Same family as T-0091: an oscillation fools a per-step stuck test — judge net progress over a window.

const jitter = (n) => Array.from({ length: n }, (_, i) => ({ x: -78.6 + (i % 2 ? 0.25 : -0.2), z: -249.8 + (i % 3 ? 0.15 : -0.15) }));

test('T-0285: hop-jitter against a wall (every step > 0.12b, net < 1b) is stuck', () => {
    assert.equal(typeof geom.runNetStuck, 'function', 'mobility_geom must export runNetStuck');
    const trail = jitter(8);
    for (let i = 1; i < trail.length; i++) assert.ok(Math.hypot(trail[i].x - trail[i - 1].x, trail[i].z - trail[i - 1].z) > 0.12, 'fixture: each step beats the old per-step test');
    assert.equal(geom.runNetStuck(trail), true);
});

test('T-0285: a real sprint away (≥1b net over the window) is not stuck; a short trail is not judged', () => {
    const run = Array.from({ length: 8 }, (_, i) => ({ x: i * 0.8, z: 0 }));
    assert.equal(geom.runNetStuck(run), false);
    assert.equal(geom.runNetStuck(jitter(5)), false, 'needs a full window before calling it stuck');
});

test('T-0285: the creeper backoff loop feeds a position trail into runNetStuck and arms the wedge branch at once', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const loop = src.slice(src.indexOf('let gatedPunches = 0;'), src.indexOf("Kiting creeper+swarm till dawn"));
    assert.match(loop, /runNetStuck\(runTrail\)/);
    assert.match(loop, /stuckRun = Math\.max\(stuckRun \+ 1, 8\)/, 'net-stuck must reach the wedge threshold immediately');
});
