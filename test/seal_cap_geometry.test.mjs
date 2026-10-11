// T-0105 seal-fail root: head caps were placed at a FIXED feet+2 after a fixed-depth dig. On flat
// ground that cell floats (all neighbours air, below = the bot's own head) → placeBlock
// 'no-build-off' (~85% of ~3.3k historical head-cap attempts in mine_motion.jsonl) → "Can't seal".
// Also: digOneCapOne froze its cap material BEFORE digging, falling back to any item with an id
// (stick / pressure plate), so the dirt it had just dug was never used.
import test from 'node:test';
import assert from 'node:assert/strict';
import Vec3 from 'vec3';
import minecraftData from 'minecraft-data';
import { planOverheadCap, resolveCapBlock, isCapBlockName, isSealedPocket, breakWouldFlood, woodAboveReserve, entombedIsNightShelter, creeperResponseInPocket, gravityOverColumn, awaitCapMaterial, escapeDigPlan, marchStepClimbable, climbLanded, unarmedSoloMeleeExempt, fallbackPickWeapon, suffocationEscapeDir, overheadGravityRisk, drowningPriority } from '../src/agent/library/skills.js';

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

test('T-0172②: suffocating under a gravel COLUMN → step sideways, not dig the head block (death #9: 6 head digs, hp13→1)', () => {
    // feet y45 at (0,0): head y46 gravel, y47 gravel above; side (1,0) open at y45/46 on stone; (−1,0) stone
    const blockAt = (p) => {
        if (p.x === 0 && p.z === 0 && p.y === 45) return { name: 'air', boundingBox: 'empty' };
        if (p.x === 0 && p.z === 0 && (p.y === 46 || p.y === 47)) return { name: 'gravel', boundingBox: 'block' };
        if (p.x === 1 && p.z === 0 && (p.y === 45 || p.y === 46)) return { name: 'air', boundingBox: 'empty' };
        if (p.y > 47) return { name: 'air', boundingBox: 'empty' };
        return { name: 'stone', boundingBox: 'block' };
    };
    assert.deepEqual(suffocationEscapeDir(blockAt, new Vec3(0, 45, 0)), [1, 0]);
    // a single gravel block on the head (nothing above) → null: digging it once clears it
    const single = (p) => (p.x === 0 && p.z === 0 && p.y === 47) ? { name: 'air', boundingBox: 'empty' } : blockAt(p);
    assert.equal(suffocationEscapeDir(single, new Vec3(0, 45, 0)), null);
});

test('T-0172③: master dig gate refuses digging a gravity column standing over the bot (11 unguarded dig-up sites)', () => {
    const pos = new Vec3(10.5, 45, 20.5);   // feet y45, own column (10,20)
    const col = (over) => (p) => ({ name: over[`${p.x},${p.y},${p.z}`] || 'stone', boundingBox: 'block' });
    // gravel two above the head: digging it drops the column onto us
    assert.equal(overheadGravityRisk(col({ '10,47,20': 'gravel' }), pos, new Vec3(10, 47, 20)), true);
    // stone at feet+2 holding gravel at feet+3 — removing the stone releases the gravel
    assert.equal(overheadGravityRisk(col({ '10,48,20': 'gravel' }), pos, new Vec3(10, 47, 20)), true);
    // plain stone overhead → fine
    assert.equal(overheadGravityRisk(col({}), pos, new Vec3(10, 47, 20)), false);
    // head cell (feet+1) is never gated — that is already suffocation self-rescue
    assert.equal(overheadGravityRisk(col({ '10,46,20': 'gravel', '10,47,20': 'gravel' }), pos, new Vec3(10, 46, 20)), false);
    // a gravel column in a NEIGHBOURING column (tunnelling sideways) is not ours
    assert.equal(overheadGravityRisk(col({ '12,47,20': 'gravel' }), pos, new Vec3(12, 47, 20)), false);
    // straddling a cell edge (x=10.75 → body spans x10..11): the neighbouring column counts
    assert.equal(overheadGravityRisk(col({ '11,47,20': 'gravel' }), new Vec3(10.75, 45, 20.5), new Vec3(11, 47, 20)), true);
});

test('T-0174: drowning outranks task digging (death #10: mineDown held the dig slot underwater, rescue got "dig slot busy" ×6)', () => {
    assert.equal(drowningPriority({ headInWater: true, oxygen: 20 }), true, 'head under water → rescue first');
    assert.equal(drowningPriority({ headInWater: false, feetInWater: true, oxygen: 8 }), true, 'air running out (body in water)');
    assert.equal(drowningPriority({ headInWater: false, oxygen: 20 }), false);
    assert.equal(drowningPriority({ headInWater: false, oxygen: undefined }), false);
});

test('T-0174: dig-slot rule — rescue digs preempt task digs; while a rescue holds the slot, other digs are refused', async () => {
    const { isRescueDig, rescueMayPreempt, taskDigBlockedByRescue } = await import('../src/agent/framework/mobility_signals.js');
    assert.equal(isRescueDig('mobility:ENTOMBED'), true);
    assert.equal(isRescueDig('mobility:SEALED-up'), true);
    assert.equal(isRescueDig('mobility:MAROONED'), false, 'road-building march is not a rescue');
    assert.equal(isRescueDig('mobility:MAROONED', true), true, 'but drowning promotes it');
    // death #10: mineDown's dig (no slot owner, targetDigBlock) vs ENTOMBED rescue while drowning
    assert.equal(rescueMayPreempt({ claimantOwner: 'mobility:ENTOMBED', drowning: true, holderOwner: null }), true);
    assert.equal(rescueMayPreempt({ claimantOwner: 'mobility:SEALED', drowning: false, inDanger: true, holderOwner: 'branchMine:ore-window' }), true, 'hurt + task holds → preempt');
    assert.equal(rescueMayPreempt({ claimantOwner: 'mobility:SEALED', drowning: true, holderOwner: 'mobility:ENTOMBED' }), false, 'rescues never fight each other');
    assert.equal(rescueMayPreempt({ claimantOwner: 'mobility:MAROONED', drowning: false, inDanger: true, holderOwner: 'branchMine:ore-window' }), false);
    // live 22:45 regression: full hp, O2=20, surfaceUp climbing a 1×1 shaft → ENTOMBED must NOT fight it
    assert.equal(rescueMayPreempt({ claimantOwner: 'mobility:ENTOMBED', drowning: false, inDanger: false, holderOwner: 'surfaceUp:fallback' }), false);
    const now = 1000;
    assert.equal(taskDigBlockedByRescue({ preemptUntil: 5000, now }), true, 'task dig refused right after a preemption');
    assert.equal(taskDigBlockedByRescue({ preemptUntil: 5000, now, rescueToken: 'mobility:ENTOMBED' }), false, 'the rescue itself digs');
    assert.equal(taskDigBlockedByRescue({ preemptUntil: 500, now }), false, 'expired lock');
    assert.equal(taskDigBlockedByRescue({ preemptUntil: 0, now }), false, 'no preemption → no lock');
});

test('T-0182: unowned-danger fallback — in danger with nobody driving for ≥3s → take the body back', async () => {
    const { unownedDangerAction } = await import('../src/agent/framework/mobility_signals.js');
    // death #11 shape: head under water, O2 dropping, 11s with act='-'
    assert.equal(unownedDangerAction({ unownedMs: 3500, hurtRecently: true, headInWater: true, oxygen: 4, exposed: false }), 'swim');
    // death #8 shape: zombie hitting, underground, nobody acting
    assert.equal(unownedDangerAction({ unownedMs: 3500, hurtRecently: true, headInWater: false, oxygen: 20, exposed: false }), 'bunker');
    assert.equal(unownedDangerAction({ unownedMs: 3500, hurtRecently: true, headInWater: false, oxygen: 20, exposed: true }), 'flee', 'exposed surface → run (user order: flee over in-place bunker)');
    assert.equal(unownedDangerAction({ unownedMs: 1500, hurtRecently: true, headInWater: false, oxygen: 20, exposed: true }), null, 'give the receiver a moment first');
    assert.equal(unownedDangerAction({ unownedMs: 9000, hurtRecently: false, headInWater: false, oxygen: 20, exposed: true }), null, 'no danger → idle is fine');
    assert.equal(unownedDangerAction({ unownedMs: 9000, hurtRecently: false, headInWater: true, oxygen: 18, exposed: false }), null, 'controlled dive with air is not danger');
});

test('T-0182 普查: hand-offs only to a receiver that can take it now', async () => {
    const { dangerBlocksHold, brawlHandoffReady, marchYieldAllowed } = await import('../src/agent/framework/mobility_signals.js');
    // #3 tableRecoveryHold must not park the ENTOMBED dig-out while drowning / being hit
    assert.equal(dangerBlocksHold({ headInWater: true, msSinceDamage: 60000 }), true);
    assert.equal(dangerBlocksHold({ headInWater: false, msSinceDamage: 800 }), true);
    assert.equal(dangerBlocksHold({ headInWater: false, msSinceDamage: 60000 }), false);
    // #10 armoredZombieBrawl → self_defense only when self_defense can actually fight
    assert.equal(brawlHandoffReady({ armed: false, pointBlankZombies: 1 }), false, 'armour but no weapon (death #8 shape)');
    assert.equal(brawlHandoffReady({ armed: true, pointBlankZombies: 3 }), false, 'a pack: self_defense refuses ≥3');
    assert.equal(brawlHandoffReady({ armed: true, pointBlankZombies: 2 }), true);
    // #1 self_preservation yields to MAROONED/ENTOMBED only when nothing it alone handles is happening
    assert.equal(marchYieldAllowed({ closeThreat: false, inLavaOrFire: true, headInWater: false, oxygen: 20 }), false);
    assert.equal(marchYieldAllowed({ closeThreat: false, inLavaOrFire: false, headInWater: true, oxygen: 10 }), false);
    assert.equal(marchYieldAllowed({ closeThreat: false, inLavaOrFire: false, headInWater: false, oxygen: 20 }), true);
});

test('T-0174 hotfix: stale bot.oxygenLevel on dry land is not "drowning" (23:03: mineDown aborted 3x on land, O2=-1)', () => {
    assert.equal(drowningPriority({ headInWater: false, feetInWater: false, oxygen: -1 }), false);
    assert.equal(drowningPriority({ headInWater: false, feetInWater: true, oxygen: 6 }), true);
    assert.equal(drowningPriority({ headInWater: true, feetInWater: true, oxygen: 20 }), true);
});

test('T-0180: boxed-in flee never sprints off a ledge — hold at the edge (death #12: hp5.7, ~8-block cave drop)', async () => {
    const { chooseFleeHeading } = await import('../src/agent/mobility_geom.js');
    // every heading: head blocked except straight ahead, which is a drop → no safe heading
    const probe = (ux, uz) => (Math.abs(ux - 1) < 1e-6 && Math.abs(uz) < 1e-6)
        ? { foot: false, head: false, above: false, water: false, drop: true }
        : { foot: true, head: true, above: true, water: false, drop: false };
    const r = chooseFleeHeading(1, 0, probe);
    assert.equal(r.found, false);
    assert.equal(r.hold, true, 'straight push direction is a cliff → hold');
    // boxed in by WALLS only (no drop) → keep the old push/dig-through fallback
    const walls = () => ({ foot: true, head: true, above: true, water: false, drop: false });
    assert.equal(chooseFleeHeading(1, 0, walls).hold, false);
});

test('T-0180③: underground flee backtracks along cells we walked, never back into the mob (death #12 charged into the cave)', async () => {
    const { backtrackTarget } = await import('../src/agent/mobility_geom.js');
    const crumbs = [{ x: -20, y: 12, z: 0 }, { x: -12, y: 12, z: 0 }, { x: -6, y: 12, z: 0 }, { x: -2, y: 12, z: 0 }];
    const me = { x: 0, y: 12, z: 0 };
    assert.deepEqual(backtrackTarget(crumbs, me, { x: 4, z: 0 }), { x: -6, y: 12, z: 0 }, 'nearest walked cell ≥6b away, away from the mob');
    assert.equal(backtrackTarget(crumbs, me, { x: -10, z: 0 }), null, 'the way back is where the mob is → no backtrack');
    assert.equal(backtrackTarget([], me, null), null);
});

test('T-0180①: shared cavity-breach primitive — own tunnel/stair is not a cavity; a cave ahead (incl. one level down) is', async () => {
    const { cavityBreachAt } = await import('../src/agent/library/skills.js');
    const p = new Vec3(0, 10, 0);
    const tunnel = (q) => ({ name: (q.z === 0 && q.x <= 1 && (q.y === 10 || q.y === 11)) ? 'air' : 'stone' });
    const caveLevel = (q) => ({ name: (q.x >= 1 && q.x <= 4 && q.y >= 9 && q.y <= 13) ? 'cave_air' : 'stone' });
    const caveBelow = (q) => ({ name: (q.x >= 1 && q.x <= 4 && q.y >= 6 && q.y <= 9) ? 'water' : 'stone' });   // death #11: flooded cave under a descending stair
    assert.equal(cavityBreachAt(tunnel, p, 1, 0), false);
    assert.equal(cavityBreachAt(caveLevel, p, 1, 0), true);
    assert.equal(cavityBreachAt(caveBelow, p, 1, 0, { yLo: 0 }), false, 'branchMine band misses a cave below the stair');
    assert.equal(cavityBreachAt(caveBelow, p, 1, 0, { yLo: -1 }), true, 'mineDown band (one below the feet) catches it');
});

test('T-0180① C387: open sky ahead is not a cavity — mineDown starting on the surface must not seal its own entrance', async () => {
    const { cavityBreachAt } = await import('../src/agent/library/skills.js');
    const p = new Vec3(0, 65, 0);
    // 实录 01:18:48: 地表 y65 平地, 前方 y64..66 → 地面以上全露天
    const surface = (q) => ({ name: q.y < 65 ? 'grass_block' : 'air' });
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0]]) assert.equal(cavityBreachAt(surface, p, dx, dz, { yLo: -1 }), false, `heading ${dx},${dz}`);
    // 树荫下 (leaves 当顶) 也不算
    const canopy = (q) => ({ name: q.y < 65 ? 'grass_block' : (q.y === 70 ? 'spruce_leaves' : 'air') });
    assert.equal(cavityBreachAt(canopy, p, 1, 0, { yLo: -1 }), false);
    // 同样的空间盖上岩顶 = 洞穴 → 判破口
    const roofed = (q) => ({ name: q.y < 65 ? 'grass_block' : (q.y === 68 ? 'stone' : 'air') });
    assert.equal(cavityBreachAt(roofed, p, 1, 0, { yLo: -1 }), true);
});

test('T-0195: no chestplate-tier armor (bot._cavitySealAlways) → a cavity breach is sealed even with no hostile in sight', async () => {
    const { sealCavityBreach } = await import('../src/agent/library/skills.js');
    const mk = (always) => ({
        output: '', entities: {}, _cavitySealAlways: always,
        entity: { position: new Vec3(0.5, 10, 0.5) },
        inventory: { items: () => [] },
        blockAt: (q) => ({ name: (q.x >= 1 && q.x <= 4 && q.y >= 9 && q.y <= 13) ? 'cave_air' : 'stone' }),
    });
    assert.equal((await sealCavityBreach(mk(true), 1, 0)).breached, true, 'seal-always: breach handled without seeing a mob');
    assert.equal((await sealCavityBreach(mk(false), 1, 0)).breached, false, 'chestplate worn + no hostile → keep digging (old behavior)');
    const solid = mk(true); solid.blockAt = () => ({ name: 'stone' });
    assert.equal((await sealCavityBreach(solid, 1, 0)).breached, false, 'no cavity → nothing to seal');
});

test('T-0180① C381: the cells the caller just dug (p+d column) are not cavity evidence — 3 self-dug + 5 natural air ≠ breach', async () => {
    const { cavityBreachAt } = await import('../src/agent/library/skills.js');
    const p = new Vec3(-8, 39, 11);
    // 实录 00:07:34 heading 0,1: mineDown 刚挖开 (-8,38..40,12) 三格, 远处只有 5 格零散空隙 → 旧判据凑满 8 = 误判破口
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const dug = (q) => q.x === p.x + dx && q.z === p.z + dz && q.y >= 38 && q.y <= 40;
        const sparse = new Set();
        for (let s = -1; s <= 1; s++) sparse.add(`${p.x + 3 * dx + (dz ? s : 0)},38,${p.z + 3 * dz + (dx ? s : 0)}`);
        sparse.add(`${p.x + 3 * dx},39,${p.z + 3 * dz}`);
        sparse.add(`${p.x + 2 * dx},40,${p.z + 2 * dz}`);
        const world = (q) => ({ name: dug(q) || sparse.has(`${q.x},${q.y},${q.z}`) ? 'air' : 'stone' });
        assert.equal(cavityBreachAt(world, p, dx, dz, { yLo: -1 }), false, `heading ${dx},${dz}: own dig + 5 sparse air`);
        // 真洞穴: 自挖列之外前方整片打开 → 仍判破口
        const cave = (q) => ({ name: dug(q) || ((q.x - p.x) * dx + (q.z - p.z) * dz >= 2 && q.y >= 38 && q.y <= 40) ? 'air' : 'stone' });
        assert.equal(cavityBreachAt(cave, p, dx, dz, { yLo: -1 }), true, `heading ${dx},${dz}: real cave`);
    }
});

test('T-0248 death #52: 封闭坑里苦力怕在外 (T-0127 hold) → 真·原地不动, 不再走 bunkerDown 挖/寻路/垫柱出坑; bunkerDown 每个移动子分支写 progress', async () => {
    const fs = await import('node:fs');
    const m = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const br = m.slice(m.indexOf('pocket has no horizontal exit → ${_cResp}'), m.indexOf('pocket has no horizontal exit → ${_cResp}') + 1400);
    assert.match(br, /if \(_cResp === 'hold'\) \{\s*execute\(this, agent, async \(\) => \{ await this\.creeperHoldInPocket\(agent\); \}\);/);
    const hold = m.slice(m.indexOf('creeperHoldInPocket: async function'), m.indexOf('bunkerDown: async function'));
    assert.ok(hold.length > 0);
    assert.ok(!/dig|placeBlock|goToPosition|pillarUp|setControlState\(/.test(hold.replace(/\/\/[^\n]*/g, '')), 'hold never digs, places, walks or presses keys');
    assert.match(hold, /nearestCreeper\(bot, 3\)/, 're-evaluates when the creeper closes in');
    const bd = m.slice(m.indexOf('bunkerDown: async function'), m.indexOf('bunkerDown: async function') + 30000);
    for (const tag of ["_bdLog('enter')", '_bdLog(`relocate→', "_bdLog('no-filler roof-niche dig+walk')", "_bdLog('cap failed → pillar-up fallback')", "_bdLog('seal failed → run from swarm')"]) {
        assert.ok(bd.includes(tag), `bunkerDown logs: ${tag}`);
    }
});