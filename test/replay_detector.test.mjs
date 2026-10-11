import assert from 'node:assert/strict';
import test from 'node:test';
import { replay, triage, phaseOf, ADAPTERS } from '../bots/_supervisor/tools/replay-detector.mjs';

// bots/_supervisor/tools/replay-detector.mjs — the shared "回放校准" harness for new botwatch detectors. Synthetic
// history so the harness itself is pinned (tick cadence, liveness/log-gap skips, episode merge, triage evidence).

const T0 = Date.parse('2026-10-11T04:16:00Z');
const iso = (ms) => new Date(T0 + ms).toISOString();
const vit = (ms, o = {}) => ({ ts: T0 + ms, tod: 1000, skill: 'kernelDriver', x: 51, y: 66, z: -21, mob: 'FREE', hp: 20, ...o });

function history({ vitalsGapAt = null, progressGapAfter = null } = {}) {
    const vitals = [];
    for (let s = 0; s <= 600; s += 15) if (vitalsGapAt == null || s < vitalsGapAt[0] || s > vitalsGapAt[1]) vitals.push(vit(s * 1000));
    const progress = [{ t: T0 + 5000, l: `[${iso(5000)}] [kernel] dispatch → reclaimFurnace (kind=RECLAIM_FURNACE) args=[]` }];
    for (let s = 60; s <= 600; s += 60) if (progressGapAfter == null || s < progressGapAfter) progress.push({ t: T0 + s * 1000, l: `[${iso(s * 1000)}] [proposeTasks] ★REPLENISH_KIT-propose` });
    return { vitals, progress };
}

test('replay-detector: idle-dispatch over a synthetic 10-min still daylight gap → one merged episode starting ≥3min in', () => {
    const h = history();
    const eps = replay(h, ADAPTERS['idle-dispatch']());
    assert.equal(eps.length, 1);
    assert.ok(eps[0].start - T0 >= 3 * 60000 + 5000 - 15000 && eps[0].start - T0 <= 3 * 60000 + 20000);
    const tri = triage(eps[0], h);
    assert.equal(tri.span, 0);
    assert.deepEqual(tri.mobility, ['FREE']);
    assert.ok(tri.tags['[proposeTasks]'] >= 1);
});

test('replay-detector: ticks where the bot is not live (vitals stale) or progress.txt has a log gap are skipped', () => {
    // vitals missing after 2:00 until 8:45 — botwatch still counts the bot live for STALE (90s) after the last sample,
    // so 3:30 → 8:45 is offline: no tick in there may be reported (episodes end before it or start after it)
    const offline = replay(history({ vitalsGapAt: [121, 524] }), ADAPTERS['idle-dispatch']());
    const offA = T0 + 120000 + 90000, offB = T0 + 525000;
    assert.ok(offline.every(e => e.end <= offA || e.start >= offB), `hits inside the offline gap: ${JSON.stringify(offline.map(e => [e.start - T0, e.end - T0]))}`);
    // 20 min of vitals but progress.txt only has the 0:05 dispatch → after 10 min without any line it's a log gap
    // (botwatch would have seen lines), so the episode must end there instead of running on to the end of vitals.
    const vitals = [];
    for (let s = 0; s <= 1200; s += 15) vitals.push(vit(s * 1000));
    const progress = [{ t: T0 + 5000, l: `[${iso(5000)}] [kernel] dispatch → reclaimFurnace (kind=RECLAIM_FURNACE) args=[]` }];
    const eps = replay({ vitals, progress }, ADAPTERS['idle-dispatch']());
    assert.equal(eps.length, 1);
    assert.ok(eps[0].end < T0 + 5000 + 10 * 60000, `episode must stop at the log gap, ended ${new Date(eps[0].end).toISOString()}`);
});

test('replay-detector: phaseOf mirrors world_model (day < 12000, dusk, night, dawn ≥ 23000)', () => {
    assert.deepEqual([0, 11999, 12000, 13000, 22999, 23000].map(phaseOf), ['day', 'day', 'dusk', 'night', 'night', 'dawn']);
    assert.equal(phaseOf(null), null);
});
