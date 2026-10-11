import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as owner from '../src/agent/framework/night_owner.js';

// T-0274 (10-11 06:06:40-06:08:56, hp1/food0 at night on the surface): the commitment flipped FOOD_FLOOR → NIGHT_DIG_ONE,
// which ended famineBodyFreeze's FOOD_FLOOR bypass. From then on self_preservation called setGoal(null)/stop()/
// clearControlStates() every tick while nightShelter tried to dig in — 2m16s for 2 blocks, until bunkerDown sealed it in 7s.
// At food 0 a freeze saves no hunger (it is already 0) — it must never pin a shelter-building action.

test('T-0274: a shelter action owns the body (nightShelter skill, NIGHT_DIG_ONE / NIGHT_SEAL commitment)', () => {
    assert.equal(typeof owner.shelterOwnsBody, 'function', 'night_owner must export shelterOwnsBody');
    assert.equal(owner.shelterOwnsBody({ skill: 'nightShelter' }), true);
    assert.equal(owner.shelterOwnsBody({ skill: 'kernelDriver', commitmentKind: 'NIGHT_DIG_ONE' }), true);
    assert.equal(owner.shelterOwnsBody({ skill: 'kernelDriver', commitmentKind: 'NIGHT_SEAL' }), true);
});

test('T-0274: non-shelter work is still frozen at food 0 (no blanket night exemption)', () => {
    assert.equal(owner.shelterOwnsBody({ skill: 'chopWood', commitmentKind: 'REPLENISH_KIT' }), false);
    assert.equal(owner.shelterOwnsBody({ skill: 'branchMine', commitmentKind: 'DUSK_MINE_NIGHT' }), false);
    assert.equal(owner.shelterOwnsBody({}), false);
});

test('T-0274: famineBodyFreeze yields to a shelter action before it clears the controls', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('function famineBodyFreeze'), src.indexOf('function famineForageActive'));
    const gate = fn.search(/if \(shelterOwnsBody\(\{ skill, commitmentKind: bot\._commitment && bot\._commitment\.kind \}\)\) return false;/);
    assert.ok(gate > 0, 'famineBodyFreeze must consult shelterOwnsBody');
    assert.ok(gate < fn.indexOf('bot.clearControlStates()'), 'the shelter check comes before the body is pinned');
});
