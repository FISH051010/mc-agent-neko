// ★T-0069 FOOD_FLOOR 执行技能 — 有界短猎 + 就地烤 + 吃。不漫游 (用户 07-08 令 MC_FOOD_INSTINCTS=0 的边界内)。
//   ① 背包无生肉 → 只打 radius 格内、高差 ≤ maxDy 的一只可猎动物 (找不到 = 如实失败, 不去找)
//   ② 有煤/木炭 + 生肉 → smeltSafe 就地烤 (熔炉现造, 圆石来自挖矿库存)
//   ③ 吃: 熟食优先; 无熟食时吃生肉 (生鸡肉除外: 30% 饥饿效果)
//   全程 ≤ maxMs; 超时停寻路/PVP 收手。返回契约: 有进食/得肉 = truthy; 零进展 = {failed:true} (kernel 3 连败冷却)。
// Invoked via: {"skill":"quickMeal","args":[{"radius":16,"maxDy":4,"maxMs":60000}]}
// ctx = { skills, world, mc, Vec3, log }
import fs from 'fs';
import path from 'path';
import { HUNTABLE_RE } from '../../../src/agent/framework/food_floor.js';

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
        const d = e.position.distanceTo(me);
        if (d <= radius && d < bd) { bd = d; best = e; }
    }
    return best;
}

const race = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), new Promise(r => setTimeout(r, Math.max(0, ms)))]);

export default async function quickMeal(bot, ctx, opts = {}) {
    const { skills, world } = ctx;
    const radius = opts.radius ?? 16, maxDy = opts.maxDy ?? 4, maxMs = opts.maxMs ?? 60000;
    const t0 = Date.now();
    const left = () => maxMs - (Date.now() - t0);
    const inv = () => { try { return world.getInventoryCounts(bot) || {}; } catch (e) { return {}; } };
    const rawHeld = () => RAW.reduce((s, n) => s + (inv()[n] || 0), 0);
    const food0 = bot.food;
    let gotMeat = false, ate = 0;
    const stopBody = () => { try { bot.pvp && bot.pvp.stop && bot.pvp.stop(); } catch (e) {} try { bot.pathfinder && bot.pathfinder.stop(); } catch (e) {} try { bot.clearControlStates(); } catch (e) {} };

    // ① 短猎
    if (rawHeld() === 0) {
        const target = pickHuntTarget(bot, radius, maxDy);
        if (!target) { prog(`no huntable animal within ${radius}b/dy${maxDy} — honest fail (no roaming)`); return { failed: true, reason: 'no-animal-in-radius' }; }
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
