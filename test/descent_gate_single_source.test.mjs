// T-0282 (监工; 06:46-06:52Z @-171,58,-195): 夜里 kernel 承诺 DUSK_MINE_NIGHT 每分钟派 mineDown, self_preservation sealed night hold
// 整夜持身拒它 → 整夜零下挖。修 = 提案门与 hold 让位条件同一判据: night_owner.descentGateOpen (worker-death 反射侧 decisionOwnsNightMining
// 也调它)。world_model 的下挖过滤只许经 descentGateOpenFor → descentGateOpen, 不许再写一份裸的 descentBlocked/hostileRawNear。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/agent/framework/world_model.js', import.meta.url), 'utf8');

test('T-0282: world_model 下挖门单一来源 — 过滤与兜底都经 descentGateOpenFor, 它只委托 night_owner.descentGateOpen', () => {
    assert.ok(src.includes("import { descentGateOpen } from './night_owner.js';"));
    assert.ok(src.includes('if (!descentGateOpenFor(bot, vitals))'), 'proposal filter');
    assert.ok(src.includes('DESCENT_SKILL_RE.test(fb.skill) && !descentGateOpenFor(bot, vitals)'), 'day fallback');
    assert.ok(!/hostileRawNear\(bot, DESCENT_HOSTILE_R\) > 0\)\s*\n\s*_final = _final\.filter/.test(src), 'no second copy of the hostile gate');
    const body = src.slice(src.indexOf('export function descentGateOpenFor'), src.indexOf('export function liveAnimalLandmark'));
    assert.match(body, /return descentGateOpen\(/);
});

test('T-0282: 行为 — 门开 (血食够、4 格内无敌对) 提夜挖; 4 格内有僵尸或饿着 → 不提 (hold 也不让, 两边一致)', async () => {
    const { descentGateOpenFor } = await import('../src/agent/framework/world_model.js');
    const { descentGateOpen } = await import('../src/agent/framework/night_owner.js');
    const Vec3 = (await import('vec3')).default;
    const mk = (mobs = [], food = 20) => ({ food, health: 20, entity: { position: new Vec3(0, 58, 0) },
        entities: Object.fromEntries(mobs.map((m, i) => [i + 1, { id: i + 1, name: m.name, type: 'hostile', position: new Vec3(m.d, 58, 0) }])),
        inventory: { items: () => [{ name: 'stone_pickaxe', count: 2 }, { name: 'bread', count: 4 }] } });
    for (const [b, why] of [[mk(), 'open'], [mk([{ name: 'zombie', d: 2 }]), 'zombie 2b'], [mk([], 2), 'starving'], [mk([{ name: 'zombie', d: 10 }]), 'zombie 10b']]) {
        assert.equal(descentGateOpenFor(b, { food: b.food, hp: b.health }), descentGateOpen(b), `same verdict as the hold side: ${why}`);
    }
    assert.equal(descentGateOpenFor(mk()), true);
    assert.equal(descentGateOpenFor(mk([{ name: 'zombie', d: 2 }])), false);
});
