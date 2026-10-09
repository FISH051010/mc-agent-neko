import test from 'node:test';
import assert from 'node:assert/strict';
import { pace } from '../bots/_supervisor/skills/kernelDriver.js';
import { wait as skillsWait } from '../src/agent/library/skills.js';

// 2026-10-10 live: at a kernelDriver hot-deploy handoff bot.interrupt_code stuck true; the dispatcher's
// anti-hot-spin throttle was skills.wait, which returns instantly while interrupt_code is set →
// 5000 "dispatch →" lines in 1.3s and "loop exhausted (5000 iters)". The dispatcher must really wait.

test('2026-10-10: skills.wait returns immediately while interrupt_code is set (the hazard)', async () => {
  const t0 = Date.now();
  assert.equal(await skillsWait({ interrupt_code: true }, 300), false);
  assert.ok(Date.now() - t0 < 50);
});

test('2026-10-10: kernelDriver pace() really waits even with a stuck interrupt_code', async () => {
  const t0 = Date.now();
  assert.equal(await pace({ interrupt_code: true }, 300), true);
  assert.ok(Date.now() - t0 >= 280, `pace returned after ${Date.now() - t0}ms`);
});

test('2026-10-10: pace() still wakes early for a supervisor cancel (hot-deploy handshake)', async () => {
  const t0 = Date.now();
  assert.equal(await pace({ _supervisorCancelAt: Date.now() }, 5000), false);
  assert.ok(Date.now() - t0 < 100);
});
