import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { openSkyAbove } from '../bots/_supervisor/skills/mineDown.js';

// Live 10-09 22:58:00/02/03 @-8,69,-7 (surface y69, daytime): a cave sits right under the surface — every heading's
// stair support was air and planVoidHop found no 3-solid column within 4b → three START-then-DONE dispatches →
// GO_UNDERGROUND cooled 5min. The fluid branch (T-0162) had a relocate escape; the void branch did not.
const k = (x, y, z) => `${x},${y},${z}`;
const world = (solid) => (x, y, z) => solid.has(k(x, y, z)) ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' };

test('T-0183: open sky above the bot = surface (pathfinder relocation works there); a roof or canopy = not', () => {
    assert.equal(openSkyAbove(world(new Set()), -8, 69, -7), true);
    assert.equal(openSkyAbove(world(new Set([k(-8, 80, -7)])), -8, 69, -7), false, 'covered → underground rules');
    assert.equal(openSkyAbove(world(new Set([k(-8, 69 + 25, -7)])), -8, 69, -7), true, 'only the first 24 above count');
});

test('T-0183: the void branch relocates (tunnel, else surface pathfinder) once per dispatch before giving up', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    const i = src.indexOf("log_(`void hop ${plan ? 'walk failed' : 'no safe column within 4b'} — abort`);");
    const j = src.indexOf("abort = `no floor support under", i);
    assert.ok(i > 0 && j > i);
    const seg = src.slice(i, j);
    assert.match(seg, /if \(loopRelocates < 1\) \{/);
    assert.match(seg, /const _tun = planRelocateTunnel\(bn, cx, cy, cz\);/);
    assert.match(seg, /else if \(openSkyAbove\(bn, cx, cy, cz\) \|\| \(bot\._mobility && bot\._mobility\.enclosed === false\)\) \{/);
    assert.match(seg, /await skills\.goToPosition\(bot, _dest\.x, _dest\.y, _dest\.z, 1\)/);   // ★23:06 re-fix: aim at a solid column
    assert.match(seg, /voidHops = 0; noProg = 0;\s*\r?\n\s*continue;/);
});
