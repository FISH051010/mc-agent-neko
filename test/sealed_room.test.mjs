import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';
import { detectSealedRoom } from '../src/agent/mobility_geom.js';

// T-0074 / C341: a bot walled into a 3x3x2 cobble room (interior air, every wall solid) was labeled FREE
// (adjacent walkable air counts as an "exit") → no escape reflex → trapped forever with an iron pickaxe.

// Build a world: everything solid stone except the listed air cells.
function world(airCells, { lava = [] } = {}) {
    const air = new Set(airCells.map(([x, y, z]) => `${x},${y},${z}`));
    const lavaSet = new Set(lava.map(([x, y, z]) => `${x},${y},${z}`));
    return (p) => {
        const k = `${p.x},${p.y},${p.z}`;
        if (lavaSet.has(k)) return { name: 'lava', boundingBox: 'empty' };
        return air.has(k) ? { name: 'air', boundingBox: 'empty' } : { name: 'cobblestone', boundingBox: 'block' };
    };
}
const room3x3x2 = () => { const c = []; for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let y = 64; y <= 65; y++) c.push([x, y, z]); return c; };
const bot = (blockAt) => ({ entity: { position: new Vec3(0.5, 64, 0.5) }, blockAt });

test('T-0074: 3x3x2 walled room → sealed (not FREE)', () => {
    const r = detectSealedRoom(bot(world(room3x3x2())));
    assert.equal(r.sealed, true);
    assert.equal(r.cells, 9);
});

test('T-0074: the same room with a 1-wide tunnel out to open space → not sealed', () => {
    const cells = room3x3x2();
    for (let x = 2; x <= 200; x++) { cells.push([x, 64, 0], [x, 65, 0]); }   // long corridor = reachable area > cap
    assert.equal(detectSealedRoom(bot(world(cells))).sealed, false);
});

test('T-0074: a chimney to the sky lets the flood escape → not sealed', () => {
    const cells = room3x3x2();
    for (let y = 66; y <= 260; y++) cells.push([0, y, 0]);
    // the chimney cell itself must be "standable" (feet+head air) all the way up
    assert.equal(detectSealedRoom(bot(world(cells))).sealed, false);
});

test('C341: lava cells are not walkable escape space; a head-solid start is not a room (ENTOMBED owns it)', () => {
    const cells = room3x3x2();
    for (let x = 2; x <= 200; x++) { cells.push([x, 64, 0], [x, 65, 0]); }   // open corridor... behind a lava cell
    assert.equal(detectSealedRoom(bot(world(cells, { lava: [[2, 64, 0]] }))).sealed, true, 'a lava "opening" is not a way out');
    assert.equal(detectSealedRoom(bot(world([[0, 64, 0]]))).sealed, false, 'feet air but head solid → not standable');
});
