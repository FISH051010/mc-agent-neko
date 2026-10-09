import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { sealedEscapeStep, SEALED_EPISODE_MAX_MS } from '../src/agent/mobility_geom.js';

// Live 10-10 18:38:58→18:40:50: mining out of a sealed room flipped SEALED(6-11s)↔FREE(6-11s), ~17s per cell —
// every dug cell made detectSealedRoom answer 'no-stand' (bot mid-step / in the breach), resetting the 10s
// debounce. Classifier ticks every 2s; a SEALED tick = one dig+step burst.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TICK = 2000, DEBOUNCE = 10000;

// Drive N cells of tunnel: each SEALED tick advances one cell; right after each step the next tick reads
// 'no-stand' (in the breach), then sealed again until the last cell spills into open space.
// returns steady-state ms per cell: first confirmed SEALED dig → last dig (the initial 10s confirmation is
// kept on purpose — it is the C341 guard against flagging a mining pocket — so it is not counted per cell)
function simulate({ useEpisode, cells = 6 }) {
    let t = 0, episode = null, sealedSince = 0, dug = 0, pendingBreach = false, firstDigAt = 0;
    while (dug < cells && t < 600000) {
        t += TICK;
        const sr = pendingBreach ? { sealed: false, reason: 'no-stand' } : { sealed: true };
        pendingBreach = false;
        // old C341 debounce: sealed must hold 10s (any non-sealed read resets it)
        if (!sr.sealed) sealedSince = 0; else if (!sealedSince) sealedSince = t;
        const debounceSealed = sr.sealed && sealedSince && t - sealedSince > DEBOUNCE;
        let st;
        if (useEpisode) {
            const r = sealedEscapeStep({ episode, sr, enc: true, night: false, now: t, debounceSealed });
            episode = r.episode; st = r.st;
        } else st = debounceSealed ? 'SEALED' : null;
        if (st === 'SEALED') { if (!dug) firstDigAt = t; dug++; pendingBreach = true; }
    }
    return (t - firstDigAt) / (cells - 1);
}

test('T-0135: a confirmed escape keeps digging every tick instead of re-debouncing 10s per cell', () => {
    const before = simulate({ useEpisode: false });
    const after = simulate({ useEpisode: true });
    assert.ok(before >= 10000, `old model ~${before}ms/cell (live ~17s)`);
    assert.ok(after <= 3000, `episode model must be 2-3s/cell, got ${after}ms`);
});

test('T-0135: the episode ends on genuine open space, sky, night, or age — never on a mid-step read', () => {
    const ep = { since: 0, lastAt: 0 };
    assert.equal(sealedEscapeStep({ episode: ep, sr: { sealed: false, reason: 'no-stand' }, enc: true, night: false, now: 1000 }).st, 'SEALED');
    assert.equal(sealedEscapeStep({ episode: ep, sr: { sealed: false, reason: 'spill' }, enc: true, night: false, now: 1000 }).episode, null);
    assert.equal(sealedEscapeStep({ episode: ep, sr: { sealed: true }, enc: false, night: false, now: 1000 }).episode, null);
    assert.equal(sealedEscapeStep({ episode: ep, sr: { sealed: true }, enc: true, night: true, now: 1000 }).episode, null);
    assert.equal(sealedEscapeStep({ episode: ep, sr: { sealed: true }, enc: true, night: false, now: SEALED_EPISODE_MAX_MS + 1 }).st, null,
        'aged-out episode falls back to the normal debounce');
    // no episode yet: a mining pocket still needs the 10s debounce (C341 false-positive guard kept)
    assert.equal(sealedEscapeStep({ episode: null, sr: { sealed: true }, enc: true, night: false, now: 1000, debounceSealed: false }).st, null);
});

test('T-0135: modes.js classifier routes SEALED through the escape episode', () => {
    const src = fs.readFileSync(path.join(root, 'src/agent/modes.js'), 'utf8');
    assert.match(src, /const _esc = sealedEscapeStep\(\{ episode: this\._sealedEpisode, sr: _srObj,/);
    assert.match(src, /_debounceSealed = true;\s+\/\/ bounded \+ stuck ≥10s = genuine trap/);
    assert.doesNotMatch(src, /st = 'SEALED';\s+\/\/ bounded \+ stuck ≥10s = genuine trap/, 'debounce must not set SEALED directly any more');
});
