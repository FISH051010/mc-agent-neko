import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Live 10-11 06:26:38→06:28:40Z dusk @-3,62,-62 (监工实时): mob=SWIM_STUCK next to a 1-high grass bank, [swim] looping 70+ rounds
// in a 2×3 patch; meanwhile edge_unstick logged 'wedged ~2450ms (jump-fail, replan #4…#24 +back-off relocate)' every 3-4s —
// it stands down for SWIM / POCKET / ENTOMBED but not SWIM_STUCK, so it read the swim reflex's jump as a wedge and dragged the
// bot back+sideways off the bank (T-0239 back-off) every few seconds. Water belongs to the swim reflex: stand down for any SWIM*.
test('T-0276: edge_unstick stands down for every SWIM* mobility state (SWIM_STUCK too)', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const i = src.indexOf("name: 'edge_unstick',");
    const j = src.indexOf("name: 'pf_dig_watchdog',", i);
    const seg = src.slice(i, j);
    assert.match(seg, /if \(\/\^SWIM\/\.test\(mob\) \|\| mob === 'POCKET' \|\| mob === 'ENTOMBED'\) \{ this\.wedgeStart = 0; this\.lastPos = null; releaseJump\(\); return; \}/);
    assert.doesNotMatch(seg, /if \(mob === 'SWIM' \|\| mob === 'POCKET'/);
});
