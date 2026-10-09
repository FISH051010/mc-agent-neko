import assert from 'node:assert/strict';
import test from 'node:test';
import { pinKickIntervalMs, pinKickEscalates } from '../src/agent/framework/mobility_signals.js';

// C234: reflex_watchdog's pin-breaker re-kicked a pinned stack every 60s forever — each forced interrupt made the
// bridge re-arm the SAME sticky skill 8s later → re-deadlock → kick again (per-minute livelock + reconnect storms).

test('C234: kick interval backs off 1m → 2m → 4m → 8m and caps at 8m', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 9].map(pinKickIntervalMs), [60000, 120000, 240000, 480000, 480000, 480000]);
});

test('C234: after 3 ineffective kicks the breaker escalates to a persistent-pin signal instead of chatty re-kicks', () => {
    assert.equal(pinKickEscalates(3), false);
    assert.equal(pinKickEscalates(4), true);
});
