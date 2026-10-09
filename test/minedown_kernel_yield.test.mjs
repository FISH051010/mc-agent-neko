import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Live 10-09 23:26:37→23:26:53: 'commitment flipped GET_IRON_ARMOR_SET→NIGHT_DIG_ONE mid-child → interrupt mineDown' ×17 —
// the staircase loop never looks at the kernel's request; it finished step 11 and a whole wedge-recovery chain (ghost
// re-dig ×3, blacklist, sidestep) first. Bare interrupt_code can't be used (reflex pulses set it too); the kernel's
// _commitFlipAt stamp (T-0181) is the caller's "stop".
test('T-0190: mineDown checks the kernel flip stamp at every step and before a wedge recovery', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /import \{ kernelYieldRequested \} from '\.\/surfaceUp\.js';/);
    assert.match(src, /const mdEnteredAt = Date\.now\(\);/);
    assert.match(src, /for \(let i = 0; i < steps; i\+\+\) \{\s*\r?\n\s*if \(kernelYieldRequested\(bot, mdEnteredAt\)\) \{ abort = 'kernel commitment flipped — yield \(T-0190\)'; break; \}/);
    assert.match(src, /const wedgeRecover = async \(fx, cy, fz\) => \{\s*\r?\n\s*if \(kernelYieldRequested\(bot, mdEnteredAt\)\) return 'kernel-flip';/);
});
