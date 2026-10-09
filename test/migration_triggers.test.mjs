import assert from 'node:assert/strict';
import test from 'node:test';
import { woodBarrenTick, migrationRecommend } from '../src/agent/framework/migration_triggers.js';
import { proposeTasks } from '../src/agent/framework/world_model.js';
import { EMPTY_WORLD } from '../src/agent/framework/contracts.js';

const MIN = 60000;
const BEACH = { x: 102, y: 49, z: 140 };

// Drive the latch the way modes.js does (one call per ~2s decision tick, collapsed to 1/min here).
function runBarren(bot, { minutes, picks = 0, counts = { cobblestone: 91 }, pos = () => BEACH, t0 = 1e12 }) {
    let wb = false;
    for (let m = 0; m <= minutes; m++) wb = woodBarrenTick(bot, { picks, counts, p: pos(m), now: t0 + m * MIN });
    return wb;
}

test('T-0102: pickless + zero wood on a livable beach for 5min → woodBarren fires', () => {
    // live 06-28 @102,49,140: pickless, 0 planks/logs/sticks, 91 cobble; badBiome/deathZone/stuckTerrain all false.
    const bot = {};
    assert.equal(runBarren(bot, { minutes: 4 }), false, 'not before ~5min sustained');
    assert.equal(runBarren(bot, { minutes: 6 }), true);
});

test('T-0102: woodBarren clears once a pick is back, or after travelling >48b; never fires with a pick or wood', () => {
    const t0 = 1e12;
    const bot = {};
    assert.equal(runBarren(bot, { minutes: 6, t0 }), true);
    assert.equal(woodBarrenTick(bot, { picks: 1, counts: {}, p: BEACH, now: t0 + 7 * MIN }), false, 'pick recovered');
    const bot2 = {};
    assert.equal(runBarren(bot2, { minutes: 6, t0 }), true);
    assert.equal(woodBarrenTick(bot2, { picks: 0, counts: {}, p: { x: BEACH.x + 60, y: 64, z: BEACH.z }, now: t0 + 7 * MIN }), false, 'relocated');
    assert.equal(runBarren({}, { minutes: 20, picks: 1 }), false, 'healthy bot with a pick');
    assert.equal(runBarren({}, { minutes: 20, counts: { oak_log: 1 } }), false, 'one log = sticks for a pick');
    assert.equal(runBarren({}, { minutes: 20, counts: { stick: 2 } }), false);
});

test('woodBarren 2026-07-14: a fresh, close, reachable tree (woodReach) means "can\'t chop" not "no trees" → no relocate', () => {
    const bot = { _world: { landmarks: { woodReach: { dist: 20, age: 30000 } } } };
    assert.equal(runBarren(bot, { minutes: 8 }), false);
    const stale = { _world: { landmarks: { woodReach: { dist: 20, age: 63 * 3600000 } } } };   // 63h-old landmark (T-0102 live)
    assert.equal(runBarren(stale, { minutes: 8 }), true);
});

test('T-0102/T-0106: recommend — force triggers ride the migrate cooldown, non-force ones do not; never at night', () => {
    const base = { phase: 'day', badBiome: false, inDeathZone: false, stuckTerrain: false, woodBarren: false, migrateOnCooldown: false };
    assert.equal(migrationRecommend({ ...base, woodBarren: true, migrateOnCooldown: true }), true, 'woodBarren is force → cooldown irrelevant');
    assert.equal(migrationRecommend({ ...base, inDeathZone: true, migrateOnCooldown: true }), false, 'T-0106: non-force on cooldown = no-op spin');
    assert.equal(migrationRecommend({ ...base, inDeathZone: true }), true);
    assert.equal(migrationRecommend({ ...base, woodBarren: true, inDeathZone: true, migrateOnCooldown: true }), false,
        'woodBarren inside a death zone is NOT force (non-force + cooldown → would spin)');
    assert.equal(migrationRecommend({ ...base, phase: 'night', woodBarren: true }), false);
    assert.equal(migrationRecommend({ ...base, phase: 'dusk', badBiome: true }), false);
    assert.equal(migrationRecommend(base), false);
});

test('T-0102: decision layer turns woodBarren into a FORCE migrate (beach passes badBiome=false; plain migrate would veto)', () => {
    const bot = { inventory: { items: () => [{ name: 'cobblestone', count: 91 }], slots: [] }, game: { dimension: 'overworld' },
        entity: { position: BEACH }, health: 20, food: 20 };
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'day', isDay: true };
    w.migration = { biome: 'beach', badBiome: false, inDeathZone: false, stuckTerrain: false, woodBarren: true, recommend: true };
    const mig = proposeTasks(w, bot).find(p => p.kind === 'MIGRATE');
    assert.ok(mig, 'MIGRATE proposed');
    assert.equal(mig.args[0].force, true);
    assert.equal(mig.args[0].maxBlocks, 128);
    w.migration = { ...w.migration, woodBarren: false, inDeathZone: true };
    const mig2 = proposeTasks(w, bot).find(p => p.kind === 'MIGRATE');
    assert.deepEqual(mig2.args, [], 'death-zone relocate stays non-force (force bypasses the night gate)');
});
