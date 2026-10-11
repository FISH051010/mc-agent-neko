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
// the previous death (it was never cleared or time-stamped).

const NOW = 1_000_000_000;

test('T-0235: a stale _deathLayers snapshot from the previous death is ignored — the live layers win', () => {
    const r = pickDeathLayers({
        captured: { skill: 'reclaimFurnace', action: 'action:collectBlocks', supervised: 'kernelDriver', at: NOW - 600000 },
        live: { skill: 'mineDown', action: null, supervised: 'kernelDriver' },
        now: NOW,
    });
    assert.equal(r.skill, 'mineDown');
    assert.equal(r.action, null, 'the old action must not leak into this death');
});

test('checkpoint #9: a FRESH snapshot (death event first, actions.stop() already nulled the live layers) is used', () => {
    const r = pickDeathLayers({
        captured: { skill: 'nightShelter', action: null, supervised: 'kernelDriver', at: NOW - 400 },
        live: { skill: null, action: null, supervised: null },
        now: NOW,
    });
    assert.equal(r.skill, 'nightShelter');
    assert.equal(r.supervised, 'kernelDriver');
});

test('T-0235: an un-timestamped legacy snapshot is treated as stale', () => {
    const r = pickDeathLayers({ captured: { skill: 'old' }, live: { skill: 'mineDown' }, now: NOW });
    assert.equal(r.skill, 'mineDown');
});

test('T-0235 wiring: the death handler time-stamps the snapshot and the writer goes through pickDeathLayers', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const src = fs.readFileSync(path.join(root, 'src', 'agent', 'agent.js'), 'utf8');
    assert.match(src, /this\.bot\._deathLayers = \{[\s\S]{0,300}at: Date\.now\(\)/);
    assert.match(src, /pickDeathLayers\(\{/);
    assert.doesNotMatch(src, /action: \(b && b\._deathLayers && b\._deathLayers\.action\)/, 'raw stale read must be gone');
});
