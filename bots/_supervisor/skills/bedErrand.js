// Hot-reloadable REAL skill: ★T-0202 床优先 (监工战略拍板, 2026-10-10)。
// #13/#14/#15 在 45 分钟内三连死, #5/#15 是裸装夜间重生即被打死 (T-0043: 无床锚 → 重生在裸露的世界出生点)。
// 床同时解决两件事: ①夜里睡过去, 整夜的风险和停滞一起消失; ②重生锚定在床边。
// 旧 GET_BED 只看 64 格内现成的羊 (food<6 时 12 格), 不去找 — 可侦察在 41 格外找到过羊, 羊是有的。
// 流程: 包里已有床 / ≥3 羊毛 / ≥4 线 → 直接交 setBed (合成+放床+右键设重生);
//       否则有界侦察找羊 (≤96 格 / ≤120s, 复用 quickMeal 那套: GoalNearXZ、被叫停不耗航点、敌对让位),
//       有剪刀就剪、没有就击杀, 凑够 3 羊毛 → setBed。
// 返回: setBed 成功 → true; 敌对让位 → {deferred} (不计 strike); 找不到羊/凑不够 → {failed} (kernel 冷却)。
// Invoked via: {"skill":"bedErrand"}  ctx = { skills, world, mc, Vec3, log }
import fs from 'fs';
import path from 'path';
import mfp from 'mineflayer-pathfinder';
import { scoutForAnimal, pickHuntTarget, haltPath, raceI } from './quickMeal.js';
import { nearestSighting, scoutPlanToward } from '../../../src/agent/framework/animal_sightings.js';
const { goals } = mfp;

const PROG = path.resolve(process.cwd(), 'bots', '_supervisor', 'progress.txt');
const prog = (s) => { try { fs.appendFileSync(PROG, `[${new Date().toISOString()}] bedErrand: ${s}\n`); } catch (e) {} };
const SHEEP_RE = /^sheep$/;
export const WOOL_NEEDED = 3;
export const SCOUT_RADIUS = 96;
export const SCOUT_MS = 120000;
const MAX_MS = 180000;

export function woolCount(counts) { return Object.keys(counts || {}).filter(k => /_wool$/.test(k)).reduce((s, k) => s + (counts[k] || 0), 0); }
/** 包里的材料已经够 setBed 直接做床 (床 / ≥3 羊毛 / ≥4 线→1 羊毛 + ≥2 羊毛)。 */
export function bedMaterialsReady(counts) {
    counts = counts || {};
    if (Object.keys(counts).some(k => /_bed$/.test(k) && counts[k] > 0)) return true;
    const wool = woolCount(counts), str = counts['string'] || 0;
    return wool + Math.floor(str / 4) >= WOOL_NEEDED;
}

const race = (p, ms) => { let t = null; return Promise.race([Promise.resolve(p).catch(() => null), new Promise(r => { t = setTimeout(r, Math.max(0, ms)); })]).finally(() => clearTimeout(t)); };

export default async function bedErrand(bot, ctx) {
    const { skills, world } = ctx;
    const inv = () => { try { return world.getInventoryCounts(bot) || {}; } catch (e) { return {}; } };
    const t0 = Date.now();
    const left = () => MAX_MS - (Date.now() - t0);

    if (!bedMaterialsReady(inv())) {
        // ★T-0209 目击记忆: 记得哪儿见过羊 → 朝那里出发 (≤200b, 有目标的出行); 没有记录才 96b 盲搜
        const sight = nearestSighting(bot._landmarks, SHEEP_RE, bot.entity.position);
        const plan = scoutPlanToward(sight, SCOUT_RADIUS);
        prog(`no bed/wool (wool=${woolCount(inv())} string=${inv().string || 0}) — ${plan.targeted ? `sheep last seen @${sight.x},${sight.z} (${sight.dist}b, ${Math.round(sight.ageMs / 60000)}min ago) → targeted scout ≤${plan.radius}b` : `blind scout ≤${plan.radius}b`}/${SCOUT_MS / 1000}s`);
        let sheep = pickHuntTarget(bot, 48, 8, SHEEP_RE);
        if (!sheep) {
            sheep = await scoutForAnimal(bot, { radius: 48, maxDy: 8, scoutRadius: plan.radius, scoutMs: SCOUT_MS, targetRe: SHEEP_RE, scoutToward: plan.toward });
            if (sheep === 'hostile') { prog('scout deferred: hostile near'); return { deferred: true, reason: 'hostile-near' }; }
            if (bot.interrupt_code) { haltPath(bot); prog('interrupted during scout — exit'); return false; }   // ★T-0206: 打断按 unwind 处理
            // ★T-0208 (02:01/02:03Z 实录: 96b 内两轮都没羊, 立即重派 → 3 轮×2min + 5min 冷却 ≈ 每个白天一半在找羊): 记下时间,
            //   world_model 在 NO_SHEEP_BACKOFF_MS 内不再提侦察 (bot 去干别的、换了地方再找)。
            if (!sheep) { prog('no sheep found'); try { bot._bedErrandNoSheepAt = Date.now(); } catch (e) {} return { failed: true, reason: 'no-sheep' }; }
        }
        const shears = (bot.inventory.items() || []).find(i => i.name === 'shears');
        let kills = 0;
        while (woolCount(inv()) < WOOL_NEEDED && left() > 8000 && !bot.interrupt_code) {
            const s = pickHuntTarget(bot, 48, 8, SHEEP_RE);
            if (!s) { prog(`no more sheep in reach (wool=${woolCount(inv())})`); break; }
            prog(`${shears ? 'shear' : 'hunt'} sheep @${s.position.distanceTo(bot.entity.position).toFixed(1)}b (wool=${woolCount(inv())})`);
            try { await raceI(bot, bot.pathfinder.goto(new goals.GoalNear(Math.floor(s.position.x), Math.floor(s.position.y), Math.floor(s.position.z), 2)), Math.min(left(), 20000)); } catch (e) {}
            haltPath(bot);
            const w0 = woolCount(inv());
            if (shears) {
                try { await skills.equip(bot, 'shears'); await bot.activateEntity(s); } catch (e) {}
            } else {
                await raceI(bot, skills.attackEntity(bot, s, true), Math.min(left(), 25000));
                kills++;
            }
            if (skills.pickupNearbyItems) await raceI(bot, skills.pickupNearbyItems(bot, 6), Math.min(left(), 8000));
            if (woolCount(inv()) <= w0 && kills >= 6) { prog('6 kills without wool — stop'); break; }
        }
        if (!bedMaterialsReady(inv())) { prog(`not enough wool (${woolCount(inv())}/${WOOL_NEEDED}) — honest fail`); return { failed: true, reason: 'wool-short' }; }
    }
    prog(`materials ready (wool=${woolCount(inv())}) — setBed: craft + place + set spawn`);
    const ok = await skills.customSkill(bot, 'setBed').catch(() => false);
    prog(`setBed → ${ok}`);
    return ok === true ? true : { failed: true, reason: 'setBed-failed' };
}
