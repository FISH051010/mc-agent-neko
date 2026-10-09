import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mobilityDigTimeoutMs, MOBILITY_DIG_TIMEOUT_CAP_MS } from '../src/agent/framework/mobility_signals.js';

// Live 10-10 03:12:24-35 ENTOMBED @-3,47,3 just out of SWIM, floating (act_trace g=0): 'dig retry … stone:
// dig-timeout' ×4 — guardedDig sized the timeout with block.digTime(heldType) (on ground, dry) while bot.dig
// really takes bot.digTime(block) (airborne ×5, in water ×5).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stone = { name: 'stone', digTime: (held, creative, inWater, notOnGround) => 1150 * (inWater ? 5 : 1) * (notOnGround ? 5 : 1) };
const mk = ({ onGround = true, isInWater = false, envAware = true } = {}) => ({
    entity: { onGround, isInWater }, heldItem: { type: 1 },
    digTime: envAware ? (b) => b.digTime(1, false, isInWater, !onGround) : undefined,
});

test('T-0143: the timeout tracks the real (environment-aware) dig time — airborne/in water is not cut short', () => {
    const ground = mobilityDigTimeoutMs(mk(), stone);
    const floating = mobilityDigTimeoutMs(mk({ onGround: false }), stone);
    assert.ok(floating >= 1150 * 5, `airborne stone takes ≥5.75s; timeout ${floating}ms must cover it`);
    assert.ok(floating > ground);
    assert.equal(mobilityDigTimeoutMs(mk({ onGround: false, isInWater: true }), stone), MOBILITY_DIG_TIMEOUT_CAP_MS, 'capped under the 45s burst deadline');
});

test('T-0143: without bot.digTime it still applies the water/airborne penalties itself', () => {
    assert.ok(mobilityDigTimeoutMs(mk({ onGround: false, envAware: false }), stone) >= 1150 * 5);
    assert.equal(mobilityDigTimeoutMs({ entity: {} }, { digTime: () => NaN }), 5000, 'unknown → old default');
});

test('T-0143: guardedDig sizes its dig timeout with mobilityDigTimeoutMs', () => {
    const src = fs.readFileSync(path.join(root, 'src/agent/modes.js'), 'utf8');
    assert.match(src, /const digMs = mobilityDigTimeoutMs\(bot, fresh\);/);
    assert.doesNotMatch(src, /const dt = fresh\.digTime\(ht\);/);
});
