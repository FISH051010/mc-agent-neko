import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Vec3 from 'vec3';
import villageHarvest from '../bots/_supervisor/skills/villageHarvest.js';

// T-0089: computeOpening (modes.js) returns VILLAGE_HARVEST whenever a village landmark is <32b unless
// bot._villageHarvestCooldownUntil is in the future. villageHarvest must stamp that cooldown after a pass,
// otherwise a farmed-out village pins the opening phase forever (live -68,71,8: re-dispatched every 1.6s,
// pinned 450s+). The stamp was lost (never committed) — modes.js kept reading a field nobody wrote.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeBot({ crops = [], night = false, hostile = false } = {}) {
    const blocks = new Map(crops.map(c => [c.p.toString(), { name: c.name, position: c.p, getProperties: () => ({ age: c.age }) }]));
    const bot = {
        entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 20, interrupt_code: false,
        time: { timeOfDay: night ? 18000 : 6000 },
        entities: hostile ? { z: { position: new Vec3(3, 64, 0) } } : {},
        registry: { blocksByName: { wheat: { id: 1 }, carrots: { id: 2 }, potatoes: { id: 3 }, beetroots: { id: 4 } } },
        findBlocks: () => [...blocks.values()].map(b => b.position),
        blockAt: (p) => blocks.get(p.toString()) || null,
        _world: { landmarks: { village: { x: 20, y: 64, z: 0, dist: 20 } } },
    };
    bot.entity.position.distanceTo = function (o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); };
    const ctx = {
        mc: { isHostile: () => true },
        world: { getInventoryCounts: () => ({}) },
        skills: {
            goToPosition: async () => true,
            breakBlockAt: async (_b, x, y, z) => { blocks.delete(new Vec3(x, y, z).toString()); return true; },
            pickupNearbyItems: async () => true,
            tillAndSow: async () => false,
            craftRecipe: async () => false,
            consume: async () => false,
        },
    };
    return { bot, ctx };
}

test('T-0089: farmed-out village (no mature crops) → honest false AND stamps the ~8min harvest cooldown', async () => {
    const { bot, ctx } = makeBot({ crops: [{ name: 'wheat', p: new Vec3(5, 64, 0), age: 3 }] });   // immature only
    const t0 = Date.now();
    assert.equal(await villageHarvest(bot, ctx), false);
    assert.ok((bot._villageHarvestCooldownUntil || 0) >= t0 + 7 * 60000,
        'without the stamp computeOpening re-proposes VILLAGE_HARVEST forever (no-op re-dispatch pin)');
});

test('T-0089: a productive pass also stamps the cooldown (next pass waits for regrowth)', async () => {
    const { bot, ctx } = makeBot({ crops: [{ name: 'wheat', p: new Vec3(3, 64, 0), age: 7 }, { name: 'carrots', p: new Vec3(4, 64, 1), age: 7 }] });
    const r = await villageHarvest(bot, ctx);
    assert.equal(r.harvested, 2);
    assert.ok((bot._villageHarvestCooldownUntil || 0) > Date.now());
});

test('T-0089: night / hostile defers are NOT a finished pass — no cooldown stamp', async () => {
    for (const opts of [{ night: true }, { hostile: true }]) {
        const { bot, ctx } = makeBot({ ...opts, crops: [{ name: 'wheat', p: new Vec3(3, 64, 0), age: 7 }] });
        assert.equal(await villageHarvest(bot, ctx), false);
        assert.equal(bot._villageHarvestCooldownUntil, undefined, JSON.stringify(opts));
    }
});

test('T-0089 contract: the field modes.js computeOpening gates on is the one villageHarvest writes', () => {
    const modes = fs.readFileSync(path.join(root, 'src', 'agent', 'modes.js'), 'utf8');
    const skill = fs.readFileSync(path.join(root, 'bots', '_supervisor', 'skills', 'villageHarvest.js'), 'utf8');
    assert.match(modes, /bot\._villageHarvestCooldownUntil/);
    assert.match(skill, /_villageHarvestCooldownUntil\s*=/);
});
