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
import { HUNTABLE_RE, skyOpenAt } from '../../../src/agent/framework/food_floor.js';
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

/** hp=1 安全寻路: 最多下落 2 格 (3 格内无摔伤)、不跑酷、不挖、水极贵。 */
function setSafeMovements(bot) {
    try {
        const mv = new Movements(bot);
        mv.maxDropDown = 2; mv.allowParkour = false; mv.canDig = false; mv.allow1by1towers = false; mv.liquidCost = 1000;
        bot.pathfinder.setMovements(mv);
    } catch (e) {}
}

/** ★监工加急 #2 有界侦察: hp=1 任何伤害致死 → 安全寻路 (最多下落 2 格、不跑酷、不挖、水极贵), 16 格内有敌对立即收手。 */
// ★18:16:41 实录 (黎明): 16 格内有敌对 → 侦察秒中止 ×3 → 计 strike 冷却 5min。黎明亡灵几秒内就晒死 —
//   先原地不动等它消失 (≤maxWaitMs, 计入总上限), 仍在才放弃, 且放弃算"延后"不算失败。
export async function waitHostileClear(bot, maxWaitMs, stepMs = 1000) {
    const t0 = Date.now();
    while (hostileWithin(bot, 16)) {
        if (Date.now() - t0 >= maxWaitMs) return false;
        try { bot.pathfinder && bot.pathfinder.stop(); bot.clearControlStates(); } catch (e) {}
        await new Promise(r => setTimeout(r, stepMs));
    }
    return true;
}

export function nearestHostile(bot) {
    const me = bot.entity && bot.entity.position;
    if (!me) return null;
    let best = null;
    for (const e of Object.values(bot.entities || {})) {
        if (!e || !e.position || !HOSTILE_RE.test(e.name || '')) continue;
        const d = e.position.distanceTo(me);
        if (!best || d < best.dist) best = { name: e.name, pos: e.position, dist: d, entity: e };
    }
    return best;
}

/** 背离敌对的航点 (纯函数): 从 me 沿 (me - hostile) 方向走 dist 格。 */
export function awayPoint(me, hostilePos, dist) {
    const dx = me.x - hostilePos.x, dz = me.z - hostilePos.z, d = Math.hypot(dx, dz) || 1;
    return { x: me.x + dx / d * dist, z: me.z + dz / d * dist };
}

// ★监工#5 (18:16:44 实录: 苦力怕自昨夜贴身打转, 白天不晒死, 侦察秒收手×3 → 冷却): 敌对在 6-16 格且没在逼近
//   → 背离它侦察 (人类 1 血见苦力怕: 走开去找吃的); 只有 ≤6 格或正在逼近才收手, 交给 self_preservation。
async function hostileDecision(bot) {
    const h1 = nearestHostile(bot);
    if (!h1 || h1.dist >= 16) return { action: 'go' };
    if (h1.dist <= 6) return { action: 'yield', h: h1 };
    await new Promise(r => setTimeout(r, 600));
    const h2 = nearestHostile(bot);
    if (h2 && h2.dist <= 6) return { action: 'yield', h: h2 };
    if (h2 && h2.dist < h1.dist - 0.4) return { action: 'yield', h: h2 };   // 正在逼近
    return { action: 'away', h: h2 || h1 };
}

async function scoutForAnimal(bot, { radius, maxDy, scoutRadius, scoutMs, scoutToward }) {
    const t0 = Date.now(), origin = bot.entity.position.clone ? bot.entity.position.clone() : { ...bot.entity.position };
    let legs = 0, legsFailed = 0, moved = 0, firstErr = null;
    setSafeMovements(bot);
    for (const wp0 of scoutWaypoints(origin, scoutRadius, scoutToward)) {
        if (Date.now() - t0 > scoutMs) break;
        let wp = wp0;
        const hd = await hostileDecision(bot);
        if (hd.action === 'yield') {
            prog(`scout paused: ${hd.h.name} ${hd.h.dist.toFixed(1)}b (≤6 or closing) — yield to self_preservation, wait ≤15s`);
            if (!(await waitHostileClear(bot, Math.min(15000, Math.max(0, scoutMs - (Date.now() - t0)))))) { prog('scout deferred: hostile still near'); return 'hostile'; }
        } else if (hd.action === 'away') {
            const me = bot.entity.position;
            const ap = awayPoint(me, hd.h.pos, 24);
            if (Math.hypot(ap.x - origin.x, ap.z - origin.z) <= scoutRadius) { wp = ap; prog(`scout away from ${hd.h.name} ${hd.h.dist.toFixed(1)}b → (${Math.round(ap.x)},${Math.round(ap.z)})`); }
        }
        const found = pickHuntTarget(bot, radius, maxDy);
        if (found) return found;
        const legMs = Math.min(20000, scoutMs - (Date.now() - t0));
        // ★T-0189 (23:21:15-17Z 实录: "bounded scout" 0.15-0.4s 就 "found nothing"; 上线以来只成功过一次): 旧 GoalNear 把目标高度钉在
        //   起点 y — 24-96 格外地形高低不一, 目标点不可达, pathfinder 立即拒绝, 33 个航点 0.2s 全败。改 GoalNearXZ (不限高度);
        //   单段不可达就换下一个点, 记首个失败原因, 全不可达时如实写进日志。
        const p0 = bot.entity.position, x0 = p0.x, z0 = p0.z;
        try {
            const r = await race(bot.pathfinder.goto(new goals.GoalNearXZ(Math.round(wp.x), Math.round(wp.z), 3)).then(() => 'ok', (e) => e), legMs);
            if (r && r !== 'ok') { legsFailed++; if (!firstErr) firstErr = String((r && r.message) || r).slice(0, 80); }
        } catch (e) { legsFailed++; if (!firstErr) firstErr = String(e && e.message || e).slice(0, 80); }
        try { bot.pathfinder.stop(); bot.clearControlStates(); } catch (e) {}
        const q = bot.entity.position;
        moved += Math.hypot(q.x - x0, q.z - z0);
        legs++;
    }
    const last = pickHuntTarget(bot, radius, maxDy);
    if (!last) prog(`scout: ${legs} legs, ${legsFailed} unreachable, moved ${moved.toFixed(0)}b in ${((Date.now() - t0) / 1000).toFixed(1)}s${firstErr ? ` (first fail: ${firstErr})` : ''}`);
    return last;
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

const race = (p, ms) => {
    let timer = null;
    const deadline = new Promise(r => { timer = setTimeout(r, Math.max(0, ms)); });
    return Promise.race([Promise.resolve(p).catch(() => null), deadline]).finally(() => clearTimeout(timer));   // 不留悬挂计时器
};

export default async function quickMeal(bot, ctx, opts = {}) {
    const { skills, world } = ctx;
    const radius = opts.radius ?? 48, maxDy = opts.maxDy ?? 6, maxMs = opts.maxMs ?? 60000;
    // ⓪ 饿着在矿里 → 先上浮 (监工拍板: 在矿里的要先回地面觅食); 单独限时, 不吃猎杀的 60s 预算
    // ★监工加急#3: 阈值与 depthBand 同口径 (surface = y≥62); 旧 y<60 在 y60 跳过上浮 → 直接失败 3 连败冷却
    // ★T-0189 (23:21:15Z 实录: y61 本在地表 mob=FREE, "surfaced y 61→61" 空上浮): 头顶见天 (skyLight≥14) 就不上浮。
    if (opts.surfaceFirst && bot.entity && bot.entity.position && bot.entity.position.y < 62 && skyOpenAt(bot) !== true) {
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
            // ★监工#5: 因敌对收手 = unwind 语义, 不计 strike (返回非失败的 deferred, kernel 1.5s 后重派, 每次最多等 15s)
            if (target === 'hostile') return { deferred: true, reason: 'hostile-near' };
            prog(target ? `scout found ${target.name}` : 'scout found nothing');
            t0 = Date.now();   // 侦察有自己的 ≤scoutMs 上限; 猎杀/烤/吃重新计 maxMs
            if (!target) return opts._surfaced ? { ok: true, surfaced: true, scouted: true } : { failed: true, reason: 'scout-found-nothing' };
        }
        if (!target) {
            prog(`no huntable animal within ${radius}b/dy${maxDy} — ${opts._surfaced ? 'surfaced (progress), no hunt' : 'honest fail (no roaming)'}`);
            return opts._surfaced ? { ok: true, surfaced: true } : { failed: true, reason: 'no-animal-in-radius' };
        }
        prog(`hunt ${target.name} @${target.position.distanceTo(bot.entity.position).toFixed(1)}b (food=${bot.food})`);
        const r0 = rawHeld();
        // ★18:04:35 实录: attackEntity 预检"远于 4 格且无清晰路径就放弃" → 41.7 格的羊 0 秒收手、零肉。
        //   先安全寻路贴近 (≤2 格, 限时 20s; 动物会走动, 用实时 position), 再出手。
        if (target.position.distanceTo(bot.entity.position) > 3.5) {
            const approach = async () => {
                setSafeMovements(bot);
                try { await race(bot.pathfinder.goto(new goals.GoalNear(Math.floor(target.position.x), Math.floor(target.position.y), Math.floor(target.position.z), 2)), Math.min(left(), 20000)); } catch (e) {}
                try { bot.pathfinder.stop(); } catch (e) {}
            };
            const d0 = target.position.distanceTo(bot.entity.position);
            await approach();
            // ★T-0167 (21:03:01 实录: y56 封闭地下, 猪在 44 格外地面 → 安全寻路 0s 无路, "approached → 44.4b" 照样出手,
            //   3 连败 FOOD_FLOOR 冷却 5min)。接近没缩短距离且人在地下 → 先上浮 (≤60s) 再接近一次。
            if (d0 - target.position.distanceTo(bot.entity.position) < 2 && bot.entity.position.y < 62 && skyOpenAt(bot) !== true && !opts._surfaced) {
                const y0 = Math.round(bot.entity.position.y);
                prog(`approach made no progress (${d0.toFixed(1)}b) underground y=${y0} — surfaceUp first (≤60s), then retry`);
                await race(skills.customSkill(bot, 'surfaceUp', 63), Math.min(left(), 60000));
                try { bot.pathfinder && bot.pathfinder.stop(); bot.clearControlStates(); } catch (e) {}
                prog(`surfaced y ${y0}→${Math.round(bot.entity.position.y)}`);
                if (bot.entity.position.y - y0 >= 4) opts = { ...opts, _surfaced: true };
                if (target.isValid !== false && left() > 5000) await approach();
            }
            const hd = await hostileDecision(bot);   // 同侦察口径: ≤6 格或逼近才收手; 6-16 格不逼近 → 继续猎 (目标就在眼前)
            if (hd.action === 'yield' && !(await waitHostileClear(bot, Math.min(15000, Math.max(0, left()))))) {
                prog(`approach deferred: ${hd.h.name} ${hd.h.dist.toFixed(1)}b (hp-critical)`); stopBody(); return { deferred: true, reason: 'hostile-near' };
            }
            prog(`approached ${target.name} → ${target.position.distanceTo(bot.entity.position).toFixed(1)}b`);
        }
        await race(skills.attackEntity(bot, target, true), Math.min(left(), 25000));
        stopBody();
        if (skills.pickupNearbyItems) await race(skills.pickupNearbyItems(bot, 6), Math.min(left(), 8000));
        gotMeat = rawHeld() > r0;
        if (!gotMeat) prog(`hunt yielded no meat (target escaped / out of reach)`);
        // ★监工拍板: 会话猎杀计数 (world_model 锁存 SESSION_KILL_CAP=6 只后释放, 防打光一片再漫游)
        else if (bot._foodFloorLatch && bot._foodFloorLatch.active) bot._foodFloorLatch.kills = (bot._foodFloorLatch.kills || 0) + 1;
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
    if (opts._surfaced) return { ok: true, surfaced: true, ate, gotMeat };   // T-0167: 上浮本身是进度 (下一拍在地面重猎)
    return { failed: true, reason: 'no-progress' };
}
