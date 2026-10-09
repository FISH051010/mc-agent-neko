import assert from 'node:assert/strict';
import test from 'node:test';
import {
    siteScore, isSettleSite, biomeScore, escapeSettleOk, forceMinAdvance, shouldMigrate,
} from '../bots/_supervisor/skills/migrate.js';

// migrate.js site selection / start gate — the T-0042 / T-0051 / T-0055 / T-0059 / T-0061 / T-0110④ family.

test('T-0061/C324: site score counts REACHABLE trees, not visible plateau trees', () => {
    // live: wooded_badlands plateau, 10 visible trees, none reachable → bot settled and starved.
    const plateau = { biome: 'plains', landAnimals: 2, trees: 10, reachableTrees: 0, grass: 1 };
    const reachable = { ...plateau, reachableTrees: 6 };
    assert.equal(siteScore(plateau), 10 + 8 + 0 + 2);
    assert.equal(siteScore(reachable), 10 + 8 + 6 + 2);
    assert.equal(isSettleSite({ ...plateau, biome: 'badlands' }, 14), false);
});

test('T-0051/C312: fleeing a death zone, a tree-bearing death-free site is a valid escape even below the ideal-home bar', () => {
    // live: 4 migrations in 15min, each found 34,85 trees=18 deathsNear=0 score=12<14 → never settled.
    const site = { biome: 'savanna', landAnimals: 0, trees: 18, reachableTrees: 18, deathsNear: 0 };
    assert.equal(isSettleSite(site, 14), false, 'not an ideal home');
    assert.equal(escapeSettleOk(site), true, 'but good enough to get off the kill-zone and bootstrap wood');
});

test('T-0055/C324 keystone: escape settle needs >=4 REACHABLE trees, no deaths, no water', () => {
    assert.equal(escapeSettleOk({ biome: 'wooded_badlands', trees: 10, reachableTrees: 0, deathsNear: 0 }), false);
    assert.equal(escapeSettleOk({ biome: 'forest', trees: 8, reachableTrees: 8, deathsNear: 1 }), false);
    assert.equal(escapeSettleOk({ biome: 'beach', trees: 8, reachableTrees: 8, deathsNear: 0 }), false);
    assert.equal(escapeSettleOk({ biome: 'forest', trees: 5 }), true, 'legacy samples without reachableTrees fall back to trees');
});

test('T-0059/C323-A: desert/badlands are husk death traps — never anchor a home there', () => {
    assert.equal(biomeScore('desert'), -12);
    assert.equal(biomeScore('badlands'), -12);
    assert.equal(isSettleSite({ biome: 'desert', landAnimals: 3, trees: 6, grass: 1 }, 14), false);
});

test('T-0110④: a force relocate must march >=48b before it may settle (no in-place settle)', () => {
    // live @71,85 sunflower_plains score=24: no-op escape fired migrate 4×, each settled movedBlocks=0.
    assert.equal(forceMinAdvance({ force: true }), 48);
    assert.equal(forceMinAdvance({}), 0);
    assert.equal(forceMinAdvance({ force: true, minAdvance: 10 }), 10);
});

test('T-0042/C309: woodless-bootstrap deadlock is unlivable evidence on its own; nothing else = stay', () => {
    const base = { food: 20, msSinceLastMigrate: Infinity };
    assert.equal(shouldMigrate({ ...base, bootstrapStuck: true }).go, true);
    assert.equal(shouldMigrate(base).go, false);
    assert.equal(shouldMigrate({ ...base, bootstrapStuck: true, isNight: true }).go, false, 'never start a long march at night');
    assert.equal(shouldMigrate({ ...base, insideDeathZone: true, msSinceLastMigrate: 60000 }).go, false, 'cooldown');
    assert.equal(shouldMigrate({ ...base, force: true, isNight: true }).go, true, 'force bypasses the start gate (T-0102 woodBarren relies on it)');
});
