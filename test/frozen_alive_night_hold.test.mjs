import assert from 'node:assert/strict';
import test from 'node:test';
import { makeFrozenAliveTracker, frozenAliveActive, legitNightHold } from '../bots/_supervisor/botwatch-trackers.mjs';

// Live 10-10 00:09 @71,65,-2 (occurrence #2018): sealed night hold, progress "sealed night hold: w=40"
// every 30s, world model fresh, events.log silent 128s → reported as FROZEN-ALIVE.
const T0 = 1_791_562_000_000;
function holdState(t, over = {}) {
    return {
        t, hp: 14, v: { x: 71, y: 65, z: -2 },
        wm: {
            ts: t - 1500,
            time: { tod: 18079, phase: 'night', isDay: false },
            cover: { overhead: true, coverReal: true },
            threat: { hostiles: 0, actionable: 0, takingDamage: false },
            ...(over.wm || {}),
        },
        ...(over.top || {}),
    };
}
function drive(over) {
    const eventsMtime = T0;                       // events.log silent from T0 on
    const tr = makeFrozenAliveTracker(() => eventsMtime);
    let s;
    for (let t = T0; t <= T0 + 180000; t += 15000) { s = holdState(t, over); s._frozen = tr(s, t); }
    return s;
}

test('T-0062: a legit sealed night hold (fresh wm, roofed, no threat, alive) is NOT frozen-alive', () => {
    const s = drive();
    assert.ok(s._frozen.frozenMs >= 120000 && s._frozen.eventsAgeS >= 120, 'precondition: pinned + events silent');
    assert.equal(legitNightHold(s), true);
    assert.equal(frozenAliveActive(s), false);
});

test('T-0062: real frozen bodies still fire — dead / hit / stale wm / daylight / exposed / threatened', () => {
    const cases = {
        dead: { top: { hp: 0 } },
        hit: { wm: { threat: { actionable: 0, takingDamage: true } } },
        staleWm: { wm: { ts: 0 } },
        daylight: { wm: { time: { tod: 6000, phase: 'day', isDay: true } } },
        exposed: { wm: { cover: { overhead: true, coverReal: false } } },
        threatened: { wm: { threat: { actionable: 1, takingDamage: false } } },
    };
    for (const [name, over] of Object.entries(cases)) {
        const s = drive(over);
        assert.equal(frozenAliveActive(s), true, name);
    }
});
