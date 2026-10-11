import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';
import { classifySwim, mobilityBaseState, sealedWaterTrapYield } from '../src/agent/swim_progress.js';

// T-0098 (溺死实锤 06-25T11:29 @235,51): mining into a water pocket sealed by solid stone above. `inWater`
// short-circuited the base state to SWIM, so the "find a shore" swim reflex owned the body; findShore/pillar/
// vertical-exit all fail under a stone ceiling, and the horizontal thrashing kept resetting SWIM_STUCK → 13min
// bobbing → drowned. A covered (enc) water pocket is a FLOODED ENTOMBMENT: after 12s it must escalate to
// ENTOMBED so the aquifer-aware dig-out owns it.

const tick = (holder, sec, { enc, x = 235, z = 51, t0 = 1e9 }) => classifySwim(holder, { enc, now: t0 + sec * 1000, x, z });

test('T-0098: covered water pocket escalates to ENTOMBED after 12s, even while thrashing sideways', () => {
    const h = {};
    let st;
    for (let s = 0; s <= 14; s += 2) st = tick(h, s, { enc: true, x: 235 + (s % 4 ? 1.5 : -1.5) });
    assert.equal(st, 'ENTOMBED');
    const early = {};
    assert.equal(tick(early, 0, { enc: true }), 'SWIM');
    assert.equal(tick(early, 10, { enc: true }), 'SWIM', 'brief controlled dives never hit the 12s gate');
});

test('T-0098: open water (sky visible) never becomes ENTOMBED — the T-0091 SWIM_STUCK path keeps it', () => {
    const h = {};
    const seen = new Set();
    for (let s = 0; s <= 30; s += 2) seen.add(tick(h, s, { enc: false }));
    assert.ok(!seen.has('ENTOMBED'));
    assert.ok(seen.has('SWIM_STUCK'), 'bobbing in place in open water still escalates to the vertical-escape reflex');
});

test('T-0098: surfacing out of the sealed pocket resets the trap clock', () => {
    const h = {};
    tick(h, 0, { enc: true });
    tick(h, 10, { enc: true });
    tick(h, 11, { enc: false });              // a chimney to the sky opens up
    assert.equal(tick(h, 14, { enc: true }), 'SWIM', 'fresh 12s episode, not carried over');
});

test('C231 base state: water short-circuits to SWIM (classifySwim then decides), dry topology unchanged', () => {
    assert.equal(mobilityBaseState({ inWater: true, exitsN: 0, upOpen: false, enc: true }), 'SWIM');
    assert.equal(mobilityBaseState({ inWater: false, exitsN: 2, upOpen: false, enc: true }), 'FREE');
    assert.equal(mobilityBaseState({ inWater: false, exitsN: 0, upOpen: true, enc: true }), 'POCKET');
    assert.equal(mobilityBaseState({ inWater: false, exitsN: 0, upOpen: true, enc: false }), 'FREE', 'open-sky ledge is not a POCKET');
    assert.equal(mobilityBaseState({ inWater: false, exitsN: 0, upOpen: false, enc: true }), 'ENTOMBED');
});


const trapBot = ({ oxygen = 10, enclosed = true, above = 'stone', state = 'ENTOMBED', at = Date.now(), skillDigAgo = Infinity, mobilityOn = true } = {}) => ({
    oxygenLevel: oxygen,
    _mobility: { enclosed, state, at },
    _lastSkillDigAt: Number.isFinite(skillDigAgo) ? Date.now() - skillDigAgo : 0,
    modes: { isOn: (m) => (m === 'mobility' ? mobilityOn : true) },
    entity: { position: new Vec3(69.5, 48, 12.5) },
    blockAt: (p) => (p.y === 50 ? { name: above, boundingBox: /water|lava|air/.test(above) ? 'empty' : 'block' } : { name: 'water', boundingBox: 'empty' }),
});

test('T-0104: drowning in a stone-capped covered pocket → self_preservation yields to the ENTOMBED dig-out', () => {
    // live 06-28T03:39 @69,48 coveredAbove=2: 'heading for air' fought the dig-out 26s → drowned.
    assert.equal(sealedWaterTrapYield(trapBot()), true);
});

test('T-0104: no yield in open water, with air/water overhead, or before oxygen drops (controlled dive)', () => {
    assert.equal(sealedWaterTrapYield(trapBot({ enclosed: false })), false);
    assert.equal(sealedWaterTrapYield(trapBot({ above: 'water' })), false);
    assert.equal(sealedWaterTrapYield(trapBot({ above: 'air' })), false);
    assert.equal(sealedWaterTrapYield(trapBot({ oxygen: 20 })), false);
});

test('T-0232 drown 23:09:34 (10-10): 只让给"真在接"的 ENTOMBED — 分类陈旧 / mobility 关着 / 技能正在挖 (采矿心跳压住挖出) → 不让, 自己上浮', () => {
    // live 23:08:30→23:09:34: ENTOMBED for 64s while branchMine kept digging (T-0121 heartbeat) → both yielded → drowned mining.
    assert.equal(sealedWaterTrapYield(trapBot({ skillDigAgo: 2000 })), false, 'a skill is digging — the dig-out reflex defers to it');
    assert.equal(sealedWaterTrapYield(trapBot({ at: Date.now() - 20000 })), false, 'stale classification');
    assert.equal(sealedWaterTrapYield(trapBot({ mobilityOn: false })), false, 'mobility frozen (e.g. by surfaceUp)');
    assert.equal(sealedWaterTrapYield(trapBot()), true, 'live ENTOMBED rescue — yield as before');
});

test('T-0180: no handoff gap — swim reflex only yields once ENTOMBED owns the trap, and drowning escalates to ENTOMBED immediately (death #11)', () => {
    // live 22:48:43→54: swim reflex yielded while mobility was still 'SWIM' (12s escalation) → nobody acted
    assert.equal(sealedWaterTrapYield(trapBot({ state: 'SWIM' })), false, 'mobility not digging yet → keep swimming');
    assert.equal(sealedWaterTrapYield(trapBot({ state: 'ENTOMBED' })), true);
    const h = {};
    assert.equal(classifySwim(h, { enc: true, now: 1e9, x: 0, z: 0, oxygen: 20 }), 'SWIM', 'controlled dive with full air');
    assert.equal(classifySwim(h, { enc: true, now: 1e9 + 2000, x: 0, z: 0, oxygen: 14 }), 'ENTOMBED', 'drowning in a covered pocket → dig out now, not after 12s');
});
