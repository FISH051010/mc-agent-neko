import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { goToColumn, relocateFallback } from '../bots/_supervisor/skills/mineDown.js';

// Live 10-10 00:04:25/30 @-5,48,7 (aquifer area, all headings remembered): the START relocate found no dry 9-cell tunnel
// line and fell back to skills.moveAway — 0.2b moved, then the next one hung 43s until a restart. moveAway (GoalInvert)
// has never moved the bot underground. Underground: walk the bot's own tunnels to a solid column, else fail fast.
const solidRock = (x, y, z) => ({ name: 'stone', boundingBox: 'block' });   // nowhere to stand within 24b
const mkBot = () => {
    const b = { entity: { position: { x: -4.5, y: 48, z: 7.5 } }, stopped: 0, moved: 0, _mobility: { enclosed: true } };
    b.pathfinder = { stop: () => { b.stopped++; } };
    b.clearControlStates = () => {};
    return b;
};

test('T-0193: underground with no reachable solid column → fast honest fail, never moveAway', async () => {
    const bot = mkBot();
    const logs = [];
    const skills = { moveAway: async () => { bot.moved++; }, goToPosition: async () => {} };
    const t0 = Date.now();
    const ok = await relocateFallback(bot, skills, solidRock, (s) => logs.push(s), 'no dry tunnel line');
    assert.equal(ok, false);
    assert.equal(bot.moved, 0, 'moveAway is useless underground');
    assert.ok(Date.now() - t0 < 1000);
    assert.match(logs.join('\n'), /honest fail/);
});

test('T-0193: a hung pathfinder walk is bounded and stopped', async () => {
    const bot = mkBot();
    const skills = { goToPosition: () => new Promise(() => {}) };
    const t0 = Date.now();
    const ok = await goToColumn(bot, skills, { x: 10, y: 48, z: 7 }, 150);
    assert.equal(ok, false);
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(bot.stopped, 1);
});

test('T-0193: wiring — START relocate and the void branch both go through the bounded fallbacks', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /if \(!_ok\) await relocateFallback\(bot, skills, bn, log_, 'tunnel walk stopped'\);/);
    assert.match(src, /await relocateFallback\(bot, skills, bn, log_, 'no dry solid 9-cell tunnel line at this level'\);/);
    assert.match(src, /_moved = await goToColumn\(bot, skills, _dest\);/);
    assert.doesNotMatch(src, /falling back to moveAway/);
});
