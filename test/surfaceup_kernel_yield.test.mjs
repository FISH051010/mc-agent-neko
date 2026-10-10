import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { kernelYieldRequested, KERNEL_FLIP_FRESH_MS } from '../bots/_supervisor/skills/surfaceUp.js';

// Live 10-09 22:46:37→22:47:58: kernel flipped REPLENISH_KIT→DUSK_MINE_NIGHT mid-child ×81 while replenishKit's
// surfaceUp kept clearing interrupt_code (its shield against reflex pulses) → it climbed y39→54 for 81s, then the kernel
// immediately sent mineDown back down. A commitment flip is the caller saying "stop now", not a reflex pulse.
test('T-0181: a fresh kernel commitment flip after this climb started requests a yield', () => {
    const entered = 1_000_000;
    assert.equal(kernelYieldRequested({ _commitFlipAt: entered + 5000 }, entered, entered + 5500), true);
    assert.equal(kernelYieldRequested({ _commitFlipAt: entered - 100 }, entered, entered + 50), false, 'flip from before this climb is stale');
    assert.equal(kernelYieldRequested({ _commitFlipAt: entered + 5000 }, entered, entered + 5000 + KERNEL_FLIP_FRESH_MS + 1), false, 'stale flip');
    assert.equal(kernelYieldRequested({}, entered, entered + 10), false, 'no flip → reflex pulses still shielded');
});

test('T-0181: wiring — kernelDriver stamps the flip; surfaceUp loops exit on it via deadlineHit', () => {
    const kd = fs.readFileSync(new URL('../bots/_supervisor/skills/kernelDriver.js', import.meta.url), 'utf8');
    assert.match(kd, /bot\._commitFlipAt = Date\.now\(\);[^\n]*\r?\n\s*bot\.interrupt_code = true;/);
    const su = fs.readFileSync(new URL('../bots/_supervisor/skills/surfaceUp.js', import.meta.url), 'utf8');
    assert.match(su, /const deadlineHit = \(\) => !!\(deadlineAt && Date\.now\(\) >= deadlineAt\) \|\| kernelYieldRequested\(bot, enteredAtSU\)[^\n]*;/);
});
