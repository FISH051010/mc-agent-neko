import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gravityColumnAbove, gravityHazard, settleGravityColumn, fallingBlockInColumn } from '../src/agent/framework/mobility_signals.js';

// Live 10-10 18:40:49 @100,66,-39: mobility SEALED dig-out dug gravel → 18:40:50 stepped forward into the
// opened cell → the gravel column above collapsed onto the head → suffocation (hp1, full iron kit lost).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const k = (p) => `${p.x},${p.y},${p.z}`;

// Tiny column world: gravity blocks fall one cell per tick into air below them.
function columnWorld(names) {   // names[i] = block at y=i (x=z=0)
    const blocks = new Map(names.map((n, y) => [k({ x: 0, y, z: 0 }), n]));
    const blockAt = (p) => { const n = blocks.get(k(p)) || 'air'; return { name: n, boundingBox: n === 'air' ? 'empty' : 'block', position: p }; };
    const tick = () => {   // one physics step, bottom-up
        for (let y = 1; y < 40; y++) {
            const n = blocks.get(k({ x: 0, y, z: 0 }));
            if (/^(sand|gravel|red_sand)$/.test(n || '') && !blocks.get(k({ x: 0, y: y - 1, z: 0 }))) {
                blocks.delete(k({ x: 0, y, z: 0 })); blocks.set(k({ x: 0, y: y - 1, z: 0 }), n);
            }
        }
    };
    const dig = async (b) => { blocks.delete(k(b.position)); };
    return { blocks, blockAt, tick, dig };
}

test('T-0131: a dug gravel cell with gravel stacked above is drained before it counts as safe', async () => {
    // y0 stone floor, y1 = the cell we dig (gravel), y2..y4 more gravel, y5 stone roof
    const w = columnWorld(['stone', 'gravel', 'gravel', 'gravel', 'gravel', 'stone']);
    const cell = { x: 0, y: 1, z: 0 };
    assert.equal(gravityColumnAbove(w.blockAt, cell), 3);
    assert.equal(gravityHazard(w.blockAt, cell, 'gravel'), true);
    await w.dig(w.blockAt(cell));
    const st = await settleGravityColumn({ blockAt: w.blockAt, entities: () => ({}), dig: w.dig, cell,
        sleep: async () => { w.tick(); } });
    assert.equal(st.ok, true);
    assert.equal(st.redug, 3, 'each block that fell into the cell was re-dug');
    assert.equal(w.blockAt(cell).name, 'air');
    assert.equal(w.blockAt({ x: 0, y: 2, z: 0 }).name, 'air', 'nothing left hanging over the head cell');
});

test('T-0131: a column too tall to drain in budget reports UNSETTLED (caller must not step in)', async () => {
    const w = columnWorld(['stone', 'gravel', ...Array(30).fill('gravel'), 'stone']);
    const cell = { x: 0, y: 1, z: 0 };
    await w.dig(w.blockAt(cell));
    const st = await settleGravityColumn({ blockAt: w.blockAt, entities: () => ({}), dig: w.dig, cell, maxRounds: 6,
        sleep: async () => { w.tick(); } });
    assert.equal(st.ok, false);
});

test('T-0131: a falling_block entity still in the column means "not yet"', () => {
    const ents = { 1: { name: 'falling_block', position: { x: 0.5, y: 3.2, z: 0.5 } } };
    assert.equal(fallingBlockInColumn(ents, { x: 0, y: 1, z: 0 }), true);
    assert.equal(fallingBlockInColumn(ents, { x: 3, y: 1, z: 0 }), false);
    assert.equal(gravityHazard(columnWorld(['stone', 'stone', 'stone']).blockAt, { x: 0, y: 1, z: 0 }, 'stone'), false);
});

test('T-0131: modes.js wiring — guardedDig settles/refuses gravity, every dig-out step honours the hold', () => {
    const src = fs.readFileSync(path.join(root, 'src/agent/modes.js'), 'utf8');
    assert.match(src, /\(bot\.health \|\| 20\) <= 4 && gravityHazard\(/, 'low-hp gravity dig refusal');
    assert.match(src, /const st = await settleGravityColumn\(\{/, 'post-dig column settle');
    assert.match(src, /if \(!st\.ok\) \{ bot\._gravityHoldUntil = Date\.now\(\) \+ 4000; return false; \}/);
    assert.match(src, /const gravityHeld = \(\) => \(bot\._gravityHoldUntil \|\| 0\) > Date\.now\(\);/);
    assert.equal((src.match(/if \(!gravityHeld\(\)\) bot\.setControlState\(/g) || []).length, 8,
        'ENTOMBED(2) + SEALED(2) + MAROONED-climb(2) + MAROONED march(1) + POCKET dig(1)');
});
