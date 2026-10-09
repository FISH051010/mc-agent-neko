// ★T-0069 FOOD_FLOOR 执行技能 — 有界短猎 + 就地烤 + 吃。不漫游 (用户 07-08 令 MC_FOOD_INSTINCTS=0 的边界内)。
//   ① 背包无生肉 → 只打 radius 格内、高差 ≤ maxDy 的一只可猎动物 (找不到 = 如实失败, 不去找)
//   ② 有煤/木炭 + 生肉 → smeltSafe 就地烤 (熔炉现造, 圆石来自挖矿库存)
//   ③ 吃: 熟食优先; 无熟食时吃生肉 (生鸡肉除外: 30% 饥饿效果)
//   全程 ≤ maxMs; 超时停寻路/PVP 收手。返回契约: 有进食/得肉 = truthy; 零进展 = {failed:true} (kernel 3 连败冷却)。
// Invoked via: {"skill":"quickMeal","args":[{"radius":16,"maxDy":4,"maxMs":60000}]}
// ctx = { skills, world, mc, Vec3, log }
import fs from 'fs';
import path from 'path';
import mfp from 'mineflayer-pathfinder';
import { HUNTABLE_RE } from '../../../src/agent/framework/food_floor.js';
const { goals, Movements } = mfp;
const HOSTILE_RE = /zombie|skeleton|creeper|spider|witch|enderman|drowned|husk|stray|phantom|slime|piglin|silverfish|cave_spider|pillager|vindicator/i;

export function hostileWithin(bot, r) {
    const me = bot.entity && bot.entity.position;
    if (!me) return false;
    return Object.values(bot.entities || {}).some(e => e && e.position && HOSTILE_RE.test(e.name || '') && e.position.distanceTo(me) < r);
}

/** 侦察航点: 有朝向线索(见过的动物)先朝它, 否则 8 方向螺旋外扩 (24→48→72→96)。纯函数, 供测试。 */
export function scoutWaypoints(origin, radius, toward) {
    const pts = [];
    if (toward && Number.isFinite(toward.x)) {
        const dx = toward.x - origin.x, dz = toward.z - origin.z, d = Math.hypot(dx, dz) || 1;
        const reach = Math.min(radius, d);
        pts.push({ x: origin.x + dx / d * reach, z: origin.z + dz / d * reach });
    }
    for (let r = 24; r <= radius; r += 24)
        for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + r / 24; pts.push({ x: origin.x + Math.cos(a) * r, z: origin.z + Math.sin(a) * r }); }
    return pts;
}

/** ★监工加急 #2 有界侦察: hp=1 任何伤害致死 → 安全寻路 (最多下落 2 格、不跑酷、不挖、水极贵), 16 格内有敌对立即收手。 */
async function scoutForAnimal(bot, { radius, maxDy, scoutRadius, scoutMs, scoutToward }) {
    const t0 = Date.now(), origin = bot.entity.position.clone ? bot.entity.position.clone() : { ...bot.entity.position };
    try {
        const mv = new Movements(bot);
        mv.maxDropDown = 2; mv.allowParkour = false; mv.canDig = false; mv.allow1by1towers = false; mv.liquidCost = 1000;
        bot.pathfinder.setMovements(mv);
    } catch (e) {}
    for (const wp of scoutWaypoints(origin, scoutRadius, scoutToward)) {
        if (Date.now() - t0 > scoutMs) break;
        if (hostileWithin(bot, 16)) { prog('scout aborted: hostile within 16b (hp-critical)'); break; }
        const found = pickHuntTarget(bot, radius, maxDy);
        if (found) return found;
        const legMs = Math.min(20000, scoutMs - (Date.now() - t0));
        try {
            await race(bot.pathfinder.goto(new goals.GoalNear(Math.round(wp.x), Math.round(origin.y), Math.round(wp.z), 3)), legMs);
        } catch (e) {}
        try { bot.pathfinder.stop(); bot.clearControlStates(); } catch (e) {}
    }
    return pickHuntTarget(bot, radius, maxDy);
}

const PROG = path.resolve(process.cwd(), 'bots', '_supervisor', 'progress.txt');
const prog = (s) => { try { fs.appendFileSync(PROG, `[${new Date().toISOString()}] quickMeal: ${s}\n`); } catch (e) {} };
const RAW = ['beef', 'porkchop', 'mutton', 'rabbit', 'chicken'];
const COOKED = ['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_rabbit', 'cooked_chicken'];

export function pickHuntTarget(bot, radius, maxDy) {
    const me = bot.entity && bot.entity.position;
    if (!me) return null;
    let best = null, bd = Infinity;
    for (const e of Object.values(bot.entities || {})) {
        if (!e || !e.position || !HUNTABLE_RE.test(e.name || '')) continue;
        if (Math.abs(e.position.y - me.y) > maxDy) continue;
        const d = Math.hypot(e.position.x - me.x, e.position.z - me.z);   // 监工口径: 半径按水平距离
        if (d <= radius && d < bd) { bd = d; best = e; }
    }
    return best;
}

const race = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), new Promise(r => setTimeout(r, Math.max(0, ms)))]);

export default async function quickMeal(bot, ctx, opts = {}) {
    const { skills, world } = ctx;
    const radius = opts.radius ?? 48, maxDy = opts.maxDy ?? 6, maxMs = opts.maxMs ?? 60000;
    // ⓪ 饿着在矿里 → 先上浮 (监工拍板: 在矿里的要先回地面觅食); 单独限时, 不吃猎杀的 60s 预算
    if (opts.surfaceFirst && bot.entity && bot.entity.position && bot.entity.position.y < 60) {
        const y0 = Math.round(bot.entity.position.y);
        prog(`starving underground y=${y0} food=${bot.food} — surfaceUp first (≤${Math.round((opts.surfaceMaxMs ?? 120000) / 1000)}s)`);
        await race(skills.customSkill(bot, 'surfaceUp', 63), opts.surfaceMaxMs ?? 120000);
        try { bot.pathfinder && bot.pathfinder.stop(); bot.clearControlStates(); } catch (e) {}
        prog(`surfaced y ${y0}→${Math.round(bot.entity.position.y)}`);
        if (bot.entity.position.y - y0 >= 8) opts = { ...opts, _surfaced: true };
    }
    let t0 = Date.now();
    const left = () => maxMs - (Date.now() - t0);
    const inv = () => { try { return world.getInventoryCounts(bot) || {}; } catch (e) { return {}; } };
    const rawHeld = () => RAW.reduce((s, n) => s + (inv()[n] || 0), 0);
    const food0 = bot.food;
    let gotMeat = false, ate = 0;
    const stopBody = () => { try { bot.pvp && bot.pvp.stop && bot.pvp.stop(); } catch (e) {} try { bot.pathfinder && bot.pathfinder.stop(); } catch (e) {} try { bot.clearControlStates(); } catch (e) {} };

    // ① 短猎
    if (rawHeld() === 0) {
        let target = pickHuntTarget(bot, radius, maxDy);
        if (!target && opts.scout) {
            prog(`starving, no animal ≤${radius}b — bounded scout ≤${opts.scoutRadius ?? 96}b/${Math.round((opts.scoutMs ?? 90000) / 1000)}s`);
            target = await scoutForAnimal(bot, { radius, maxDy, scoutRadius: opts.scoutRadius ?? 96, scoutMs: opts.scoutMs ?? 90000, scoutToward: opts.scoutToward });
            prog(target ? `scout found ${target.name}` : 'scout found nothing');
            t0 = Date.now();   // 侦察有自己的 ≤scoutMs 上限; 猎杀/烤/吃重新计 maxMs
            if (!target) return { failed: true, reason: 'scout-found-nothing' };
        }
        if (!target) {
            prog(`no huntable animal within ${radius}b/dy${maxDy} — ${opts._surfaced ? 'surfaced (progress), no hunt' : 'honest fail (no roaming)'}`);
            return opts._surfaced ? { ok: true, surfaced: true } : { failed: true, reason: 'no-animal-in-radius' };
        }
        prog(`hunt ${target.name} @${target.position.distanceTo(bot.entity.position).toFixed(1)}b (food=${bot.food})`);
        const r0 = rawHeld();
        await race(skills.attackEntity(bot, target, true), Math.min(left(), 25000));
        stopBody();
        if (skills.pickupNearbyItems) await race(skills.pickupNearbyItems(bot, 6), Math.min(left(), 8000));
        gotMeat = rawHeld() > r0;
        if (!gotMeat) prog(`hunt yielded no meat (target escaped / out of reach)`);
    }

    // ② 就地烤
    const fuel = (inv().coal || 0) + (inv().charcoal || 0);
    if (fuel > 0 && left() > 15000) {
        for (const raw of RAW) {
            const n = inv()[raw] || 0;
            if (!n || left() < 12000) continue;
            prog(`cook ${n} ${raw} (fuel=${fuel})`);
            await race(skills.customSkill(bot, 'smeltSafe', raw, n), left() - 2000);
        }
        stopBody();
    }

    // ③ 吃 (熟食优先, 无熟食吃生肉, 生鸡肉不吃)
    for (let i = 0; i < 4 && left() > 0 && bot.food < 18; i++) {
        const c = inv();
        const pick = COOKED.find(n => c[n] > 0) || ['beef', 'porkchop', 'mutton', 'rabbit'].find(n => c[n] > 0);
        if (!pick) break;
        try { await race(skills.consume(bot, pick), Math.min(left(), 5000)); ate++; } catch (e) { break; }
    }
    prog(`done food ${food0}→${bot.food} ate=${ate} gotMeat=${gotMeat} in ${Math.round((Date.now() - t0) / 1000)}s`);
    if (ate > 0 || gotMeat || bot.food > food0) return { ok: true, ate, gotMeat, food: bot.food };
    return { failed: true, reason: 'no-progress' };
}
