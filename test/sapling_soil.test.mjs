import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';
import { nearestReachableSoil } from '../bots/_supervisor/skills/chopWood.js';

// T-0030 / C300: on a badlands plateau (red_sand / terracotta surface) with 0 dirt carried, no spot ever qualified to
// plant a sapling → camped a treeless plateau forever. Harvest the nearest reachable soil block first.

const ME = new Vec3(0, 64, 0);
const EYE = new Vec3(0.5, 65.6, 0.5);
const world = (soil = {}) => (p) => {
    const k = `${p.x},${p.y},${p.z}`;
    if (soil[k]) return { name: soil[k], position: p };
    return { name: p.y < 64 ? 'red_sand' : 'air', position: p };
};

test('T-0030/C300: mesa with one grass block in reach → that block is the soil to harvest', () => {
    const { best } = nearestReachableSoil(world({ '2,63,1': 'grass_block', '4,63,4': 'dirt' }), ME, EYE);
    assert.equal(best.name, 'grass_block');
    assert.deepEqual([best.position.x, best.position.y, best.position.z], [2, 63, 1]);
});

test('T-0030: pure mesa (red_sand / terracotta only) → null, caller relocates; soil out of reach is ignored', () => {
    assert.equal(nearestReachableSoil(world({ '1,63,0': 'orange_terracotta' }), ME, EYE).best, null);
    assert.equal(nearestReachableSoil(world({ '4,61,4': 'dirt' }), ME, EYE).best, null, 'eye distance > 4.6');
});
