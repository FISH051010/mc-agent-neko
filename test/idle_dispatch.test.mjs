import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeIdleDispatchTracker, IDLE_DISPATCH_MS } from '../bots/_supervisor/botwatch-trackers.mjs';

// IDLE-DISPATCH (监工 10-11): daytime + kernelDriver driving + no kernel dispatch and no skill progress and no body
// motion for ≥3min → ticket. Calibrated by replaying 10-09→10-11 progress.txt + vitals.jsonl at botwatch's 15s cadence:
// the 04:16:41→04:21:33 window hits; the other 13 hits were each verified as the same class (body pinned in daylight,
// kernel silent: dispatch-cooldown with nothing else proposable / FREE_PLAY / skill abort loop / ENTOMBED all day);
// zero hits while the body moved or a skill was logging.

// The real 04:16 excerpt (progress.txt, 10-11): reclaimFurnace finished at 04:16:41, then only [proposeTasks] chatter.
const REAL_0416 = [
    '[2026-10-11T04:16:32.221Z] [kernel] ★dispatch-cooldown REPLENISH_KIT via replenishKit: failed 3x consecutively — suppressing REPLENISH_KIT proposals 5min',
    '[2026-10-11T04:16:33.730Z] [kernel] dispatch → reclaimFurnace (kind=RECLAIM_FURNACE) args=[]',
    '[2026-10-11T04:16:41.745Z] [reclaimFurnace] reclaim stranded furnace @52,66,-23: +5 (iron_ingot/raw_iron, expected 5)',
    '[2026-10-11T04:16:41.746Z] [reclaimFurnace] done: +5 items, 0 furnace(s) picked up, 0 record(s) left',
    '[2026-10-11T04:16:46.987Z] [proposeTasks] ★REPLENISH_KIT-propose: picks=0/2 planksEq=2/16 pri=67 y=66',
    '[2026-10-11T04:17:47.795Z] [proposeTasks] ★REPLENISH_KIT-propose: picks=0/2 planksEq=2/16 pri=67 y=66',
    '[2026-10-11T04:18:48.240Z] [proposeTasks] ★REPLENISH_KIT-propose: picks=0/2 planksEq=2/16 pri=67 y=66',
    '[2026-10-11T04:19:48.319Z] [proposeTasks] ★REPLENISH_KIT-propose: picks=0/2 planksEq=2/16 pri=67 y=66',
    '[2026-10-11T04:20:48.442Z] [proposeTasks] ★REPLENISH_KIT-propose: picks=0/2 planksEq=2/16 pri=67 y=66',
    '[2026-10-11T04:21:33.669Z] [kernel] dispatch → replenishKit (kind=REPLENISH_KIT) args=[]',
];
const at = (iso) => Date.parse(iso);
const PIN = { x: 51.5, y: 66, z: -21.5 };

// Drive like botwatch: every 15s ingest the lines that appeared, note the body, check.
function drive(lines, { from, to, phase = () => 'day', driver = 'kernelDriver', pos = () => PIN, tracker = makeIdleDispatchTracker() }) {
    const parsed = lines.map(l => ({ t: Date.parse(l.slice(1, 25)), l })).sort((a, b) => a.t - b.t);
    let i = 0;
    const hits = [];
    for (let now = from; now <= to; now += 15000) {
        const batch = [];
        while (i < parsed.length && parsed[i].t <= now) batch.push(parsed[i++].l);
        tracker.ingest(batch);
        tracker.noteBody(now, pos(now));
        const h = tracker.check(now, { phase: phase(now), driver });
        if (h) hits.push({ now, ...h });
    }
    return hits;
}

test('IDLE-DISPATCH: the real 10-11 04:16:41→04:21:33 daylight gap fires (≥3min, no dispatch, body still)', () => {
    const hits = drive(REAL_0416, { from: at('2026-10-11T04:16:30Z'), to: at('2026-10-11T04:21:30Z') });
    assert.ok(hits.length > 0, 'must fire');
    const first = hits[0].now;
    assert.ok(first >= at('2026-10-11T04:19:41Z') && first <= at('2026-10-11T04:20:00Z'), `first fire at ${new Date(first).toISOString()}`);
    assert.equal(hits[0].lastKind, 'RECLAIM_FURNACE');
    assert.ok(hits.every(h => h.idleMs >= IDLE_DISPATCH_MS));
    const after = drive(REAL_0416, { from: at('2026-10-11T04:16:30Z'), to: at('2026-10-11T04:22:30Z') });
    assert.ok(after.every(h => h.now < at('2026-10-11T04:21:33Z')), 'the 04:21:33 dispatch clears it');
});

test('IDLE-DISPATCH: [proposeTasks]/[mobility]/[kernel] chatter is not activity, a skill progress line is', () => {
    const base = '2026-10-11T10:00:';
    const lines = ['[2026-10-11T10:00:00.000Z] [kernel] dispatch → mineDown (kind=GO_UNDERGROUND) args=[]'];
    for (let s = 50; s <= 59; s += 3) lines.push(`[${base}${s}.000Z] [mobility] → FREE`);
    const silent = drive(lines, { from: at('2026-10-11T10:00:00Z'), to: at('2026-10-11T10:03:30Z') });
    assert.ok(silent.length > 0);
    const logging = [...lines];
    for (let m = 1; m <= 3; m++) logging.push(`[2026-10-11T10:0${m}:00.000Z] [mineDown] step ${m} pos=1,40,1 dug=${m * 3}`);
    assert.equal(drive(logging, { from: at('2026-10-11T10:00:00Z'), to: at('2026-10-11T10:03:30Z') }).length, 0, 'a long single skill that keeps logging is legit');
});

test('IDLE-DISPATCH: a silent long skill whose body is MOVING is legit', () => {
    const lines = ['[2026-10-11T10:00:00.000Z] [kernel] dispatch → migrate (kind=MIGRATE) args=[]'];
    const walking = (now) => ({ x: (now - at('2026-10-11T10:00:00Z')) / 3000, y: 64, z: 0 });   // 5 blocks / 15s
    assert.equal(drive(lines, { from: at('2026-10-11T10:00:00Z'), to: at('2026-10-11T10:05:00Z'), pos: walking }).length, 0);
});

test('IDLE-DISPATCH: intentional stillness is exempt — HOLD / HEAL kinds and a self_preservation FAMINE body freeze', () => {
    for (const kind of ['HOLD', 'HEAL']) {
        const l = [`[2026-10-11T10:00:00.000Z] [kernel] dispatch → healHold (kind=${kind}) args=[]`];
        assert.equal(drive(l, { from: at('2026-10-11T10:00:00Z'), to: at('2026-10-11T10:06:00Z') }).length, 0, kind);
    }
    const freeze = ['[2026-10-11T10:00:00.000Z] [kernel] dispatch → quickMeal (kind=FOOD_FLOOR) args=[]'];
    for (let s = 15; s < 360; s += 15) freeze.push(`[${new Date(at('2026-10-11T10:00:00Z') + s * 1000).toISOString()}] [self_preservation] FAMINE body freeze: food=0 hp=1`);
    assert.equal(drive(freeze, { from: at('2026-10-11T10:00:00Z'), to: at('2026-10-11T10:06:00Z') }).length, 0, '10-09 17:43 replay hit — intentional freeze');
});

test('IDLE-DISPATCH: never at night/dusk; a day that starts mid-gap counts from daybreak', () => {
    const lines = ['[2026-10-11T10:00:00.000Z] [kernel] dispatch → nightShelter (kind=NIGHT_DIG_ONE) args=["dig_one"]'];
    assert.equal(drive(lines, { from: at('2026-10-11T10:00:00Z'), to: at('2026-10-11T10:10:00Z'), phase: () => 'night' }).length, 0);
    const dawnAt = at('2026-10-11T10:05:00Z');
    const hits = drive(lines, { from: at('2026-10-11T10:00:00Z'), to: at('2026-10-11T10:09:00Z'), phase: (now) => (now < dawnAt ? 'dawn' : 'day') });
    assert.ok(hits.length > 0 && hits[0].now >= dawnAt + IDLE_DISPATCH_MS, 'idle clock starts at daybreak, not at the night dispatch');
});

test('IDLE-DISPATCH: no ticket when kernelDriver is not driving (cancelled, or another sticky)', () => {
    const cancelled = ['[2026-10-11T10:00:00.000Z] [kernel] dispatch → mineDown (kind=GO_UNDERGROUND) args=[]',
        '[2026-10-11T10:00:05.000Z] [kernel] supervisor cancel received — returning to release run_skill lock'];
    assert.equal(drive(cancelled, { from: at('2026-10-11T10:00:00Z'), to: at('2026-10-11T10:06:00Z') }).length, 0);
    const other = ['[2026-10-11T10:00:00.000Z] [kernel] dispatch → mineDown (kind=GO_UNDERGROUND) args=[]'];
    assert.equal(drive(other, { from: at('2026-10-11T10:00:00Z'), to: at('2026-10-11T10:06:00Z'), driver: 'missionNether' }).length, 0);
});


test('IDLE-DISPATCH wiring: botwatch feeds the shared progress delta + vitals pos + world_model phase; hourly dedupKey, 2h throttle', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const src = fs.readFileSync(path.join(root, 'bots', '_supervisor', 'botwatch.mjs'), 'utf8');
    assert.match(src, /try \{ await idleDispatchDetector\(s, t, _newProg\); \} catch \(e\) \{\}/);
    assert.match(src, /try \{ await cooldownChurnDetector\(s, t, _newProg\); \} catch \(e\) \{\}/, 'one read per tick shared by both detectors');
    assert.match(src, /phase: s\.wm && s\.wm\.time \? s\.wm\.time\.phase : null, driver: s\.skill/);
    assert.match(src, /dedupKey: `idle-dispatch-\$\{hourKey\}`/);
    assert.match(src, /t - _idleDispatchTicketedAt < 2 \* 3600000/);
});
