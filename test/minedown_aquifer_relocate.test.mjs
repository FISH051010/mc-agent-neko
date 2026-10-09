import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { rememberAbortedHeading, aquiferHere, AQUIFER_WET_HEADINGS } from '../bots/_supervisor/skills/mineDown.js';

// Death #10 10-09 22:04:16 drowning @32,38,-9: fluid turn 1/4, 2/4, 3/4 at 22:03:36-41 (water near on three sides),
// T-0162 then staircased down the 4th heading because ITS stair ring read dry — three steps later the aquifer broke
// in (SWIM 22:03:52 → ENTOMBED → drowned). Water on three sides = you are in an aquifer: a human leaves sideways,
// they don't descend the last direction.
const bot = { entity: { position: { x: 32, z: -5 } } };

test('T-0162: three distinct wet headings near here = aquifer; void/wedge aborts do not count', () => {
    const b = { entity: { position: { x: 32, z: -5 } } };
    const now = 1_000_000;
    rememberAbortedHeading(b, -1, 0, now, 'fluid');
    rememberAbortedHeading(b, 1, 0, now, 'fluid');
    rememberAbortedHeading(b, 0, 1, now, 'void');
    assert.equal(aquiferHere(b._mineDownFluidAvoid, b.entity.position, now), false, '2 wet + 1 void is not an aquifer');
    rememberAbortedHeading(b, 0, 1, now, 'fluid');
    assert.equal(AQUIFER_WET_HEADINGS, 3);
    assert.equal(aquiferHere(b._mineDownFluidAvoid, b.entity.position, now), true);
    assert.equal(aquiferHere(b._mineDownFluidAvoid, { x: 32 + 9, z: -5 }, now), false, '≥8 blocks away = fresh ground');
    rememberAbortedHeading(b, 1, 0, now, 'fluid');   // same heading twice still counts once
    assert.equal(aquiferHere(b._mineDownFluidAvoid.filter(a => !(a.sx === 0 && a.sz === 1)), b.entity.position, now), false);
});

test('T-0162: in-dispatch fluid abort tunnels out of an aquifer instead of descending the remaining heading', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /rememberAbortedHeading\(bot, sx, sz, Date\.now\(\), 'fluid'\);/);
    assert.match(src, /const _aq = aquiferHere\(bot\._mineDownFluidAvoid, bot\.entity\.position\);/);
    assert.match(src, /if \(_r\.rotated && fluidTurns < 4 && !_aq\) \{/);
    assert.match(src, /if \(\(_r\.exhausted \|\| _aq\) && loopRelocates < 1\) \{/);
});

test('T-0162: START also relocates (not rotates) when the remembered wet headings say aquifer', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /const _aqStart = aquiferHere\(bot\._mineDownFluidAvoid, p0\) && bot\.entity\.position\.y > targetY \+ 2;/);
    assert.match(src, /const clean = \(_rot\.rotated && !_aqStart\) \? \[_rot\.sx, _rot\.sz\] : null;/);
});
