import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Movement-physics fixes that cannot be reproduced offline (jump/step timing) — structural pins so a merge cannot
// silently drop them. Live backstop: motion_audit 'step_edge.wall_dig.*' events and chopWood 'raw-approach … (jump-climb)'.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('C227: stepEdgeAssist with no walkable step-up digs a doorway through a 2-high wall (goal/yaw direction only)', () => {
    // user-filmed: 2-block wall → pathfinder parkour jump-flailed at it forever instead of digging through.
    const src = read('src/agent/library/skills.js');
    const fn = src.slice(src.indexOf('export async function stepEdgeAssist'), src.indexOf('export async function stepEdgeAssist') + 20000);
    const noCand = fn.indexOf('if (!c) {');
    assert.ok(noCand > 0, 'no-candidate branch missing');
    const branch = fn.slice(noCand, noCand + 3000);
    assert.match(branch, /for \(const d of \[dirFromGoal\(\), dirFromYaw\(\)\]\)/, 'wall dig only along goal/yaw (never sideways/backward)');
    assert.match(branch, /if \(!solid\(wFoot\) \|\| !solid\(wHead\)\) continue;/);
    assert.match(branch, /step_edge\.wall_dig\.begin/);
});

test('C270: chopWood raw-approach jump-climbs toward a tree on higher ground instead of a flat sprint that stalls', () => {
    // live new-world dawn1: oak@y82, bot@y78 → flat sprint stalled at 6.8b → blacklisted → 0 wood → naked night death.
    const src = read('bots/_supervisor/skills/chopWood.js');
    assert.match(src, /const _climb = \(nearest\.b\.position\.y - meW\.y\) > 0\.5;/);
    assert.match(src, /if \(_climb\) bot\.setControlState\('jump', true\);/);
});

test('C265: the edge_unstick recovery reflex exists (jump → replan → back-off) and stepHeight is never cheated', () => {
    // user (a week, 4-5 asks): bot wedges on 1-block steps; edgeStall was measured but nothing recovered.
    const modes = read('src/agent/modes.js');
    assert.match(modes, /name: 'edge_unstick'/);
    assert.match(read('src/agent/framework/instinct.js'), /mode: 'edge_unstick'/);
    // deliberately NOT raising prismarine-physics stepHeight (sliding up a full block without jumping = cheat feel)
    for (const p of ['src/agent/modes.js', 'src/agent/library/skills.js', 'src/utils/mcdata.js']) {
        assert.doesNotMatch(read(p), /\.stepHeight\s*=[^=]/, p);   // a property assignment, not the comment "stepHeight=0.6"
    }
});
