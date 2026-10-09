import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquire, release, status } from '../bots/_supervisor/deploy-lock.mjs';

const lockFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'neko-deploylock-')), 'deploy.lock');

// 2026-10-10: worker-stuck killed a main.js that worker-death had just deployed — the "deploying now"
// comment convention depended on each worker scanning tickets correctly. The lock must be exclusive.
test('2026-10-10: a second deployer cannot acquire while the lock is held', () => {
  const file = lockFile();
  assert.equal(acquire({ actor: 'worker-death', reason: 'T-0105', file }).ok, true);
  const r = acquire({ actor: 'worker-stuck', reason: 'T-0119', file });
  assert.equal(r.ok, false);
  assert.equal(r.holder.actor, 'worker-death');
});

test('2026-10-10: only the holder can release; then the next deployer gets it', () => {
  const file = lockFile();
  acquire({ actor: 'a', file });
  assert.equal(release({ actor: 'b', file }).ok, false);
  assert.equal(release({ actor: 'a', file }).ok, true);
  assert.equal(acquire({ actor: 'b', file }).ok, true);
});

test('2026-10-10: a lock older than the TTL is stale and can be taken over (holder died mid-deploy)', () => {
  const file = lockFile();
  acquire({ actor: 'a', file, now: 1000 });
  const r = acquire({ actor: 'b', file, now: 1000 + 16 * 60 * 1000 });
  assert.equal(r.ok, true);
  assert.equal(r.tookOverFrom.actor, 'a');
  assert.equal(status({ file, now: 1000 + 16 * 60 * 1000 }).actor, 'b');
});

test('2026-10-10: re-acquiring your own live lock is a no-op success', () => {
  const file = lockFile();
  acquire({ actor: 'a', file });
  assert.equal(acquire({ actor: 'a', file }).reentrant, true);
});
