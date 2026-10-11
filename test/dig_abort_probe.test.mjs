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

// v2 (10-11 05:30:41/44Z: mobility 'dig retry … (MAROONED/ENTOMBED) …: Digging aborted' — the probe recorded the caller but only
// mineDown's DONE line read it back, so aborts in other skills/reflexes left no trace). Every abort now writes one line itself.
test('T-0260 v2: every abort is logged with block / caller / holder / skill; an older listener is replaced, not stacked', async () => {
    const { DIG_ABORT_PROBE_V } = await import('../bots/_supervisor/skills/mineDown.js');
    const bot = fakeBot();
    const old = () => {};
    bot.on('diggingAborted', old);
    bot._digAbortProbe = true; bot._digAbortListener = old;     // a v1-era install
    const lines = [];
    bot._bodyOwner = { kind: 'mode', name: 'mode:mobility' }; bot._currentSkill = 'mineDown';
    installDigAbortProbe(bot, { sink: (s) => lines.push(s) });
    assert.equal(bot._digAbortProbe, DIG_ABORT_PROBE_V);
    assert.equal(bot.listenerCount('diggingAborted'), 1, 'old listener removed');
    function mobilityGuardedDig() { bot.stopDigging(); }
    mobilityGuardedDig();
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[dig-abort\] grass_block@\(44, 66, -23\) by=.*mobilityGuardedDig.* holder=mode:mobility skill=mineDown/);
    mobilityGuardedDig();
    assert.equal(lines.length, 1, 'throttled');
});

test('T-0260: the probe lives in src/agent/framework/dig_abort_probe.js, modes installs it at init, mineDown re-exports it', () => {
    const modes = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    assert.match(modes, /import \{ installDigAbortProbe \} from '\.\/framework\/dig_abort_probe\.js';/);
    assert.match(modes, /try \{ installDigAbortProbe\(agent\.bot\); \} catch \(e\) \{\}/);
    const md = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(md, /from '\.\.\/\.\.\/\.\.\/src\/agent\/framework\/dig_abort_probe\.js'/);
    assert.doesNotMatch(md, /export function installDigAbortProbe/);
});
