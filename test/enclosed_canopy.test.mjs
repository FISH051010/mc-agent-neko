import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as judge from '../src/agent/framework/surface_judge.js';

// T-0265: mobility.enclosed ("isolated from the open sky — night can't reach me") scanned 3x3 columns ×36 up and took
// ANY solid as a roof, so a dense-forest canopy made a bot standing bare on the grass "enclosed" → shouldNightShelter /
// MINE_THROUGH_NIGHT / NIGHT-BAIL / flee all treated it as sheltered at night. Leaves stop no zombie.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function world(fill) {
    const m = new Map();
    const set = (x, y, z, name, bb = 'block') => m.set(`${x},${y},${z}`, { name, boundingBox: bb });
    fill(set);
    return (q) => m.get(`${Math.floor(q.x)},${Math.floor(q.y)},${Math.floor(q.z)}`) || { name: 'air', boundingBox: 'empty' };
}
const feet = { x: 0, y: 70, z: 0 };
const grid = (fn) => { for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) fn(x, z); };

test('T-0265: a forest canopy (leaves/logs over every column) is not enclosed', () => {
    assert.equal(typeof judge.enclosedAt, 'function', 'surface_judge must export enclosedAt');
    const w = world(set => grid((x, z) => { for (let y = 75; y <= 77; y++) set(x, y, z, 'dark_oak_leaves'); set(x, 78, z, 'dark_oak_log'); }));
    assert.equal(judge.enclosedAt(w, feet), false);
});

test('T-0265: a rock cave roof over every column is enclosed', () => {
    const w = world(set => grid((x, z) => set(x, 74, z, 'stone')));
    assert.equal(judge.enclosedAt(w, feet), true);
});

test('T-0265: rock above the canopy still counts (cave mouth with hanging leaves)', () => {
    const w = world(set => grid((x, z) => { set(x, 73, z, 'oak_leaves'); set(x, 80, z, 'deepslate'); }));
    assert.equal(judge.enclosedAt(w, feet), true);
});

test('T-0265: water overhead is not a roof (lake bottom at night is exposed, as before)', () => {
    const w = world(set => grid((x, z) => { for (let y = 72; y <= 78; y++) set(x, y, z, 'water', 'empty'); }));
    assert.equal(judge.enclosedAt(w, feet), false);
});

test('T-0265: one open column breaks enclosure (cave skylight hole)', () => {
    const w = world(set => grid((x, z) => { if (!(x === 4 && z === -4)) set(x, 74, z, 'stone'); }));
    assert.equal(judge.enclosedAt(w, feet), false);
});

test('T-0265: modes.js mobility + world-model scans use enclosedAt, no hand-written 36-block roof probe', () => {
    const s = fs.readFileSync(path.join(root, 'src', 'agent', 'modes.js'), 'utf8');
    assert.doesNotMatch(s, /for \(let dy = 2; dy <= 36; dy\+\+\)/);
    assert.ok((s.match(/enclosedAt\(/g) || []).length >= 2, 'both the mobility classifier and the world-model observer use enclosedAt');
    assert.match(s, /import \{[^}]*enclosedAt[^}]*\} from '\.\/framework\/surface_judge\.js'/);
});
