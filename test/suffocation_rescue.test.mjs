import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Vec3 from 'vec3';
import { digOutOfSuffocation, suffocationRescueActive, headSuffocating } from '../src/agent/library/skills.js';

// T-0268 (监工加急, death #55 10-11 05:30:43Z y-8 @113,-8,169 窒息, 丢 24 铁/1 钻/2 铁镐): gravel fell on the head at 05:30:35;
// reflex_watchdog 'SUFFOCATION self-rescue: head=gravel … dig out NOW' fired every 1.5s (one dig each, the column refilled the
// head), mobility (ENTOMBED) dug other cells at the same time ('dig retry … gravel@112,-6,169: Digging aborted' — two diggers
// cancelling each other) and at hp≤4 T-0131 refused every gravel dig ('gravity dig refused at hp=4/3/2 … pick another
// bearing'). 16 hp → dead in 8s. Suffocating = dig the head cell, again and again until it is air; nothing else digs meanwhile;
// no gravity gate applies.
const k = (p) => `${p.x},${p.y},${p.z}`;
function gravelWorld(feet, columnAbove = 2) {
    const M = new Map();
    for (let dy = 1; dy <= 1 + columnAbove; dy++) M.set(k(feet.offset(0, dy, 0)), 'gravel');
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, 2]) M.set(k(feet.offset(dx, dy, dz)), 'gravel');
    M.set(k(feet.offset(0, -1, 0)), 'stone');
    const blockAt = (p) => { const n = M.get(k(p.floored ? p.floored() : p)) || 'air'; return { name: n, position: p.floored ? p.floored() : p, boundingBox: n === 'air' ? 'empty' : 'block' }; };
    // digging the head lets the column above fall one cell
    const digAt = (p) => {
        const col = []; for (let y = p.y; y < p.y + 6; y++) col.push(M.get(k(new Vec3(p.x, y, p.z))) || 'air');
        col.shift(); col.push('air');
        for (let i = 0; i < col.length; i++) { const q = k(new Vec3(p.x, p.y + i, p.z)); if (col[i] === 'air') M.delete(q); else M.set(q, col[i]); }
    };
    return { M, blockAt, digAt };
}

test('T-0268: head gravel with 2 more above, gravel all around (no sidestep), hp 4 → dig the head until it is air', async () => {
    const feet = new Vec3(113, -8, 169);
    const w = gravelWorld(feet, 2);
    let digs = 0, stopped = 0;
    const bot = {
        health: 4, entity: { position: new Vec3(113.5, -8, 169.5) }, targetDigBlock: { name: 'gravel' },
        blockAt: w.blockAt,
        dig: async (b) => { digs++; w.digAt(b.position); },
        stopDigging() { stopped++; this.targetDigBlock = null; },
        tool: { equipForBlock: async () => {} },
    };
    assert.equal(headSuffocating(w.blockAt, feet), true);
    const r = await digOutOfSuffocation(bot, { settleMs: 0 });
    assert.equal(r.cleared, true);
    assert.equal(digs, 3, 'three gravel blocks fell through the head cell');
    assert.equal(stopped >= 1, true, 'a competing dig is stopped first');
    assert.equal(headSuffocating(w.blockAt, feet), false);
});

test('T-0268: while the rescue runs the gravity gates are exempt and other digs yield; it clears after', async () => {
    const feet = new Vec3(0, 60, 0);
    const w = gravelWorld(feet, 0);
    let activeDuringDig = null;
    const bot = { health: 6, entity: { position: new Vec3(0.5, 60, 0.5) }, blockAt: w.blockAt,
        dig: async (b) => { activeDuringDig = suffocationRescueActive(bot); w.digAt(b.position); }, stopDigging() {}, tool: { equipForBlock: async () => {} } };
    await digOutOfSuffocation(bot, { settleMs: 0 });
    assert.equal(activeDuringDig, true);
    assert.equal(suffocationRescueActive(bot), false);
});

test('T-0268: not suffocating (air at the head) → nothing to do', async () => {
    const feet = new Vec3(0, 60, 0);
    const blockAt = () => ({ name: 'air', boundingBox: 'empty' });
    assert.equal(headSuffocating(blockAt, feet), false);
    const r = await digOutOfSuffocation({ health: 20, entity: { position: new Vec3(0.5, 60, 0.5) }, blockAt, dig: async () => { throw new Error('no'); }, stopDigging() {}, tool: {} }, { settleMs: 0 });
    assert.equal(r.cleared, true);
    assert.equal(r.digs, 0);
});

test('T-0268: watchdog uses the loop; the T-0172 dig gate exempts a suffocation rescue; mobility digs yield to it (T-0131 exemption: worker-death C410)', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    assert.match(src, /await skills\.digOutOfSuffocation\(bot, \{/);
    assert.match(src, /if \(_ogr && !skills\.suffocationRescueActive\(bot\)\) \{/);
    assert.match(src, /if \(skills\.suffocationRescueActive\(bot\) && !_isHeadCell\(block\)\) \{/);
});
