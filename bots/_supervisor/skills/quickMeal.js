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

// ★T-0204 (01:37:36-01:39:37Z 实录: bedErrand 侦察 112 段 111 段 "Path was stopped", 120s 只走 22b, 探针零外部打断者):
//   mineflayer-pathfinder 的 stop() 只置 stopPathing 标志, 等下一次 resetPath 才执行 — 没有在走的路径时标志一直留着,
//   下一次 goto 的 setGoal→resetPath 立刻 stop → 新路径当场被杀。每段结束 stop() + 被叫停后重试前又 stop() = 永远被杀。
//   停寻路一律用 setGoal(null): 立即清路径, 不留延迟标志。
export function haltPath(bot) {
    try { bot.pathfinder && bot.pathfinder.setGoal(null); } catch (e) {}
    try { bot.clearControlStates(); } catch (e) {}
}

/** 侦察航点: 有朝向线索(见过的动物)先朝它, 否则 8 方向螺旋外扩 (24→48→72→96)。纯函数, 供测试。 */
export function scoutWaypoints(origin, radius, toward) {
    const pts = [];
    if (toward && Number.isFinite(toward.x)) {
        // ★T-0213 (02:42-02:46Z 实录: 羊在 145-153b 外一直被追踪着, 定向侦察 100s 没走到 — 旧逻辑只放一个 145b 的直达点, 单段 20s
        //   超时走不到, 之后的航点全绕出发点转圈, 越走越远): 沿连线每 32b 一个中间点一路走到目标, 到了在目标周围 16b 转一圈,
        //   最后才退回出发点螺旋。
        const dx = toward.x - origin.x, dz = toward.z - origin.z, d = Math.hypot(dx, dz) || 1;
        const reach = Math.min(radius, d);
        const along = (s) => ({ x: origin.x + dx / d * s, z: origin.z + dz / d * s });
        for (let s = 32; s < reach; s += 32) pts.push(along(s));
        pts.push(along(reach));
        if (d <= radius) for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2, p = { x: toward.x + Math.cos(a) * 16, z: toward.z + Math.sin(a) * 16 };
            if (Math.hypot(p.x - origin.x, p.z - origin.z) <= radius) pts.push(p);
        }
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
        if (bot.interrupt_code) return false;   // ★T-0206
        haltPath(bot);
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

// ★T-0199 诊断 (监工: 00:58:26Z "scout: 70 legs, 0 unreachable, 69 stopped, moved 17b in 90.2s", hostiles=0 — 有东西持续打断 pathfinder):
//   侦察期间临时包住 bot.pathfinder.stop / setGoal, 按"第一个非 quickMeal / 非 pathfinder 库 / 非 node 内部"的调用帧归因计数,
//   记首次的 _bodyOwner / supervised; 侦察结束还原并写一行汇总 (限频: 只汇总, 不逐条刷)。纯诊断, 不改行为。
export function callerKey(stack) {
    // 去掉探针包装帧 (pf.stop / pf.setGoal, 定义在本文件) 后, 链里还有 quickMeal 自己 → 自身调用 (含经 skills.* 间接), 不计
    const frames = String(stack || '').split('\n').slice(1).map(s => s.trim()).filter(s => !/at (?:Object\.)?(?:note|pf\.stop|pf\.setGoal)\b|stopProbe/.test(s));   // 探针自身帧 (note/包装) 不算
    if (frames.some(s => /quickMeal\.js/.test(s))) return 'quickMeal(self)';
    // ★T-0199 二轮 (首轮只看到 stop@customSkill / setGoal@executePathfindingPhase, 都停在 skills.js 看不出谁调的): 记外部调用链前 3 帧
    const fmt = (f) => { const m = f.match(/at (?:async )?([^\s(]+)?\s*\(?(.*?):(\d+):\d+\)?$/); return m ? `${m[1] || '?'}@${(m[2] || '').split(/[\\/]/).pop()}:${m[3]}` : f.slice(0, 60); };
    const chain = frames.filter(s => !/mineflayer-pathfinder|node:internal|<anonymous>/.test(s)).slice(0, 3).map(fmt);
    return chain.length ? chain.join(' < ') : 'unknown';
}
function installStopProbe(bot) {
    const pf = bot && bot.pathfinder;
    if (!pf || typeof pf.stop !== 'function') return { restore() {}, summary: () => '' };
    const counts = new Map(); let firstOwner = null;
    const note = (kind) => {
        const lim = Error.stackTraceLimit; Error.stackTraceLimit = 30; const st = new Error('stopProbe').stack; Error.stackTraceLimit = lim;   // 默认 10 帧不够看到 customSkill 的调用者
        const key = `${kind}:${callerKey(st)}`;
        if (/quickMeal\(self\)$/.test(key)) return;
        counts.set(key, (counts.get(key) || 0) + 1);
        if (!firstOwner) { try { firstOwner = JSON.stringify({ owner: bot._bodyOwner && bot._bodyOwner.name, mob: bot._mobility && bot._mobility.state }); } catch (e) {} }
    };
    const origStop = pf.stop, origSet = pf.setGoal;
    pf.stop = function (...a) { note('stop'); return origStop.apply(this, a); };
    if (typeof origSet === 'function') pf.setGoal = function (g, ...a) { note(g ? 'setGoal' : 'setGoal(null)'); return origSet.call(this, g, ...a); };
    return {
        restore() { pf.stop = origStop; if (typeof origSet === 'function') pf.setGoal = origSet; },
        summary() { const top = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, n]) => `${k}×${n}`); return top.length ? `${top.join(', ')} | first ${firstOwner || '-'}` : ''; },
    };
}

export async function scoutForAnimal(bot, opts) {   // ★T-0202 导出: bedErrand 找羊复用同一套有界侦察
    const probe = installStopProbe(bot);
    try { return await scoutForAnimalInner(bot, opts); }
    finally { probe.restore(); const s = probe.summary(); if (s) prog(`scout interrupters (T-0199 probe): ${s}`); }
}

async function scoutForAnimalInner(bot, { radius, maxDy, scoutRadius, scoutMs, scoutToward, targetRe }) {
    const t0 = Date.now(), origin = bot.entity.position.clone ? bot.entity.position.clone() : { ...bot.entity.position };
    let legs = 0, legsFailed = 0, legsStopped = 0, stoppedRun = 0, stuckRun = 0, moved = 0, firstErr = null;
    setSafeMovements(bot);
    const wps = scoutWaypoints(origin, scoutRadius, scoutToward);
    for (let wi = 0; wi < wps.length; wi++) {
        if (Date.now() - t0 > scoutMs) break;
        if (bot.interrupt_code) { haltPath(bot); prog('scout interrupted (commitment flipped) — exit'); return null; }   // ★T-0206
        let wp = wps[wi];
        const hd = await hostileDecision(bot);
        if (hd.action === 'yield') {
            prog(`scout paused: ${hd.h.name} ${hd.h.dist.toFixed(1)}b (≤6 or closing) — yield to self_preservation, wait ≤15s`);
            if (!(await waitHostileClear(bot, Math.min(15000, Math.max(0, scoutMs - (Date.now() - t0)))))) { prog('scout deferred: hostile still near'); return 'hostile'; }
        } else if (hd.action === 'away') {
            const me = bot.entity.position;
            const ap = awayPoint(me, hd.h.pos, 24);
            if (Math.hypot(ap.x - origin.x, ap.z - origin.z) <= scoutRadius) { wp = ap; prog(`scout away from ${hd.h.name} ${hd.h.dist.toFixed(1)}b → (${Math.round(ap.x)},${Math.round(ap.z)})`); }
        }
        const found = pickHuntTarget(bot, radius, maxDy, targetRe);
        if (found) return found;
        const legMs = Math.min(20000, scoutMs - (Date.now() - t0));
        // ★T-0189 (23:21:15-17Z 实录: "bounded scout" 0.15-0.4s 就 "found nothing"; 上线以来只成功过一次): 旧 GoalNear 把目标高度钉在
        //   起点 y — 24-96 格外地形高低不一, 目标点不可达, pathfinder 立即拒绝, 33 个航点 0.2s 全败。改 GoalNearXZ (不限高度);
        //   单段不可达就换下一个点, 记首个失败原因, 全不可达时如实写进日志。
        const p0 = bot.entity.position, x0 = p0.x, z0 = p0.z;
        let err = null;
        try {
            const r = await raceI(bot, bot.pathfinder.goto(new goals.GoalNearXZ(Math.round(wp.x), Math.round(wp.z), 3)).then(() => 'ok', (e) => e), legMs);
            if (r && r !== 'ok') err = String((r && r.message) || r);
        } catch (e) { err = String(e && e.message || e); }
        haltPath(bot);
        const q = bot.entity.position;
        moved += Math.hypot(q.x - x0, q.z - z0);
        legs++;
        // ★T-0189 补 (23:38:08-26Z 实录: 苦力怕 12.5b, 32 段里 31 段 "Path was stopped before it could be completed" — 反射抢寻路
        //   把每段一开走就叫停, 侦察把航点一个个烧掉): 被外部叫停 ≠ 不可达 — 不耗航点, 等 1s 重试同一点;
        //   连续 3 次被叫停且附近有敌对 → 交给保命反射, 按延后返回 (不计 strike)。
        if (err && /stopped/i.test(err)) {
            legsStopped++; stoppedRun++;
            if (stoppedRun >= 3 && hostileWithin(bot, 16)) { prog(`scout deferred: path stopped ${stoppedRun}x by reflexes with hostile near`); return 'hostile'; }
            await new Promise(r => setTimeout(r, 1000));
            wi--;   // 重试同一航点
            continue;
        }
        stoppedRun = 0;
        if (err) { legsFailed++; if (!firstErr) firstErr = err.slice(0, 80); }
        // ★T-0214 (02:56:37-02:57:55Z 实录: 拂晓还封在夜坑里, 两轮各 42 段 moved 0b, 白跑 25s): 连续 6 段几乎没动 → 提前结束
        const legMoved = Math.hypot(bot.entity.position.x - x0, bot.entity.position.z - z0);
        stuckRun = legMoved < 0.5 ? stuckRun + 1 : 0;
        if (stuckRun >= 6) { prog(`scout: ${stuckRun} legs in a row without moving (sealed pit / no path) — stop early`); break; }
    }
    const last = pickHuntTarget(bot, radius, maxDy, targetRe);
    if (!last) prog(`scout: ${legs} legs, ${legsFailed} unreachable, ${legsStopped} stopped, moved ${moved.toFixed(0)}b in ${((Date.now() - t0) / 1000).toFixed(1)}s${firstErr ? ` (first fail: ${firstErr})` : ''}`);
    return last;
}

const PROG = path.resolve(process.cwd(), 'bots', '_supervisor', 'progress.txt');
const prog = (s) => { try { fs.appendFileSync(PROG, `[${new Date().toISOString()}] quickMeal: ${s}\n`); } catch (e) {} };
const RAW = ['beef', 'porkchop', 'mutton', 'rabbit', 'chicken'];
const COOKED = ['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_rabbit', 'cooked_chicken'];

export function pickHuntTarget(bot, radius, maxDy, targetRe = HUNTABLE_RE) {   // ★T-0202: targetRe 可只找羊 (bedErrand 复用)
    const me = bot.entity && bot.entity.position;
    if (!me) return null;
    let best = null, bd = Infinity;
    for (const e of Object.values(bot.entities || {})) {
        if (!e || !e.position || !targetRe.test(e.name || '')) continue;
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
// ★T-0206 (death #16 01:43:33-41Z: commitment 每秒翻 GET_BED→MIGRATE, bedErrand 8 秒不退, 原地无人驾驶被僵尸打):
//   等待一律可被 interrupt_code 打断 — 每 200ms 轮询, 被打断立即返回 'interrupted' (≤1s 退出)。
export const raceI = (bot, p, ms) => {
    let t = null, iv = null;
    return Promise.race([Promise.resolve(p).catch(() => null), new Promise(r => {
        t = setTimeout(r, Math.max(0, ms));
        iv = setInterval(() => { if (bot && bot.interrupt_code) r('interrupted'); }, 200);
    })]).finally(() => { clearTimeout(t); clearInterval(iv); });
};

export default async function quickMeal(bot, ctx, opts = {}) {
    const { skills, world } = ctx;
    const radius = opts.radius ?? 48, maxDy = opts.maxDy ?? 6, maxMs = opts.maxMs ?? 60000;
    // ⓪ 饿着在矿里 → 先上浮 (监工拍板: 在矿里的要先回地面觅食); 单独限时, 不吃猎杀的 60s 预算
    // ★监工加急#3: 阈值与 depthBand 同口径 (surface = y≥62); 旧 y<60 在 y60 跳过上浮 → 直接失败 3 连败冷却
    // ★T-0189 (23:21:15Z 实录: y61 本在地表 mob=FREE, "surfaced y 61→61" 空上浮): 头顶见天 (skyLight≥14) 就不上浮。
    if (opts.surfaceFirst && bot.entity && bot.entity.position && bot.entity.position.y < 62 && skyOpenAt(bot) !== true) {
        const y0 = Math.round(bot.entity.position.y);
        // ★T-0211 (death #17 02:37:09Z: 拂晓 y36 地下, 16 格内有僵尸, 上浮途中被打死): 上浮前有敌对 → 原地等 ≤15s (拂晓亡灵会晒死/走开),
        //   仍在 → 延后 (不计 strike), 不往怪堆里爬。
        if (hostileWithin(bot, 16)) {
            prog(`surfaceUp held: hostile within 16b underground — wait ≤15s before climbing`);
            if (!(await waitHostileClear(bot, 15000))) { prog('surfaceUp deferred: hostile still near'); return { deferred: true, reason: 'hostile-near-surfacing' }; }
        }
        prog(`starving underground y=${y0} food=${bot.food} — surfaceUp first (≤${Math.round((opts.surfaceMaxMs ?? 120000) / 1000)}s)`);
        await raceI(bot, skills.customSkill(bot, 'surfaceUp', 63), opts.surfaceMaxMs ?? 120000);
        haltPath(bot);
        prog(`surfaced y ${y0}→${Math.round(bot.entity.position.y)}`);
        if (bot.entity.position.y - y0 >= 8) opts = { ...opts, _surfaced: true };
    }
    let t0 = Date.now();
    const left = () => maxMs - (Date.now() - t0);
    const inv = () => { try { return world.getInventoryCounts(bot) || {}; } catch (e) { return {}; } };
    const rawHeld = () => RAW.reduce((s, n) => s + (inv()[n] || 0), 0);
    const food0 = bot.food;
    let gotMeat = false, ate = 0;
    const stopBody = () => { try { bot.pvp && bot.pvp.stop && bot.pvp.stop(); } catch (e) {} haltPath(bot); try { bot.clearControlStates(); } catch (e) {} };

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
                try { await raceI(bot, bot.pathfinder.goto(new goals.GoalNear(Math.floor(target.position.x), Math.floor(target.position.y), Math.floor(target.position.z), 2)), Math.min(left(), 20000)); } catch (e) {}
                haltPath(bot);
            };
            const d0 = target.position.distanceTo(bot.entity.position);
            await approach();
            // ★T-0167 (21:03:01 实录: y56 封闭地下, 猪在 44 格外地面 → 安全寻路 0s 无路, "approached → 44.4b" 照样出手,
            //   3 连败 FOOD_FLOOR 冷却 5min)。接近没缩短距离且人在地下 → 先上浮 (≤60s) 再接近一次。
            if (d0 - target.position.distanceTo(bot.entity.position) < 2 && bot.entity.position.y < 62 && skyOpenAt(bot) !== true && !opts._surfaced) {
                const y0 = Math.round(bot.entity.position.y);
                prog(`approach made no progress (${d0.toFixed(1)}b) underground y=${y0} — surfaceUp first (≤60s), then retry`);
                await raceI(bot, skills.customSkill(bot, 'surfaceUp', 63), Math.min(left(), 60000));
                haltPath(bot);
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
        await raceI(bot, skills.attackEntity(bot, target, true), Math.min(left(), 25000));
        stopBody();
        if (skills.pickupNearbyItems) await raceI(bot, skills.pickupNearbyItems(bot, 6), Math.min(left(), 8000));
        gotMeat = rawHeld() > r0;
        if (!gotMeat) prog(`hunt yielded no meat (target escaped / out of reach)`);
        // ★监工拍板: 会话猎杀计数 (world_model 锁存 SESSION_KILL_CAP=6 只后释放, 防打光一片再漫游)
        else if (bot._foodFloorLatch && bot._foodFloorLatch.active) bot._foodFloorLatch.kills = (bot._foodFloorLatch.kills || 0) + 1;
    }

    // ①.5 ★T-0191 (23:38:53-23:39:35Z 实录: food 0 时猎到 3 猪排全拿去烤, 生肉进了炉包里零可吃, 饥饿掉血 hp 5→2 才烤好):
    //   危急 (food≤3; 饥饿掉血只在 food=0 发生, 不用绝对血量门 — 技能层禁绝对 hp 门) 先生吃一块保命
    //   (生猪排/牛/羊/兔安全; 生鸡肉排除, RAW 里的 chicken 不在此档), 剩下的再烤。
    if (bot.food <= 3 && skills.consume) {
        const rawSafe = ['porkchop', 'beef', 'mutton', 'rabbit'].find(n => (inv()[n] || 0) > 0);
        if (rawSafe) {
            prog(`critical (hp=${Math.round(bot.health)} food=${bot.food}) — eat 1 raw ${rawSafe} now, cook the rest`);
            try { await raceI(bot, skills.consume(bot, rawSafe), 5000); ate++; } catch (e) {}
        }
    }

    // ② 就地烤
    const fuel = (inv().coal || 0) + (inv().charcoal || 0);
    if (fuel > 0 && left() > 15000) {
        for (const raw of RAW) {
            const n = inv()[raw] || 0;
            if (!n || left() < 12000) continue;
            prog(`cook ${n} ${raw} (fuel=${fuel})`);
            await raceI(bot, skills.customSkill(bot, 'smeltSafe', raw, n), left() - 2000);
        }
        stopBody();
    }

    // ③ 吃 (熟食优先, 无熟食吃生肉, 生鸡肉不吃)
    for (let i = 0; i < 4 && left() > 0 && bot.food < 18; i++) {
        const c = inv();
        const pick = COOKED.find(n => c[n] > 0) || ['beef', 'porkchop', 'mutton', 'rabbit'].find(n => c[n] > 0);
        if (!pick) break;
        try { await raceI(bot, skills.consume(bot, pick), Math.min(left(), 5000)); ate++; } catch (e) { break; }
    }
    prog(`done food ${food0}→${bot.food} ate=${ate} gotMeat=${gotMeat} in ${Math.round((Date.now() - t0) / 1000)}s`);
    if (ate > 0 || gotMeat || bot.food > food0) return { ok: true, ate, gotMeat, food: bot.food };
    if (opts._surfaced) return { ok: true, surfaced: true, ate, gotMeat };   // T-0167: 上浮本身是进度 (下一拍在地面重猎)
    return { failed: true, reason: 'no-progress' };
}
