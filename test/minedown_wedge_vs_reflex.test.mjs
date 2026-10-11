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

test('T-0267 + T-0282: bounded — past REFLEX_STEP_WAITS_MAX reflex holds the dispatch yields (reflex-exhausted), not a wedge', () => {
    // ★T-0282 (监工): 原先等满后算楔死 → wedge-final moveAway 8b + 记楔死朝向 (06:46-06:52Z sealed night hold 整夜如此)
    assert.equal(stepOutcome({ descended: false, movedHoriz: false, gateBlocked: true, reflexWaits: REFLEX_STEP_WAITS_MAX }), 'reflex-exhausted');
    assert.equal(stepOutcome({ descended: false, movedHoriz: false, gateBlocked: false, reflexWaits: REFLEX_STEP_WAITS_MAX }), 'wedge', 'not gate-blocked → still a real wedge');
});

test('T-0282: reflex-exhausted 让位退出 — 不进楔死恢复链 (不 moveAway/不记朝向), 返回失败+reflexHeld 交 kernel 的 T-0241 被拒式计数', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    const i = src.indexOf("if (_so === 'reflex-exhausted') {");
    const j = src.indexOf("if (_so === 'wedge') noProg++");
    assert.ok(i > 0 && j > i, 'reflex-exhausted is handled before the wedge/noProg chain');
    assert.match(src.slice(i, j), /reflexYield = true;[\s\S]*break;/);
    assert.ok(src.includes('if (reflexYield) r.reflexHeld = true;'));
});

test('T-0267: mineDown snapshots gate refusals around the walk and waits for the reflex instead of counting noProg', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /const _gateBeforeWalk = reflexGateRefusals\(bot\);/);
    assert.match(src, /const _so = stepOutcome\(\{ descended: stepDescended, movedHoriz: stepMovedHoriz, gateBlocked: reflexGateRefusals\(bot\) > _gateBeforeWalk, reflexWaits \}\);/);
    assert.match(src, /if \(_so === 'reflex'\) \{/);
    assert.match(src, /from '\.\.\/\.\.\/\.\.\/src\/agent\/framework\/reflex_body_gate\.js'/);
});

test('T-0267: the bound is live — mineDown counts each reflex hold before re-taking the step (else a stuck reflex waits forever)', () => {
    // worker-tests mutation 10-11: dropping `reflexWaits++` kept every other T-0267 pin green, yet stepOutcome then sees
    // reflexWaits=0 forever → a reflex that never lets go re-takes the same step every 4s with no wedge, no fail.
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    const branch = /if \(_so === 'reflex'\) \{([\s\S]*?)\n\s*continue;/.exec(src);
    assert.ok(branch, 'reflex branch ends in continue');
    assert.match(branch[1], /\breflexWaits\+\+|\breflexWaits \+= 1\b|\+\+reflexWaits\b/);
    assert.match(src, /let reflexWaits = 0;/, 'per-dispatch counter, reset each run');
});
