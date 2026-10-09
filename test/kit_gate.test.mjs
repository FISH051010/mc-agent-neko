import assert from 'node:assert/strict';
import test from 'node:test';
import { undergroundKitGate, digOneCapViable } from '../src/agent/framework/kit_gate.js';

// 石棺死锁 (T-0060 family): a bot that descends and can't make its NEXT pick underground ends up
// pickless in a pocket. The descent gate must demand "can recraft in place", not just "has a pick".
const gate = (picks, durablePick, counts) => undergroundKitGate({ picks, durablePick, counts }).sufficientForUnderground;

test('T-0088: lone durable pick + cobble/sticks but NO wood and NO carried table → stay on surface', () => {
    // live 06-24: 1 stone_pickaxe + 134 cobble + 10 stick + 0 wood + 0 table — pick wears out deep → tomb.
    assert.equal(gate(1, true, { stone_pickaxe: 1, cobblestone: 134, stick: 10 }), false);
});

test('T-0088: lone durable pick that CAN recraft in place → may descend', () => {
    assert.equal(gate(1, true, { stone_pickaxe: 1, cobblestone: 3, stick: 2, oak_planks: 4 }), true, '4 planks = a table');
    assert.equal(gate(1, true, { stone_pickaxe: 1, cobblestone: 3, birch_log: 2 }), true, 'logs → table + sticks');
    assert.equal(gate(1, true, { stone_pickaxe: 1, cobblestone: 3, stick: 2, crafting_table: 1 }), true, 'carried table');
    assert.equal(gate(1, true, { stone_pickaxe: 1, cobblestone: 2, crafting_table: 1, stick: 9 }), false, 'needs 3 cobble');
});

test('T-0012: picks>=2 bypass — 4 worn picks + no table + no wood to make one → still gated', () => {
    // live 06-25 smoking gun: 4 stone picks + 136 cobble + 2 planks + 5 sticks, no table → ground every
    // pick to dust underground, tool_keeper couldn't recraft → tier relapsed to wood, enclosed 石棺.
    assert.equal(gate(4, true, { stone_pickaxe: 4, cobblestone: 136, acacia_planks: 2, stick: 5 }), false);
});

test('T-0012: spare picks WITH a carried table pass (healthy 3-pick night miner unaffected)', () => {
    assert.equal(gate(3, true, { stone_pickaxe: 3, crafting_table: 1 }), true);
    assert.equal(gate(2, false, { wooden_pickaxe: 2, crafting_table: 1 }), true, 'two wooden picks + table');
});

test('C290/T-0025: a single WOODEN pick never qualifies; zero picks never qualifies', () => {
    assert.equal(gate(1, false, { wooden_pickaxe: 1, cobblestone: 64, oak_log: 10, crafting_table: 1 }), false);
    assert.equal(gate(0, false, { cobblestone: 64, oak_log: 10, crafting_table: 1 }), false);
});


test('T-0107: a PICKLESS bot never picks DIG_ONE_CAP at night (would bury itself under the forest floor)', () => {
    // live 06-30: spawn forest @y66, dig_one through dirt to y62 + capped → dawn chopWood: every tree "+4 unreachable".
    assert.equal(digOneCapViable({ picks: 0, gravityPit: false, y: 66 }), false);
    assert.equal(digOneCapViable({ picks: 1, gravityPit: false, y: 66 }), true);
    assert.equal(digOneCapViable({ picks: 1, gravityPit: true, y: 66 }), false, 'gravity column');
    assert.equal(digOneCapViable({ picks: 1, gravityPit: false, y: 16 }), false, 'deep: not a shallow night shelter');
});
