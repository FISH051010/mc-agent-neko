import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { dispatchProgressed } from '../bots/_supervisor/skills/mineDown.js';

// Live 10-10 00:26:42→00:27:38 NIGHT_STONE_BOOTSTRAP mineDown @y67: dug 23 blocks down to y64, wedged 3× on one spot →
// wedge-final moveAway climbed to y68 → "progress" = entryY-endY = -1 → failed:true → 3rd strike → 5-min cooldown,
// although the cobble the night bootstrap wanted was in the pack.
test('T-0198: cobble gained counts as progress; a true zero-change dispatch still fails', () => {
    assert.equal(dispatchProgressed({ wedgeFinal: true, entryY: 67, endY: 68, oreGain: 0, cobbleGain: 20 }), true);
    assert.equal(dispatchProgressed({ wedgeFinal: true, entryY: 67, endY: 68, oreGain: 0, cobbleGain: 2 }), false, 'a couple of ghost re-digs are not progress');
    assert.equal(dispatchProgressed({ wedgeFinal: false, entryY: 67, endY: 66, oreGain: 0, cobbleGain: 0 }), true, 'descended');
    assert.equal(dispatchProgressed({ wedgeFinal: true, entryY: 67, endY: 66, oreGain: 0, cobbleGain: 0 }), false, 'wedge-final needs ≥3 down');
    assert.equal(dispatchProgressed({ wedgeFinal: false, entryY: 67, endY: 67, oreGain: 1, cobbleGain: 0 }), true, 'ore');
});

test('T-0198: mineDown judges its return through dispatchProgressed with the cobble delta', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /const cobbleAtEntry = cobbleUnits\(\);/);
    assert.match(src, /const progressed = dispatchProgressed\(\{ wedgeFinal, entryY, endY: r\.endY, oreGain: oreUnits\(\) - oreUnitsAtEntry, cobbleGain: cobbleUnits\(\) - cobbleAtEntry \}\);/);
});
