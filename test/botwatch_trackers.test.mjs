import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFrozenAliveTracker, frozenAliveActive, makeWedgeTracker, falseHoldActive, makeSurvivalChurnTracker, survivalChurnActive, falseShelterActive, mobilityStuckActive, bootstrapDeadlockActive } from '../bots/_supervisor/botwatch-trackers.mjs';

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


const reflexLog = (n) => Array.from({ length: 80 }, (_, i) => (i < n ? 'Fighting zombie!' : 'chopWood: log +1'));

test('T-0073: healthy + FREE + reflex-dominated log + flat pick tier for 15min → SURVIVAL-CHURN fires', () => {
    // live: 满血 FREE 在峡谷整夜 kite/钻坑打转, slipped no-progress / mobility-stuck / staleMin.
    const tr = makeSurvivalChurnTracker();
    let s;
    for (let m = 0; m <= 16; m++) { s = { hp: 20, mob: 'FREE', pickTier: 'stone', events: reflexLog(12) }; s._churn = tr(s, m * MIN); }
    assert.equal(survivalChurnActive(s), true);
});

test('T-0073: a tier advance resets the clock; low hp / trapped states / productive logs never count', () => {
    const tr = makeSurvivalChurnTracker();
    let s;
    for (let m = 0; m <= 16; m++) {
        s = { hp: 20, mob: 'FREE', pickTier: m < 10 ? 'stone' : 'iron', events: reflexLog(12) };
        s._churn = tr(s, m * MIN);
    }
    assert.equal(survivalChurnActive(s), false, 'stone→iron at minute 10 is real progress');
    for (const variant of [{ hp: 8 }, { mob: 'MAROONED' }, { mob: 'POCKET' }, { events: reflexLog(3) }]) {
        const t2 = makeSurvivalChurnTracker();
        let x;
        for (let m = 0; m <= 16; m++) { x = { hp: 20, mob: 'FREE', pickTier: 'stone', events: reflexLog(12), ...variant }; x._churn = t2(x, m * MIN); }
        assert.equal(survivalChurnActive(x), false, JSON.stringify(variant).slice(0, 40));
    }
});

test('T-0072: the retired staleMin NO-PROGRESS detector stays inert (re-enabling it spawned a dup idle ticket per stall)', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const src = fs.readFileSync(path.join(root, 'bots', '_supervisor', 'botwatch.mjs'), 'utf8');
    const block = src.slice(src.indexOf("key: 'no-progress'"), src.indexOf("key: 'no-progress'") + 2500);
    assert.match(block, /active: \(s\) => false,/);
});

test('T-0040/T-0085: FALSE-SHELTER — night + shelter intent + roof NOT sealed for 1min+ + no threat → fires (silent near-miss)', () => {
    const base = { wm: { time: { isDay: false }, cover: { coverReal: false } }, skill: 'nightShelter', mob: 'FREE', _stale: { staleMs: 3 * MIN }, threat: { actionable: 0 } };
    assert.equal(falseShelterActive(base), true);
    assert.equal(falseShelterActive({ ...base, wm: { ...base.wm, cover: { coverReal: true } } }), false, 'really sealed');
    assert.equal(falseShelterActive({ ...base, wm: { ...base.wm, cover: {} } }), false, 'cover unknown ≠ known-unsealed (宁缺毋滥)');
    assert.equal(falseShelterActive({ ...base, wm: { ...base.wm, time: { isDay: true } } }), false);
    assert.equal(falseShelterActive({ ...base, threat: { actionable: 1 } }), false, 'active threat is owned by seal-fail/death/combat');
    assert.equal(falseShelterActive({ ...base, skill: 'mineDown', mob: 'POCKET' }), true, 'contained mobility also counts as shelter intent');
});

test('T-0032: MOBILITY-stuck never false-fires on a legit sealed night hold; does fire by day / exposed / under threat', () => {
    const night = { mob: 'ENTOMBED', wm: { time: { isDay: false }, cover: { coverReal: true } }, threat: { actionable: 0 } };
    assert.equal(mobilityStuckActive(night), false);
    assert.equal(mobilityStuckActive({ ...night, wm: { time: { isDay: true }, cover: { coverReal: true } } }), true);
    assert.equal(mobilityStuckActive({ ...night, wm: { time: { isDay: false }, cover: { coverReal: false } } }), true);
    assert.equal(mobilityStuckActive({ ...night, threat: { actionable: 2 } }), true);
});

test('T-0012: BOOTSTRAP deadlock = no usable pick AND no pickaxe item; a crafting table alone does NOT clear it', () => {
    const has = (inv) => (re) => inv.some(n => re.test(n));
    assert.equal(bootstrapDeadlockActive({ picks: 0, has: has(['crafting_table', 'cobblestone']) }), true, 'live 06-20: table in bag, still no pick');
    assert.equal(bootstrapDeadlockActive({ picks: 0, has: has(['wooden_pickaxe']) }), false);
    assert.equal(bootstrapDeadlockActive({ picks: 1, has: has(['stone_pickaxe']) }), false);
});

// ── T-0124: the mobility classifier silently stopped for 1.5h; no detector noticed ─────────────────────────
import { mobilityStaleActive } from '../bots/_supervisor/botwatch-trackers.mjs';

test('T-0124/T-0126: MOBILITY-STALE fires on a crashed classifier or >5min unscheduled, not on a 1-2min reflex hold', () => {
  const v = { x: 0, y: 64, z: 0 };
  assert.equal(mobilityStaleActive({ v, ageS: 2, mobAge: 2, mobRaw: 'FREE' }), false);
  assert.equal(mobilityStaleActive({ v, ageS: 2, mobAge: 600, mobRaw: 'ENTOMBED' }), true);   // starved >5min
  // T-0126 false positive: self_preservation held the slot vs a creeper @2.7b → mobility legitimately unscheduled ~93s
  assert.equal(mobilityStaleActive({ v, ageS: 2, mobAge: 93, mobRaw: 'ENTOMBED' }), false);
  assert.equal(mobilityStaleActive({ v, ageS: 2, mobAge: null, mobRaw: '?' }), true);         // live: '?' after restart
});

test('T-0126b: a never-classified model after restart (NONE) is not a crash; only >5min unscheduled fires', () => {
  const v = { x: 0, y: 64, z: 0 };
  // live 02:28: restart straight into a sealed night hold → mobility never scheduled for minutes, vitals showed '?'
  assert.equal(mobilityStaleActive({ v, ageS: 2, mobAge: 90, mobRaw: 'NONE' }), false);
  assert.equal(mobilityStaleActive({ v, ageS: 2, mobAge: 400, mobRaw: 'NONE' }), true);
  assert.equal(mobilityStaleActive({ v, ageS: 2, mobAge: 5, mobRaw: '?' }), true);   // catch-path crash
});

test('T-0129b: a legit sealed night hold starving mobility >5min is not a stall; a crash still fires', () => {
  const t = Date.now();
  const wm = { ts: t, time: { isDay: false }, cover: { coverReal: true }, threat: { actionable: 0 } };
  // live 20:14: night at spawn, self_preservation held the slot all night, mobAge=370
  assert.equal(mobilityStaleActive({ v: { x: 9 }, ageS: 2, mobAge: 370, mobRaw: 'FREE', hp: 20, wm, t }), false);
  assert.equal(mobilityStaleActive({ v: { x: 9 }, ageS: 2, mobAge: 370, mobRaw: 'FREE', hp: 20, wm: { ...wm, time: { isDay: true } }, t }), true);
  assert.equal(mobilityStaleActive({ v: { x: 9 }, ageS: 2, mobAge: 5, mobRaw: '?', hp: 20, wm, t }), true);
});

test('T-0124: MOBILITY-STALE stays quiet when vitals themselves are stale (that is the STALE detector)', () => {
  assert.equal(mobilityStaleActive({ v: { x: 0 }, ageS: 600, mobAge: 900, mobRaw: 'FREE' }), false);
  assert.equal(mobilityStaleActive({ v: null, ageS: 9999, mobAge: null, mobRaw: '' }), false);
});
