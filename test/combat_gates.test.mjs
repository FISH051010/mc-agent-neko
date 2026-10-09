import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';
import {
    combatHasPriority, armoredSoloBrawl, rangedUnreachableTrap, isFutileMob, recordFightOutcome,
    unblacklistAttackers, FUTILE_FIGHT_STRIKES,
} from '../src/agent/combat_gates.js';

// T-0063 family — "战斗无能": reflexes fragmenting fights, boxed bots air-swinging at mobs behind walls,
// and a sword-holding bot that never commits. These gates arbitrate who owns the body around combat.

const P = new Vec3(0, 64, 0);
let nextId = 1;
const mob = (name, dx, dz = 0, dy = 0) => ({ id: nextId++, name, type: 'hostile', position: new Vec3(dx, 64 + dy, dz) });

function makeBot({ items = [], armor = [], mobs = [], mobility = null, hurtAgoMs = Infinity } = {}) {
    const slots = new Array(46).fill(null);
    armor.forEach((name, i) => { slots[5 + i] = { name }; });
    return {
        entity: { position: P.clone() },
        inventory: { items: () => items.map(name => ({ name, count: 1 })), slots },
        entities: Object.fromEntries(mobs.map(m => [m.id, m])),
        _mobility: mobility,
        lastDamageTime: Number.isFinite(hurtAgoMs) ? Date.now() - hurtAgoMs : 0,
        interrupt_code: false,
    };
}

test('C332/T-0063: point-blank killable mob + a sword → combat outranks the shallow-water get-out reflex', () => {
    assert.equal(combatHasPriority(makeBot({ items: ['iron_sword'], mobs: [mob('zombie', 2)] })), true);
    assert.equal(combatHasPriority(makeBot({ items: ['iron_pickaxe'], mobs: [mob('zombie', 2)] })), false, 'pickaxe is not a weapon — bare-handed brawl = death');
    assert.equal(combatHasPriority(makeBot({ items: ['iron_sword'], mobs: [mob('zombie', 6)] })), false, 'nothing in arm reach');
    assert.equal(combatHasPriority(makeBot({ items: ['iron_sword'], mobs: [mob('zombie', 2), mob('zombie', 4), mob('husk', 5)] })), false, 'swarmed (3+) → escape first');
    assert.equal(combatHasPriority(makeBot({ items: ['iron_sword'], mobs: [mob('creeper', 2)] })), false, 'creepers belong to self_preservation');
});

test('C367: armored + weapon + exactly ONE non-creeper mob → fight, never with a creeper near or a crowd', () => {
    const ok = { items: ['stone_sword'], armor: ['iron_helmet'] };
    assert.equal(armoredSoloBrawl(makeBot({ ...ok, mobs: [mob('skeleton', 9)] })), true, 'even a ranged skeleton out of melee reach');
    assert.equal(armoredSoloBrawl(makeBot({ ...ok, mobs: [mob('skeleton', 9), mob('zombie', 12)] })), false);
    assert.equal(armoredSoloBrawl(makeBot({ ...ok, mobs: [mob('zombie', 4), mob('creeper', 7)] })), false);
    assert.equal(armoredSoloBrawl(makeBot({ items: ['stone_sword', 'iron_helmet'], mobs: [mob('zombie', 4)] })), false, 'armor in the bag does not reduce damage');
});

test('C353/T-0063: boxed in a pocket, skeleton shooting from outside → disengage (let mobility dig out / forage)', () => {
    const boxed = { state: 'POCKET', enclosed: true, exits: [] };
    // live 06-27: skeleton d=0.4 behind the wall, 'Fighting skeleton!' ×10/3s, hp of the mob never moved.
    assert.equal(rangedUnreachableTrap(makeBot({ mobility: boxed, mobs: [mob('skeleton', 0.4)] })), true);
    assert.equal(rangedUnreachableTrap(makeBot({ mobility: null, mobs: [mob('skeleton', 5)] })), false, 'open ground: chase it');
});

test('C354/T-0063: fully boxed + melee mob behind the wall but NOT hurting us → unreachable; actually hurting us → fight back', () => {
    const boxed = { state: 'ENTOMBED', enclosed: true, exits: [] };
    assert.equal(rangedUnreachableTrap(makeBot({ mobility: boxed, mobs: [mob('spider', 4.1)] })), true, '石棺实锤 07-03 spider d=4.1');
    // C354 live 06-27 @91,53,160: zombie d=0.4 on the far side of the wall kept meleeReachable true forever →
    // bot air-swung at a skeleton from its pocket for days and starved. hp not dropping = the wall is real.
    assert.equal(rangedUnreachableTrap(makeBot({ mobility: boxed, mobs: [mob('skeleton', 3), mob('zombie', 0.4)] })), true);
    assert.equal(rangedUnreachableTrap(makeBot({ mobility: boxed, mobs: [mob('zombie', 1)], hurtAgoMs: 1000 })), false, '挨打必还手');
    const halfOpen = { state: 'POCKET', enclosed: true, exits: [{}] };
    assert.equal(rangedUnreachableTrap(makeBot({ mobility: halfOpen, mobs: [mob('zombie', 3), mob('skeleton', 6)] })), false, 'a reachable melee target keeps the fight');
});

test('C353 restart edge: bot._mobility not yet written → falls back to bot._world.mobility', () => {
    const b = makeBot({ mobs: [mob('skeleton', 3)] });
    b._world = { mobility: { state: 'SEALED', enclosed: true, exits: [] } };
    assert.equal(rangedUnreachableTrap(b), true);
});

test('C360/T-0063: same mob, N zero-progress fight cycles → blacklisted; getting hit by it lifts the blacklist', () => {
    const spider = mob('spider', 4.6);
    const bot = makeBot({ mobs: [spider] });
    bot._mobHurtAt = new Map();
    for (let i = 0; i < FUTILE_FIGHT_STRIKES; i++) {
        recordFightOutcome(bot, { id: spider.id, name: 'spider', t0: Date.now() - 4000, dist0: 4.6 });
    }
    assert.equal(isFutileMob(bot, spider), true, 'live 07-03: Fighting spider ×400 / 26min against a mob it could never reach');
    spider.position = new Vec3(2, 64, 0);
    bot.lastDamageTime = Date.now();
    unblacklistAttackers(bot, 'test');
    assert.equal(isFutileMob(bot, spider), false);
});

test('C360: a cycle where the target took damage or we closed in resets the tally (no false blacklist)', () => {
    const z = mob('zombie', 4);
    const bot = makeBot({ mobs: [z] });
    bot._mobHurtAt = new Map();
    for (let i = 0; i < FUTILE_FIGHT_STRIKES + 2; i++) {
        const t0 = Date.now() - 4000;
        if (i % 2) bot._mobHurtAt.set(z.id, Date.now());   // landed hits on alternate cycles
        recordFightOutcome(bot, { id: z.id, name: 'zombie', t0, dist0: 4 });
    }
    assert.equal(isFutileMob(bot, z), false);
});
