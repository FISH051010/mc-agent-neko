import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';
import { proposeTasks, bedErrandFeasible } from '../src/agent/framework/world_model.js';
import { EMPTY_WORLD } from '../src/agent/framework/contracts.js';

// Live 10-10 00:17: naked respawn (1 wooden pick, 0 wood), no sheep/wool/string/sword → GET_BED@44 still
// proposed; once committed it held the body over REPLENISH_KIT@62 for 3 setBed "no sheep within 64 —
// defer" NO-OPs, re-armed every 5 min after the dispatch cooldown.
function makeBot(inv, ents = []) {
    const items = Object.entries(inv).map(([name, count]) => ({ name, count }));
    const entities = Object.fromEntries(ents.map(([name, x, z], i) => [i + 1, { name, position: new Vec3(x, 64, z) }]));
    return { inventory: { items: () => items, slots: [] }, game: { dimension: 'overworld' },
        entity: { position: new Vec3(0, 64, 0) }, entities, health: 20, food: 20 };
}
function dayWorld() {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { tod: 2000, phase: 'day', isDay: true };
    w.kit = { ...w.kit, picks: 1, pickTier: 'wooden' };
    return w;
}
const hasBed = (bot) => proposeTasks(dayWorld(), bot).some(p => p.kind === 'GET_BED');

test('T-0119: no sheep / wool / string / sword+spider → GET_BED is NOT proposed (setBed would only defer)', () => {
    assert.equal(bedErrandFeasible(makeBot({ wooden_pickaxe: 1 })), false);
    assert.equal(hasBed(makeBot({ wooden_pickaxe: 1 })), false);
    // barehanded + spider: setBed skips the spider hunt without a sword
    assert.equal(hasBed(makeBot({ wooden_pickaxe: 1 }, [['spider', 10, 0]])), false);
    // a sheep beyond setBed's 64b scan cannot be reached by it either
    assert.equal(hasBed(makeBot({ wooden_pickaxe: 1 }, [['sheep', 80, 0]])), false);
});

test('T-0119: any real setBed path re-arms GET_BED', () => {
    assert.equal(hasBed(makeBot({ wooden_pickaxe: 1 }, [['sheep', 55, 0]])), true, 'sheep within 64');
    assert.equal(hasBed(makeBot({ wooden_pickaxe: 1, white_wool: 3 })), true, 'wool in pack');
    assert.equal(hasBed(makeBot({ wooden_pickaxe: 1, string: 4 })), true, 'string → wool');
    assert.equal(hasBed(makeBot({ wooden_pickaxe: 1, wooden_sword: 1 }, [['spider', 30, 0]])), true, 'sword + spider');
    assert.equal(hasBed(makeBot({ wooden_pickaxe: 1, red_bed: 1 })), true, 'bed in pack');
});
