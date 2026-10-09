import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseFleeHeading } from '../src/agent/mobility_geom.js';

// T-0068 / C334-A: fleeMove only searched the forward ±90° arc. In a U-shaped corner (2-high wall ahead and
// both sides) every forward heading was head-blocked → fallback rammed the wall → kited till dawn, swarmed.

const open = { foot: false, head: false, above: false, water: false, drop: false };
const wall = { ...open, head: true };
// probe by heading angle relative to +x (away direction = +x)
const angleOf = (ux, uz) => Math.round(Math.atan2(uz, ux) * 180 / Math.PI);
const probeFrom = (fn) => (ux, uz) => fn(angleOf(ux, uz));

test('T-0068: open ground → keeps the straight away heading, no jump', () => {
    const h = chooseFleeHeading(1, 0, probeFrom(() => open));
    assert.equal(h.found, true);
    assert.equal(angleOf(h.hx, h.hz), 0);
    assert.equal(h.needJump, false);
});

test('T-0068/C334-A: U-corner (forward ±90° all walled) → turns back through the only opening instead of ramming', () => {
    const h = chooseFleeHeading(1, 0, probeFrom(a => (Math.abs(a) >= 135 ? open : wall)));
    assert.equal(h.found, true);
    assert.ok(Math.abs(angleOf(h.hx, h.hz)) >= 135, `got ${angleOf(h.hx, h.hz)}°`);
});

test('fleeMove preference: away arc first; water only if every dry heading is blocked; never off a ledge', () => {
    const wetAhead = probeFrom(a => (a === 0 ? { ...open, water: true } : open));
    assert.equal(angleOf(...Object.values(chooseFleeHeading(1, 0, wetAhead)).slice(0, 2)), 45, 'dry diagonal beats the river');
    const allWet = probeFrom(() => ({ ...open, water: true }));
    assert.equal(chooseFleeHeading(1, 0, allWet).found, true, 'island: swimming beats the swarm');
    const ledgeAhead = probeFrom(a => (a === 0 ? { ...open, drop: true } : open));
    assert.notEqual(angleOf(...Object.values(chooseFleeHeading(1, 0, ledgeAhead)).slice(0, 2)), 0);
});

test('#1 (07-06): a 1-block step with a solid block above the landing (2-high lip) is not a jumpable heading', () => {
    const lip = probeFrom(a => (a === 0 ? { ...open, foot: true, above: true } : (a === 45 ? { ...open, foot: true } : wall)));
    const h = chooseFleeHeading(1, 0, lip);
    assert.equal(angleOf(h.hx, h.hz), 45);
    assert.equal(h.needJump, true, 'a real 1-block step still hops');
    const boxed = chooseFleeHeading(1, 0, probeFrom(() => wall));
    assert.equal(boxed.found, false, 'truly boxed → caller digs an escape (has pick) instead');
});
