import assert from 'node:assert/strict';
import test from 'node:test';
import { commitGoal } from '../src/agent/framework/world_model.js';
import { EMPTY_WORLD, PROPOSAL_KIND } from '../src/agent/framework/contracts.js';

// Fake bot: empty pack (bootstrap not done), commitment pre-seeded.
function fakeBot(commitKind, skill) {
    return {
        entity: { position: { x: 0, y: 70, z: 0 } },
        inventory: { items: () => [] },
        _commitment: { kind: commitKind, skill, args: [], since: Date.now() - 5000 },
    };
}

function world(over = {}) {
    return {
        ...EMPTY_WORLD,
        time: { tod: 3000, phase: 'day', isDay: true },
        vitals: { ...EMPTY_WORLD.vitals, ...(over.vitals || {}) },
        threat: { ...EMPTY_WORLD.threat, ...(over.threat || {}) },
        migration: { biome: 'taiga', badBiome: false, inDeathZone: true, recommend: true, ...(over.migration || {}) },
    };
}

const BOOT = { kind: PROPOSAL_KIND.BOOTSTRAP_KIT, priority: 90, skill: 'prepNether', args: [] };
const MIG = { kind: PROPOSAL_KIND.MIGRATE, priority: 60, skill: 'migrate', args: [] };

test('T-0108: calm daytime death-zone MIGRATE must not preempt an in-progress BOOTSTRAP_KIT', () => {
    const bot = fakeBot(PROPOSAL_KIND.BOOTSTRAP_KIT, 'prepNether');
    // Several consecutive ticks: commitment must stay put (no BOOTSTRAP↔MIGRATE flip).
    for (let i = 0; i < 5; i++) {
        const g = commitGoal(bot, [BOOT, MIG], world());
        assert.equal(g.kind, PROPOSAL_KIND.BOOTSTRAP_KIT, `tick ${i}: flipped to ${g.kind}`);
        assert.equal(bot._commitment.kind, PROPOSAL_KIND.BOOTSTRAP_KIT);
    }
});

test('T-0108: calm death-zone MIGRATE also yields to REPLENISH_KIT (cheap productive kit work)', () => {
    const bot = fakeBot(PROPOSAL_KIND.REPLENISH_KIT, 'replenishKit');
    const g = commitGoal(bot, [{ kind: PROPOSAL_KIND.REPLENISH_KIT, priority: 67, skill: 'replenishKit' }, MIG], world());
    assert.equal(g.kind, PROPOSAL_KIND.REPLENISH_KIT);
});

test('T-0108: death zone that is actually biting (low hp / actionable threat) still preempts bootstrap', () => {
    for (const over of [{ vitals: { hp: 8 } }, { threat: { actionable: 1 } }, { threat: { takingDamage: true } }]) {
        const bot = fakeBot(PROPOSAL_KIND.BOOTSTRAP_KIT, 'prepNether');
        const g = commitGoal(bot, [BOOT, MIG], world(over));
        assert.equal(g.kind, PROPOSAL_KIND.MIGRATE, `expected preempt for ${JSON.stringify(over)}`);
        assert.equal(g.preemptedFrom, PROPOSAL_KIND.BOOTSTRAP_KIT);
    }
});

test('T-0108: calm death-zone MIGRATE still preempts a non-kit daytime commitment (zone gets left)', () => {
    const bot = fakeBot(PROPOSAL_KIND.GET_BED, 'getBed');
    const g = commitGoal(bot, [{ kind: PROPOSAL_KIND.GET_BED, priority: 50, skill: 'getBed' }, MIG], world());
    assert.equal(g.kind, PROPOSAL_KIND.MIGRATE);
});

test('T-0108: a committed death-zone MIGRATE is not dethroned by a night plan (still an emergency commitment)', () => {
    const bot = fakeBot(PROPOSAL_KIND.MIGRATE, 'migrate');
    const night = { kind: PROPOSAL_KIND.NIGHT_SEAL, priority: 92, skill: 'nightShelter', args: ['seal'] };
    const g = commitGoal(bot, [night, MIG], world());
    assert.equal(g.kind, PROPOSAL_KIND.MIGRATE);
});
