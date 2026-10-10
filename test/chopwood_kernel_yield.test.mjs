import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Live 10-10 00:26:03→00:26:34: 'commitment flipped REPLENISH_KIT→TOOL_UPKEEP mid-child → interrupt replenishKit' ×32 —
// replenishKit step ② chopWood kept iterating (iter5..iter9: dig-staircase, raw-approach) until it ran out of trees.
// chopWood's per-iter yield point (_superseded) only knew its generation/poison; fold in the kernel flip stamp (T-0181).
test('T-0197: chopWood yields at the next iteration once the kernel flips the commitment', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/chopWood.js', import.meta.url), 'utf8');
    assert.match(src, /import \{ kernelYieldRequested \} from '\.\/surfaceUp\.js';/);
    assert.match(src, /const _cwEnteredAt = Date\.now\(\);/);
    assert.match(src, /const _superseded = \(\) => \{ try \{ return !!bot\._poisoned \|\| bot\._chopGen !== _gen \|\| kernelYieldRequested\(bot, _cwEnteredAt\); \} catch \(e\) \{ return false; \} \};/);
});
