import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { stepOutcome, REFLEX_STEP_WAITS_MAX } from '../bots/_supervisor/skills/mineDown.js';

// Live 10-11 05:18:42-58Z @75,66,166: '[body-gate] skill mineDown setControlState(forward) refused — mode:item_collecting holds the
// body (T-0231)' (mineDown's own ore sweep drops items → item_collecting picks them up) → the step made no progress → noProg → the
// wedge chain blamed a ghost block: 'ghost-buster: resync cleared=0 fwdOpen=true' ×2, both recoveries burned on nothing. Same
// shape 05:07:55-05:08:03 (self_preservation held the body → 'wedge x4 at same spot' honest fail). A borrowed body isn't a wedge:
// wait for the reflex to let go and take the step again.
test('T-0267: a step that moved is progress; a still step during a gate refusal is a reflex hold; otherwise a wedge', () => {
    assert.equal(stepOutcome({ descended: true, movedHoriz: false, gateBlocked: true, reflexWaits: 0 }), 'progress');
    assert.equal(stepOutcome({ descended: false, movedHoriz: true, gateBlocked: false, reflexWaits: 0 }), 'progress');
    assert.equal(stepOutcome({ descended: false, movedHoriz: false, gateBlocked: true, reflexWaits: 0 }), 'reflex');
    assert.equal(stepOutcome({ descended: false, movedHoriz: false, gateBlocked: false, reflexWaits: 0 }), 'wedge');
});

test('T-0267: bounded — past REFLEX_STEP_WAITS_MAX reflex holds in one dispatch a still step counts as a wedge again', () => {
    assert.equal(stepOutcome({ descended: false, movedHoriz: false, gateBlocked: true, reflexWaits: REFLEX_STEP_WAITS_MAX }), 'wedge');
});

test('T-0267: mineDown snapshots gate refusals around the walk and waits for the reflex instead of counting noProg', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /const _gateBeforeWalk = reflexGateRefusals\(bot\);/);
    assert.match(src, /const _so = stepOutcome\(\{ descended: stepDescended, movedHoriz: stepMovedHoriz, gateBlocked: reflexGateRefusals\(bot\) > _gateBeforeWalk, reflexWaits \}\);/);
    assert.match(src, /if \(_so === 'reflex'\) \{/);
    assert.match(src, /from '\.\.\/\.\.\/\.\.\/src\/agent\/framework\/reflex_body_gate\.js'/);
});
