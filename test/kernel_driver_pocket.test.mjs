import assert from 'node:assert/strict';
import test from 'node:test';
import kernelDriver, { reflexBusy } from '../bots/_supervisor/skills/kernelDriver.js';

// Live 10-10 00:40/00:42/00:44/00:47: each time mineDown returned at the bottom of its own 1x1 shaft,
// mobility read POCKET → kernelDriver yielded → the POCKET reflex only acts after 30s and then
// step-up-climbs 1 block (undoing the descent) → only then was mineDown re-dispatched.
const pack = (...names) => ({ items: () => names.map(name => ({ name, count: 1 })) });
const mk = (state, inventory) => ({ _mobility: { state, enclosed: true }, _world: { threat: {}, vitals: { food: 20 } }, inventory });

test('T-0086: a POCKET with a pickaxe in the pack is NOT reflex-busy (dig on, don\'t wait 30s)', () => {
    assert.equal(reflexBusy(mk('POCKET', pack('stone_pickaxe', 'cobblestone'))), false);
    assert.equal(reflexBusy(mk('POCKET', pack('wooden_pickaxe'))), false);
});

test('T-0086: pickless POCKET and every other rescue state still yield to the reflex layer', () => {
    assert.equal(reflexBusy(mk('POCKET', pack('dirt'))), true);
    for (const st of ['ENTOMBED', 'MAROONED', 'SWIM', 'SWIM_STUCK']) {   // SEALED+pick → T-0194 (not busy)
        assert.equal(reflexBusy(mk(st, pack('stone_pickaxe'))), true, st);
    }
});

test('T-0086: the live loop re-dispatches mineDown at once from a shaft-bottom POCKET', async () => {
    const calls = [];
    const bot = {
        ...mk('POCKET', pack('stone_pickaxe', 'crafting_table')),
        _commitment: { kind: 'GO_UNDERGROUND', skill: 'mineDown', args: [{ targetY: 14 }] },
        entity: { position: { x: 43, y: 15, z: 40 } },
        game: { dimension: 'overworld' },
    };
    let ticks = 0;
    const ctx = {
        world: { getInventoryCounts: () => ({}) },
        pace: () => { ticks++; return Promise.resolve(); },
        skills: { wait: () => Promise.resolve(), customSkill: async (b, name) => { calls.push({ name, ticks }); if (calls.length >= 2) b._supervisorCancelAt = Date.now(); return true; } },
    };
    await kernelDriver(bot, ctx);
    assert.equal(calls[0].name, 'mineDown');
    assert.ok(calls.length >= 2, 'second dispatch happened');
    assert.ok(calls[1].ticks - calls[0].ticks <= 1, `re-dispatch waited ${calls[1].ticks - calls[0].ticks} pace ticks instead of 1`);
});
