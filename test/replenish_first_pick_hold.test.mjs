import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { holdWoodForFirstPick, FIRST_PICK_PLANKS_EQ } from '../bots/_supervisor/skills/replenishKit.js';

// T-0271 (监工加急, 一阶停滞 05:44:58Z): zero picks, 1 spruce_log → '③ planks 0→4' → '③.5 口袋台 0→1' → '④ break — 棍造不出'.
// The one log became a table and the first pick still lacked 5 planks; ③.5 ignored the first-pick rule (zero picks and
// planksEq < FIRST_PICK_PLANKS_EQ → chop first, don't spend wood). Same rule now gates the pocket table and the bed.
test('T-0271: zero picks and wood below the first-pick floor → hold the wood (no table, no bed yet)', () => {
    assert.equal(holdWoodForFirstPick({ picks: 0, planksEq: 4 }), true);
    assert.equal(holdWoodForFirstPick({ picks: 0, planksEq: FIRST_PICK_PLANKS_EQ - 1 }), true);
    assert.equal(holdWoodForFirstPick({ picks: 0, planksEq: FIRST_PICK_PLANKS_EQ }), false, 'enough for table+sticks+pick');
    assert.equal(holdWoodForFirstPick({ picks: 1, planksEq: 4 }), false, 'already has a pick');
});

test('T-0271: replenishKit ③.5 table and bed are gated by it', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/replenishKit.js', import.meta.url), 'utf8');
    assert.match(src, /cnt\('crafting_table'\) < 1 && planksHeld\(\) >= 4 && !holdWoodForFirstPick\(\{ picks: picks\(\), planksEq: planksEq\(\) \}\)( && !\(picks\(\) === 0 && tableNear\(\)\))?\) \{/);
    assert.match(src, /!bot\.inventory\.items\(\)\.some\(i => \/_bed\$\/\.test\(i\.name \|\| ''\)\) && !holdWoodForFirstPick\(\{ picks: picks\(\), planksEq: planksEq\(\) \}\)\) \{/);
});
