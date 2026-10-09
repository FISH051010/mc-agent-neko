import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_ROOT } from '../src/utils/paths.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 2026-10-09: placement_recovery.sim.test.mjs wrote a fake furnace into the LIVE bot's
// bots/_supervisor/stations.json because tests ran with cwd = repo root. Run tests via
// `npm test` (test/run.mjs), which points cwd and MC_AGENT_HOME at a throwaway dir.
test('2026-10-09: tests never run against the live runtime state directory', () => {
  assert.notEqual(path.resolve(process.cwd()), repoRoot, 'cwd is the repo root — use `npm test` (test/run.mjs)');
  assert.notEqual(path.resolve(DATA_ROOT), repoRoot, 'dataPath() resolves into the repo — MC_AGENT_HOME not isolated');
});
