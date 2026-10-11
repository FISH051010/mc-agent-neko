import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { goSleepInstinctEligible, abortWalkOnHurt, SLEEP_INSTINCT_MAX_DIST } from '../src/agent/framework/sleep_instinct.js';

// T-0284 (death #56, 10-11 07:07:06Z): dusk, kernel running smeltSafe for NIGHT_SMELT_IRON at y18 in a cave; the
// go_to_bed_sleep instinct fired (its yield list only knew DUSK_MINE_NIGHT/DUSK_GO_BED/NIGHT_DIG_ONE/NIGHT_SEAL) and its
// goToPosition (mine_motion seq 15, GoalNear 163,-15,-259 — a 'bed' 272b away underground) drove the body over smeltSafe:
// sprint across the cave, 20-block drop hp 20→1, kept sprinting at hp 1 for 11s (07:06:47-57) into a creeper.
const dusk = (bed, extra = {}) => ({ time: { phase: 'dusk', tod: 12100 }, threat: { actionable: 0 }, landmarks: { bed }, ...extra });
const bot = (extra = {}) => ({ health: 20, ...extra });
const near = { x: 5, y: 64, z: 5, dist: 10 };

test('T-0284: the live case — NIGHT_SMELT_IRON commitment, bed 272b away → the instinct does NOT fire', () => {
    const far = { x: 163, y: -15, z: -259, dist: 272 };
    assert.equal(goSleepInstinctEligible(dusk(far), bot({ _commitment: { kind: 'NIGHT_SMELT_IRON', skill: 'smeltSafe' } })), false);
    assert.equal(goSleepInstinctEligible(dusk(far), bot()), false, 'and a cross-map dusk run is refused even when idle');
});

test('T-0284: yields to ANY real kernel commitment, not a hand-picked list', () => {
    for (const kind of ['NIGHT_SMELT_IRON', 'GET_ARMOR', 'GO_UNDERGROUND', 'DUSK_GO_BED', 'NIGHT_DIG_ONE', 'HEAL', 'FOOD_FLOOR'])
        assert.equal(goSleepInstinctEligible(dusk(near), bot({ _commitment: { kind } })), false, kind);
    for (const kind of ['FREE_PLAY', 'IDLE_FALLBACK'])
        assert.equal(goSleepInstinctEligible(dusk(near), bot({ _commitment: { kind } })), true, kind);
    assert.equal(goSleepInstinctEligible(dusk(near), bot()), true, 'no commitment → instinct may act (execute-first)');
});

test('T-0284: never when hurt or healing; kept rules (threat, day, far-at-night, fail memo) unchanged', () => {
    assert.equal(goSleepInstinctEligible(dusk(near), bot({ health: 9 })), false);
    assert.equal(goSleepInstinctEligible(dusk(near), bot({ _healLatch: true })), false);
    assert.equal(goSleepInstinctEligible(dusk(near, { threat: { actionable: 1 } }), bot()), false);
    assert.equal(goSleepInstinctEligible({ ...dusk(near), time: { phase: 'day' } }, bot()), false);
    const mid = { ...near, dist: 40 };
    assert.equal(goSleepInstinctEligible(dusk(mid), bot()), true, 'mid-range bed at dusk');
    assert.equal(goSleepInstinctEligible({ ...dusk(mid), time: { phase: 'night' } }, bot()), false, 'no far bed run at night');
    assert.equal(goSleepInstinctEligible(dusk({ ...near, dist: SLEEP_INSTINCT_MAX_DIST + 1 }), bot()), false);
    assert.equal(goSleepInstinctEligible(dusk(near), bot({ _bedSleepFailAt: Date.now() - 1000 })), false);
});

test('T-0284: a walk is halted the moment the body is hurt (fall hp 20→1 must not keep sprinting)', async () => {
    let goal = 'bed', cleared = 0, aborted = null;
    const b = { health: 20, pathfinder: { setGoal(g) { goal = g; } }, clearControlStates() { cleared++; } };
    const w = abortWalkOnHurt(b, { pollMs: 10, onAbort: (h0, h1) => { aborted = [h0, h1]; } });
    await new Promise(r => setTimeout(r, 40));
    assert.equal(w.fired(), false);
    b.health = 1;
    await new Promise(r => setTimeout(r, 40));
    w.stop();
    assert.equal(w.fired(), true);
    assert.equal(goal, null);
    assert.equal(cleared, 1);
    assert.deepEqual(aborted, [20, 1]);
});

test('T-0284: small chip damage does not abort; modes wires the instinct to the shared predicate + hurt watcher', async () => {
    const b = { health: 20, pathfinder: { setGoal() { throw new Error('should not halt'); } } };
    const w = abortWalkOnHurt(b, { pollMs: 10 });
    b.health = 18;
    await new Promise(r => setTimeout(r, 40));
    w.stop();
    assert.equal(w.fired(), false);
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    assert.match(src, /test: \(w, b\) => goSleepInstinctEligible\(w, b\),/);
    assert.match(src, /const _hurt = abortWalkOnHurt\(b, \{/);
});
