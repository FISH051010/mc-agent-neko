import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// T-0014 / C301: migrate's desert gate reads `noAnimalStreak>=4`, but that counter was declared/read/reset and NEVER
// incremented anywhere → a land food-desert was invisible to migrate → food8 catch-22, starve in place. Every
// *Streak counter migrate.shouldMigrate consumes must have an INCREMENTING writer somewhere.
const ALLOW = {
    // never incremented since migrate.js was written (89f200c); the ocean case is covered directly by
    // `currentOcean === true` in the same desert expression, so the dead streak is harmless.
    oceanStreak: 'dead since 89f200c, superseded by currentOcean',
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('T-0014/C301: every migrate_state streak counter that gates migration has an incrementing writer', () => {
    const migrate = read('bots/_supervisor/skills/migrate.js');
    const consumed = [...new Set([...migrate.matchAll(/\(s\.(\w+Streak) \|\| 0\) >= \d+/g)].map(m => m[1]))];
    assert.ok(consumed.includes('noAnimalStreak'), `consumed: ${consumed}`);
    const skillsDir = path.join(root, 'bots', '_supervisor', 'skills');
    const all = fs.readdirSync(skillsDir).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(skillsDir, f), 'utf8')).join('\n');
    const missing = consumed.filter(name => !(name in ALLOW)
        && !new RegExp(String.raw`${name}\s*=\s*[^;]*\+\s*1|${name}\+\+|${name}\s*\+=`).test(all));
    assert.deepEqual(missing, []);
});
