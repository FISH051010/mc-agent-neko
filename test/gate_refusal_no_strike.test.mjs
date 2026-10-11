import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { settleDispatch, GATE_DEFER_LIMIT, GATE_DEFER_WINDOW_MS, DISPATCH_FAIL_LIMIT } from '../bots/_supervisor/skills/kernelDriver.js';
import { installReflexBodyGate, skillCtx, reflexGateRefusals } from '../src/agent/framework/reflex_body_gate.js';

// Live 10-11 02:25:21-02:27:53Z: self_preservation (creeper 8.2m bunker / sealed night hold) held the body in short bursts;
// the T-0231 gate refused mineDown's walk/path ('[body-gate] skill mineDown setControlState(forward) refused'), every
// relocate candidate failed in ~1.6s → DONE failed:true ×3 → ★dispatch-cooldown DUSK_MINE_NIGHT 5min. A skill whose body
// was borrowed by a reflex didn't fail at its job — no strike. Bounded (监工): a reflex that holds the body all night must
// not turn this into an endless strike-free re-dispatch (noop-dispatch 通律) — after GATE_DEFER_LIMIT such defers of one
// kind within GATE_DEFER_WINDOW_MS, failures count as strikes again.
test('T-0241: the gate counts every refusal it makes', () => {
    const bot = { _bodyOwner: { kind: 'mode', name: 'mode:self_preservation' }, setControlState() {}, clearControlStates() {} };
    installReflexBodyGate(bot);
    const before = reflexGateRefusals(bot);
    skillCtx.run({ skill: 'mineDown' }, () => { bot.setControlState('forward', true); bot.clearControlStates(); });
    assert.equal(reflexGateRefusals(bot) - before, 2);
    bot._bodyOwner = null;
    skillCtx.run({ skill: 'mineDown' }, () => bot.setControlState('forward', true));
    assert.equal(reflexGateRefusals(bot) - before, 2, 'not refused when no reflex holds the body');
});

test('T-0241: a failure while the gate refused the child is a defer — no strike, streak kept', () => {
    const bot = {};
    let t = 1_000_000;
    settleDispatch(bot, 'DUSK_MINE_NIGHT', { failed: true }, { now: t });            // strike 1 (genuine)
    for (let n = 0; n < 3; n++) {
        const st = settleDispatch(bot, 'DUSK_MINE_NIGHT', { failed: true }, { now: t += 10000, gateRefused: true });
        assert.equal(st.cooled, false); assert.equal(st.deferred, true); assert.equal(st.strikes, 1);
    }
    assert.ok(!(bot._kindCooldownUntil || {}).DUSK_MINE_NIGHT, 'not cooled');
});

test('T-0241: a reflex holding the body all night — after the defer budget, failures strike and cool as usual', () => {
    const bot = {};
    let t = 2_000_000, cooled = false, n = 0;
    while (!cooled && n < 100) {
        n++;
        cooled = settleDispatch(bot, 'GET_IRON_ARMOR_SET', { failed: true }, { now: t += 15000, gateRefused: true }).cooled;
    }
    assert.ok(cooled, 'eventually cooled');
    assert.equal(n, GATE_DEFER_LIMIT + DISPATCH_FAIL_LIMIT);
    assert.ok(bot._kindCooldownUntil.GET_IRON_ARMOR_SET > t);
});

test('T-0241: old defers age out of the window; successes and other kinds are untouched', () => {
    const bot = {};
    let t = 3_000_000;
    for (let n = 0; n < GATE_DEFER_LIMIT; n++) settleDispatch(bot, 'K', { failed: true }, { now: t += 1000, gateRefused: true });
    t += GATE_DEFER_WINDOW_MS + 1;
    assert.equal(settleDispatch(bot, 'K', { failed: true }, { now: t, gateRefused: true }).deferred, true, 'budget refilled');
    assert.equal(settleDispatch(bot, 'J', { failed: true }, { now: t, gateRefused: false }).strikes, 1);
    assert.equal(settleDispatch(bot, 'K', { ok: true }, { now: t, gateRefused: true }).failed, false);
});

test('T-0241: kernelDriver snapshots gate refusals around the child and passes gateRefused', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/kernelDriver.js', import.meta.url), 'utf8');
    assert.match(src, /const _gateBefore = reflexGateRefusals\(bot\);/);
    assert.match(src, /gateRefused: reflexGateRefusals\(bot\) > _gateBefore/);
});
