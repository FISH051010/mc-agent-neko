import assert from 'node:assert/strict';
import test from 'node:test';
import kernelDriver, { settleDispatch, isDispatchFailure, DISPATCH_FAIL_LIMIT, DISPATCH_COOLDOWN_MS } from '../bots/_supervisor/skills/kernelDriver.js';

const NOOP = { failed: true, reason: 'all prep goals already held' };

test('T-0115: failure verdicts follow the kernel.js contract', () => {
    assert.equal(isDispatchFailure(false), true);
    assert.equal(isDispatchFailure(NOOP), true);
    assert.equal(isDispatchFailure({ ok: false }), true);
    assert.equal(isDispatchFailure(undefined, true), true);
    for (const ok of [true, undefined, 0, { phase: 'enter', entered: false }]) assert.equal(isDispatchFailure(ok), false);
});

test('T-0115: 3 consecutive child failures → kind cooldown stamped + commitment released', () => {
    const bot = { _commitment: { kind: 'GET_BED', skill: 'prepNether' } };
    const now = 5_000_000;
    for (let i = 1; i < DISPATCH_FAIL_LIMIT; i++) assert.equal(settleDispatch(bot, 'GET_BED', NOOP, { now }).cooled, false);
    const st = settleDispatch(bot, 'GET_BED', NOOP, { now });
    assert.equal(st.cooled, true);
    assert.equal(bot._kindCooldownUntil.GET_BED, now + DISPATCH_COOLDOWN_MS);
    assert.equal(bot._commitment, null);
});

test('T-0115: success resets the streak; cancel/interrupt unwinds are not strikes', () => {
    const bot = {};
    settleDispatch(bot, 'GET_BED', NOOP);
    settleDispatch(bot, 'GET_BED', NOOP);
    settleDispatch(bot, 'GET_BED', true);                       // progress → reset
    settleDispatch(bot, 'GET_BED', NOOP);
    settleDispatch(bot, 'GET_BED', false, { interrupted: true }); // commitment flip mid-child
    bot._supervisorCancelAt = Date.now();
    settleDispatch(bot, 'GET_BED', false);                       // cancel unwind
    assert.equal(bot._kindCooldownUntil, undefined);
    assert.equal(bot._kdDispatchFails.GET_BED, 1);
});

test('T-0115: the live kernelDriver loop stops re-dispatching a no-op skill after 3 failures', async () => {
    const calls = [];
    const bot = {
        _commitment: { kind: 'GET_BED', skill: 'prepNether', args: [] },
        _world: { time: { isDay: true }, threat: {}, vitals: { food: 20 } },
        _mobility: { state: 'FREE' },
        entity: { position: { x: 0, y: 70, z: 0 } },
        game: { dimension: 'overworld' },
    };
    const ctx = {
        world: { getInventoryCounts: () => ({}) },
        skills: {
            wait: () => Promise.resolve(),
            customSkill: async (b, name) => { calls.push(name); return NOOP; },   // prepNether NO-OP every time
        },
    };
    const r = await kernelDriver(bot, ctx);   // fake wait → loop runs to its 5000-iter cap instantly
    assert.deepEqual(r, { exhausted: true });
    assert.equal(calls.filter(n => n === 'prepNether').length, DISPATCH_FAIL_LIMIT, `dispatched ${calls.length}x`);
    assert.ok(bot._kindCooldownUntil && bot._kindCooldownUntil.GET_BED > Date.now());
    assert.equal(bot._commitment, null);
});
