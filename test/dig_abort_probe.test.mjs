import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { installDigAbortProbe, digInterrupter } from '../bots/_supervisor/skills/mineDown.js';

// Live 10-11 04:22:54-57Z @45,67,-24 (worker-tier/监工 转): GO_UNDERGROUND → mineDown ×3, each step-0 dig threw
// 'Digging aborted [by owner=- digSlot=- digging=- chopGen=7]' within ~1ms → cooled. mineflayer only raises that from
// bot.stopDigging(), and stopDigging emits 'diggingAborted' synchronously — a listener's stack names the real caller.
// digInterrupter could only say who held the body (nobody); now it says who called stopDigging.
function fakeBot() {
    const bot = new EventEmitter();
    bot.targetDigBlock = { name: 'grass_block', position: { toString: () => '(44, 66, -23)' } };
    bot.stopDigging = () => { bot.emit('diggingAborted', bot.targetDigBlock); };
    return bot;
}

test('T-0260: the probe records the stopDigging caller, and digInterrupter reports it', () => {
    const bot = fakeBot();
    installDigAbortProbe(bot);
    installDigAbortProbe(bot);   // idempotent
    assert.equal(bot.listenerCount('diggingAborted'), 1);
    function someReflexThatStopsDigging() { bot.stopDigging(); }
    someReflexThatStopsDigging();
    assert.ok(bot._lastDigAbort && Date.now() - bot._lastDigAbort.at < 1000);
    assert.match(bot._lastDigAbort.by, /someReflexThatStopsDigging/);
    assert.match(digInterrupter(bot), /abortBy=.*someReflexThatStopsDigging/);
});

test('T-0260: a stale abort (older than 3s) is not blamed', () => {
    const bot = fakeBot();
    installDigAbortProbe(bot);
    bot._lastDigAbort = { at: Date.now() - 10000, block: 'x', by: 'oldCaller' };
    assert.doesNotMatch(digInterrupter(bot), /oldCaller/);
});

test('T-0260: mineDown installs the probe on entry', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    const i = src.indexOf('export default async function mineDown(');
    assert.ok(i > 0);
    assert.match(src.slice(i, i + 400), /installDigAbortProbe\(bot\);/);
});
