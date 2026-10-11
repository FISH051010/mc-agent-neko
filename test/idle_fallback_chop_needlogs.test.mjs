// T-0281 (10-11 06:41:05-15Z): IDLE_FALLBACK dispatched chopWood(8) 8× in 12s — dayFallbackTask picks chopWood while
// woodUnits < 16 (planksEq 13), but chopWood's main loop BAILs at planksEq >= 8 ('woodEq=13 already enough … no optional
// tree route') and returns the log count it holds (3, truthy → success → never a strike, never a cooldown). The decision
// layer committed a skill the skill layer refuses to run. The fallback now asks for logs explicitly (needLogs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Vec3 from 'vec3';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'idlefb-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.env.MC_FOOD_INSTINCTS = '0';
const { dayFallbackTask } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

const mkBot = (inv) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) }, entities: {}, health: 20, food: 20 });
const w = JSON.parse(JSON.stringify(EMPTY_WORLD));

test('T-0281: fallback chopWood (planksEq 8..15) carries needLogs so chopWood does not BAIL on its own 8-plank floor', () => {
    const fb = dayFallbackTask(w, mkBot({ stone_pickaxe: 1, spruce_log: 3, spruce_planks: 1 }));   // the live case: planksEq 13
    assert.equal(fb.skill, 'chopWood');
    assert.equal(fb.args[0], 8);
    assert.equal(fb.args[1] && fb.args[1].needLogs, true);
    const noPick = dayFallbackTask(w, mkBot({ cobblestone: 64, dirt: 64, spruce_log: 10 }));
    if (noPick.skill === 'chopWood') assert.equal(noPick.args[1] && noPick.args[1].needLogs, true);
});

test('T-0281: chopWood\'s woodEq BAIL is skipped under needLogs (the flag the fallback sends)', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/chopWood.js', import.meta.url), 'utf8');
    assert.match(src, /if \(!_opts\.needLogs && !_opts\.allowCriticalForage && _planksEq\(\) >= 8\) \{/);
});
