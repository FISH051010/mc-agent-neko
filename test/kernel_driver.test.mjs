import assert from 'node:assert/strict';
import test from 'node:test';
import { reflexBusy, famineStall, noopIsProgress, noopEscapePlan } from '../bots/_supervisor/skills/kernelDriver.js';

// kernelDriver is the sole top-level dispatcher. Every case where reflexBusy() wrongly returns true
// while the reflex layer has nothing to do = nobody dispatches = FROZEN-ALIVE (pos/hp pinned while
// vitals keep ticking — the T-0062 symptom family).

const mkBot = ({ mob, enclosed = false, threat = {}, vitals = { food: 20 }, food } = {}) => ({
    _mobility: mob === undefined ? undefined : { state: mob, enclosed },
    _world: { threat, vitals },
    food,
});

test('T-0083: enclosed=true but mobility already released to FREE → NOT reflex-busy (kernel must dispatch)', () => {
    // live -24,50,-31 / -92,18,-102: underground = "enclosed" by definition; mobility FREE won't act,
    // a standalone enclosed gate made kernelDriver yield forever → 6-20min 站桩冻死.
    assert.equal(reflexBusy(mkBot({ mob: 'FREE', enclosed: true })), false);
    assert.equal(reflexBusy(mkBot({ mob: null, enclosed: true })), false);
});

test('T-0083: active rescue states and actionable threats still yield to the reflex layer', () => {
    for (const st of ['ENTOMBED', 'POCKET', 'MAROONED', 'SEALED', 'SWIM']) {
        assert.equal(reflexBusy(mkBot({ mob: st })), true, st);
    }
    assert.equal(reflexBusy(mkBot({ mob: 'FREE', threat: { actionable: 1 } })), true);
    assert.equal(reflexBusy(mkBot({ mob: 'FREE' })), false);
});

test('T-0182 #34: actionable 威胁让位须有反射持身 — 8s 无任何 mode 接手 → 恢复派发; 反射持身则一直让', async () => {
    const { actionableYieldHeld, ACTIONABLE_YIELD_MS } = await import('../bots/_supervisor/skills/kernelDriver.js');
    const b = mkBot({ mob: 'FREE', threat: { actionable: 1 } });
    const t0 = 1_000_000;
    assert.equal(actionableYieldHeld(b, t0), true, 'first sight: give the reflexes a window');
    assert.equal(actionableYieldHeld(b, t0 + ACTIONABLE_YIELD_MS - 1), true);
    assert.equal(actionableYieldHeld(b, t0 + ACTIONABLE_YIELD_MS + 1), false, 'nobody took the body (unarmed exemption etc.) → dispatch');
    b._bodyOwner = { name: 'mode:self_defense', kind: 'mode' };
    assert.equal(actionableYieldHeld(b, t0 + 60000), true, 'a reflex is driving → keep yielding');
    b._bodyOwner = null;
    assert.equal(actionableYieldHeld(b, t0 + 60001), true, 'window restarts after the reflex lets go');
    const calm = mkBot({ mob: 'FREE' });
    calm._actionableIdleSince = t0;
    reflexBusy(calm);
    assert.equal(calm._actionableIdleSince, 0, 'threat gone → window reset');
});

test('T-0206 death #16 战斗: 反射 mode 持身时 kernel 的承诺翻转中断 (全局 interrupt_code) 必须推迟 — 否则每秒杀掉 defendSelf', async () => {
    const fs = await import('node:fs');
    const { flipInterruptAllowed } = await import('../bots/_supervisor/skills/kernelDriver.js');
    assert.equal(flipInterruptAllowed({ _bodyOwner: { name: 'mode:self_defense', kind: 'mode' } }), false);
    assert.equal(flipInterruptAllowed({ _bodyOwner: { name: 'kernel:bedErrand', kind: 'skill' } }), true);
    assert.equal(flipInterruptAllowed({ _bodyOwner: null }), true);
    const kd = fs.readFileSync(new URL('../bots/_supervisor/skills/kernelDriver.js', import.meta.url), 'utf8');
    const w = kd.slice(kd.indexOf('if (kindFlip || idFlip) {'), kd.indexOf('bot.interrupt_code = true;', kd.indexOf('if (kindFlip || idFlip) {')));
    assert.match(w, /if \(!flipInterruptAllowed\(bot\)\)[\s\S]*return;/, 'gate sits before raising interrupt_code');
    const sk = fs.readFileSync(new URL('../src/agent/library/skills.js', import.meta.url), 'utf8');
    const ds = sk.slice(sk.indexOf('export async function defendSelf'), sk.indexOf('// ───────────────────────── DIG PRIMITIVES'));
    assert.match(ds, /if \(bot\.interrupt_code\) \{\s*bot\.pvp\.stop\(\);/, 'premise: defendSelf bails on the global flag (why the kernel must not raise it mid-fight)');
});

test('T-0206 death #16 先手: self_defense 在近战怪 ≤8b 走近时先换武器 (不夺身体, 挖掘中不换)', async () => {
    const fs = await import('node:fs');
    const m = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    assert.match(m, /if \(!enemy && hasWeapon && !bot\.targetDigBlock && Date\.now\(\) - \(this\._preEquipAt \|\| 0\) > 3000\)/);
    assert.match(m, /_closing && !\/_sword\$\|_axe\$\/\.test\(_held\)[\s\S]{0,400}bot\.equip\(_w, 'hand'\)/);
});

test('T-0101: famine stall (food<=2, no lethal threat) overrides POCKET/threat yield so GET_FOOD can dispatch', () => {
    // 9h 实锤: creeper hunger hold — food=0 in a sealed box, reflexBusy kept yielding → 冻 150min 饿死.
    const starving = { food: 0, canRegen: false };
    assert.equal(famineStall(mkBot({ mob: 'POCKET', vitals: starving })), true);
    assert.equal(reflexBusy(mkBot({ mob: 'POCKET', vitals: starving })), false);
    assert.equal(reflexBusy(mkBot({ mob: 'FREE', vitals: starving, threat: { actionable: 1 } })), false,
        'one reachable mob is not lethal; foraging skills carry their own hostile gates');
});

test('T-0101: famine override never fires under a REAL lethal threat', () => {
    const starving = { food: 1, canRegen: false };
    for (const threat of [{ creeperDist: 3 }, { takingDamage: true }, { actionable: 2 }]) {
        assert.equal(famineStall(mkBot({ mob: 'POCKET', vitals: starving, threat })), false, JSON.stringify(threat));
        assert.equal(reflexBusy(mkBot({ mob: 'POCKET', vitals: starving, threat })), true, JSON.stringify(threat));
    }
    assert.equal(famineStall(mkBot({ vitals: { food: 5 } })), false, 'food 5 is not a famine');
});

test('T-0110: no-op spin — junk-only creep is NOT progress; hop / descent / ore gain is', () => {
    const anchor = { x: 88, y: 66, z: 10 };
    assert.equal(noopIsProgress(anchor, 20, { x: 91, y: 65, z: 12 }, 20), false, 'wiggling in place');
    assert.equal(noopIsProgress(anchor, 20, { x: 98, y: 66, z: 10 }, 20), true, '>8b horizontal');
    assert.equal(noopIsProgress(anchor, 20, { x: 88, y: 60, z: 10 }, 20), true, '>4b descent');
    assert.equal(noopIsProgress(anchor, 20, { x: 88, y: 66, z: 10 }, 30), true, 'ore/log gain');
});

test('T-0110: no-op escape — day→migrate, night→nightShelter; blocked by sealed night hold / combat / deep mining', () => {
    assert.equal(noopEscapePlan({ time: { isDay: true }, pos: { depthBand: 'surface' } }), 'migrate');
    assert.equal(noopEscapePlan({}), 'migrate');
    assert.equal(noopEscapePlan({ time: { isDay: false }, cover: { coverReal: false } }), 'nightShelter');
    assert.equal(noopEscapePlan({ time: { isDay: false }, cover: { coverReal: true } }), null, 'legit sealed night hold');
    assert.equal(noopEscapePlan({ threat: { actionable: 1 } }), null);
    assert.equal(noopEscapePlan({ threat: { takingDamage: true } }), null);
    // DEPTH GATE: live death — escape on barren branchMine @y18 → migrate up through terrain → SUFFOCATION.
    assert.equal(noopEscapePlan({ pos: { depthBand: 'mid' } }), null);
    assert.equal(noopEscapePlan({ pos: { depthBand: 'deep' } }), null);
});

test('T-0105: a night/hold commitment (NIGHT_DIG_ONE sealed-pocket hold) is never a no-op escape, even once world_model flips to day at dawn', () => {
    const dawn = { time: { isDay: true }, cover: { coverReal: true }, pos: { depthBand: 'surface' } };
    assert.equal(noopEscapePlan(dawn, 'NIGHT_DIG_ONE'), null);
    assert.equal(noopEscapePlan({ time: { isDay: false }, cover: { coverReal: false } }, 'NIGHT_SEAL'), null);
    assert.equal(noopEscapePlan(dawn, 'HOLD'), null);
    assert.equal(noopEscapePlan(dawn, 'REPLENISH_KIT'), 'migrate', 'daytime work kinds still escape a real no-op pin');
});
