import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { rememberAbortedHeading, rotateAwayFromAborted } from '../bots/_supervisor/skills/mineDown.js';

// Live 10-10 03:11:01/03/06 @110,9,-71: branchMine aimed at iron_ore@109,10,-77 (heading 0,-1); tunnel-step 'clear-lava-near'
// → branchMine false in 1.2s (dug=0) ×3 dispatches, the same heading each time → DUSK_MINE_NIGHT cooled. T-0180 made
// branchMine READ the shared heading memory, but a fluid-blocked tunnel never WROTE it.
test('T-0216: a remembered fluid-blocked heading makes the next dispatch pick another cardinal', () => {
    const bot = { entity: { position: { x: 110, z: -71 } } };
    rememberAbortedHeading(bot, 0, -1, Date.now(), 'fluid');
    const r = rotateAwayFromAborted(bot._mineDownFluidAvoid, bot.entity.position, 0, -1);
    assert.equal(r.rotated, true);
    assert.notDeepEqual([r.sx, r.sz], [0, -1]);
});

test('T-0216: branchMine records the fluid-blocked heading and stops this tunnel', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/branchMine.js', import.meta.url), 'utf8');
    assert.match(src, /import \{ rotateAwayFromAborted, rememberAbortedHeading \} from '\.\/mineDown\.js';/);
    assert.match(src, /lastStepFail = r;/);
    assert.match(src, /if \(!ok && \/lava\|water\/\.test\(lastStepFail \|\| ''\)\) \{/);
    assert.match(src, /rememberAbortedHeading\(bot, dx, dz, Date\.now\(\), 'fluid'\);/);
});
