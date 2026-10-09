import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { archiveStaleWorldStateOnSwitch, supIn } from '../src/agent/world_scope.js';

// T-0065 / C333: death_log / landmarks / bed are world-LOCAL but persisted globally. A fresh world
// must archive them (else phantom death-zones from the old world → chopWood 无限背撤); a same-world
// reconnect or a fresh naked death must keep them.

const NOW = Date.parse('2026-10-09T12:00:00Z');
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();

function makeInv({ items = [], armor = {} } = {}) {
    const slots = new Array(46).fill(null);
    for (const [slot, name] of Object.entries(armor)) slots[slot] = { name, count: 1 };
    return { items: () => items, slots };
}

function makeSup(deaths) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-worldscope-'));
    if (deaths) fs.writeFileSync(path.join(dir, 'death_log.jsonl'), deaths.map(d => JSON.stringify(d)).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'landmarks.json'), '{}');
    fs.writeFileSync(path.join(dir, 'bed.json'), '{}');
    return { dir, sup: supIn(dir), has: (f) => fs.existsSync(path.join(dir, f)) };
}

const bot = (inventory, pos = { x: 23, y: 68, z: -10 }) => ({ inventory, entity: { position: pos } });
const run = (b, sup) => archiveStaleWorldStateOnSwitch(b, { sup, delayMs: 0, now: () => NOW });

test('T-0065: naked fresh char + old-world death_log (deaths near new spawn, hours old) → archived', async () => {
    // 用户实证: 旧世界 129 死里 54 条落在新生点 16 格内 — near=true but hours old must NOT block reset.
    const s = makeSup([{ ts: minsAgo(400), x: 17, y: 61, z: -20 }, { ts: minsAgo(300), x: 22, y: 68, z: -12 }]);
    const r = await run(bot(makeInv({ items: [{ name: 'sand', count: 6 }] })), s.sup);
    assert.ok(r, 'must detect new world');
    assert.equal(s.has('death_log.jsonl'), false, 'stale death_log must be moved away');
    assert.equal(s.has('landmarks.json'), false);
    assert.equal(s.has('bed.json'), false);
    assert.ok(fs.readdirSync(s.dir).some(f => /^death_log\.jsonl\..*\.oldworld$/.test(f)), 'archived (renamed), not deleted');
});

test('T-0065: naked fresh char + far recent death (live case: 16min ago, near=false) → archived', async () => {
    const s = makeSup([{ ts: minsAgo(16), x: 500, y: 64, z: 500 }]);
    assert.ok(await run(bot(makeInv()), s.sup));
    assert.equal(s.has('death_log.jsonl'), false);
});

test('C333 guard: geared same-world reconnect never archives', async () => {
    const s = makeSup([{ ts: minsAgo(400), x: 0, y: 64, z: 0 }]);
    const geared = makeInv({ items: [{ name: 'iron_pickaxe', count: 1 }], armor: { 6: 'iron_chestplate' } });
    assert.equal(await run(bot(geared), s.sup), null);
    assert.equal(s.has('death_log.jsonl'), true);
    // armor alone / shield alone / a big stack of blocks each also mean "not a fresh char"
    for (const inv of [makeInv({ armor: { 5: 'leather_helmet' } }), makeInv({ items: [{ name: 'shield', count: 1 }] }),
        makeInv({ items: [{ name: 'cobblestone', count: 64 }] })]) {
        assert.equal(await run(bot(inv), s.sup), null);
    }
    assert.equal(s.has('death_log.jsonl'), true);
});

test('C333 guard (a): inventory load-lag — naked at spawn but gear arrives before re-check → keep', async () => {
    const s = makeSup([{ ts: minsAgo(400), x: 0, y: 64, z: 0 }]);
    const inv = makeInv();
    const b = bot(inv);
    const p = archiveStaleWorldStateOnSwitch(b, { sup: s.sup, delayMs: 20, now: () => NOW });
    inv.slots[7] = { name: 'iron_leggings', count: 1 };        // gear loads in during the wait
    assert.equal(await p, null);
    assert.equal(s.has('death_log.jsonl'), true);
});

test('C333 guard (b): same world, bot just died naked nearby (<10min, <24b) → keep death_log', async () => {
    const s = makeSup([{ ts: minsAgo(400), x: 900, y: 64, z: 900 }, { ts: minsAgo(3), x: 20, y: 68, z: -5 }]);
    assert.equal(await run(bot(makeInv()), s.sup), null);
    assert.equal(s.has('death_log.jsonl'), true, 'a fresh naked death in this world is still relevant');
});

test('C333: no death_log → nothing to archive', async () => {
    const s = makeSup(null);
    assert.equal(await run(bot(makeInv()), s.sup), null);
    assert.equal(s.has('landmarks.json'), true);
});

// ── 2026-10-09 扩展: 世界身份改用登录包 hashedSeed + 清单补全 ──────────────────────────────
import { worldIdFromLoginPacket, WORLD_SCOPED_FILES, WORLD_ID_FILE } from '../src/agent/world_scope.js';

const runSeed = (b, sup, worldId) => archiveStaleWorldStateOnSwitch(b, { sup, delayMs: 0, now: () => NOW, worldId });
const geared = () => makeInv({ items: [{ name: 'iron_pickaxe', count: 1 }], armor: { 5: 'iron_helmet' } });

test('T-0065: seed changed → archive ALL world-scoped coordinate state, even when geared and with no death_log', async () => {
    const s = makeSup(null);
    fs.writeFileSync(path.join(s.dir, WORLD_ID_FILE), JSON.stringify({ id: 'old-seed' }));
    for (const f of ['stations.json', 'spawn_pos.json', 'bank.json', 'migrate_state.json']) fs.writeFileSync(path.join(s.dir, f), '{}');
    const r = await runSeed(bot(geared()), s.sup, 'new-seed');
    assert.equal(r.by, 'seed');
    for (const f of ['stations.json', 'spawn_pos.json', 'bank.json', 'migrate_state.json', 'landmarks.json', 'bed.json']) {
        assert.equal(s.has(f), false, `${f} must be archived on a world switch`);
    }
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, WORLD_ID_FILE), 'utf8')).id, 'new-seed');
});

test('T-0065: same seed → never archive, even a naked character with an old far death_log', async () => {
    const s = makeSup([{ ts: minsAgo(600), x: 500, z: 500 }]);
    fs.writeFileSync(path.join(s.dir, WORLD_ID_FILE), JSON.stringify({ id: 'seed-A' }));
    assert.equal(await runSeed(bot(makeInv()), s.sup, 'seed-A'), null);
    assert.equal(s.has('death_log.jsonl'), true);
});

test('T-0065: first sighting of a seed records it and falls back to the naked heuristic', async () => {
    const s = makeSup(null);
    assert.equal(await runSeed(bot(geared()), s.sup, 'seed-B'), null);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, WORLD_ID_FILE), 'utf8')).id, 'seed-B');
});

test('T-0065: world id is read from the raw login packet (worldState.hashedSeed, i64 as [hi,lo] or bigint)', () => {
    assert.equal(worldIdFromLoginPacket({ worldState: { hashedSeed: [12, 34] } }), '12:34');
    assert.equal(worldIdFromLoginPacket({ worldState: { hashedSeed: 99n } }), '99');
    assert.equal(worldIdFromLoginPacket({ hashedSeed: [1, 2] }), '1:2');
    assert.equal(worldIdFromLoginPacket({}), null);
    assert.equal(worldIdFromLoginPacket(null), null);
});

test('T-0065: stations.json is world-scoped (old world left 223 phantom tables/furnaces behind)', () => {
    for (const f of ['stations.json', 'spawn_pos.json', 'bank.json', 'migrate_state.json']) assert.ok(WORLD_SCOPED_FILES.includes(f), f);
});
