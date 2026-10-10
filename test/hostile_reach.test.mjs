import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';
import { hostileActionable, hostileActionableNear } from '../src/agent/framework/hostile_reach.js';

// T-0222 (监工指派): 03:57→04:10+ the bot froze at 27,13,29 (y13, hp7 food6) — ONE underground skeleton with no line
// of sight to the bot (self_defense 'ranged-unreachable-trap') held every "hostile near → wait / skip" gate: replenishKit
// surfaceUp (hostiles16), quickMeal/exitPit (8b), GET_BED (16b). Gates counted raw hostiles. One predicate for all.
const k = (x, y, z) => `${x},${y},${z}`;
function mkBot(walls = []) {
    const W = new Set(walls.map(p => k(...p)));
    return {
        entity: { position: new Vec3(0.5, 13, 0.5), height: 1.8 },
        entities: {},
        blockAt: (p) => W.has(k(p.x, p.y, p.z)) ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' },
    };
}
const mob = (name, x, y, z) => ({ name, type: 'hostile', position: new Vec3(x, y, z), height: 1.95 });
const wallX = (x) => { const w = []; for (let y = 10; y <= 20; y++) for (let z = -6; z <= 6; z++) w.push([x, y, z]); return w; };

test('T-0222: a skeleton behind a wall (no line of sight) is NOT actionable', () => {
    const bot = mkBot(wallX(4));
    const sk = mob('skeleton', 8.5, 13, 0.5);
    bot.entities = { 1: sk };
    assert.equal(hostileActionable(bot, sk, 16), false);
    assert.equal(hostileActionableNear(bot, 16), 0);
});

test('T-0222: the same skeleton with line of sight IS actionable', () => {
    const bot = mkBot();
    const sk = mob('skeleton', 8.5, 13, 0.5);
    bot.entities = { 1: sk };
    assert.equal(hostileActionableNear(bot, 16), 1);
});

test('T-0222: a melee zombie on our level in view counts; one 8 blocks above without reach does not', () => {
    const bot = mkBot();
    bot.entities = { 1: mob('zombie', 6.5, 13, 0.5), 2: mob('zombie', 3.5, 21, 0.5) };
    assert.equal(hostileActionableNear(bot, 16), 1);
});

test('T-0222: anything within 3 blocks counts even through a wall (it will be on us)', () => {
    const bot = mkBot(wallX(2));
    const z = mob('zombie', 3.0, 13, 0.5);
    bot.entities = { 1: z };
    assert.equal(hostileActionable(bot, z, 16), true);
});

test('T-0222: passive mobs and out-of-range hostiles never count', () => {
    const bot = mkBot();
    bot.entities = { 1: { name: 'cow', type: 'animal', position: new Vec3(2, 13, 0) }, 2: mob('zombie', 30, 13, 0) };
    assert.equal(hostileActionableNear(bot, 16), 0);
});

test('T-0222: the replenishKit surfaceUp gate is not held by a skeleton behind a wall', async () => {
    const { surfaceUpHostileGate } = await import('../bots/_supervisor/skills/replenishKit.js');
    const bot = mkBot(wallX(4));
    bot.entities = { 1: mob('skeleton', 8.5, 13, 0.5) };
    let waited = 0;
    const g = await surfaceUpHostileGate({ hostilesNear: () => hostileActionableNear(bot, 16), wait: async () => { waited++; } });
    assert.equal(g.ok, true);
    assert.equal(waited, 0, 'no waiting on an unreachable skeleton');
});

test('T-0222: every swapped gate and the world_model threat count use the shared predicate', async () => {
    const fs = await import('node:fs');
    const rd = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
    for (const f of ['replenishKit', 'setBed', 'bankGear', 'prepNether']) {
        const s = rd(`../bots/_supervisor/skills/${f}.js`);
        assert.match(s, /import \{ hostileActionableNear \} from '\.\.\/\.\.\/\.\.\/src\/agent\/framework\/hostile_reach\.js';/, f);
        assert.match(s, /const hostilesNear = \(r = \d+\) => hostileActionableNear\(bot, r\);/, f);
    }
    assert.match(rd('../src/agent/modes.js'), /if \(d < 12 && hostileActionable\(bot, e, 12\)\) actionable\+\+;/);
});
