import test from 'node:test';
import assert from 'node:assert/strict';
import { landedAt, alreadyLive } from '../bots/_supervisor/deploy-lock.mjs';

// T-0114 捎带判定 (worker-death 建议): 10-10 00:21 worker-death's C356-C358 (128cbf9, merged 00:19:22) rode
// a restart someone else triggered — a further "deploy my commit" restart would have been the 4th stacked one.
// Rule: the commit is live iff the running process started AFTER the commit LANDED in the deploy tree.
const reflog = [   // newest first, as `git reflog` prints
    { sha: 'f43a', atMs: 1003 },
    { sha: 'e1c9', atMs: 1002 },
    { sha: '14d9', atMs: 1001 },   // ← target lands here
    { sha: '128c', atMs: 1000 },
];
const containsTarget = (tip) => ['f43a', 'e1c9', '14d9'].includes(tip);

test('T-0114: landing time = the oldest reflog tip that contains the commit (not its commit/rebase time)', () => {
    assert.equal(landedAt(reflog, containsTarget), 1001);
    assert.equal(landedAt(reflog, () => false), null, 'not merged into the deploy tree yet');
});

test('T-0114: a commit is already live only if the process started after it landed', () => {
    assert.equal(alreadyLive({ landedMs: 1001, procStartMs: 1500 }), true);
    assert.equal(alreadyLive({ landedMs: 1001, procStartMs: 900 }), false);
    assert.equal(alreadyLive({ landedMs: null, procStartMs: 1500 }), false, 'unmerged → never "live"');
    assert.equal(alreadyLive({ landedMs: 1001, procStartMs: null }), false, 'no process → restart needed');
});
