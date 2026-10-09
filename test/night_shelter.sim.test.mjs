import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';
import nightShelter from '../bots/_supervisor/skills/nightShelter.js';

// docs/shelter-mechanism-disabled.md (用户令 2026-07-07): 「允许挖三填一，不允许封箱」. The surface
// wall-box kept leaving the bot standing OUTSIDE its own walls; nightShelter('seal') must build NOTHING
// unless NEKO_ENABLE_SEAL_SHELTER=1. An upstream merge flipping this default silently resurrects the box.
// (T-0103's "就地取材 for sealBlock" patched the pre-07-07 seal builder, which no longer exists.)

function makeWorld({ pick = false, bag = { dirt: 20 } } = {}) {
    const calls = { place: 0, digOne: 0, goTo: 0 };
    const items = Object.entries(bag).map(([name, count]) => ({ name, count }));
    if (pick) items.push({ name: 'stone_pickaxe', count: 1 });
    const pos = new Vec3(10.5, 64, 10.5);
    const bot = {
        entity: { position: pos },
        health: 20, food: 20, interrupt_code: false,
        time: { timeOfDay: 18000 },
        _world: { time: { phase: 'night' } },
        entities: {},
        inventory: { items: () => items },
        heldItem: null,
        pathfinder: { stop() {} },
        clearControlStates() {},
        // flat grass plain: solid below y64, air above — no terrain walls at all
        blockAt: (p) => (p.y < 64
            ? { name: 'grass_block', boundingBox: 'block', position: p, digTime: () => 900 }
            : { name: 'air', boundingBox: 'empty', position: p }),
    };
    const counts = Object.fromEntries(items.map(i => [i.name, i.count]));
    const ctx = {
        Vec3,
        log: () => {},
        mc: { isHostile: () => false },
        world: { getInventoryCounts: () => counts },
        skills: {
            placeBlock: async () => { calls.place++; return true; },
            digOneCapOne: async () => { calls.digOne++; return true; },
            goToPosition: async () => { calls.goTo++; return true; },
            consume: async () => true,
            wait: (_b, ms) => new Promise(r => setTimeout(r, Math.min(ms, 5))),
        },
    };
    return { bot, ctx, calls };
}

async function withSealEnv(value, fn) {
    const old = process.env.NEKO_ENABLE_SEAL_SHELTER;
    if (value === undefined) delete process.env.NEKO_ENABLE_SEAL_SHELTER; else process.env.NEKO_ENABLE_SEAL_SHELTER = value;
    try { return await fn(); } finally {
        if (old === undefined) delete process.env.NEKO_ENABLE_SEAL_SHELTER; else process.env.NEKO_ENABLE_SEAL_SHELTER = old;
    }
}

test('shelter-disabled (07-07): seal at night with a full dirt bag places ZERO blocks by default', async () => {
    await withSealEnv(undefined, async () => {
        const { bot, ctx, calls } = makeWorld({ pick: true });
        const ok = await nightShelter(bot, ctx, 'seal', { maxMs: 30 });
        assert.equal(ok, true, 'hold slice returns true (false would 3-strike-cooldown the night plan)');
        assert.equal(calls.place, 0, 'no wall-box');
        assert.equal(calls.digOne, 1, 'with a pick: 挖三填一 is the allowed fallback');
    });
});

test('shelter-disabled §7.3: PICKLESS seal never hand-digs 挖三填一 (self-bury under trees → wood deadlock)', async () => {
    await withSealEnv(undefined, async () => {
        const { bot, ctx, calls } = makeWorld({ pick: false });
        await nightShelter(bot, ctx, 'seal', { maxMs: 30 });
        assert.equal(calls.place, 0);
        assert.equal(calls.digOne, 0);
        assert.equal(calls.goTo, 0, 'no relocation hunt for diggable ground either');
    });
});

test('shelter escape hatch: NEKO_ENABLE_SEAL_SHELTER=1 restores the wall-box (proves the test can see building)', async () => {
    await withSealEnv('1', async () => {
        const { bot, ctx, calls } = makeWorld({ pick: true });
        await nightShelter(bot, ctx, 'seal', { maxMs: 30 });
        assert.ok(calls.place > 0);
    });
});
