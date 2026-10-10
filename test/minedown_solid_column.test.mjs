import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { planSolidColumn, openSkyAbove } from '../bots/_supervisor/skills/mineDown.js';

// Live 10-09 23:06:07-12: the T-0183 surface relocate worked (pathfinder moveAway 10.1b) but landed on the SAME big
// cave roof (A -7,68,-17 ↔ B -8,69,-7), and at B a spruce canopy made openSkyAbove say "not under open sky" → no more
// relocation → GO_UNDERGROUND cooled a 3rd time; bot still wooden-pick 15min after respawn. A human walks to ground
// they can see is solid and starts the shaft there.
const k = (x, y, z) => `${x},${y},${z}`;
// surface at y=69 (ground blocks y<=68); a cave y=63..67 under x in [-14,2]; elsewhere solid down to y=50
function terrain({ leavesAt = [] } = {}) {
    const L = new Set(leavesAt.map(p => k(...p)));
    return (x, y, z) => {
        if (L.has(k(x, y, z))) return { name: 'spruce_leaves', boundingBox: 'block' };
        if (y >= 69) return { name: 'air', boundingBox: 'empty' };
        if (y >= 63 && y <= 67 && x >= -14 && x <= 2) return { name: 'cave_air', boundingBox: 'empty' };
        return { name: y === 68 ? 'grass_block' : 'stone', boundingBox: 'block' };
    };
}

test('T-0183: relocation target = nearest column with 5 solid blocks under the feet, outside the cave footprint', () => {
    const dest = planSolidColumn(terrain(), -8, 69, -7);
    assert.ok(dest, 'found');
    assert.ok(dest.x > 2 || dest.x < -14, `not over the cave: ${dest.x}`);
    assert.equal(dest.y, 69);
    const d = Math.hypot(dest.x + 8, dest.z + 7);
    assert.ok(d >= 6 && d <= 24, `distance ${d}`);
});

test('T-0183: no solid column in range → null (honest fail)', () => {
    const allCave = (x, y, z) => (y >= 69 ? { name: 'air', boundingBox: 'empty' } : y >= 63 ? { name: 'cave_air', boundingBox: 'empty' } : { name: 'stone', boundingBox: 'block' });
    assert.equal(planSolidColumn(allCave, -8, 69, -7), null);
});

test('T-0183: a tree canopy is not a roof — leaves/logs above still count as open sky', () => {
    assert.equal(openSkyAbove(terrain({ leavesAt: [[-8, 75, -7], [-8, 76, -7]] }), -8, 69, -7), true);
});

test('T-0183: surface void relocate walks to the planned solid column (not a random moveAway)', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /let dest = planSolidColumn\(bn, cx, cy, cz, skip\);/);   // inside relocateFallback (T-0193)
    assert.match(src, /const ok = await goToColumn\(bot, skills, dest, /);
    assert.match(src, /openSkyAbove\(bn, cx, cy, cz\) \|\| \(bot\._mobility && bot\._mobility\.enclosed === false\)/);
});
