import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// C240 (11h live pin @-22,82,10): mineDown computed the bot's block cell with Math.round instead of Math.floor —
// at x/z in [n-0.5, n) the staircase was dug one cell OFF from where the bot actually stood, so it "dug 93 blocks,
// ran 40 steps" without ever descending. Minecraft block coords are floor(). Structural pin (the descent itself
// needs a physics world): the step loop's cell must be floored.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('C240: mineDown step loop derives its block cell with Math.floor (never Math.round) on x/z', () => {
    const src = fs.readFileSync(path.join(root, 'bots', '_supervisor', 'skills', 'mineDown.js'), 'utf8');
    assert.match(src, /const cx = Math\.floor\(cur\.x\), cz = Math\.floor\(cur\.z\);/);
    assert.doesNotMatch(src, /const cx = Math\.round\(/);
    assert.doesNotMatch(src, /cz = Math\.round\(cur\.z\)/);
});
