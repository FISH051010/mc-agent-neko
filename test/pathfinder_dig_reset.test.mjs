import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// T-0260 root cause (dig-abort probe 10-11 06:25:15Z: '[dig-abort] dirt@(25, 64, -12) by=pf.setMovements < executePathfindingPhase
// < goToGoal < goToPosition'). mineflayer-pathfinder's resetPath() calls bot.stopDigging() whenever its own `digging` flag is set —
// but bot.stopDigging stops WHATEVER dig is current. When a skill's bot.dig replaces the pathfinder's dig (mineflayer stops the old
// one, starts the new one synchronously), the pathfinder's dig .catch → resetPath('dig_error') runs a microtask later with
// digging still true and stops the NEW dig: mineDown's first dig 'Digging aborted [by owner=- …]' within 1-3ms ×3 (04:22:54-57Z).
// Also detectDiggingStopped used removeAllListeners(event, fn) — Node ignores fn and drops EVERY diggingAborted listener (the
// probe included). Patched in patches/mineflayer-pathfinder+2.4.5.patch; these pins prove the patch is applied in node_modules.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const libFile = require.resolve('mineflayer-pathfinder');
const lib = fs.readFileSync(libFile, 'utf8');
const patch = fs.readFileSync(path.join(root, 'patches', 'mineflayer-pathfinder+2.4.5.patch'), 'utf8');

test('T-0260: resetPath stops only the pathfinder\'s OWN dig (target matches), else just drops its flag', () => {
    const i = lib.indexOf('function resetPath');
    const seg = lib.slice(i, i + 1400);
    assert.match(seg, /if \(digging\) \{/);
    assert.match(seg, /bot\.targetDigBlock && digTargetPos && bot\.targetDigBlock\.position && bot\.targetDigBlock\.position\.equals\(digTargetPos\)/);
    assert.match(seg, /digging = false/);
    assert.match(lib, /digTargetPos = block \? block\.position : null/);
});

test('T-0260: detectDiggingStopped removes only its own listener', () => {
    const i = lib.indexOf('function detectDiggingStopped');
    const seg = lib.slice(i, i + 400);
    assert.match(seg, /bot\.removeListener\('diggingAborted', detectDiggingStopped\)/);
    assert.doesNotMatch(seg, /removeAllListeners\('diggingAborted'/);
});

test('T-0260: the patch file carries the change (reproducible by patch-package on npm install)', () => {
    assert.match(patch, /digTargetPos/);
    assert.match(patch, /\+\s*bot\.removeListener\('diggingAborted', detectDiggingStopped\)/);
});

test('T-0260: the patch carries EVERY line of the fix, not just the declaration (a fresh install is the only copy players get)', () => {
    // worker-tests mutation 10-11: dropping the resetPath target check or the digTargetPos assignment from the .patch kept all
    // three pins above green — node_modules on the dev machine was already patched — yet `npm install` (postinstall patch-package,
    // the consumer build) would ship the old resetPath that kills the skill's fresh dig.
    for (const line of [
        /^\+\s*let digTargetPos = null/m,
        /^\+.*digTargetPos = block \? block\.position : null/m,
        /^\+\s*if \(bot\.targetDigBlock && digTargetPos && bot\.targetDigBlock\.position && bot\.targetDigBlock\.position\.equals\(digTargetPos\)\) \{/m,
        /^\+\s*bot\.removeListener\('diggingAborted', detectDiggingStopped\)/m,
        /^\+\s*bot\.removeListener\('diggingCompleted', detectDiggingStopped\)/m,
        /^-\s*bot\.removeAllListeners\('diggingAborted', detectDiggingStopped\)/m,
    ]) assert.match(patch, line);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.match(pkg.scripts.postinstall || '', /patch-package/, 'patches are applied on install');
});
