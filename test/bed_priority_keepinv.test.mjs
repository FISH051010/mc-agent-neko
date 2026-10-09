// T-0043 night-respawn death loop: GET_BED was yielded below mining (@44, or dropped entirely when
// diamond-ready) on the premise "keepInventory ON, so a deferred respawn anchor loses nothing".
// The 2026-10-09 world has keepInventory=false: a bedless death drops the whole kit and respawns at
// the bare world spawn. When the wool path is right there (sheep in sight / wool / bed in pack),
// the bed must outrank the descent; without it, keep the old yield (no endless sheep-wander).
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import { bedProposalPriority, woolPathVisible } from '../src/agent/framework/world_model.js';

test('T-0043: keepInventory OFF + sheep in reach → GET_BED outranks GO_UNDERGROUND@45 even pre-iron', () => {
    const pri = bedProposalPriority({ keepInvOff: true, woolPath: true, preIronDescend: true, diamondYield: false });
    assert.ok(pri > 45, `bed must beat the descent, got ${pri}`);
});

test('T-0043: keepInventory OFF + sheep in reach → bed still proposed when diamond-ready', () => {
    assert.notEqual(bedProposalPriority({ keepInvOff: true, woolPath: true, preIronDescend: false, diamondYield: true }), null);
});

test('T-0043: no wool path, or keepInventory ON/unknown → original yields unchanged', () => {
    assert.equal(bedProposalPriority({ keepInvOff: true, woolPath: false, preIronDescend: true, diamondYield: false }), 44);
    assert.equal(bedProposalPriority({ keepInvOff: false, woolPath: true, preIronDescend: true, diamondYield: false }), 44);
    assert.equal(bedProposalPriority({ keepInvOff: null, woolPath: true, preIronDescend: false, diamondYield: true }), null);
    assert.equal(bedProposalPriority({ keepInvOff: false, woolPath: false, preIronDescend: false, diamondYield: false }), 50);
});

test('T-0043: wool path = sheep within 48b, ≥3 wool, or a bed item in the pack', () => {
    const bot = (items, ents = {}) => ({
        entity: { position: new Vec3(0, 64, 0) },
        entities: ents,
        inventory: { items: () => items.map(([name, count]) => ({ name, count })) },
    });
    assert.equal(woolPathVisible(bot([])), false);
    assert.equal(woolPathVisible(bot([], { 1: { name: 'sheep', position: new Vec3(30, 64, 10) } })), true);
    assert.equal(woolPathVisible(bot([], { 1: { name: 'sheep', position: new Vec3(90, 64, 0) } })), false);
    assert.equal(woolPathVisible(bot([['white_wool', 3]])), true);
    assert.equal(woolPathVisible(bot([['white_wool', 2]])), false);
    assert.equal(woolPathVisible(bot([['red_bed', 1]])), true);
});
