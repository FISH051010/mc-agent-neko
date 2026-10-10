// T-0043 第三次复发 (death #15 2026-10-10 01:10:27): #14 后裸装重生, 夜计划只能落 SEAL_FORT (= 原地裸 hold,
// 有怪即秒退 ×15), 反射 bunkerDown 封不上又以"技能层会挖"冷却 45s → 无人给顶; 01:10:21 僵尸 1.6b 时才就地开挖,
// 坑没封上被僵尸+溺尸打死。不变量: 裸装夜间重生在软土上 → 决策层给 DIG_ONE_CAP, 执行层徒手挖 1 格封顶;
// 近战怪已 <4.5b 时不就地开挖 (挖两格+封顶 ≥2s 接不住) → 先拉开距离; 残血时兜底 1.5s 就收回控制。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { digOneCapViable } from '../src/agent/framework/kit_gate.js';
import { bunkerTooLate, unownedDangerThreshold } from '../src/agent/framework/mobility_signals.js';

const src = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('T-0043 不变量: 裸装 (0 镐) 夜里站在软土上 → DIG_ONE_CAP 可行; 决策层不再另加 picks>=1 门', () => {
    assert.equal(digOneCapViable({ picks: 0, gravityPit: false, y: 63, softFloor: true }), true);
    const m = src('../src/agent/modes.js');
    assert.match(m, /digOneCapViable\(\{ picks, gravityPit: _gravityPitTrap\(\), y, softFloor: _floorSoft \}\)/);
    assert.ok(!/decision: 'DIG_ONE_CAP', when: \(\) => digOneViable \|\| \(picks >= 1/.test(m), 'relocate branch has no pick gate (scan filters soft-only when pickless)');
});

test('T-0043 不变量: nightShelter 无镐也挖三填一 — 就地仅软土, 否则 ≤15b 找软土 relocate (执行层与决策层同口径)', () => {
    const s = src('../bots/_supervisor/skills/nightShelter.js');
    assert.ok(!/if \(!isDay\(\) && !bot\.interrupt_code && bot\.health > 0 && _hasPickInv\(\)\)/.test(s), 'pickless hard gate removed');
    assert.match(s, /if \(_hasPickInv\(\) \|\| diggableUnder\(_h0\.x, _h0\.y, _h0\.z\)\)/, 'pickless digs in place only on soft ground');
    assert.match(s, /return DIG_SOFT\.test\(n\) \|\| \(_hasPickInv\(\) && DIG_STONE\.test\(n\)\)/, 'pickless relocate target = soft only (no sand/gravel)');
});

test('T-0043: 近战怪 <4.5b (高差≤2) → 就地封坑来不及; 射手/苦力怕/远处/高处不算', () => {
    assert.equal(bunkerTooLate([{ name: 'zombie', d: 1.6, dy: 0 }]), true, 'death #15');
    assert.equal(bunkerTooLate([{ name: 'drowned', d: 1.2, dy: -0.5 }]), true);
    assert.equal(bunkerTooLate([{ name: 'zombie', d: 6, dy: 0 }]), false);
    assert.equal(bunkerTooLate([{ name: 'zombie', d: 3, dy: 4 }]), false, 'can not reach');
    assert.equal(bunkerTooLate([{ name: 'skeleton', d: 3, dy: 0 }, { name: 'creeper', d: 2, dy: 0 }]), false, 'own branches');
    const m = src('../src/agent/modes.js');
    const i = m.indexOf("say(agent, 'Nightfall — securing till dawn (proactive, before mobs swarm).')");
    const pre = m.slice(m.lastIndexOf('bunkerTooLate(_mobs)', i), i);
    assert.match(pre, /this\.sprintFlee\(agent\)/, 'too-late branch sprints clear before the proactive bunker branch');
});

test('T-0043: 残血时无人掌舵兜底阈值 1.5s (death #15 hp17→4→0 只用 3.5s)', () => {
    assert.equal(unownedDangerThreshold(4), 1500);
    assert.equal(unownedDangerThreshold(17), 3000);
    assert.match(src('../src/agent/modes.js'), /threshold: unownedDangerThreshold\(bot\.health\)/);
});
