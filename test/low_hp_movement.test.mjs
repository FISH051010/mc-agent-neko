import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { lowHpMovementProfile, LOW_HP_MOVE } from '../src/agent/framework/mobility_signals.js';
import { installLowHpClamp } from '../src/agent/library/skills.js';

// Death #6 10-10 20:03:31 fall @50,70,25: hp=1 (starving), mobility MAROONED march climbed the spruce canopy
// with forward+jump to y76.2 and missed the landing (~3.5 fall from the jump apex = lethal at hp1).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('T-0154: low-hp movement profile — no jumping, drops ≤1, no parkour at hp ≤ 6', () => {
    assert.deepEqual(lowHpMovementProfile(1), { low: true, allowJump: false, maxDropDown: 1, allowParkour: false });
    assert.equal(lowHpMovementProfile(LOW_HP_MOVE).low, true);
    assert.equal(lowHpMovementProfile(7).low, false);
    assert.equal(lowHpMovementProfile(undefined).low, false, 'unknown hp → normal');
});

test('T-0154: pathfinder movements are clamped by CURRENT hp at read time, even after callers override them', () => {
    const bot = { health: 20 };
    const m = installLowHpClamp({ maxDropDown: 3, allowParkour: true }, bot);
    assert.equal(m.maxDropDown, 3); assert.equal(m.allowParkour, true);
    m.maxDropDown = 8;                      // e.g. mineDown widening drops after construction
    assert.equal(m.maxDropDown, 8);
    bot.health = 1;                         // starving mid-walk
    assert.equal(m.maxDropDown, 1, 'every replan now caps drops at 1');
    assert.equal(m.allowParkour, false);
    bot.health = 18;                        // regen → caller's own values come back, no restore logic needed
    assert.equal(m.maxDropDown, 8); assert.equal(m.allowParkour, true);
});

test('T-0154: wiring — every pf.Movements gets the clamp; MAROONED march holds at low hp', () => {
    const sk = fs.readFileSync(path.join(root, 'src/agent/library/skills.js'), 'utf8');
    assert.match(sk, /try \{ installLowHpClamp\(this, args\[0\]\); \} catch \(e\) \{\}/);
    const md = fs.readFileSync(path.join(root, 'src/agent/modes.js'), 'utf8');
    assert.match(md, /if \(!lowHpMovementProfile\(bot\.health\)\.allowJump\) \{\s*\n\s*try \{ bot\.clearControlStates\(\); \} catch \(e\) \{\}/);
});
