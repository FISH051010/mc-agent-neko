import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chopWoodWithin, cancelChopWood } from '../src/agent/library/skills.js';

// Live 10-10 03:23:47: replenishKit's 'replenish-chop-timeout' race stopped waiting, but chopWood kept running
// (iter8/9, act_trace dig=spruce_log) and aborted every mineDown dig ('Digging aborted' ×3 → cooldown).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fakeBot = () => { const b = { _chopGen: 5, stopped: 0, cleared: 0 }; b.stopDigging = () => { b.stopped++; }; b.clearControlStates = () => { b.cleared++; }; b.pathfinder = { stop() {} }; return b; };

test('T-0148: a timed-out chopWood is cancelled (generation bumped → its loop yields; dig stopped), caller sees its label', async () => {
    const bot = fakeBot();
    await assert.rejects(chopWoodWithin(bot, 20, 'replenish-chop-timeout', [12], () => new Promise(() => {})), /replenish-chop-timeout/);
    assert.equal(bot._chopGen, 6, 'orphan chop loop sees _superseded() at its next iter');
    assert.equal(bot.stopped, 1, 'in-flight dig stopped so it cannot abort the next skill\'s dig');
});

test('T-0148: a chop that finishes in time is returned untouched (no cancel)', async () => {
    const bot = fakeBot();
    assert.equal(await chopWoodWithin(bot, 1000, 'x', [1], async () => 7), 7);
    assert.equal(bot._chopGen, 5);
    assert.equal(bot.stopped, 0);
    cancelChopWood(bot);
    assert.equal(bot._chopGen, 6);
});

test('T-0148: no skill races chopWood against a bare timeout any more (all go through chopWoodWithin)', () => {
    const dir = path.join(root, 'bots', '_supervisor', 'skills');
    const offenders = [];
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
        const s = fs.readFileSync(path.join(dir, f), 'utf8');
        if (/Promise\.race\(\[\s*\r?\n?\s*skills\.customSkill\(bot, 'chopWood'/.test(s)) offenders.push(f);
    }
    assert.deepEqual(offenders, []);
});
