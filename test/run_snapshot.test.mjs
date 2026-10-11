import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// world_scope "flaky only in the full parallel run" (2026-10-11): deploy-lock and npm test ran the suite against the
// LIVE shared checkout while other sessions edited files non-atomically → a test read a half-written agent.js
// (reproduced 23/25 with a concurrent rewrite). test/run.mjs now runs every file from a consistent git snapshot of
// the working tree taken at start. This pins that: under run.mjs the test files themselves must NOT be the live ones.

const underRunner = !!process.env.NEKO_TEST_HOME;   // set by test/run.mjs (direct `node --test` runs are exempt)

test('run.mjs executes tests from a source snapshot, never from the live shared working tree', { skip: !underRunner || process.env.NEKO_TEST_NO_SNAPSHOT === '1' }, () => {
    const live = process.env.NEKO_TEST_LIVE_ROOT;
    assert.ok(live, 'run.mjs must export NEKO_TEST_LIVE_ROOT (snapshot runner)');
    const here = path.resolve(fileURLToPath(import.meta.url));
    const rel = path.relative(path.resolve(live), here);
    assert.ok(rel.startsWith('..') || path.isAbsolute(rel), `test file ${here} is inside the live tree ${live}`);
});
