import assert from 'node:assert/strict';
import test from 'node:test';
import { installReflexBodyGate, skillCtx, holdBodyForReflex, reflexGateRefusals } from '../src/agent/framework/reflex_body_gate.js';

// Live 10-11 03:04:35 / 03:05:38Z (starving, hp→1): edge_unstick's 700ms back-off hold (T-0239) made the gate THROW at
// quickMeal's scout legs — 17× / 33× refused inside the hold, the scout burned its legs ('without moving') and quickMeal gave
// up. A short timed hold should make the skill wait, not fail: its setGoal is applied when the hold ends (goto keeps waiting,
// pathfinder's goto registers listeners before calling setGoal). A mode owner (T-0231) still refuses as before.
function fakeBot() {
    const goals = [];
    const bot = {
        _bodyOwner: null,
        pathfinder: { setGoal(g) { goals.push(g); } },
        setControlState() {}, clearControlStates() {},
    };
    installReflexBodyGate(bot);
    return { bot, goals };
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

test('T-0239: during a short reflex hold a skill setGoal is deferred to the hold end — no throw, not counted as a refusal', async () => {
    const { bot, goals } = fakeBot();
    holdBodyForReflex(bot, 'edge_unstick', 60);
    const g = { name: 'leg' };
    const before = reflexGateRefusals(bot);
    skillCtx.run({ skill: 'quickMeal' }, () => bot.pathfinder.setGoal(g));   // must not throw
    assert.equal(goals.length, 0, 'not applied during the hold');
    assert.equal(reflexGateRefusals(bot), before);
    await wait(120);
    assert.deepEqual(goals, [g], 'applied once the hold ended');
});

test('T-0239: a later direct setGoal supersedes the deferred one', async () => {
    const { bot, goals } = fakeBot();
    holdBodyForReflex(bot, 'edge_unstick', 60);
    skillCtx.run({ skill: 'quickMeal' }, () => bot.pathfinder.setGoal({ name: 'old' }));
    bot.pathfinder.setGoal(null);    // reflex / plugin drops the goal meanwhile
    await wait(120);
    assert.deepEqual(goals, [null]);
});

test('T-0239: a mode owner still refuses skill pathing (T-0231 unchanged)', () => {
    const { bot, goals } = fakeBot();
    bot._bodyOwner = { kind: 'mode', name: 'mode:self_preservation' };
    assert.throws(() => skillCtx.run({ skill: 'mineDown' }, () => bot.pathfinder.setGoal({ name: 'x' })), /reflex holds the body/);
    assert.equal(goals.length, 0);
});
