import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Live 10-10 01:18:47/50/55 GO_UNDERGROUND @0,65,-14: T-0180 sealed a cavity breach with a hostile near on headings 0,1 /
// 1,0 / -1,0 — one heading per dispatch → three dug=1 failures → 5-min cooldown. Same shape as fluid (T-0162) and void
// (T-0183): keep the T-0180 seal/not-entering, but re-head inside this dispatch and relocate once if all four breach.
test('T-0203: after a T-0180 seal mineDown re-heads in-dispatch (≤3) and relocates once when every heading breaches', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /let fluidTurns = 0, loopRelocates = 0, cavityTurns = 0;/);
    const i = src.indexOf('★T-0203 (live 01:18:47-56');
    const j = src.indexOf("abort = `cavity breach + hostile ≤16b toward", i);
    assert.ok(i > 0 && j > i);
    const seg = src.slice(i, j);
    assert.match(seg, /const _rc = rotateAwayFromAborted\(bot\._mineDownFluidAvoid, bot\.entity\.position, sx, sz\);/);
    assert.match(seg, /if \(_rc\.rotated && cavityTurns < 3\) \{/);
    assert.match(seg, /if \(_rc\.exhausted && loopRelocates < 1\) \{/);
    assert.match(seg, /await relocateFallback\(bot, skills, bn, log_, 'every heading breaches a cavity with a hostile near'\)/);
});
