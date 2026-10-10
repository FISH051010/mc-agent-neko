// T-0136: 决策层选 MINE_THROUGH_NIGHT 派 mineDown, 反射 shouldNightShelter (y59, 非 enclosed) 预防性封箱抢身体 →
// mineDown 秒退 ×3 → DUSK_MINE_NIGHT 冷却 → FREE_PLAY 站着过夜 (实录 10-10 18:47:23Z)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decisionOwnsNightMining } from '../src/agent/framework/night_owner.js';

const NOW = 5_000_000;
const bot = (kind, kdAgo = 1000, extra = {}) => ({ _commitment: { kind, skill: 'mineDown', since: NOW - 60000 }, _currentSkill: 'mineDown', _kernelDriverActive: NOW - kdAgo, ...extra });

test('T-0136: 决策层已承诺夜挖 + 派发器在线 + 无怪 → 预防性封箱让位', () => {
    assert.equal(decisionOwnsNightMining(bot('DUSK_MINE_NIGHT'), { hostilesNear: 0, now: NOW }), true);
});

test('T-0136: 有怪 / 派发器离线 / 承诺不是夜挖 → 照旧封箱', () => {
    assert.equal(decisionOwnsNightMining(bot('DUSK_MINE_NIGHT'), { hostilesNear: 1, now: NOW }), false, 'mob near → shelter');
    assert.equal(decisionOwnsNightMining(bot('DUSK_MINE_NIGHT', 60000), { hostilesNear: 0, now: NOW }), false, 'stale dispatcher');
    assert.equal(decisionOwnsNightMining(bot('NIGHT_DIG_ONE'), { hostilesNear: 0, now: NOW }), false);
    assert.equal(decisionOwnsNightMining({}, { hostilesNear: 0, now: NOW }), false);
});

test('T-0182 #15: 派发器心跳 ≠ 夜挖在跑 — 承诺的技能没在跑、15s 内没技能挖掘、承诺也不新 → 不让位 (照旧夜宿)', () => {
    const idle = bot('DUSK_MINE_NIGHT', 1000, { _currentSkill: 'kernelDriver' });
    assert.equal(decisionOwnsNightMining(idle, { hostilesNear: 0, now: NOW }), false, 'heartbeat only');
    assert.equal(decisionOwnsNightMining({ ...idle, _lastSkillDigAt: NOW - 3000 }, { hostilesNear: 0, now: NOW }), true, 'skill dig 3s ago');
    assert.equal(decisionOwnsNightMining({ ...idle, _commitment: { ...idle._commitment, since: NOW - 2000 } }, { hostilesNear: 0, now: NOW }), true, 'dispatch in flight');
    assert.equal(decisionOwnsNightMining(bot('DUSK_MINE_NIGHT'), { hostilesNear: 0, now: NOW }), true, 'mineDown is the current skill');
});

test('T-0136: modes.js shouldNightShelter 在预防性分支前查询决策层夜挖', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const start = src.indexOf('shouldNightShelter: function');
    const fn = src.slice(start, src.indexOf('armoredZombieBrawl(bot)) return false', start));
    assert.ok(/decisionOwnsNightMining\(bot/.test(fn), 'shouldNightShelter consults decisionOwnsNightMining');
});
