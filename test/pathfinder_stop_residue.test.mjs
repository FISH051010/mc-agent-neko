import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import test from 'node:test';

// T-0207 (library-level root of T-0204): in mineflayer-pathfinder, stop() only arms stopPathing; the real stop runs at
// the next resetPath. Called while NOT walking, the flag lingers — the next setGoal/goto (resetPath) stops on the spot:
// new goal cleared, 'path_stop' emitted, goto rejects 'Path was stopped before it could be completed!' (bedErrand: 111
// of 112 scout legs killed; skills.customSkill stops on every start). Exercised against the REAL patched library.
const require = createRequire(import.meta.url);
const { pathfinder, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

function fakeBot() {
    const bot = new EventEmitter();
    bot.registry = require('minecraft-data')('1.21.1');
    bot.version = '1.21.1';
    bot.entity = { position: new Vec3(0, 64, 0), velocity: new Vec3(0, 0, 0), onGround: true, height: 1.8, width: 0.6 };
    bot.clearControlStates = () => {}; bot.setControlState = () => {}; bot.stopDigging = () => {};
    bot.blockAt = () => null; bot.inventory = { items: () => [] };
    pathfinder(bot);
    return bot;
}

test('T-0207: an idle stop() leaves nothing armed — the next setGoal keeps its goal', () => {
    const bot = fakeBot();
    let stops = 0; bot.on('path_stop', () => stops++);
    bot.pathfinder.stop();
    const before = stops;
    bot.pathfinder.setGoal(new goals.GoalBlock(5, 64, 5));
    assert.ok(bot.pathfinder.goal, 'goal survives');
    assert.equal(stops, before, 'setGoal did not trigger a stale stop');
});

test('T-0207: stop() right before goto does not reject the goto with PathStopped', async () => {
    const bot = fakeBot();
    bot.pathfinder.stop();
    let rejected = null;
    bot.pathfinder.goto(new goals.GoalBlock(5, 64, 5)).catch(e => { rejected = e; });
    await new Promise(r => setTimeout(r, 30));
    assert.ok(!rejected || !/stopped/i.test(rejected.message), `goto rejected: ${rejected && rejected.message}`);
    bot.pathfinder.setGoal(null);
});

test('T-0207: stop() with a goal but no walked path stops now (goal cleared, path_stop emitted)', () => {
    const bot = fakeBot();
    let stops = 0; bot.on('path_stop', () => stops++);
    bot.pathfinder.setGoal(new goals.GoalBlock(5, 64, 5));
    bot.pathfinder.stop();
    assert.equal(bot.pathfinder.goal, null);
    assert.equal(stops, 1);
});

test('T-0207: an idle stop() does not clear control states a manual mover holds', () => {
    const bot = fakeBot();
    let cleared = 0; bot.clearControlStates = () => { cleared++; };
    bot.pathfinder.stop();
    assert.equal(cleared, 0);
});
