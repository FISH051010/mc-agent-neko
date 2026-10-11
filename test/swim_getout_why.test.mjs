import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// T-0277 (10-11 06:37-06:38, day, 0 hostiles): six quickMeal scouts in a row were dragged ashore by the swim instinct's
// surface get-out ([swim] enter i=0 stall=0) — the [B] "follow the pathfinder across the water" yield did not hold, and
// the trace had no way to say which of its gates failed. Not reproducible offline (needs the live pathfinder state at
// the water edge); in-game fallback signal = this trace line. Pin it so the evidence can't silently disappear.
test('T-0277: the swim get-out trace records every [B] yield gate', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const line = src.split('\n').find(l => l.includes('_tr(`enter y=')) || '';
    for (const k of ['goto=${gotoActive}', 'pfMoving=${_pfMoving}', 'pfAgo=', 'mining=${miningActive}', 'drownDmg=${drowningDamage}', 'futile=${_jumpFutile}', 'crossing=${_swimCrossing}', 'skill=']) {
        assert.ok(line.includes(k), `[swim] enter trace must include ${k}`);
    }
});
