import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';
import surfaceUp from '../bots/_supervisor/skills/surfaceUp.js';

// T-0038 / C281: surfaceUp treated the absolute targetY as a goal to pillar toward. In open desert at y67 with
// targetY=86 it built a free-standing 1-wide cobble spire to y86; the next skill's pathfinder walked off the top →
// fatal fall. With real open sky overhead the bot is ALREADY surfaced — targetY is only a ceiling.

function makeBot({ y = 67, roofAt = null, inv = [['cobblestone', 64]] } = {}) {
    const calls = { place: 0, pillar: 0, goto: 0 };
    const items = inv.map(([name, count]) => ({ name, count }));
    const bot = {
        entity: { position: new Vec3(0.5, y, 0.5), onGround: true },
        inventory: { items: () => items },
        heldItem: null,
        food: 20, health: 20,
        interrupt_code: false,
        blockAt: (p) => {
            if (p.y < y) return { name: 'sand', boundingBox: 'block', position: p };
            if (roofAt != null && p.y === roofAt) return { name: 'stone', boundingBox: 'block', position: p };
            return { name: 'air', boundingBox: 'empty', position: p };
        },
        pathfinder: { stop() {}, setGoal() {}, setMovements() {} },
        clearControlStates() {}, setControlState() {},
        modes: { isOn: () => false, setOn() {}, exists: () => false },
    };
    const counts = Object.fromEntries(inv);
    const ctx = {
        world: { getInventoryCounts: () => counts },
        mc: {}, Vec3, log: () => {},
        skills: {
            wait: async () => {},
            placeBlock: async () => { calls.place++; return true; },
            pillarUp: async () => { calls.pillar++; return true; },
            goToPosition: async () => { calls.goto++; return true; },
        },
    };
    return { bot, ctx, calls };
}

test('T-0038/C281: open sky overhead at y67 with targetY=86 → already surfaced, no spire', async () => {
    const { bot, ctx, calls } = makeBot();
    assert.equal(await surfaceUp(bot, ctx, 86), true);
    assert.deepEqual(calls, { place: 0, pillar: 0, goto: 0 });
});

test('C226-D: a relative target from a mountain top (y118+18) is capped at the surface ceiling → no runaway pillar', async () => {
    const { bot, ctx, calls } = makeBot({ y: 118, roofAt: 138 });   // overhang 20 up: openAbove(8) yes, open sky no
    assert.equal(await surfaceUp(bot, ctx, 136), true);
    assert.equal(calls.pillar + calls.place, 0);
});
