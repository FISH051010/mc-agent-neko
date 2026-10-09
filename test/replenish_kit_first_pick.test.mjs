import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldChopBeforeCrafting, FIRST_PICK_PLANKS_EQ } from '../bots/_supervisor/skills/replenishKit.js';

test('2026-10-09 replenishKit: pickless bot holding enough wood crafts its first pick before chopping more', () => {
  // live repro: 12 spruce logs (planksEq=50), picks=0, table=0 → it kept chopping toward 64.
  assert.equal(shouldChopBeforeCrafting({ picks: 0, planksEq: 50 }), false);
  assert.equal(shouldChopBeforeCrafting({ picks: 0, planksEq: FIRST_PICK_PLANKS_EQ }), false);
});

test('2026-10-09 replenishKit: pickless bot without enough wood for table+pick still chops', () => {
  assert.equal(shouldChopBeforeCrafting({ picks: 0, planksEq: FIRST_PICK_PLANKS_EQ - 1 }), true);
  assert.equal(shouldChopBeforeCrafting({ picks: 0, planksEq: 0 }), true);
});

test('2026-10-09 replenishKit: once a pick exists the 64-plank buffer target is unchanged', () => {
  assert.equal(shouldChopBeforeCrafting({ picks: 1, planksEq: 50 }), true);
  assert.equal(shouldChopBeforeCrafting({ picks: 2, planksEq: 64 }), false);
});
