import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { instinctTravelVeto, instinctMayTravel } from '../src/agent/framework/instinct_travel.js';
import { runInstinct } from '../src/agent/framework/instinct.js';

// T-0290 (监工, T-0284 族 — death #56): audit every place that moves the body outside a kernel commitment. The only channel
// that bypasses execute()/the arbiter/the reflex body gate is an instinct act (runInstinct launches it NOT awaited, act_trace
// act='-'). So the guard lives in runInstinct for every `travels` instinct: live commitment yields, hurt/healing never starts,
// no cross-map run, and the walk halts the moment the body is hurt or the kernel commits meanwhile.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('T-0290: instinctTravelVeto — commitment / healing / hp / distance', () => {
    assert.equal(instinctTravelVeto({ health: 20 }, { dist: 10 }), null);
    assert.equal(instinctTravelVeto({ health: 20, _commitment: { kind: 'FREE_PLAY' } }, { dist: 10 }), null);
    assert.equal(instinctTravelVeto({ health: 20, _commitment: { kind: 'IDLE_FALLBACK' } }, { dist: 10 }), null);
    assert.equal(instinctTravelVeto({ health: 20, _commitment: { kind: 'NIGHT_SMELT_IRON' } }, { dist: 10 }), 'commitment:NIGHT_SMELT_IRON');
    assert.equal(instinctTravelVeto({ health: 20, _healLatch: true }, { dist: 10 }), 'healing');
    assert.equal(instinctTravelVeto({ health: 9 }, { dist: 10 }), 'hp9<10');
    assert.equal(instinctTravelVeto({ health: 20 }, { dist: 272 }), 'dist272>64');
    assert.equal(instinctMayTravel({ health: 20 }, { dist: 272, maxDist: 300 }), true);
});

function travelInstinct(log, extra = {}) {
    return {
        name: 't', travels: true, travelDist: () => 10, test: () => true,
        onHalt: (h0, h1, why) => log.push(['halt', h0, h1, why]),
        act: async (w, b, c) => { log.push(['act', !!(c && c.hurt)]); while (!(c.hurt && c.hurt.fired())) await sleep(20); log.push(['gave-up']); },
        ...extra,
    };
}
const mkBot = (extra = {}) => ({ health: 20, pathfinder: { goal: 'x', setGoal(g) { this.goal = g; } }, clearControlStates() {}, ...extra });

test('T-0290: runInstinct refuses a travelling instinct while the kernel holds a real commitment (the death #56 case)', () => {
    const log = [];
    const b = mkBot({ _commitment: { kind: 'NIGHT_SMELT_IRON' } });
    const r = runInstinct(b, travelInstinct(log), {}, {});
    assert.equal(r.fired, false);
    assert.equal(log.length, 0);
    const far = runInstinct(mkBot(), travelInstinct(log, { travelDist: () => 272 }), {}, {});
    assert.equal(far.fired, false, 'cross-map run refused');
});

test('T-0290: a travelling act halts at once when the body is hurt (fall hp 20→1)', async () => {
    const log = [];
    const b = mkBot();
    const r = runInstinct(b, travelInstinct(log), {}, {});
    assert.equal(r.fired, true);
    await sleep(60);
    b.health = 1;
    await r.act;
    assert.deepEqual(log[0], ['act', true]);
    assert.deepEqual(log.find(x => x[0] === 'halt'), ['halt', 20, 1, null]);
    assert.equal(b.pathfinder.goal, null, 'walk halted (setGoal(null))');
});

test('T-0290: … and when the kernel commits while it walks (yield mid-way)', async () => {
    const log = [];
    const b = mkBot();
    const r = runInstinct(b, travelInstinct(log), {}, {});
    await sleep(60);
    b._commitment = { kind: 'GO_UNDERGROUND' };
    await r.act;
    assert.deepEqual(log.find(x => x[0] === 'halt'), ['halt', 20, 20, 'commitment:GO_UNDERGROUND']);
    assert.equal(b.pathfinder.goal, null);
});

test('T-0290: non-travelling instincts are untouched (no guard, no watcher)', async () => {
    let ctxSeen = null;
    const b = mkBot({ _commitment: { kind: 'NIGHT_SMELT_IRON' }, health: 2 });
    const r = runInstinct(b, { name: 'eat', test: () => true, act: async (w, bb, c) => { ctxSeen = c; } }, {}, { a: 1 });
    assert.equal(r.fired, true);
    await r.act;
    assert.deepEqual(ctxSeen, { a: 1 });
});

// ── source audit: every long-range body move in modes.js is either inside the short-range survival modes or a `travels` instinct ──
const MOVE_RE = /skills\.(goToPosition|goToNearbyBlock|goToNearbyEntity|goToPlayer|followPlayer)\(|pathfinder\.goto\(|pathfinder\.setGoal\(new /g;
const SURVIVAL_MODES = new Set(['self_preservation', 'unstuck', 'self_defense']);
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));

test('T-0290 audit: modes.js — no body move outside the survival modes except a `travels: true` instinct', () => {
    const src = stripComments(fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8'));
    const modeStarts = [...src.matchAll(/^ {8}name: '([a-z_]+)',/gm)].map(m => ({ name: m[1], at: m.index }));
    assert.ok(modeStarts.length > 15, 'mode table found');
    const modeAt = (i) => { let cur = null; for (const m of modeStarts) { if (m.at <= i) cur = m.name; else break; } return cur; };
    const offenders = [];
    for (const m of src.matchAll(MOVE_RE)) {
        const mode = modeAt(m.index);
        if (SURVIVAL_MODES.has(mode)) continue;
        // inside an instinct object literal that declares travels: true?
        const before = src.slice(Math.max(0, m.index - 3000), m.index);
        const objStart = before.lastIndexOf("name: 'go_to_bed_sleep'");
        const inTravelInstinct = objStart >= 0 && /travels: true,/.test(before.slice(objStart));
        if (!inTravelInstinct) offenders.push(`${mode}: ${m[0]} @${src.slice(0, m.index).split('\n').length}`);
    }
    assert.deepEqual(offenders, [], 'every new body-moving instinct/observer must go through runInstinct with travels:true (T-0290)');
});

test('T-0290 audit: framework modules never move the body themselves', () => {
    const dir = new URL('../src/agent/framework/', import.meta.url);
    const offenders = [];
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
        const src = stripComments(fs.readFileSync(new URL(f, dir), 'utf8'));
        if (MOVE_RE.test(src)) offenders.push(f);
        MOVE_RE.lastIndex = 0;
    }
    assert.deepEqual(offenders, []);
});

test('T-0290 audit: every instinct passed to runInstinct in modes.js that walks declares travels:true', () => {
    const src = stripComments(fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8'));
    const objs = [...src.matchAll(/this\.(_\w+Instinct) = \{([\s\S]*?)\n {24}\};/g)];
    assert.ok(objs.length >= 1);
    for (const [, name, body] of objs) if (/goToPosition|goToNearby|pathfinder/.test(body)) assert.match(body, /travels: true,/, name);
});
