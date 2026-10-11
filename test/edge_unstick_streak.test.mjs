import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { bumpWedgeStreak, WEDGE_STREAK_WINDOW_MS, WEDGE_STREAK_RADIUS } from '../src/agent/framework/wedge_streak.js';
import { reflexHolds, holdBodyForReflex } from '../src/agent/framework/reflex_body_gate.js';

// Live 10-11 01:58-01:59Z @104.3,80,-2.3 (spruce canopy, hp1 food4, quickMeal scout): edge_unstick logged
// 'wedged ~2450ms (jump-fail, replan #1)' ×16 in 2 min — never #2 — and the scout made 3b in 90s (13/14 legs stopped by
// modes.js:6150). resetStreak was zeroed on every !moving tick (pathfinder.stop → isMoving false until the next leg) and on
// any ≥0.05b jiggle, so the back-off branch was unreachable. A human who keeps hitting the same spot backs off and sidesteps.
test('T-0239: repeated wedges at the same spot escalate across replans (no reset in between)', () => {
    const st = {};
    const p = { x: 104.3, y: 80, z: -2.3 };
    let t = 1_000_000;
    assert.equal(bumpWedgeStreak(st, p, t), 1);
    assert.equal(bumpWedgeStreak(st, { x: 104.4, y: 80, z: -2.3 }, t += 7500), 2);
    assert.equal(bumpWedgeStreak(st, { x: 104.1, y: 80, z: -2.2 }, t += 5000), 3);
});

test('T-0239: a wedge far away or after the window starts a fresh streak', () => {
    const st = {};
    let t = 2_000_000;
    bumpWedgeStreak(st, { x: 0, y: 64, z: 0 }, t);
    assert.equal(bumpWedgeStreak(st, { x: 0.5, y: 64, z: 0 }, t += 1000), 2);
    assert.equal(bumpWedgeStreak(st, { x: WEDGE_STREAK_RADIUS + 1, y: 64, z: 0 }, t += 1000), 1, 'moved on → new spot');
    assert.equal(bumpWedgeStreak(st, { x: WEDGE_STREAK_RADIUS + 1, y: 64, z: 0 }, t += WEDGE_STREAK_WINDOW_MS + 1), 1, 'stale');
});

test('T-0239: edge_unstick no longer zeroes the streak on !moving / jiggle, and uses the spot streak', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const i = src.indexOf("name: 'edge_unstick',");
    const j = src.indexOf("name: 'pf_dig_watchdog',", i);
    assert.ok(i > 0 && j > i);
    const seg = src.slice(i, j);
    assert.doesNotMatch(seg, /resetStreak = 0/);
    assert.match(seg, /this\.resetStreak = bumpWedgeStreak\(this, p, now\);/);
    // back-off must own the body for its 600ms, else the scout's next-leg setGoal overrides the keys at once
    assert.match(seg, /holdBodyForReflex\(bot, 'edge_unstick', 700, now\);/);
    assert.match(seg, /bot\.pathfinder\.setGoal\(null\)/);
});

test('T-0239: a short reflex body hold gates skill-chain pathing like a mode owner, and expires', () => {
    const bot = {};
    const now = Date.now();
    assert.equal(reflexHolds(bot), false);
    holdBodyForReflex(bot, 'edge_unstick', 700, now);
    assert.equal(reflexHolds(bot, now + 100), true);
    assert.equal(reflexHolds(bot, now + 800), false);
    bot._bodyOwner = { kind: 'mode', name: 'mode:x' };
    assert.equal(reflexHolds(bot, now + 800), true);
});
