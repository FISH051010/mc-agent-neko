import assert from 'node:assert/strict';
import test from 'node:test';
import { proposeTasks, diamondDiveReady } from '../src/agent/framework/world_model.js';
import { EMPTY_WORLD } from '../src/agent/framework/contracts.js';

// Live 10-10 02:26 night @94,72,-61: commitment flipped to DUSK_MINE_NIGHT (night DIAMOND rush → mineDiamonds)
// with iron_pickaxe×3 and NO stone_pickaxe; mineDiamonds' lone-iron-pick escort guard DEFERred 3× →
// dispatch cooldown revoked the whole night plan → FREE_PLAY at night, hp 1, 3 hostiles.
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
const nightWorld = () => makeWorld({ time: { phase: 'night', isDay: false }, nightPlan: { decision: 'MINE_THROUGH_NIGHT' },
    vitals: { hp: 20, food: 20, armor: 2 }, kit: { picks: 3, pickTier: 'iron', sufficientForUnderground: true } });
const dayWorld = () => makeWorld({ time: { phase: 'day', isDay: true }, vitals: { hp: 20, food: 20, armor: 1 },
    kit: { picks: 3, pickTier: 'iron', sufficientForUnderground: true, foodSufficient: true },
    surfaceGate: { mode: 'free' }, pos: { depthBand: 'surface' } });
const KIT = { cobblestone: 545, stick: 27, spruce_planks: 7, crafting_table: 1, cooked_beef: 8, torch: 16 };

test('T-0128: the diamond dive needs the stone escort pick mineDiamonds itself demands', () => {
    assert.equal(diamondDiveReady(makeBot({ iron_pickaxe: 3 })), false);
    assert.equal(diamondDiveReady(makeBot({ iron_pickaxe: 1, stone_pickaxe: 1 })), true);
    assert.equal(diamondDiveReady(makeBot({ stone_pickaxe: 2 })), false);
});

test('T-0128: night MINE_THROUGH_NIGHT without a stone escort falls back to a skill that runs (never mineDiamonds)', () => {
    const out = proposeTasks(nightWorld(), makeBot({ iron_pickaxe: 3, ...KIT }));
    const night = out.find(p => p.kind === 'DUSK_MINE_NIGHT');
    assert.ok(night, `night plan must survive; got ${out.map(p => p.kind).join(',')}`);
    assert.notEqual(night.skill, 'mineDiamonds');
});

test('T-0128: with the escort the night diamond rush is kept; daytime GET_DIAMOND follows the same gate', () => {
    const nightOut = proposeTasks(nightWorld(), makeBot({ iron_pickaxe: 2, stone_pickaxe: 1, ...KIT }));
    assert.equal(nightOut.find(p => p.kind === 'DUSK_MINE_NIGHT').skill, 'mineDiamonds');
    assert.ok(!proposeTasks(dayWorld(), makeBot({ iron_pickaxe: 3, ...KIT })).some(p => p.kind === 'GET_DIAMOND'));
    assert.ok(proposeTasks(dayWorld(), makeBot({ iron_pickaxe: 2, stone_pickaxe: 1, ...KIT })).some(p => p.kind === 'GET_DIAMOND'));
});
