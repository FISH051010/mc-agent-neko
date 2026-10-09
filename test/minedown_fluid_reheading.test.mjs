import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { rememberAbortedHeading, rotateAwayFromAborted } from '../bots/_supervisor/skills/mineDown.js';

// worker-tier + live 20:22:59: one heading per dispatch → three wet headings = three zero-dig dispatches =
// kernelDriver 3-strike cooldown, so the 4th heading and the T-0161 tunnel relocate never ran.
test('T-0162: within ONE dispatch, three wet headings still leave the 4th heading, then the tunnel relocate', () => {
    const bot = { entity: { position: { x: -39, z: 5 } } };
    let sx = 1, sz = 0;
    const tried = [];
    for (let i = 0; i < 4; i++) {
        tried.push(`${sx},${sz}`);
        rememberAbortedHeading(bot, sx, sz);                 // this heading hit fluid
        const r = rotateAwayFromAborted(bot._mineDownFluidAvoid, bot.entity.position, sx, sz);
        if (r.exhausted) { assert.equal(i, 3, 'only after all four are wet'); break; }
        assert.equal(r.rotated, true);
        sx = r.sx; sz = r.sz;
    }
    assert.equal(new Set(tried).size, 4, 'all four cardinals tried in-dispatch before giving up');
});

test('T-0162: mineDown re-heads / tunnels in-dispatch on a fluid abort instead of ending the dispatch', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /if \(_r\.rotated && fluidTurns < 4\) \{[\s\S]{0,300}sx = _r\.sx; sz = _r\.sz; noProg = 0;\s*\n\s*continue;/);
    assert.match(src, /if \(_r\.exhausted && loopRelocates < 1\) \{\s*\n\s*const _tun = planRelocateTunnel\(bn, cx, cy, cz\);/);
});
