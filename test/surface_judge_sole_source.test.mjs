import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// T-0258 (监工): the "on the surface?" test was hand-written per module and misjudged a tree canopy as a roof three times
// (T-0189, T-0251, T-0257). surface_judge.js is now the only place that reads sky light or scans for a roof for that
// question. These pins stop a fourth hand-written copy from appearing.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = path.join(root, 'bots', '_supervisor', 'skills');
const read = (p) => fs.readFileSync(p, 'utf8');
function jsFiles(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...jsFiles(p)); }
        else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
}
const ALL = [...jsFiles(path.join(root, 'src')), ...jsFiles(SKILLS)];
const JUDGE = path.join(root, 'src', 'agent', 'framework', 'surface_judge.js');

test('T-0258: only surface_judge.js reads skyLight ≥14 for the sky-open test', () => {
    const offenders = ALL.filter(p => p !== JUDGE && /skyLight\s*>=\s*14/.test(read(p))).map(p => path.relative(root, p));
    assert.deepEqual(offenders, []);
});

test('T-0258: the retired local surface tests do not come back', () => {
    const offenders = [];
    for (const p of ALL) {
        if (p === JUDGE) continue;
        const s = read(p);
        for (const re of [/openAboveNoCanopy/, /_skyAboveHere/, /function chopOnSurface/, /function shouldClimbForKit/]) if (re.test(s)) offenders.push(`${path.relative(root, p)}: ${re}`);
    }
    assert.deepEqual(offenders, []);
});

test('T-0258: migrated skills have no hand-written 36-block sky probe and import surface_judge', () => {
    for (const f of ['chopWood.js', 'replenishKit.js', 'quickMeal.js', 'feedUp.js']) {
        const s = read(path.join(SKILLS, f));
        assert.doesNotMatch(s, /for \(let _?d[dy]? = 2; _?d[dy]? <= 36;/, `${f} scans the sky by hand`);
        assert.match(s, /from '\.\.\/\.\.\/\.\.\/src\/agent\/framework\/surface_judge\.js'/, `${f} must use surface_judge`);
    }
    const su = read(path.join(SKILLS, 'surfaceUp.js'));
    assert.match(su, /onSurfaceNow\(bot\) && \(targetY <= SURFACE_Y \|\| yNow\(\) >= targetY - 2\)/);
    const ff = read(path.join(root, 'src', 'agent', 'framework', 'food_floor.js'));
    assert.match(ff, /export \{ skyOpenAt \} from '\.\/surface_judge\.js';/);
    const wm = read(path.join(root, 'src', 'agent', 'framework', 'world_model.js'));
    assert.match(wm, /onSurface: onSurfaceNow\(bot\)/);
});

test('T-0258 第二期: achieve / prepNether / missionNether surface tests go through surface_judge', () => {
    const ach = read(path.join(SKILLS, 'achieve.js'));
    assert.match(ach, /const openSurfaceNow = \(\) => onSurfaceNow\(bot\);/);
    assert.match(ach, /const undergroundPocketNow = \(\) => !onSurfaceNow\(bot\) \|\| /);
    assert.doesNotMatch(ach, /const undergroundPocket = bot\.entity\.position\.y < 62/);
    const pn = read(path.join(SKILLS, 'prepNether.js'));
    assert.match(pn, /const openSurfaceNow = \(\) => onSurfaceNow\(bot\);/);
    assert.match(pn, /const onSurface = onSurfaceNow\(bot\);/);
    assert.match(pn, /const underground = shouldClimbToSurface\(bot\);/);
    for (const f of ['prepNether.js', 'missionNether.js']) {
        assert.match(read(path.join(SKILLS, f)), /const tableRecoveryUndergroundWorksite = \(\) => !onSurfaceNow\(bot\) \|\| /, f);
    }
    for (const f of ['achieve.js', 'prepNether.js', 'missionNether.js']) {
        assert.match(read(path.join(SKILLS, f)), /from '\.\.\/\.\.\/\.\.\/src\/agent\/framework\/surface_judge\.js'/, f);
    }
});
