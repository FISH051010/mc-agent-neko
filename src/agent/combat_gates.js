// Combat-reflex gates moved verbatim out of modes.js (T-0063 family: C332 combatHasPriority, C367
// armoredSoloBrawl, C353/C354 rangedUnreachableTrap, C360 futile-fight breaker) so
// test/combat_gates.test.mjs can pin them without importing all of modes.js. No behavior change.
import fs from 'fs';
import * as mc from '../utils/mcdata.js';

// ★C332 (T-0063, combat reflex arbitration / 反射冲突下沉): "拿着剑都杀不死贴脸僵尸" 的真根不是
// "没换剑"(attackEntity/defendSelf/shieldFight 都已装剑) 而是 self_preservation 的 SURFACE-SWIM 反射
// (优先级高于 self_defense) 在水边把战斗碎片化——events 'Fighting zombie!' 被 'In water — getting
// out' 反复抢控制, 每次脱困又 equipForBlock 把剑顶成镐 → 战斗拿不到持续输出 → 自掉 3×1HP 僵尸杀不死。
// 单点 resolve(用户: 门要加公共入口不是单个调用方): 贴脸非 creeper 怪 + 能赢这一仗时, 让"整理性"环境
// 脱困反射(浅水游上岸 / POCKET 步出)统一 defer 给 self_defense。
// ★SCOPE 铁律 — 绝不压过 LETHAL 环境急症: 调用方只在 NON-lethal 分支(y≥55 浅水 swim-to-shore)询问本门;
// 真溺水(deep/out-of-air, drowning&&y<55)、岩浆、窒息分支照旧最高优先(claude-C 的 T-0049/T-0056 反射
// 保持权威)——环境杀得比怪快的场合必须环境反射赢。本门只抑制"怪在脸上时去岸边/挪窝"这类非致命脱困。
export function combatHasPriority(bot) {
    try {
        if (!bot || !bot.entity) return false;
        const hasWeapon = bot.inventory.items().some(i => /_sword$|_axe$/.test(i.name) && !/pickaxe/.test(i.name));
        if (!hasWeapon) return false;                                        // 裸手 — 别站撸送命
        const p = bot.entity.position;
        let near = 0, ptBlank = false;
        for (const e of Object.values(bot.entities || {})) {
            if (!(e && e.position && mc.isHostile(e) && !/creeper/i.test(e.name || ''))) continue;
            if (isFutileMob(bot, e)) continue;   // ★C360: 黑名单怪不算"有仗要打" — 脱困反射别为打不动的怪让路
            const d = e.position.distanceTo(p);
            if (d < 8) near++;
            if (d < 3.2) ptBlank = true;                                     // 进近战臂展 = 有仗要打
        }
        if (!ptBlank) return false;                                         // 没怪在脸上 — 无战斗可护, 照常脱困
        if (near >= 3) return false;                                        // 被围(3+) — 脱困优先于站撸(与 self_defense swarmed 门一致)
        return true;
    } catch (e) { return false; }
}

// ★C367 (2026-07-08 用户令 · 甲兵单怪死战): 「有甲被小白攻击, 既没丝滑逃跑也没英勇战斗 — 下次英勇
// 战斗; 单只怪、有甲、有武器, 哪怕血不多也干就完事了。」穿甲 + 有武器(剑/斧) + 全场只有【一只】非苦力
// 怕怪 → 英勇战斗, 不逃不躲, HP 不设下限 (keepInventory 下"打不过大不了一次重开" << 站桩挨射/笨拙
// 逃跑反被同速怪背刺)。
// 与既有 self_preservation.armoredZombieBrawl 的分工: 那门是"穿甲 + 僵尸类【贴脸】(可成群)站撸";
// 本门是"穿甲 + 武器 + 全场【仅一只】怪(含骷髅远射, 不要求贴脸)死战" — 专补"甲兵 vs 单只小白"这一被
// 漏掉的场景(骷髅在 4.5b 外远射 → 贴脸例外/僵尸门都不触发 → 落到盾牌 flee)。
// 模块级函数: self_preservation.shouldFlee 与 self_defense
// 两处共用同一判据 (前者放行不逃, 后者放行开打, 缺一则又卡回原僵局)。
// 硬边界 (绝不越, 与全项目安全铁律一致):
//   · 8格内有苦力怕 → 不适用 (甲挡不住贴脸爆炸, 交常规逃跑分支拉开距离);
//   · 溺水 / 着火 / 岩浆由 arbiter.vitalNow 独立处理 — 本门只裁"该不该怂", 不碰环境急症;
//   · "单只" = 16格内非苦力怕敌对怪恰为 1 (成群仍逃 — 甲扛不住多怪 DPS 叠加, 用户也只说"单只怪");
//   · 必须【穿戴】护甲(slot 5-8)且【持/有】剑或斧 — 背包里的甲不减伤、裸手站撸都是送死, 不适用。
export function armoredSoloBrawl(bot) {
    try {
        if (!bot || !bot.entity) return false;
        const p = bot.entity.position;
        const HR = /zombie|skeleton|spider|witch|drowned|husk|stray|pillager|vindicator|cave_spider|zombie_villager/i;
        let creeperClose = false, count = 0;
        for (const e of Object.values(bot.entities || {})) {
            if (!(e && e.position && e.name)) continue;
            const d = e.position.distanceTo(p);
            if (/creeper/i.test(e.name) && d < 8) { creeperClose = true; break; }   // 爆炸威胁优先, 直接不适用
            if (HR.test(e.name) && d < 16) count++;
        }
        if (creeperClose || count !== 1) return false;
        const armorRe = /_helmet$|_chestplate$|_leggings$|_boots$/;
        const sl = bot.inventory.slots || [];
        let worn = false;
        for (let i = 5; i <= 8; i++) { if (sl[i] && armorRe.test(sl[i].name || '')) { worn = true; break; } }   // 穿戴中才减伤
        if (!worn) return false;
        return bot.inventory.items().some(i => /_sword$|_axe$/.test(i.name) && !/pickaxe/.test(i.name));   // 有武器才谈死战
    } catch (e) { return false; }
}

// ★C353 (T-0063, worker-combat 06-27): RANGED-UNREACHABLE-TRAP — disengage 杀不死的"够不到的远程怪"。
// 真根(监工实锤): bot 困封闭口袋(mobility=POCKET/ENTOMBED, enclosed=true, exits=[])时, 墙外一只
// 远程骷髅在 self_defense range 内 → self_defense 每 tick execute shieldFight → ranged 分支
// goToPosition 朝怪靠近, 但被墙堵死(path 不通秒回 catch) → 距离永远 d>3.2 靠不近 → 对着够不到
// 的怪空挥, 怪血不掉 → 'Fighting skeleton!' ×10/3s 疯刷。而 self_defense(modes idx 2398) 在
// mobility(2948) 之前, 它 active=true → ModeController `if(mode.active) break` 跳过 mobility →
// POCKET 脱困反射(pillar/dig-up)永远不触发 → 三重互锁(战斗占身体 / 脱困派不出 / food0 饿着)永久卡死。
// 修: self_defense 入口检测此陷阱 → 不 engage, 让位 mobility 脱困 + kernelDriver GET_FOOD。
// ★disengage ≠ 不防御 (C32/C284 安全铁律): 只对"远程射手(skeleton/stray/pillager) + bot 被封闭困住
//   + 该怪不在真贴脸臂展(≥2.5b, 即隔着墙够不到)"放手。任何近战怪(zombie/spider/husk…)或真贴脸(<2.5b)
//   的怪仍照打 — 那些是 bot 出得了手、打得死的, 放手 = 被磨杀。creeper 始终走 self_pres 不受此影响。
// 判据全部来自 bot 自有信号(_mobility 状态机 + 实体距离), 零额外探测成本。
export function rangedUnreachableTrap(bot) {
    try {
        if (!bot || !bot.entity) return false;
        // ★石棺实锤 2026-07-03 00:19 (@99,10,204 vs spider@102,7,203 d=4.1): 进程刚重启时
        // bot._mobility 是 undefined — 它由 mobility 模式写, 而 mobility 排在 self_defense
        // 之后, self_defense 一开机就 engage(active=true) → ModeController break → mobility
        // 永远没跑过一拍 → 本函数读 undefined → trapped=false → 永不 disengage → 死锁自锁.
        // 修: 回退到 bot._world.mobility(always:true 观察者自算, 不可能被饿死, 5568).
        const mobSrc = bot._mobility || (bot._world && bot._world.mobility) || null;
        const mob = (mobSrc && mobSrc.state) || '';
        const enclosed = !!(mobSrc && mobSrc.enclosed);
        const noExit = !!(mobSrc && Array.isArray(mobSrc.exits) && mobSrc.exits.length === 0);
        // 完全封闭(无水平出口的口袋 + 顶上也封 / 活埋 / 封室): bot 隔着墙, 横挥够不到墙另一侧的任何怪 —
        // 哪怕实体距离 d=0.4(贴在墙背面)也打不到(实锤 06-27: skeleton d=0.4 @墙外, 'Fighting' 疯刷血不掉)。
        // 这种状态下"真贴脸射手用近战打断"的假设失效(bot 出不去, 挥到的是墙)。
        const fullyBoxed = /ENTOMBED|SEALED/.test(mob) || (enclosed && noExit) || (mob === 'POCKET' && noExit);
        // 必须先"被困"才考虑 disengage(开阔地能追上去打, 不放手)。被困 = 封闭环境 或 困态状态机。
        // ★T-0224 death #21 (10-10 04:37:12, 骷髅 4 箭 16→0): 旧判据 `enclosed ||` 把"有顶 + 有出口的洞穴"(mob=FREE) 也当被困 →
        //   石剑在手、骷髅能射到她 (LOS 在)、她也走得过去, self_defense 却一直 DISENGAGE。C353 本意是"无出口口袋"。
        //   被困 = 困态 (POCKET/ENTOMBED/SEALED) 或 有顶且零水平出口; 有出口的洞穴里照常追打。
        const trapped = /POCKET|ENTOMBED|SEALED/.test(mob) || (enclosed && noExit);
        if (!trapped) return false;
        const p = bot.entity.position;
        const RANGED = /skeleton|stray|pillager/i;          // 射手 — 隔墙也能射 bot, 但 bot 横挥够不到它
        let sawRanged = false, meleeReachable = false, sawUnreachableMelee = false;
        for (const e of Object.values(bot.entities || {})) {
            if (!(e && e.position && mc.isHostile(e))) continue;
            const n = (e.name || '').toLowerCase();
            if (/creeper/.test(n)) continue;                // creeper 归 self_pres, 不在此门
            const d = e.position.distanceTo(p);
            if (d >= 12) continue;                          // 太远不算威胁(超 self_defense 索敌)
            if (RANGED.test(n)) {
                // 完全封闭 → 任何距离的射手都够不到(隔墙, 实锤 d=0.4 也打不到); 半困(有出口) → 只把非贴脸
                // (≥2.5b)的算够不到, 真贴脸(<2.5b)的可能挪一步近战打断, 留给 self_defense。
                if (fullyBoxed || d >= 2.5) sawRanged = true;
                else meleeReachable = true;
            } else {
                // 近战怪(zombie/spider/husk…): 真贴脸 <2.5b 默认打(墙可能薄/有缝, 保命优先, C32/C284),
                // 半困(非完全封闭)时臂展内 <4.5b 也打(能挪过去近战)。
                // ★C354 (T-0063): fullyBoxed(exits=[] 真封闭)且 bot 最近 >4s 未受伤 = 怪隔墙够不到 bot
                // (hp 不掉实证), bot 也够不到怪 → 不算 meleeReachable, 放手让 rangedUnreachableTrap→true、
                // POCKET 脱困/觅食接管。否则隔墙近战怪 d=0.4 让 meleeReachable 永真, bot 困口袋空打骷髅
                // 饿死(实锤 06-27 91,53,160 跨多天)。真受伤(墙薄怪真打到)时仍按贴脸算, 还手保命。
                const recentlyHurtBM = (Date.now() - (bot.lastDamageTime || 0)) < 4000;
                if ((d < 2.5 && (!fullyBoxed || recentlyHurtBM)) || (d < 4.5 && !fullyBoxed)) meleeReachable = true;
                // ★石棺实锤 2026-07-03 00:19: fullyBoxed + 洞外一只 spider(近战, 非 RANGED) d=4.1 —
                // 旧判据 return sawRanged && ... 要求"必须存在远程怪"才放手, 纯近战怪隔墙时 sawRanged
                // 永 false → self_defense 每拍 re-engage shieldFight → goToPosition noPath ×150/s 空转
                // 14s×∞ → mobility/SURFACE_RESCUE 全饿死. 修: 完全封闭且没在挨打的隔墙近战怪也算
                // "够不到的威胁", 与 C354 同一免责判据(hp 不掉=墙是实的).
                else if (fullyBoxed && !recentlyHurtBM) sawUnreachableMelee = true;
            }
        }
        // "存在够不到的威胁(远程射手 或 完全封闭下的隔墙近战怪) 且 无任何能近战打到的目标"才放手脱困觅食。
        return (sawRanged || sawUnreachableMelee) && !meleeReachable;
    } catch (e) { return false; }
}

// ★C360 (T-0063, 2026-07-03 01:01Z 实锤): FUTILE-FIGHT 断路器 — 同一 mob 连打 N 轮零进展即拉黑。
// 血案: bot 困夜宿口袋 @98,10,203, 隔墙 spider#468770 卡死在 102,7,203 (d=4.6 恒定不动) —
// self_defense 对它 'Fighting spider!' ×400+ / 26min 独占身体, food=5 吃不上饭、SURFACE_RESCUE
// 派不出。为什么三道旧防线全失灵:
//  (a) rangedUnreachableTrap/sawUnreachableMelee (091bc57) 是"拓扑门"— 要求 trapped/fullyBoxed
//      (enclosed 或 POCKET/ENTOMBED/SEALED)。00:48 bot 从 99,10,203 挪到 98,10,203 后 mobility
//      观察者报 enclosed=false (口袋开了条缝, 01:01:57 self_pres 日志实锤), 状态不再 POCKET
//      → trapped=false 直接短路, 内部所有判据(含 sawUnreachableMelee)根本没跑到。且 d=4.6 落在
//      "d<4.5 半困近战可打"和"fullyBoxed 隔墙"两个分支之间的裂缝里 — 拓扑判据天然盖不住
//      "口袋有缝但寻路仍不通"的几何。
//  (b) shieldFight 的 4s in-skill 断路 (C353 石棺扩展) 每轮都触发 — 但它只 break 当前 cycle,
//      无跨轮记忆; mode 层下一拍(300ms)看拓扑门=false 立刻 re-engage → ~3.8s/轮 ×400 风暴。
//  (c) 蜘蛛 29min 没打中 bot 一次(combat_log 00:58 后零 HURT) → "挨打还手"路径也不背锅。
// 修 (结果导向, 不再赌拓扑): 同一 entity id 连续 FUTILE_FIGHT_STRIKES 次 fight-cycle 完成而
// ①目标没掉过血(entityHurt 服务端实证) ②bot 没接近(≥0.75b) ③没被它打中 → 拉黑该 id 5min
// (bot._futileMobIds, 挂 bot 无模块级状态) → self_defense/defendSelf/shieldFight 三层同步豁免。
// ★挨打必还手铁律不破: 一旦被打中且黑名单 mob 在臂展内(<4.5b) → 立即摘除(unblacklistAttackers,
// self_defense 每拍 + threat_radar HURT 双入口, 后者 always:true 连 sticky 技能期间也在)。
export const FUTILE_FIGHT_STRIKES = 3;            // 连续零进展轮数 → 拉黑
export const FUTILE_MOB_TTL_MS = 5 * 60 * 1000;   // 黑名单时效 — 怪会走开/地形会变, 过期重试 3 轮 (~11s/5min)
export const FUTILE_CLOSE_EPS = 0.75;             // "接近了"的最小位移 (寻路抖动不算)

/** 黑名单 Map(id→expiry), 挂 bot; 每次取用顺手清过期。 */
export function futileMobBlacklist(bot) {
    let m = bot._futileMobIds;
    if (!(m instanceof Map)) { m = new Map(); bot._futileMobIds = m; }
    const now = Date.now();
    for (const [id, until] of m) { if (until <= now) m.delete(id); }
    return m;
}

/** 该实体是否在徒劳黑名单里 (self_defense/combatHasPriority/技能层共用判据)。 */
export function isFutileMob(bot, entity) {
    try {
        if (!entity || entity.id == null) return false;
        const m = bot._futileMobIds;
        return (m instanceof Map) && (m.get(entity.id) || 0) > Date.now();
    } catch (e) { return false; }
}

/** 挨打必还手: 被打中时摘除臂展内(<4.5b)的黑名单 mob — 真打到我的怪必须重新可打。 */
export function unblacklistAttackers(bot, via) {
    try {
        const m = bot._futileMobIds;
        if (!(m instanceof Map) || m.size === 0) return;
        const p = bot.entity && bot.entity.position;
        if (!p) return;
        for (const id of [...m.keys()]) {
            const e = bot.entities && bot.entities[id];
            if (e && e.position && e.position.distanceTo(p) < 4.5) {
                m.delete(id);
                try {
                    fs.appendFileSync('bots/_supervisor/progress.txt',
                        `[${new Date().toISOString()}] [self_defense] futile-blacklist LIFTED mob#${id} ${e.name || '?'} d=${e.position.distanceTo(p).toFixed(1)} — got hit, 挨打必还手 (via ${via})\n`);
                } catch (e2) {}
            }
        }
    } catch (e) {}
}

/** fight-cycle 结果记账: 零进展(没伤到/没接近/没被打) → 记一击; 连续 N 击 → 拉黑。 */
export function recordFightOutcome(bot, cycle) {
    try {
        if (!cycle || cycle.id == null || !bot.entity) return;
        // 不公平的轮次不记账 (也不清零 — 无信息): 被 interrupt 抢断的轮 (honor interrupt_code,
        // 战斗没得到完整机会) / <2s 的秒退轮 (arbitration 拒了 / 技能入口就抛错, 不算真打过)。
        if (bot.interrupt_code || Date.now() - cycle.t0 < 2000) return;
        const e = bot.entities && bot.entities[cycle.id];
        const alive = !!(e && e.position);
        if (!alive) {   // 打死了/despawn — 有战果, 清计数
            if (bot._futileTally && bot._futileTally.id === cycle.id) bot._futileTally = null;
            return;
        }
        const endDist = e.position.distanceTo(bot.entity.position);
        const mh = bot._mobHurtAt;
        const targetHurt = (mh instanceof Map) && (mh.get(cycle.id) || 0) > cycle.t0;   // 目标这轮掉过血 = 打得到
        const gotCloser = endDist < cycle.dist0 - FUTILE_CLOSE_EPS;                     // 真挪近了 = 还有戏
        const botHurtNear = (bot.lastDamageTime || 0) > cycle.t0 && endDist < 4.5;      // 它真打到我 = 必还手
        if (targetHurt || gotCloser || botHurtNear) {
            if (bot._futileTally && bot._futileTally.id === cycle.id) bot._futileTally = null;
            return;
        }
        let tally = bot._futileTally;
        if (!tally || tally.id !== cycle.id) tally = bot._futileTally = { id: cycle.id, n: 0 };
        tally.n++;
        if (tally.n >= FUTILE_FIGHT_STRIKES) {
            futileMobBlacklist(bot).set(cycle.id, Date.now() + FUTILE_MOB_TTL_MS);
            bot._futileTally = null;
            try {
                fs.appendFileSync('bots/_supervisor/progress.txt',
                    `[${new Date().toISOString()}] [self_defense] FUTILE-FIGHT breaker: mob#${cycle.id} ${cycle.name || '?'} d=${endDist.toFixed(1)} — ${FUTILE_FIGHT_STRIKES} 连续零进展 fight-cycle (目标没掉血/没接近/没被它打中), 拉黑 ${Math.round(FUTILE_MOB_TTL_MS / 60000)}min, 让位脱困/进食\n`);
            } catch (e2) {}
        }
    } catch (e) {}
}


// ★bunkerDown no-mob seal-fail COOLDOWN re-open gate (moved verbatim from modes.js self_preservation.bunkerDown).
// During the 45s cooldown only a TRUE threat re-opens bunkering:
//   · any hostile < 5b, or a creeper < 8b (original gate);
//   · ★C316-A (T-0050/#118): a RANGED attacker (skeleton/stray/witch/pillager/ghast/blaze/drowned) < 15b — it
//     kites outside the 5b window and whittles the bot (47s of arrows before a husk closed in);
//   · ★T-0067: at NIGHT and NOT in a real sealed box, a MELEE hostile < 9b — lead time to wall/flee before contact.
// sealedNow / isDay are thunks (evaluated in the same order as before: only when the melee branch needs them).
export function bunkerCooldownReopen({ hostiles, pos, creeperNear8, sealedNow, isDay }) {
    const _RANGED_RE = /skeleton|stray|witch|pillager|ghast|blaze|drowned/i;
    const _ranged = hostiles.some(e => e && e.position && _RANGED_RE.test(e.name || '')
        && e.position.distanceTo(pos) < 15);
    const _sealedNow = sealedNow();
    const _meleeApproaching = !_sealedNow && !isDay()
        && hostiles.some(e => e && e.position && !_RANGED_RE.test(e.name || '')
            && e.position.distanceTo(pos) < 9);
    return !!(hostiles.some(e => e.position && e.position.distanceTo(pos) < 5)
        || creeperNear8 || _ranged || _meleeApproaching);
}
