import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDiscardPlan } from '../bots/_supervisor/skills/chopWood.js';

// Full-bag wood famine: a chopped log can't be picked up into a 36/36 inventory → total stuck at 0 → every tree
// blacklisted. chopWood frees slots by discarding junk / over-cap bulk — never anything on the survival path.

const inv = (pairs) => pairs.map(([name, count]) => ({ name, count }));
const byName = (plan) => Object.fromEntries(plan.map(p => [p.name, p.num]));

test('T-0041/C309-A: the non-mesa hoard (raw_copper / lapis / dripstone) is recognised as droppable junk', () => {
    // live: 36/36 full of raw_copper×192 + lapis×44 + dripstone×24 → "no droppable junk" → keystone log never fit.
    const { plan } = buildDiscardPlan(inv([['raw_copper', 64], ['raw_copper', 64], ['raw_copper', 64], ['lapis_lazuli', 44], ['pointed_dripstone', 24]]));
    assert.deepEqual(byName(plan), { raw_copper: -1, lapis_lazuli: -1, pointed_dripstone: -1 });
});

test('C299: mesa junk (red_sand / terracotta) is discarded in full', () => {
    const p = byName(buildDiscardPlan(inv([['red_sand', 64], ['orange_terracotta', 32]])).plan);
    assert.equal(p.red_sand, -1);
    assert.equal(p.orange_terracotta, -1);
});

test('T-0055/C321: over-hoarded bulk is trimmed to its KEEP-cap, not dumped', () => {
    // live: 377 cobble + 157 coal + 107 sandstone + 60 dirt filled the bag.
    const p = byName(buildDiscardPlan(inv([['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 57],
        ['coal', 64], ['coal', 64], ['coal', 29], ['dirt', 60]])).plan);
    assert.equal(p.cobblestone, 377 - 128);
    assert.equal(p.coal, 157 - 64);
    assert.equal(p.dirt, undefined, 'dirt under its cap (sapling planting / filler) is kept');
});

test('KEEP-set is never planned: tools, food, wood, saplings, iron, seeds', () => {
    const keep = [['iron_pickaxe', 1], ['cooked_beef', 12], ['oak_log', 20], ['oak_sapling', 6], ['raw_iron', 30], ['iron_ingot', 10], ['wheat_seeds', 40], ['stick', 30], ['crafting_table', 1]];
    assert.deepEqual(buildDiscardPlan(inv(keep)).plan, []);
});
