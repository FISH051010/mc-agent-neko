import assert from 'node:assert/strict';
import test from 'node:test';
import { STONY, NO_PICK_BREACHABLE } from '../bots/_supervisor/skills/surfaceUp.js';

// T-0023 / C304-A: a pickless bot sealed under a red_sandstone roof (mesa: right below the red_sand) couldn't plan a
// bare-hand vertical breach — the sandstone family matched STONY ("stone" substring) but was missing from the
// hand-breakable set → verticalBlocked → the lateral / DEEP-DESCEND fallback drifted it DOWN (y60→54→49).

const SANDSTONES = ['sandstone', 'red_sandstone', 'smooth_sandstone', 'smooth_red_sandstone', 'cut_sandstone',
    'cut_red_sandstone', 'chiseled_sandstone', 'chiseled_red_sandstone'];

test('T-0023/C304-A: every sandstone variant is STONY (needs the no-pick plan) AND bare-hand breachable', () => {
    for (const n of SANDSTONES) {
        assert.ok(STONY.test(n), `${n} should hit the STONY branch`);
        assert.ok(NO_PICK_BREACHABLE.has(n), `${n} missing from NO_PICK_BREACHABLE → pickless bot drifts down under a mesa cap`);
    }
});

test('C304-A: the plain stone family stays breachable; obsidian (no bare-hand break in budget) never is', () => {
    for (const n of ['stone', 'cobblestone', 'deepslate', 'tuff', 'granite']) assert.ok(NO_PICK_BREACHABLE.has(n), n);
    assert.equal(NO_PICK_BREACHABLE.has('obsidian'), false);
});
