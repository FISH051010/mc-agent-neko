import assert from 'node:assert/strict';
import test from 'node:test';
import { shallowOreProbeStep } from '../bots/_supervisor/skills/achieve.js';

// C255 (2026-06-19 iron bottleneck): achieve's ore probe lumped iron with copper/coal "shallow ore" and hard-capped it
// to y48-68 (the COPPER band) — 150+ raw_copper, zero iron, "NO KNOWN WAY to obtain iron_ingot" forever; the
// "y<32 → surfaceUp to y48" rule even fled the iron-rich depth.

const st = (o = {}) => ({ vertical: 0, startY: 64, ...o });
const step = (blockName, y, s) => shallowOreProbeStep({ blockName, y, st: st(s) });

test('C255: iron from the surface → staircase DOWN to the iron band (y14), never capped to the copper band', () => {
    assert.deepEqual(step('iron_ore', 64), { action: 'lateral', why: 'iron-deep-descend', len: 24, targetY: 14 });
    assert.deepEqual(step('raw_iron', 40), { action: 'lateral', why: 'iron-deep-descend', len: 24, targetY: 14 });
});

test('C255: iron already deep (y<32) is mined in place — never surfaceUp to y48', () => {
    for (const y of [20, 14, 2, -10]) {
        const p = step('deepslate_iron_ore', y);
        assert.notEqual(p.action, 'surface', `y=${y}`);
        assert.equal(p.why, y > 22 ? 'iron-deep-descend' : 'iron-band');
    }
});

test('copper / coal keep the shallow bands (surface below y32, lateral y32-56, staircase from mountains)', () => {
    assert.deepEqual(step('copper_ore', 20), { action: 'surface', targetY: 48 });
    assert.equal(step('coal_ore', 50).why, 'at-shallow-band');
    assert.deepEqual(step('copper_ore', 80), { action: 'lateral', why: 'high-mountain-descend', len: 20, targetY: 48 });
    assert.equal(step('coal_ore', 66).why, 'vertical-budget');
    assert.deepEqual(step('coal_ore', 70), { action: 'down' }, 'bounded one-block probe');
    assert.equal(step('coal_ore', 70, { vertical: 5 }).why, 'vertical-budget');
});
