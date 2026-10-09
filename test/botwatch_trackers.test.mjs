import assert from 'node:assert/strict';
import test from 'node:test';
import { makeFrozenAliveTracker, frozenAliveActive, makeWedgeTracker, falseHoldActive } from '../bots/_supervisor/botwatch-trackers.mjs';

const MIN = 60000;
const st = (x, y, z, hp, extra = {}) => ({ v: { x, y, z }, hp, ...extra });

// Feed a sequence of [tMs, state] samples, return the predicate result after the last one.
function drive(tracker, field, active, samples) {
    let s;
    for (const [t, state] of samples) { s = state; s[field] = tracker(s, t); }
    return { fired: active(s), s };
}

test('T-0058/T-0062: frozen data + live writer — pos+hp pinned 2min AND events.log silent → FROZEN-ALIVE fires', () => {
    let eventsMtime = 0;   // events.log last written at t=0, then silent
    const tr = makeFrozenAliveTracker(() => eventsMtime);
    const { fired, s } = drive(tr, '_frozen', frozenAliveActive,
        [[0, st(-118, 71, 24, 20)], [60000, st(-118, 71, 24, 20)], [150000, st(-118, 71, 24, 20)]]);
    assert.equal(fired, true, 'vitals.ts freshness must not mask a dead-pinned pos/hp');
    assert.ok(s._frozen.frozenMs >= 2 * MIN);
});

test('T-0058: legit sealed night-hold keeps emitting events → no FROZEN-ALIVE false fire', () => {
    let t0 = 0;
    const tr = makeFrozenAliveTracker(() => t0);
    const samples = [];
    for (let t = 0; t <= 10 * MIN; t += 15000) { samples.push([t, st(5, 40, 5, 20)]); }
    // events.log touched every tick (Pocketed / table-recovery chatter)
    let s;
    for (const [t, state] of samples) { t0 = t - 5000; s = state; s._frozen = tr(s, t); }
    assert.equal(frozenAliveActive(s), false);
});

test('T-0058: any pos or hp change resets the frozen timer', () => {
    const tr = makeFrozenAliveTracker(() => 0);
    const { fired } = drive(tr, '_frozen', frozenAliveActive,
        [[0, st(1, 64, 1, 20)], [100000, st(1, 64, 1, 20)], [110000, st(1, 64, 1, 19)], [200000, st(1, 64, 1, 19)]]);
    assert.equal(fired, false, 'only 90s since the hp change');
});

test('T-0062: false hold — pinned 10min in a 3-block cell WHILE losing hp → FALSE-HOLD fires (events may be flowing)', () => {
    const tr = makeWedgeTracker();
    const samples = [];
    for (let t = 0; t <= 11 * MIN; t += 30000) {
        const jitter = (t / 30000) % 2 ? 0.4 : -0.4;                 // bobbing in a niche
        samples.push([t, st(-92 + jitter, 18, -102, t < 5 * MIN ? 20 : 15, { skill: 'kernelDriver' })]);
    }
    const { fired, s } = drive(tr, '_wedge', falseHoldActive, samples);
    assert.equal(s._wedge.hpDrop, 5);
    assert.equal(fired, true);
});

test('T-0062: genuine safe hold (zero damage) only fires after 20min; sleeping in bed never fires', () => {
    const tr = makeWedgeTracker();
    const at = (min, extra) => [min * MIN, st(0, 60, 0, 20, extra)];
    assert.equal(drive(tr, '_wedge', falseHoldActive, [at(0), at(12)]).fired, false, '12min no hp loss = legit hold');
    assert.equal(drive(tr, '_wedge', falseHoldActive, [at(21)]).fired, true, '20min+ pinned is a wedge regardless');
    const tr2 = makeWedgeTracker();
    assert.equal(drive(tr2, '_wedge', falseHoldActive, [at(0, { skill: 'bed' }), at(30, { skill: 'bed' })]).fired, false);
});
