import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Vec3 from 'vec3';
import { pickOreHeading, cardinalToward } from '../bots/_supervisor/skills/branchMine.js';

// T-0094: at the iron band branchMine tunnelled along whatever yaw the bot happened to face (blind) and its
// ore scan only saw a 5-block bubble (getNearestBlocks arg order bug) → walked past exposed iron, yield≈0.

const ME = new Vec3(0, 14, 0);
const ore = (name, x, y, z) => ({ name, position: new Vec3(x, y, z) });

test('T-0094: tunnel heads toward the nearest REACHABLE ore (cardinal), skipping unreachable / directly-overhead ones', async () => {
    const pool = [ore('iron_ore', 0, 18, 0), ore('iron_ore', -2, 14, 9), ore('iron_ore', 5, 14, 1)];
    const reachable = async (b) => b.position.x !== 5;            // the nearest lateral one sits across a gap
    const h = await pickOreHeading(ME, ME, pool, reachable);
    assert.deepEqual([h.dx, h.dz], [0, 1]);
    assert.match(h.src, /iron_ore@-2,14,9/);
});

test('T-0094: nothing reachable → null (caller keeps the yaw heading)', async () => {
    assert.equal(await pickOreHeading(ME, ME, [ore('iron_ore', 4, 14, 0)], async () => false), null);
    assert.deepEqual(cardinalToward(ME, new Vec3(-7, 14, 3)), { dx: -1, dz: 0 });
});

test('T-0094 scan-radius: every branchMine ore scan uses DISTANCE>=16 (getNearestBlocks is (bot, types, distance, count))', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const src = fs.readFileSync(path.join(root, 'bots', '_supervisor', 'skills', 'branchMine.js'), 'utf8');
    const calls = [...src.matchAll(/getNearestBlocks(?:Async)?\(bot,\s*[\w ?:]+,\s*(\d+),\s*(\d+)\)/g)];
    assert.ok(calls.length >= 2);
    for (const c of calls) assert.ok(Number(c[1]) >= 16, `scan distance ${c[1]} in: ${c[0]}`);
});
