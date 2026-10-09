import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSwimTracker } from '../src/agent/swim_progress.js';
import { STUCK_MOBILITY_RE } from '../bots/_supervisor/bb-readers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// mobility evaluates every 2s; feed a path sampled at that cadence.
function run(tracker, pathFn, seconds, t0 = 1_000_000) {
    const out = [];
    for (let s = 0; s <= seconds; s += 2) {
        const [x, z] = pathFn(s);
        out.push(tracker.observe(t0 + s * 1000, x, z));
    }
    return out;
}

test('T-0091: circling wider than 1 block in a water trap still escalates to SWIM_STUCK', () => {
    // swim instinct rotating yaw: r=1.8 circle, ~3.6b diameter — every 2s sample moves >1b, which
    // reset the old anchor forever.
    const tr = createSwimTracker();
    const out = run(tr, s => [100 + 1.8 * Math.cos(s * 0.9), 50 + 1.8 * Math.sin(s * 0.9)], 30);
    assert.equal(out.at(-1), true);
    assert.ok(out.slice(0, 6).every(v => v === false), 'must not fire before a full 12s window');
});

test('T-0091: pacing back and forth (shore hunting) is no net progress', () => {
    const tr = createSwimTracker();
    const out = run(tr, s => [100 + ((s / 2) % 2 ? 2 : -2), 50], 30);
    assert.equal(out.at(-1), true);
});

test('T-0091: SWIM_STUCK stays latched across escape bursts until real headway (no 12s re-arm gap)', () => {
    const tr = createSwimTracker();
    let t = 1_000_000;
    for (let s = 0; s <= 14; s += 2) tr.observe(t + s * 1000, 100, 50);
    assert.equal(tr.latched, true);
    // escape bursts that move ~1.5b but don't get anywhere must not hand the body back
    for (let s = 16; s <= 30; s += 2) assert.equal(tr.observe(t + s * 1000, 100 + (s % 4 ? 1.5 : -1.5), 50), true);
    // real headway ≥4b releases
    assert.equal(tr.observe(t + 32000, 105, 50), false);
    assert.equal(tr.latched, false);
});

test('T-0091: actually swimming across a lake never flags', () => {
    const tr = createSwimTracker();
    const out = run(tr, s => [100 + s * 1.5, 50], 60);
    assert.ok(out.every(v => v === false));
});

test('T-0091: botwatch mobility-stuck gate covers SWIM_STUCK but not plain SWIM/FREE', () => {
    assert.ok(STUCK_MOBILITY_RE.test('SWIM_STUCK'));
    for (const s of ['MAROONED', 'ENTOMBED', 'POCKET']) assert.ok(STUCK_MOBILITY_RE.test(s));
    for (const s of ['SWIM', 'FREE', '']) assert.ok(!STUCK_MOBILITY_RE.test(s));
    const bw = fs.readFileSync(path.join(root, 'bots/_supervisor/botwatch.mjs'), 'utf8');
    assert.match(bw, /key: 'mobility-stuck'[\s\S]{0,600}active: \(s\) => STUCK_MOBILITY_RE\.test/);
});

test('T-0091: modes.js mobility uses the windowed tracker and the SWIM_STUCK reflex does not re-anchor', () => {
    const src = fs.readFileSync(path.join(root, 'src/agent/modes.js'), 'utf8');
    // the SWIM tick now lives in swim_progress.classifySwim (T-0098 extraction); behavior pinned in submerged_trap.test.mjs
    assert.match(src, /st = classifySwim\(this, \{ enc, now, x: sp2\.x, z: sp2\.z \}\)/);
    const swim = fs.readFileSync(path.join(root, 'src/agent/swim_progress.js'), 'utf8');
    assert.match(swim, /holder\._swimTrack\.observe\(now, x, z\) \? 'SWIM_STUCK'/);
    assert.doesNotMatch(src, /_swimAnchorAt = Date\.now\(\)/, 'per-burst re-anchor gives the escape reflex ~1 burst per 12s');
});
