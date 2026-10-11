import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { tierPickCraftableHere, ironSmeltNeeded } from '../bots/_supervisor/skills/replenishKit.js';

// Live 10-11 02:59:52 → 03:03:26Z (worker-tier 核): REPLENISH_KIT was proposed for the iron-tier pick stock (iron镐=1/4, 1 ingot
// + 3 raw iron + fuel = one more pick, world_model pickPlanHasMat true). replenishKit ran ① surfaceUp first regardless of what
// was short (wood only needed the wide 64 top-up), the climb returned 0 gain ×3 → cooled; its ④-pre smelt gate wanted raw ≥3
// alone (decision side: ingot+raw ≥3) and ④ broke silently. A miner with ingots, fuel and a table just crafts the pick where
// they stand — the surface is for wood.
const c = (o) => o;

test('T-0247: iron-tier pick short, 1 ingot + 3 raw + coal + table + sticks → craftable here (no climb needed)', () => {
    assert.equal(tierPickCraftableHere(c({ iron_ingot: 1, raw_iron: 3, coal: 4, crafting_table: 1, stick: 7, oak_planks: 8 }), { bt: 3, effIron: 1, effDia: 0 }), true);
});

test('T-0247: same pick need but no fuel, or not enough iron → not craftable here', () => {
    assert.equal(tierPickCraftableHere(c({ iron_ingot: 1, raw_iron: 3, crafting_table: 1, stick: 7 }), { bt: 3, effIron: 1, effDia: 0 }), false);
    assert.equal(tierPickCraftableHere(c({ iron_ingot: 1, raw_iron: 1, coal: 4, crafting_table: 1, stick: 7 }), { bt: 3, effIron: 1, effDia: 0 }), false);
});

test('T-0247: no table and too few planks for one, or no sticks and no planks → not here', () => {
    assert.equal(tierPickCraftableHere(c({ iron_ingot: 3, stick: 2, oak_planks: 2 }), { bt: 3, effIron: 1, effDia: 0 }), false);
    assert.equal(tierPickCraftableHere(c({ iron_ingot: 3, crafting_table: 1 }), { bt: 3, effIron: 1, effDia: 0 }), false);
    assert.equal(tierPickCraftableHere(c({ iron_ingot: 3, crafting_table: 1, oak_planks: 2 }), { bt: 3, effIron: 1, effDia: 0 }), true, 'planks fold to sticks');
});

test('T-0247: diamond tier uses diamonds; tier already stocked → nothing to craft here', () => {
    assert.equal(tierPickCraftableHere(c({ diamond: 3, crafting_table: 1, stick: 2 }), { bt: 4, effIron: 0, effDia: 1 }), true);
    assert.equal(tierPickCraftableHere(c({ iron_ingot: 9, crafting_table: 1, stick: 9 }), { bt: 3, effIron: 4, effDia: 0 }), false);
});

test('T-0247: ④-pre smelt need uses the decision-side measure (ingot + raw ≥ 3, fuel), smelting only the shortfall', () => {
    assert.deepEqual(ironSmeltNeeded(c({ iron_ingot: 1, raw_iron: 3, coal: 1 })), { n: 2 });
    assert.equal(ironSmeltNeeded(c({ iron_ingot: 3, raw_iron: 3, coal: 1 })), null, 'enough ingots');
    assert.equal(ironSmeltNeeded(c({ iron_ingot: 1, raw_iron: 3 })), null, 'no fuel');
    assert.equal(ironSmeltNeeded(c({ iron_ingot: 0, raw_iron: 2, charcoal: 1 })), null, 'not enough iron');
});

test('T-0247: replenishKit skips the ① climb when the tier pick is craftable here and wood is above its trigger', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/replenishKit.js', import.meta.url), 'utf8');
    assert.match(src, /const _craftHere = !tierPickGoalMet\(\) && picks\(\) >= 3 && planksEq\(\) >= REPLENISH_WOOD_FLOOR\s*\n?\s*&& tierPickCraftableHere\(inv\(\), \{ bt: bestPickTier\(\), effIron: effIronPicksN\(\), effDia: effDiaPicksN\(\)(, ironTarget: [^}]+)? \}\);/);   // worker-tier passes IRON_PICK_TARGET here
    assert.match(src, /if \(!onSurface\(\) && _upClear && !_craftHere\) \{/);
    assert.match(src, /const _sm = ironSmeltNeeded\(inv\(\)\);/);
    assert.match(src, /④ skip — tier pick short but no material here/);
});
