// T-0105 seal-fail root: head caps were placed at a FIXED feet+2 after a fixed-depth dig. On flat
// ground that cell floats (all neighbours air, below = the bot's own head) → placeBlock
// 'no-build-off' (~85% of ~3.3k historical head-cap attempts in mine_motion.jsonl) → "Can't seal".
// Also: digOneCapOne froze its cap material BEFORE digging, falling back to any item with an id
// (stick / pressure plate), so the dirt it had just dug was never used.
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import minecraftData from 'minecraft-data';
import { planOverheadCap, resolveCapBlock, isCapBlockName, isSealedPocket, breakWouldFlood, woodAboveReserve, entombedIsNightShelter, creeperResponseInPocket, gravityOverColumn, awaitCapMaterial, escapeDigPlan, marchStepClimbable, climbLanded, unarmedSoloMeleeExempt, fallbackPickWeapon } from '../src/agent/library/skills.js';

const registry = minecraftData('1.21.1');

// Tiny voxel world: everything at y <= groundTop is `ground`, above is air; `dug` cells are air,
// `placed` cells are solid.
function world({ groundTop = 66, ground = 'grass_block', dug = [], placed = [] } = {}) {
    const key = (p) => `${p.x},${p.y},${p.z}`;
    const air = new Set(dug.map(key));
    const solid = new Map(placed.map(([p, n]) => [key(p), n]));
    return (p) => {
        const k = key(p);
        if (solid.has(k)) return { name: solid.get(k), boundingBox: 'block' };
        if (air.has(k) || p.y > groundTop) return { name: 'air', boundingBox: 'empty' };
        return { name: ground, boundingBox: 'block' };
    };
}
const col = (x, z, ys) => ys.map(y => new Vec3(x, y, z));

test('T-0105: flat ground 1 deep — cap cell (feet+2) floats above the surface → must NOT try to place', () => {
    // live sample 2026-06-18T19:03: feet y66 inside the grass layer, cap target y68, neighbours all air.
    const blockAt = world({ groundTop: 66, dug: col(0, 0, [66]) });
    const plan = planOverheadCap(blockAt, new Vec3(0, 66, 0));
    assert.equal(plan.cap.y, 68);
    assert.notEqual(plan.action, 'place', 'placing here is the no-build-off failure');
    assert.equal(plan.action, 'deepen');
});

test('T-0105: flat ground 2 deep — cap cell is at surface level → support block beside it (or deepen), never a blind place', () => {
    const blockAt = world({ groundTop: 66, dug: col(0, 0, [66, 65]) });
    const plan = planOverheadCap(blockAt, new Vec3(0, 65, 0));
    assert.equal(plan.action, 'support');
    assert.equal(plan.support.y, 67);
    assert.equal(blockAt(plan.support.offset(0, -1, 0)).boundingBox, 'block', 'support must stand on solid ground');
});

test('T-0105: flat ground 3 deep (挖三填一) — cap cell sits IN the ground layer with solid sides → place', () => {
    const blockAt = world({ groundTop: 66, dug: col(0, 0, [66, 65, 64]) });
    assert.equal(planOverheadCap(blockAt, new Vec3(0, 64, 0)).action, 'place');
});

test('T-0105: roof already solid → capped (no block spent)', () => {
    const blockAt = world({ groundTop: 70, dug: col(0, 0, [66, 67]) });
    assert.equal(planOverheadCap(blockAt, new Vec3(0, 66, 0)).action, 'capped');
});

test('T-0105: pillar top — head-level wall gives the cap a support; bare pillar has none', () => {
    // bot stands on a 2-high pillar at y69 over ground top 66 (pillar blocks y67,y68).
    const pillar = [[new Vec3(0, 67, 0), 'dirt'], [new Vec3(0, 68, 0), 'dirt']];
    const bare = planOverheadCap(world({ groundTop: 66, placed: pillar }), new Vec3(0, 69, 0));
    assert.equal(bare.action, 'deepen', 'nothing around the cap cell on a bare pillar');
    const walled = planOverheadCap(world({ groundTop: 66, placed: [...pillar, [new Vec3(1, 70, 0), 'dirt']] }), new Vec3(0, 69, 0));
    assert.equal(walled.action, 'support');
    assert.deepEqual([walled.support.x, walled.support.y, walled.support.z], [1, 71, 0]);
});

function fakeBot(items) {
    return { registry, inventory: { items: () => items.map(([name, count]) => ({ name, count })) } };
}

test('T-0105: cap material never a non-full block (stick / pressure plate) — first-night pack', () => {
    // vitals 2026-10-09 15:46: {spruce_pressure_plate:1, spruce_planks:2, wooden_pickaxe:2, spruce_log:16}
    assert.equal(resolveCapBlock(fakeBot([['spruce_pressure_plate', 1], ['stick', 4], ['spruce_planks', 2], ['wooden_pickaxe', 2]])), null);
    // (T-0113: 16 logs is AT the wood baseline → not spent; the dirt the dig yields is the cap)
    assert.equal(resolveCapBlock(fakeBot([['spruce_pressure_plate', 1], ['spruce_planks', 2], ['wooden_pickaxe', 2], ['spruce_log', 16]])), null);
    assert.equal(resolveCapBlock(fakeBot([['spruce_pressure_plate', 1], ['spruce_log', 16], ['dirt', 1]])), 'dirt');
});

test('T-0105: freshly dug dirt wins over logs; gravity blocks never cap (sand falls on the head)', () => {
    assert.equal(resolveCapBlock(fakeBot([['spruce_log', 16], ['dirt', 1]])), 'dirt');
    assert.equal(resolveCapBlock(fakeBot([['sand', 30], ['gravel', 5]])), null);
    assert.equal(isCapBlockName('cobblestone', registry), true);
    assert.equal(isCapBlockName('oak_planks', registry), false, 'planks are tool-chain material (user rule)');
    assert.equal(isCapBlockName('crafting_table', registry), false);
});

test('T-0105: re-dispatched dig_one inside a sealed pocket must NOT dig again (15:50:45 drown chain)', () => {
    // pocket at feet y56: roof y58 solid, walls solid (natural ground everywhere except the shaft)
    const blockAt = world({ groundTop: 60, dug: col(0, 0, [56, 57]) });
    assert.equal(isSealedPocket(blockAt, new Vec3(0, 56, 0)), true);
    // open shaft to the sky is NOT sealed
    const open = world({ groundTop: 60, dug: col(0, 0, [56, 57, 58, 59, 60]) });
    assert.equal(isSealedPocket(open, new Vec3(0, 56, 0)), false);
});

test('T-0105: overhead break that would let water in is refused (edge_unstick headroom-break dirt@-49,59,23)', () => {
    const base = world({ groundTop: 60, dug: col(0, 0, [57, 58]) });
    const wet = (p) => (p.y === 60 && p.x === 0 && p.z === 0) ? { name: 'water', boundingBox: 'empty' } : base(p);
    assert.equal(breakWouldFlood(wet, new Vec3(0, 59, 0)), true, 'water sits on top of the roof block');
    const sideWet = (p) => (p.y === 59 && p.x === 1 && p.z === 0) ? { name: 'flowing_water', boundingBox: 'empty' } : base(p);
    assert.equal(breakWouldFlood(sideWet, new Vec3(0, 59, 0)), true, 'water beside the roof block');
    assert.equal(breakWouldFlood(base, new Vec3(0, 59, 0)), false, 'dry roof may be broken');
});

test('T-0113: logs are NOT cap material while wood is at/below the replenish baseline (first night: 16 logs burned to 2)', () => {
    // 15 logs = 60 plank-eq < 64 baseline → never cap with a log; the dug dirt is the cap.
    assert.equal(resolveCapBlock(fakeBot([['spruce_log', 15], ['wooden_pickaxe', 2]])), null);
    assert.equal(resolveCapBlock(fakeBot([['spruce_log', 15], ['dirt', 1]])), 'dirt');
    assert.equal(woodAboveReserve(fakeBot([['spruce_log', 16]])), false, '64-4=60 < 64 after spending one');
    // genuine surplus (20 logs = 80 plank-eq) → a log may be spent in an emergency
    assert.equal(resolveCapBlock(fakeBot([['spruce_log', 20]])), 'spruce_log');
    // planks count toward the reserve but are never cap material themselves
    assert.equal(resolveCapBlock(fakeBot([['oak_planks', 64], ['oak_log', 1]])), 'oak_log');
    assert.equal(resolveCapBlock(fakeBot([['oak_planks', 64]])), null);
});

test('T-0105: ENTOMBED in a breathable pocket at night = the shelter, not a burial (16:06:40 self-dig-out)', () => {
    const base = { timeOfDay: 12259, feetName: 'air', headName: 'air', msSinceDamage: 60000 };
    assert.equal(entombedIsNightShelter(base), true);
    assert.equal(entombedIsNightShelter({ ...base, timeOfDay: 6000 }), false, 'daytime → dig out');
    assert.equal(entombedIsNightShelter({ ...base, headName: 'gravel' }), false, 'block in head = real burial');
    assert.equal(entombedIsNightShelter({ ...base, feetName: 'water' }), false, 'flooded pocket → escape');
    assert.equal(entombedIsNightShelter({ ...base, msSinceDamage: 800 }), false, 'taking damage → escape');
});

test('T-0127: creeper next to a 1×1 night pit — no horizontal exit means no "backoff" (02:12 hp1, 19× wedged)', () => {
    // sealed pit: feet y66, head y67, roof y68 solid (ground top 68)
    const sealed = world({ groundTop: 68, dug: col(0, 0, [66, 67]) });
    assert.equal(creeperResponseInPocket(sealed, new Vec3(0, 66, 0)), 'hold');
    // open-roofed 2-deep shaft: no side exit → cap it (bunker), don't run into the wall
    const shaft = world({ groundTop: 67, dug: col(0, 0, [66, 67]) });
    assert.equal(creeperResponseInPocket(shaft, new Vec3(0, 66, 0)), 'bunker');
    // standing on open ground → running is possible
    assert.equal(creeperResponseInPocket(world({ groundTop: 65 }), new Vec3(0, 66, 0)), 'backoff');
});

test('T-0132: a breach column under gravel keeps cascading — never step in / never dig up under it (death #3 suffocation, gravel 8→37)', () => {
    const base = world({ groundTop: 70 });
    const gravelAt = (cells) => (p) => cells.some(c => c.x === p.x && c.y === p.y && c.z === p.z) ? { name: 'gravel', boundingBox: 'block' } : base(p);
    // breach column at (1,66..67): gravel two above the head cell → still unstable
    assert.equal(gravityOverColumn(gravelAt([new Vec3(1, 69, 0)]), 1, 66, 0), true);
    // the wall itself is gravel → cascade risk
    assert.equal(gravityOverColumn(gravelAt([new Vec3(1, 67, 0)]), 1, 66, 0), true);
    // plain stone/dirt column → safe to step in
    assert.equal(gravityOverColumn(base, 1, 66, 0), false);
    // gravel far above (beyond the 3-cell span) doesn't block
    assert.equal(gravityOverColumn(gravelAt([new Vec3(1, 72, 0)]), 1, 66, 0), false);
});

test('T-0141: cap material from a block dug a moment ago — wait for the drop to be picked up, not "no material" (death #5)', async () => {
    const items = [];
    const bot = {
        registry,
        entity: { position: new Vec3(4.5, 66, 5.5) },
        entities: { 7: { name: 'item', position: new Vec3(4.5, 66.2, 5.5) } },
        inventory: { items: () => items.map(([name, count]) => ({ name, count })) },
    };
    setTimeout(() => items.push(['dirt', 2]), 300);   // vanilla pickup delay ~10 ticks
    const t0 = Date.now();
    assert.equal(await awaitCapMaterial(bot, { timeoutMs: 1500 }), 'dirt');
    assert.ok(Date.now() - t0 < 1200);
    // nothing on the ground → answer immediately (don't stall a swarm-pressed bunker for nothing)
    const bare = { registry, entity: { position: new Vec3(0, 66, 0) }, entities: {}, inventory: { items: () => [] } };
    const t1 = Date.now();
    assert.equal(await awaitCapMaterial(bare, { timeoutMs: 1500 }), null);
    assert.ok(Date.now() - t1 < 50);
});

test('T-0142: underwater escape dig picks the fastest pick and budgets the REAL (wet, floating) dig time (death #4 drown)', async () => {
    const { default: prismarineBlock } = await import('prismarine-block');
    const Block = prismarineBlock(registry);
    const stone = Block.fromStateId(registry.blocksByName.stone.defaultState, 0);
    const tools = ['wooden_pickaxe', 'iron_pickaxe', 'stone_pickaxe'].map(n => ({ name: n, type: registry.itemsByName[n].id }));
    const wet = escapeDigPlan(stone, tools, { inWater: true, onGround: false });
    assert.equal(wet.tool, 'iron_pickaxe');
    assert.ok(wet.digMs > 9000, `floating underwater stone is slow: ${wet.digMs}`);
    assert.ok(wet.budgetMs > wet.digMs, 'timeout must exceed the real dig time or every attempt aborts and resets progress');
    // the old land-only estimate (wooden ~1150ms → ~3.1s budget) would abort a 28s wet dig
    const woodOnly = escapeDigPlan(stone, tools.slice(0, 1), { inWater: true, onGround: false });
    assert.ok(woodOnly.digMs > 25000);
    const land = escapeDigPlan(stone, tools, { inWater: false, onGround: true });
    assert.ok(land.digMs < 1000);
});

test('T-0152: MAROONED march never climbs onto leaves/logs (death #6 fell off a spruce canopy at hp1); stops pushing forward once landed', () => {
    assert.equal(marchStepClimbable('spruce_leaves'), false);
    assert.equal(marchStepClimbable('spruce_log'), false);
    assert.equal(marchStepClimbable('dirt'), true);
    assert.equal(marchStepClimbable('stone'), true);
    assert.equal(marchStepClimbable('water'), false);
    // the fixed 420ms push carried the bot across a 1-wide step: release as soon as it stands one level up
    assert.equal(climbLanded({ startY: 74, y: 75.0, onGround: true }), true);
    assert.equal(climbLanded({ startY: 74, y: 75.6, onGround: false }), false, 'still airborne mid-jump');
    assert.equal(climbLanded({ startY: 74, y: 74.0, onGround: true }), false, 'has not risen yet');
});

test('T-0168: unarmed vs one zombie — keep working only while not being hit or near-full hp; once bleeding, flee/dig in (death #8 zero-reflex)', () => {
    const base = { hasWeapon: false, hostileCount: 1, hostileName: 'zombie', recentlyHurt: true, hp: 14 };
    assert.equal(unarmedSoloMeleeExempt(base), false, 'hit and down to 14 → no exemption → flee/dig-in path');
    assert.equal(unarmedSoloMeleeExempt({ ...base, recentlyHurt: false }), true, 'not being hit → keep bootstrapping (original livelock fix)');
    assert.equal(unarmedSoloMeleeExempt({ ...base, hp: 18 }), true, 'one scratch at near-full hp → keep going');
    assert.equal(unarmedSoloMeleeExempt({ ...base, hasWeapon: true }), false, 'armed → self_defense owns it');
    assert.equal(unarmedSoloMeleeExempt({ ...base, hostileCount: 2 }), false);
    assert.equal(unarmedSoloMeleeExempt({ ...base, hostileName: 'skeleton', recentlyHurt: false }), false);
});

test('T-0168: no sword → swing back with the best pick, but never wear out the only mining pick', () => {
    const it = (name, used = 0, max = 250) => ({ name, durabilityUsed: used, maxDurability: max });
    assert.equal(fallbackPickWeapon([it('wooden_pickaxe', 0, 59), it('iron_pickaxe', 10)]), 'iron_pickaxe', 'best tier, ≥2 picks');
    assert.equal(fallbackPickWeapon([it('iron_pickaxe', 100)]), 'iron_pickaxe', 'single pick with 60% left is fine');
    assert.equal(fallbackPickWeapon([it('iron_pickaxe', 200)]), null, 'single pick at 20% — keep it for mining');
    assert.equal(fallbackPickWeapon([it('stick'), it('dirt')]), null);
    // with a usable pick: stay and fight down to hp10; bare-handed: only near-full hp
    const base = { hasWeapon: false, hostileCount: 1, hostileName: 'zombie', recentlyHurt: true };
    assert.equal(unarmedSoloMeleeExempt({ ...base, hp: 12, hasFallbackPick: true }), true);
    assert.equal(unarmedSoloMeleeExempt({ ...base, hp: 8, hasFallbackPick: true }), false, 'low hp → flee / dig in');
    assert.equal(unarmedSoloMeleeExempt({ ...base, hp: 12, hasFallbackPick: false }), false);
});
