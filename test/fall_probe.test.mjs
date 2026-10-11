import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createFallTracker, FALL_LOG_MIN_DROP } from '../src/agent/framework/fall_probe.js';

// T-0288 (death #56 07:06:46Z): a 24-block drop (y18 → y-6, -17hp, no mob) with nothing in the logs about what was
// driving the body. Not reproducible offline (unknown mover); the fallback signal is this probe's '[fall]' line, which
// names owner/skill/keys/goal at take-off. Pin the tracker semantics and the install.

const run = (tr, frames) => frames.map(f => tr.tick({ inWater: false, ...f })).filter(Boolean);

test('T-0288: a 24-block drop is recorded with the take-off snapshot', () => {
    const tr = createFallTracker();
    let calls = 0;
    const snap = () => { calls++; return { owner: 'mode:self_preservation', skill: 'smeltSafe', keys: 'forward+sprint', goal: 'none' }; };
    const out = run(tr, [
        { onGround: true, y: 18, now: 0, snapshot: snap },
        { onGround: false, y: 18, now: 50, snapshot: snap },
        { onGround: false, y: 10, now: 800, snapshot: snap },
        { onGround: false, y: -5, now: 1500, snapshot: snap },
        { onGround: true, y: -6, now: 1600, snapshot: snap },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].drop, 24);
    assert.equal(out[0].owner, 'mode:self_preservation');
    assert.equal(out[0].skill, 'smeltSafe');
    assert.equal(calls, 1, 'snapshot taken once, at take-off');
});

test('T-0288: jumps, small steps and water are not logged', () => {
    const tr = createFallTracker();
    assert.equal(run(tr, [{ onGround: false, y: 64.4, now: 0 }, { onGround: false, y: 65.2, now: 200 }, { onGround: true, y: 64, now: 400 }]).length, 0, 'a jump');
    assert.equal(run(tr, [{ onGround: false, y: 64, now: 0 }, { onGround: true, y: 64 - (FALL_LOG_MIN_DROP - 1), now: 400 }]).length, 0, 'a short step-down');
    assert.equal(run(tr, [{ onGround: false, y: 70, now: 0 }, { onGround: false, inWater: true, y: 62, now: 600 }, { onGround: true, y: 60, now: 900 }]).length, 0, 'landing in water ends the fall');
});

test('T-0288: the probe is installed with the modes', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const init = src.slice(src.indexOf('export function initModes(agent)'));
    assert.match(init, /installFallProbe\(agent\.bot, \{/);
});
