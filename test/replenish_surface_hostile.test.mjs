import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { surfaceUpHostileGate } from '../bots/_supervisor/skills/replenishKit.js';

// death #18 10-10 02:37:11→32: replenishKit START 'y=33 onSurface=false night=false hostiles16=2' → ① surfaceUp anyway
// (the skip gate required NIGHT) → zombies at 1.7/2.4b during the climb (dawn, undead not burnt yet) → dead.
const noWait = async () => {};

test('T-0212: hostiles near → wait for them to clear, then climb', async () => {
    const seq = [2, 2, 1, 0];
    const g = await surfaceUpHostileGate({ hostilesNear: () => seq.shift() ?? 0, wait: noWait, maxWaitMs: 15000, stepMs: 1000 });
    assert.equal(g.ok, true);
});

test('T-0212: still hostile after the wait budget → do not climb (day or night)', async () => {
    const g = await surfaceUpHostileGate({ hostilesNear: () => 2, wait: noWait, maxWaitMs: 3000, stepMs: 1000 });
    assert.equal(g.ok, false);
    assert.equal(g.hostiles, 2);
});

test('T-0212: no hostiles → climb immediately', async () => {
    assert.equal((await surfaceUpHostileGate({ hostilesNear: () => 0, wait: noWait })).ok, true);
});

test('T-0212: replenishKit ① no longer gates the climb on night', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/replenishKit.js', import.meta.url), 'utf8');
    assert.match(src, /const _upGate = await surfaceUpHostileGate\(/);
    assert.match(src, /if \(!onSurface\(\) && _upClear\) \{/);
    assert.doesNotMatch(src, /if \(!onSurface\(\) && !\(isNight\(\) && hostilesNear\(16\) > 0\)\) \{/);
});
