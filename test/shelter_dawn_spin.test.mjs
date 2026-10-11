import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { shelterDayAt } from '../bots/_supervisor/skills/nightShelter.js';

// Live 10-11 03:55:49→03:56:36Z @61,16,58 (dawn, tod ≈23300→24000): kernel dispatched nightShelter('seal') every 1.5s — 29×,
// each 'digOneCapOne: y=16 too low … downgrade to seal' → '封箱禁用 … 原地裸 hold' → the hold loop's isDayDirect (t>23000)
// already said "day" → return true at once → success, no strike, re-dispatch. world_model's phase (modes.js) is day <12000 ≤
// dusk <13000 ≤ night <23000 ≤ dawn: the decision layer still proposes the night plan at dawn and dusk, the skill's hold
// thought it was day in both bands (t<12800 covers dusk 12000-12800 too). One day line for both.
test('T-0254: shelter day = world_model phase day (tod < 12000); dusk and dawn are held', () => {
    assert.equal(shelterDayAt(1000), true);
    assert.equal(shelterDayAt(11999), true);
    assert.equal(shelterDayAt(12000), false, 'dusk');
    assert.equal(shelterDayAt(12500), false, 'dusk (old t<12800 said day)');
    assert.equal(shelterDayAt(18000), false, 'night');
    assert.equal(shelterDayAt(23300), false, 'dawn (old t>23000 said day — the live spin)');
    assert.equal(shelterDayAt(23999), false);
    assert.equal(shelterDayAt(24000 % 24000), true, 'wraps to day');
});

test('T-0254: the hold loop and the dawn unflag use shelterDayAt, not the 12800/23000 band', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/nightShelter.js', import.meta.url), 'utf8');
    assert.match(src, /const isDayDirect = \(\) => \{ try \{ return shelterDayAt\(bot\.time\.timeOfDay\); \} catch \(e\) \{ return isDay\(\); \} \};/);
    assert.doesNotMatch(src, /t < 12800 \|\| t > 23000/);
});
