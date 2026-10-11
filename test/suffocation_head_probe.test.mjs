import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// T-0268 (death #55, 10-11 05:30:43, suffocated at y-8): the T-0131② low-hp gravity-dig refusal is waived when the head is
// already inside a block. seal_cap_geometry pins how `_suffocating` is used, not how it is computed — worker-tests mutation
// 10-11: probing feet+2 instead of the head (feet+1) kept every test green, and that probe misses a buried head (gravel at
// the head with air above), so the waiver never fires and the #55 death comes back. Pin the probe to the head block.
test('T-0268: the suffocation waiver probes the HEAD block (feet+1) for a full bounding box', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const m = /const _headB = bot\.blockAt\(bot\.entity\.position\.floored\(\)\.offset\((-?\d+), (-?\d+), (-?\d+)\)\);/.exec(src);
    assert.ok(m, 'the head-block probe exists');
    assert.deepEqual([m[1], m[2], m[3]].map(Number), [0, 1, 0], 'head = feet + 1');
    assert.match(src, /const _suffocating = !!\(_headB && _headB\.boundingBox === 'block'\);/);
});
