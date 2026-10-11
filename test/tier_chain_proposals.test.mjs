import assert from 'node:assert/strict';
import test from 'node:test';
import { proposeTasks, isGoalDone, bedProposalPriority } from '../src/agent/framework/world_model.js';
import { EMPTY_WORLD } from '../src/agent/framework/contracts.js';

// Decision-layer tier chain pins (framework v2 proposeTasks / isGoalDone), driven with a fake bot.

function makeBot(inv) {
    const items = Object.entries(inv).map(([name, count]) => ({ name, count }));
    return { inventory: { items: () => items, slots: [] }, game: { dimension: 'overworld' },
        entity: { position: { x: 0, y: 64, z: 0 } }, health: 20, food: 20 };
}
function makeWorld(patch = {}) {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    for (const [k, v] of Object.entries(patch)) w[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? { ...(w[k] || {}), ...v } : v;
    return w;
}
const find = (out, kind) => out.find(p => p.kind === kind);

test('T-0097: night SMELT_IRON plan with banked raw_iron → NIGHT_SMELT_IRON smeltSafe @94 (above daytime 90)', () => {
    const bot = makeBot({ stone_pickaxe: 1, raw_iron: 7, coal: 44, cobblestone: 102, furnace: 1 });
    const w = makeWorld({ time: { phase: 'night', isDay: false }, nightPlan: { decision: 'SMELT_IRON' },
        kit: { picks: 1, pickTier: 'stone' } });
    const p = find(proposeTasks(w, bot), 'NIGHT_SMELT_IRON');
    assert.ok(p, 'night iron conversion must be proposed (was day-gated → raw_iron died with the bot)');
    assert.equal(p.skill, 'smeltSafe');
    assert.deepEqual(p.args, ['raw_iron', 5]);
    assert.ok(p.priority > 90);
});

test('T-0097: once >=3 ingots are in hand the same night plan crafts the iron tier', () => {
    const bot = makeBot({ stone_pickaxe: 1, iron_ingot: 3, stick: 4 });
    const w = makeWorld({ time: { phase: 'night', isDay: false }, nightPlan: { decision: 'SMELT_IRON' },
        kit: { picks: 1, pickTier: 'stone' } });
    const p = find(proposeTasks(w, bot), 'NIGHT_SMELT_IRON');
    assert.equal(p.skill, 'craftChain');
    assert.deepEqual(p.args, ['iron_tier']);
});

test('T-0097: NIGHT_SMELT_IRON releases on an iron pick OR when nothing is left to smelt/craft (no smeltSafe no-op spin)', () => {
    const w = (tier) => makeWorld({ kit: { picks: 1, pickTier: tier } });
    assert.equal(!!isGoalDone('NIGHT_SMELT_IRON', w('stone'), makeBot({ raw_iron: 5 })), false);
    assert.equal(!!isGoalDone('NIGHT_SMELT_IRON', w('iron'), makeBot({ raw_iron: 5, iron_sword: 1, shield: 1 })), true);   // T-0170: 铁剑已在 (否则防护序里 2 锭铁剑可造); T-0229: 盾也已在
    // worker-sync 0630 frozen-alive: raw_iron smelted & ingots used without an iron pick → sticky spin at raw_iron=0
    assert.equal(!!isGoalDone('NIGHT_SMELT_IRON', w('stone'), makeBot({ iron_ingot: 2 })), true);
});

test('T-0092: iron pick + any armor + dive kit → GET_DIAMOND dispatches mineDiamonds and outranks shallow GO_UNDERGROUND', () => {
    const bot = makeBot({ iron_pickaxe: 1, stone_pickaxe: 2, crafting_table: 1, cooked_beef: 8, cobblestone: 64, torch: 16 });
    const w = makeWorld({ time: { phase: 'day', isDay: true }, vitals: { hp: 20, food: 20, armor: 1 },
        kit: { picks: 3, pickTier: 'iron', sufficientForUnderground: true, foodSufficient: true },
        surfaceGate: { mode: 'free' }, pos: { depthBand: 'surface' } });
    const out = proposeTasks(w, bot);
    const dia = find(out, 'GET_DIAMOND');
    assert.ok(dia, `GET_DIAMOND missing; got ${out.map(p => p.kind).join(',')}`);
    assert.equal(dia.skill, 'mineDiamonds');
    const under = find(out, 'GO_UNDERGROUND');
    assert.ok(under && dia.priority > under.priority, 'diamond band on purpose, not the open-ended shallow descent');
});

test('T-0092/T-0110②: the bed errand yields to the dig chain (keepInventory ON)', () => {
    // GET_BED@50 was an unfulfillable wool-errand (no wool → no bed) that outranked GET_DIAMOND@46 and GO_UNDERGROUND@45.
    assert.equal(bedProposalPriority({ keepInvOff: false, woolPath: false, preIronDescend: false, diamondYield: true }), null);
    assert.equal(bedProposalPriority({ keepInvOff: false, woolPath: false, preIronDescend: true, diamondYield: false }), 44,
        'stone-tier: below GO_UNDERGROUND@45 so the bot mines iron instead of chasing wool');
});

test('T-0092: no iron pick → no GET_DIAMOND (stone pick would destroy diamond ore)', () => {
    const bot = makeBot({ stone_pickaxe: 3, crafting_table: 1, cooked_beef: 8 });
    const w = makeWorld({ time: { phase: 'day', isDay: true }, vitals: { hp: 20, food: 20, armor: 4 },
        kit: { picks: 3, pickTier: 'stone', sufficientForUnderground: true }, surfaceGate: { mode: 'free' } });
    assert.equal(find(proposeTasks(w, bot), 'GET_DIAMOND'), undefined);
});
