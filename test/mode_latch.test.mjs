import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { burstLatchExpired, releaseExpiredLatches } from '../src/agent/mode_latch.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Live 10-10 00:59:25→01:03:50: mobility's ENTOMBED dig-out burst hung on an await, mode.active stayed true
// 4.5 min, bot._mobility froze at ENTOMBED (bot physically FREE), kernelDriver yielded and every reflex after
// mobility in modes_list (auto_heal, auto_eat, …) starved until the 5-min pinned-position backstop fired.
const T = 10_000_000;
const mobility = (heldMs) => ({ name: 'mobility', maxBurstMs: 90000, active: true, activeSince: T - heldMs });

test('T-0122: a mode holding its latch past maxBurstMs is released (with diagnostics) — not left for 5 min', () => {
    const m = mobility(95000);
    const seen = [];
    const out = releaseExpiredLatches([m, { name: 'auto_eat', active: false }], T, (mode, held) => seen.push([mode.name, held]));
    assert.deepEqual(out, ['mobility']);
    assert.deepEqual(seen, [['mobility', 95000]]);
    assert.equal(m.active, false, 'ModeController can update mobility (and reach the modes after it) again');
});

test('T-0122: legit bursts and modes without a declared bound are left alone', () => {
    assert.equal(burstLatchExpired(mobility(40000), T), false, 'a 2×20s dig burst is legit');
    assert.equal(burstLatchExpired({ name: 'self_preservation', active: true, activeSince: T - 600000 }, T), false,
        'no maxBurstMs → unbounded by design (e.g. long night holds)');
    assert.equal(burstLatchExpired({ ...mobility(95000), active: false }, T), false);
});

test('T-0122: modes.js wiring — mobility bounded, ModeController releases, stale burst cannot clear a newer one', () => {
    const src = fs.readFileSync(path.join(root, 'src/agent/modes.js'), 'utf8');
    assert.match(src, /name: 'mobility',\s*\n\s*maxBurstMs: \d+/);
    assert.match(src, /async update\(\) \{[\s\S]{0,400}releaseExpiredLatches\(modes_list, Date\.now\(\)/);
    assert.match(src, /const _burst = mode\._burstSeq = \(mode\._burstSeq \|\| 0\) \+ 1;\s*\n\s*mode\.activeSince = Date\.now\(\);/);
    assert.match(src, /finally \{\s*\n\s*if \(mode\._burstSeq === _burst\) \{\s*\n\s*mode\.active = false;/);
});

test('T-0122: releasing a latch also frees that mode\'s ActionManager slot (no 15s stop() wait + forced reconnect)', () => {
    const src = fs.readFileSync(path.join(root, 'src/agent/modes.js'), 'utf8');
    assert.match(src, /if \(_am\.executing && _slotLabel === `mode:\$\{m\.name\}`\) \{ _am\.executing = false;/);
});
