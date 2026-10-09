import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Live 10-09 20:46:43: mobility classification stopped for 460s+ — ModeController `break`s on the first active mode
// (self_preservation's swim/night hold), and mobility sits after it, so bot._mobility (vitals.mob, botwatch, watchdog,
// arbiter snapshot) went stale all night. Classification must be an always-on observer; actions stay a reflex mode.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'src/agent/modes.js'), 'utf8').replace(/\r\n/g, '\n');

function modeBlock(name) {
    const i = src.indexOf(`name: '${name}',`);
    assert.ok(i > 0, `mode ${name} exists`);
    const j = src.indexOf('\n    },\n    {', i);
    return src.slice(i, j > 0 ? j : undefined);
}

test('T-0166: an always-on mobility_observer drives classification (not starved by an active earlier mode)', () => {
    const obs = modeBlock('mobility_observer');
    assert.match(obs, /always: true,/);
    assert.match(obs, /interrupts: \[\],/);
    assert.match(obs, /mob\.classify\(agent, now\)/);
    assert.doesNotMatch(obs, /execute\(/, 'observer never takes the body');
});

test('T-0166: mobility.classify owns the state write; update() reuses the same-tick result instead of re-classifying', () => {
    const mob = modeBlock('mobility');
    const ci = mob.indexOf('classify: function (agent, now = Date.now()) {');
    const ui = mob.indexOf('update: async function (agent) {');
    assert.ok(ci > 0 && ui > ci, 'classify defined before update');
    const classify = mob.slice(ci, ui), update = mob.slice(ui);
    assert.match(classify, /bot\._mobility = \{ state: st, since: this\.stateSince, exits, enclosed, at: Date\.now\(\) \};/);
    assert.match(classify, /this\._classifiedAt = now; this\._classifiedSt = st;/);
    assert.doesNotMatch(update, /bot\._mobility = \{ state: st, since: this\.stateSince, exits, enclosed/, 'no second classifier in update');
    assert.match(update, /let st = \(now - \(this\._classifiedAt \|\| 0\) < 1000\) \? this\._classifiedSt : this\.classify\(agent, now\);/);
});

test('T-0166: observer cadence — classifies every 2s, skips only while the mobility burst runs', async () => {
    // evaluate the observer's update against a stub mobility mode (extract the function body from source)
    const obs = modeBlock('mobility_observer');
    const body = obs.slice(obs.indexOf('update: async function (agent) {') + 'update: async function (agent) {'.length, obs.lastIndexOf('}'));
    let calls = 0;
    const mob = { name: 'mobility', on: true, active: false, _classifiedAt: 0, classify(agent, now) { calls++; this._classifiedAt = now; return 'FREE'; } };
    const modes_list = [mob];
    const fn = new Function('modes_list', 'Date', `return async function (agent) {${body}};`);
    let t = 100000;
    const FakeDate = { now: () => t };
    const run = fn(modes_list, FakeDate);
    await run({});                     assert.equal(calls, 1);
    t += 500;  await run({});          assert.equal(calls, 1, 'throttled <2s');
    t += 1600; await run({});          assert.equal(calls, 2);
    mob.active = true; t += 3000; await run({}); assert.equal(calls, 2, 'own burst running → leave its state alone');
    // live 21:17:18→21:18:00 mobAge 21: surfaceUp setOn('mobility', false) to freeze the REFLEX — observation must go on
    mob.active = false; mob.on = false; t += 3000; await run({}); assert.equal(calls, 3, 'reflex switched off (surfaceUp freeze) → still classified');
});
