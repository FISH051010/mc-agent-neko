import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickDeathLayers } from '../src/agent/death_attribution.js';

// T-0235: death_log.jsonl recorded the PREVIOUS death's action/skill (#4 actual mineDown, #6 reclaimFurnace, #7
// mineDown — each logged the prior record's values). mineflayer emits 'death' on update_health(hp<=0), but the
// vanilla server broadcasts the death CHAT message first and syncs health a tick later — so the chat-triggered
// death_log writer ran BEFORE the 'death' handler refreshed bot._deathLayers, and read the stale snapshot left by
// the previous death (never cleared, never time-stamped).

const T0 = 1_000_000_000;

test('T-0235: a snapshot from the previous life is ignored — the live layers win', () => {
    const r = pickDeathLayers({
        captured: { skill: 'reclaimFurnace', action: 'action:collectBlocks', supervised: 'kernelDriver', at: T0 },
        live: { skill: 'mineDown', action: null, supervised: 'kernelDriver' },
        lastSpawnAt: T0 + 5000,
    });
    assert.equal(r.skill, 'mineDown');
    assert.equal(r.action, null, 'the old action must not leak into this death');
});

test('T-0235 chain death (T-0236): die → respawn → die again 8s later → the 2nd record does NOT reuse the 1st skill', () => {
    // 1st death: snapshot taken at T0 (death event), respawn at T0+3s, 2nd death's chat line at T0+11s (8s after spawn),
    // BEFORE its own 'death' event — well inside any fixed 15s window, but from the previous life.
    const first = { skill: 'mineDown', action: null, supervised: 'kernelDriver', at: T0 };
    const second = pickDeathLayers({ captured: first, live: { skill: 'migrate', action: 'mode:self_defense', supervised: 'kernelDriver' }, lastSpawnAt: T0 + 3000 });
    assert.equal(second.skill, 'migrate');
    assert.equal(second.action, 'mode:self_defense');
});

test('checkpoint #9: a snapshot taken in THIS life (death event first, actions.stop() already nulled live) is used', () => {
    const r = pickDeathLayers({
        captured: { skill: 'nightShelter', action: null, supervised: 'kernelDriver', at: T0 + 9000 },
        live: { skill: null, action: null, supervised: null },
        lastSpawnAt: T0 + 3000,
    });
    assert.equal(r.skill, 'nightShelter');
    assert.equal(r.supervised, 'kernelDriver');
});

test('T-0235: an un-timestamped legacy snapshot is never trusted', () => {
    assert.equal(pickDeathLayers({ captured: { skill: 'old' }, live: { skill: 'mineDown' }, lastSpawnAt: 0 }).skill, 'mineDown');
});

test('T-0235 wiring: snapshot time-stamped, spawn stamps _lastSpawnAt and clears it, writer goes through pickDeathLayers', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const src = fs.readFileSync(path.join(root, 'src', 'agent', 'agent.js'), 'utf8');
    assert.match(src, /this\.bot\._deathLayers = \{[\s\S]{0,300}at: Date\.now\(\)/);
    assert.match(src, /bot\.on\('spawn', \(\) => \{ try \{ bot\._lastSpawnAt = Date\.now\(\); bot\._deathLayers = null; \} catch \(e\) \{\} \}\);/);
    assert.match(src, /pickDeathLayers\(\{[\s\S]{0,200}lastSpawnAt: b && b\._lastSpawnAt/);
    assert.doesNotMatch(src, /action: \(b && b\._deathLayers && b\._deathLayers\.action\)/, 'raw stale read must be gone');
});
