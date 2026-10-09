import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';
import { oreLineBuried } from '../src/agent/library/skills.js';
import { xrayTrunkSkip } from '../bots/_supervisor/skills/chopWood.js';

// "非人类"够取 family: T-0035 (x-ray ore across a ravine / behind a wall) and T-0064 (chopping a trunk
// through the leaf canopy). The bot may DIG a path toward buried ore; it may never reach across open air.

// World: stone everywhere, except listed air columns (x range at y 60..70) / lava cells.
function worldBot({ airX = [], lava = [] } = {}) {
    const lavaSet = new Set(lava.map(v => v.toString()));
    return {
        blockAt: (p) => {
            if (lavaSet.has(p.toString())) return { name: 'lava', boundingBox: 'empty' };
            if (airX.includes(p.x) && p.y >= 60 && p.y <= 70) return { name: 'air', boundingBox: 'empty' };
            if (p.y > 70) return { name: 'air', boundingBox: 'empty' };
            return { name: 'stone', boundingBox: 'block' };
        },
    };
}
const EYE = new Vec3(0.5, 65.62, 0.5);
const at = (x, y, z) => new Vec3(x + 0.5, y + 0.5, z + 0.5);

test('T-0035/C304-V: ore buried in solid stone 8b away → reachable (tunnel to it, not x-ray)', () => {
    const r = oreLineBuried(worldBot({ airX: [0] }), EYE, at(8, 65, 0), 8);
    assert.equal(r.ok, true, r.why);
});

test('T-0035/C304: ore across a ravine (open air run on a flat line) → x-ray, reject', () => {
    // 用户实拍: 站墙头挖对面铜矿 — x=3..6 is a ravine between the bot and the ore wall.
    const r = oreLineBuried(worldBot({ airX: [0, 3, 4, 5, 6] }), EYE, at(8, 65, 0), 8);
    assert.equal(r.ok, false, r.why);
});

test('C304-W: steep line through shaft air (ore high on the shaft wall) is stair-carvable → reachable', () => {
    // iron@ head-height+10 in a mine shaft: the air between is a column, not a horizontal gap.
    const b = { blockAt: (p) => (p.x === 0 && p.z === 0 ? { name: 'air', boundingBox: 'empty' } : { name: 'stone', boundingBox: 'block' }) };
    const r = oreLineBuried(b, EYE, at(1, 76, 0), 10.6);
    assert.equal(r.ok, true, r.why);
});

test('C304-W: lava on the line → reject even when steep; beyond 24b → reject', () => {
    const r = oreLineBuried(worldBot({ airX: [0], lava: [new Vec3(4, 65, 0)] }), EYE, at(8, 65, 0), 8);
    assert.equal(r.ok, false);
    assert.match(r.why, /lava/);
    assert.equal(oreLineBuried(worldBot(), EYE, at(30, 65, 0), 30).ok, false);
});

test('T-0064/C339: a log beyond arm-adjacent that we cannot see (through leaves) is skipped; adjacent or visible is chopped', () => {
    assert.equal(xrayTrunkSkip(3.5, false), true);
    assert.equal(xrayTrunkSkip(3.5, true), false);
    assert.equal(xrayTrunkSkip(1.8, false), false, 'adjacent trunk passes even if canSeeBlock flickers');
});
