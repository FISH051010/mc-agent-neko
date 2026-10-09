import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// C249 (live 2026-06-18: missionNether idle ~1h, running:null): the bridge re-armed the sticky skill only once, 8s
// after a skill_result, and skipped it on a busy-rejection → a lost re-arm meant NO supervised skill until the next WS
// blip. The idle-watchdog re-arms whenever connected + no skill active for >40s. bridge.mjs is a long-running script
// with top-level side effects, so this is a structural pin; live signal = events.log 'sticky_idle_rearm'.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('C249: bridge has a periodic idle-watchdog that re-sends the sticky skill after >40s idle (connected, nothing running)', () => {
    const src = fs.readFileSync(path.join(root, 'bots', '_supervisor', 'bridge.mjs'), 'utf8');
    const m = src.match(/setInterval\(\(\) => \{\s*if \(!\(connected && ws && ws\.readyState === ws\.OPEN\)\) return;\s*if \(skillActive\) return;\s*if \(Date\.now\(\) - lastSkillEndAt < (\d+)\) return;[\s\S]{0,200}?sendStickySkill\(\);\s*\}, (\d+)\);/);
    assert.ok(m, 'idle-watchdog interval missing or reshaped');
    assert.ok(Number(m[1]) <= 60000, `idle threshold ${m[1]}ms`);
    assert.ok(Number(m[2]) <= 60000, `poll period ${m[2]}ms`);
});
