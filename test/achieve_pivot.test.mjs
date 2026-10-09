import assert from 'node:assert/strict';
import test from 'node:test';
import { heldEquipEquivalent, preferredSwordGoal } from '../bots/_supervisor/skills/achieve.js';

// achieve "死守不可达目标不 pivot" family: T-0076 (iron_pickaxe with 0 iron), T-0077 (wooden_sword with no
// planks → husk death spike), generalised by T-0078 at achieve's single "NO KNOWN WAY" exit.

test('T-0076/T-0078: unbuildable iron_pickaxe but 14 stone picks in hand → advance with the stone pick', () => {
    // live: 揣14石镐+0raw_iron却死守iron_pickaxe→"NO KNOWN WAY"空转
    assert.equal(heldEquipEquivalent('iron_pickaxe', { stone_pickaxe: 14, cobblestone: 40 }), 'stone_pickaxe');
});

test('T-0078: the downgrade rule covers the whole tool/armor class, not one item', () => {
    assert.equal(heldEquipEquivalent('diamond_sword', { iron_sword: 1 }), 'iron_sword');
    assert.equal(heldEquipEquivalent('iron_chestplate', { leather_chestplate: 1 }), 'leather_chestplate');
    assert.equal(heldEquipEquivalent('iron_boots', { iron_helmet: 1 }), null, 'different armor slot is not an equivalent');
    assert.equal(heldEquipEquivalent('iron_pickaxe', { stone_pickaxe: 0 }), null, 'zero count is not held');
    assert.equal(heldEquipEquivalent('iron_ingot', { iron_nugget: 9 }), null, 'materials never pivot by equivalence');
    assert.equal(heldEquipEquivalent('stone_axe', { stone_pickaxe: 1 }), null, '_axe must not match _pickaxe');
});

test('T-0077/C343: with cobble on hand the sword pre-step asks for stone_sword (wooden needs planks we lack)', () => {
    // live 13:00-03: 7 deaths/10min ALL sword=null while holding 56 cobble + 3 stick.
    assert.equal(preferredSwordGoal({ cobblestone: 56, stick: 3 }), 'stone_sword');
    assert.equal(preferredSwordGoal({ oak_planks: 4 }), 'wooden_sword', 'truly naked early game keeps the wooden fallback');
});
