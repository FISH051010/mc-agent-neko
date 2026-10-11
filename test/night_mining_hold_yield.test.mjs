import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { decisionOwnsNightMining } from '../src/agent/framework/night_owner.js';
import { DESCENT_MIN_HP } from '../src/agent/framework/food_floor.js';

// T-0282 (10-11 06:46-06:52Z @-171,58,-195, night, hp20 food20): kernel committed DUSK_MINE_NIGHT and dispatched mineDown
// (targetY 12) every minute; self_preservation's sealed night hold kept the body all night, the T-0231 gate refused
// mineDown's forward/pathing, mineDown's T-0267 waits ran out → 'honest fail' wedge ×3..×6, NOOP_EXEMPT → no cooldown →
// zero descent all night. Root: kernelDriver stamps bot._kernelDriverActive only at its loop top, never while it awaits a
// child — 10s into mineDown decisionOwnsNightMining went false and bunkerDown grabbed the body mid-dig (06:47:26, dug 29).
// Supervisor's ruling: while the commitment is a night descent plan AND the descent gate passes (descentBlocked /
// hostileRawNear — the decision layer's own criterion), the sealed hold yields: digging down IS the shelter, with progress.

const now = 1_000_000;
function bot({ hp = 20, food = 20, items = [{ name: 'bread', count: 4 }], hostile = null, kind = 'DUSK_MINE_NIGHT' } = {}) {
    const pos = { x: 0, y: 58, z: 0, distanceTo(o) { return Math.hypot(o.x - this.x, o.y - this.y, o.z - this.z); } };
    const self = { position: pos };
    const entities = { 1: self };
    if (hostile) entities[2] = { name: 'zombie', type: 'hostile', kind: 'Hostile mobs', position: { x: hostile, y: 58, z: 0 } };
    return {
        entity: self, entities, health: hp, food,
        inventory: { items: () => items },
        _commitment: { kind, skill: 'mineDown', since: now - 60000 },
        _currentSkill: 'mineDown',
        _kernelDriverActive: now - 1000,
    };
}

test('T-0282: night descent plan + descent gate open → the decision layer owns the body', () => {
    assert.equal(decisionOwnsNightMining(bot(), { hostilesNear: 0, now }), true);
});

test('T-0282: the hold keeps the body when the descent gate is closed (same criterion as the decision layer)', () => {
    assert.equal(decisionOwnsNightMining(bot({ hp: DESCENT_MIN_HP - 1 }), { hostilesNear: 0, now }), false, 'hp below DESCENT_MIN_HP');
    assert.equal(decisionOwnsNightMining(bot({ food: 2, items: [] }), { hostilesNear: 0, now }), false, 'starving with nothing to eat');
    assert.equal(decisionOwnsNightMining(bot({ hostile: 2.5 }), { hostilesNear: 0, now }), false, 'raw hostile within DESCENT_HOSTILE_R');
});

test('T-0282: kernelDriver keeps its heartbeat fresh while it awaits a child skill', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/kernelDriver.js', import.meta.url), 'utf8');
    const a = src.indexOf('const _watch = setInterval(');
    assert.ok(a > 0);
    assert.match(src.slice(a, src.indexOf('const nc = bot._commitment;', a)), /bot\._kernelDriverActive = Date\.now\(\)/, 'the child watcher must stamp the dispatcher heartbeat');
});

test('T-0282: both sealed-night holds yield to an owned night descent', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const loopAt = src.indexOf('for (let w = 0; w < 110 && !this.isDay(bot); w++) {');
    assert.ok(loopAt > 0);
    assert.match(src.slice(loopAt, loopAt + 900), /decisionOwnsNightMining\(bot/, 'post-seal wait loop must hand the body to the night descent');
    const cov = src.slice(src.indexOf('coveredNightHoldStatus: function (bot) {'), src.indexOf('status.coverReal = this.sealedNightBox(bot);'));
    assert.match(cov, /decisionOwnsNightMining\(bot/, 'covered night hold must not claim the body from an owned night descent');
});
