import assert from 'node:assert/strict';
import test from 'node:test';
import { noWoodBootstrap, chopLeashRadius } from '../bots/_supervisor/skills/chopWood.js';

// C269 / C275-fix: on a tree-sparse spawn (chopDBG nearest=NONE) the famine-widen only triggered on ">=8 UNREACHABLE
// trees", never on "no trees at all", so the 80b leash hard-pulled every escalating expedition back to the treeless
// anchor → circling, 0 wood, unarmed first-night deaths. A no-wood bootstrap bot must be allowed far out.

const inv = (pairs) => pairs.map(([name, count]) => ({ name, count }));

test('C269: no logs and <4 planks = no-wood bootstrap → leash widens to 256b', () => {
    assert.equal(noWoodBootstrap(inv([['cobblestone', 20], ['oak_planks', 3]])), true);
    assert.equal(chopLeashRadius({ treeDesert: true, unreachableTrees: 0 }), 256);
});

test('C269: with wood in the bag the leash stays tight (80b), ≥8 unreachable trees widen to 160b', () => {
    assert.equal(noWoodBootstrap(inv([['oak_log', 1]])), false);
    assert.equal(noWoodBootstrap(inv([['spruce_planks', 4]])), false);
    assert.equal(chopLeashRadius({ treeDesert: false, unreachableTrees: 0 }), 80);
    assert.equal(chopLeashRadius({ treeDesert: false, unreachableTrees: 8 }), 160);
});
