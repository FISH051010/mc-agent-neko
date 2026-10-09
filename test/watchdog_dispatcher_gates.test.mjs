import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ps = fs.readFileSync(path.join(repoRoot, 'watchdog.ps1'), 'utf8');
const code = ps.split(/\r?\n/).filter((l) => !/^\s*#/.test(l));

// 2026-10-10: watchdog's STUCK-ZONE night/food holds were gated on `skill -eq 'missionNether'`; since the
// framework-v2 cutover the live dispatcher is kernelDriver, so every legit sealed night hold was cancelled at
// 10min and restarted at 25min (new world nights 2 and 3). PowerShell isn't runnable here — pin structurally.
test('2026-10-10: no watchdog hold predicate accepts ONLY the retired missionNether dispatcher', () => {
  const offenders = code.filter((l) => /skill\)?\s*-eq\s*'missionNether'/.test(l));
  assert.deepEqual(offenders, [], 'gate on the dispatcher family (missionNether|kernelDriver), not missionNether alone');
});

test('2026-10-10: the STUCK-ZONE night hold recognises kernelDriver and a contained mobility state', () => {
  const night = code.find((l) => /\$nightHold\s*=\s*\(\$todN/.test(l));
  assert.ok(night, 'nightHold predicate present');
  assert.match(code.join('\n'), /\$isDispatcher\s*=.*kernelDriver/);
  assert.match(night, /\$nightMobContained/);
});
