import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Vec3 from 'vec3';
import { shooterToCover } from '../bots/_supervisor/skills/mineDown.js';

// death #22 10-10 04:51:25 (dusk, y14): mineDown logged 'hostile-steer: skeleton @9.0b / @8.0b — 拐向背离怪' and kept
// digging down into branch-mining; the skeleton followed and shot it at 4.6b. Turning the stair away does nothing
// against a shooter that SEES you — block the line of sight (or stop and let the reflexes fight).
const k = (x, y, z) => `${x},${y},${z}`;
function mkBot(walls = []) {
    const W = new Set(walls.map(p => k(...p)));
    return {
        entity: { position: new Vec3(0.5, 14, 0.5), height: 1.8 },
        entities: {},
        blockAt: (p) => W.has(k(p.x, p.y, p.z)) ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' },
    };
}
const mob = (name, x, y, z) => ({ name, type: 'hostile', position: new Vec3(x, y, z), height: 1.95 });

test('T-0225: a skeleton in view within 10b must be covered', () => {
    const bot = mkBot();
    bot.entities = { 1: mob('skeleton', 8.5, 14, 0.5) };
    const s = shooterToCover(bot, 10);
    assert.ok(s && s.name === 'skeleton');
});

test('T-0225: a skeleton behind a wall, a far skeleton, or a melee zombie does not trigger cover', () => {
    const wall = []; for (let y = 12; y <= 18; y++) for (let z = -3; z <= 3; z++) wall.push([4, y, z]);
    const bot = mkBot(wall);
    bot.entities = { 1: mob('skeleton', 8.5, 14, 0.5), 2: mob('skeleton', 20, 14, 0), 3: mob('zombie', 0.5, 14, 6.5) };
    assert.equal(shooterToCover(bot, 10), null);
});

test('T-0225: mineDown covers LOS each step and defers (not fails) when it cannot', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /const _shooter = shooterToCover\(bot, 10\);/);
    assert.match(src, /await skills\.coverFromShooter\(bot, _shooter, \{ tag: 'mineDown' \}\)/);
    assert.match(src, /deferredByShooter = true;/);
    assert.match(src, /if \(deferredByShooter\) r\.deferred = true;/);
    assert.match(src, /if \(!progressed && !r\.deferred\) r\.failed = true;/);
});
