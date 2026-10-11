import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Vec3 from 'vec3';
import { overheadGravityCell, overheadGravityRisk } from '../src/agent/library/skills.js';

// T-0268 尾巴 (监工): death #55's log said 'overhead gravity column: tuff above own head — sidestep first' ×10+ — tuff is not a
// gravity block; the risk was the gravel ABOVE it. The refusal now names the real cell. And the MAROONED-climb / dig-out path
// never logged what it actually dug, so which dig dropped the gravel couldn't be told — every mobility rescue dig now logs one
// line (1s throttle) with the gravity column above the dug cell.
const world = (cells) => (p) => ({ name: cells[`${p.x},${p.y},${p.z}`] || 'air' });

test('T-0268b: the gravity cell is the gravel above the tuff, not the tuff', () => {
    const botPos = new Vec3(115.5, -7, 170.5);
    const tuff = new Vec3(115, -5, 170);
    const bn = world({ '115,-5,170': 'tuff', '115,-3,170': 'gravel' });
    const c = overheadGravityCell(bn, botPos, tuff);
    assert.deepEqual(c && { x: c.x, y: c.y, z: c.z, name: c.name }, { x: 115, y: -3, z: 170, name: 'gravel' });
    assert.equal(overheadGravityRisk(bn, botPos, tuff), true);
    assert.equal(overheadGravityCell(world({ '115,-5,170': 'tuff' }), botPos, tuff), null);
});

test('T-0268b: dig-gate refusal names the real cell; mobility rescue digs log what they dug', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    assert.match(src, /overhead gravity column: \$\{_ogrCell \? `\$\{_ogrCell\.name\}@\$\{_ogrCell\.x\},\$\{_ogrCell\.y\},\$\{_ogrCell\.z\} in the column above ` : ''\}\$\{block\.name\}@/);
    assert.match(src, /\[mobility\] dug \$\{fresh\.name\}@/);
});
