import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { planDryTunnel } from '../bots/_supervisor/skills/mineDown.js';

// T-0184 (COOLDOWN-CHURN GO_UNDERGROUND ×3, 01-02h): 11 of the mineDown aborts were 'fluid near stair cell' around
// -31,39,-62 — re-heading and 9b tunnels kept the bot inside the same aquifer. A human walks to ground whose whole way
// down is dry: tunnel 6-16b to an end column with no fluid within r=2 from the feet down to targetY.
const k = (x, y, z) => `${x},${y},${z}`;
function world({ water = [] } = {}) {
    const W = new Set(water.map(p => k(...p)));
    return (x, y, z) => W.has(k(x, y, z)) ? { name: 'water', boundingBox: 'empty' }
        : (x === 0 && z === 0 && (y === 40 || y === 41)) ? { name: 'air', boundingBox: 'empty' }
        : { name: 'stone', boundingBox: 'block' };
}
// an aquifer column band under every +x / -x / +z endpoint up to 16b; -z side is dry
function aquiferExceptNegZ() {
    const water = [];
    for (let d = 1; d <= 60; d++) for (const [x, z] of [[d, 0], [-d, 0], [0, d]]) water.push([x, 30, z]);   // reaches the staircase line
    return water;
}

test('T-0184: the tunnel heads for the side whose whole shaft column is dry', () => {
    const plan = planDryTunnel(world({ water: aquiferExceptNegZ() }), 0, 40, 0, 14);
    assert.ok(plan, 'found');
    assert.deepEqual([plan.sx, plan.sz], [0, -1]);
    assert.ok(plan.path.length >= 6 && plan.path.length <= 16);
});

test('T-0184: fluid on the staircase line (r=2) rejects the candidate even if the tunnel and the end column are dry', () => {
    const water = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let d = 1; d <= 60; d++) for (const o of [-2, 0, 2]) water.push([dx * d + (dz ? o : 0), 20, dz * d + (dx ? o : 0)]);
    assert.equal(planDryTunnel(world({ water }), 0, 40, 0, 14), null, 'every candidate shaft is wet');
});

test('T-0184: water on the forward staircase line (not under the end column) rejects the candidate', () => {
    // only +x is tunnellable (bedrock on the other three first cells); water band at y30, x15..25 — the staircase from
    // any +x endpoint d (6..16) reaches y30 at x=d+9 ∈ 15..25, while the end column d±2 stays dry for d ≤ 12.
    const k3 = (x, y, z) => `${x},${y},${z}`;
    const W = new Set();
    for (let x = 15; x <= 25; x++) for (let z = -2; z <= 2; z++) W.add(k3(x, 30, z));
    const B = new Set([k3(-1, 40, 0), k3(0, 40, 1), k3(0, 40, -1)]);
    const bn = (x, y, z) => W.has(k3(x, y, z)) ? { name: 'water', boundingBox: 'empty' }
        : B.has(k3(x, y, z)) ? { name: 'bedrock', boundingBox: 'block' }
        : (x === 0 && z === 0 && (y === 40 || y === 41)) ? { name: 'air', boundingBox: 'empty' }
        : { name: 'stone', boundingBox: 'block' };
    assert.equal(planDryTunnel(bn, 0, 40, 0, 14), null);
});

test('T-0184: aquifer relocation prefers the dry-shaft tunnel before the plain 9b tunnel', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /const _tun = planDryTunnel\(bn, cx, cy, cz, targetY\) \|\| planRelocateTunnel\(bn, cx, cy, cz\);/);
    // live 04:45:37: tunnelled +x to dry rock, then kept heading -1,0 back toward the aquifer → 2 fluid turns
    assert.match(src, /const _r2 = rotateAwayFromAborted\(bot\._mineDownFluidAvoid, bot\.entity\.position, _tun\.sx, _tun\.sz\);/);
    assert.match(src, /const _tun = planDryTunnel\(bn, Math\.floor\(before\.x\), Math\.round\(before\.y\), Math\.floor\(before\.z\), targetY\)[^\n]*\r?\n\s*\|\| planRelocateTunnel\(/);
});
