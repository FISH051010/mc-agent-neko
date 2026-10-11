// Hot-reloadable REAL skill: ★T-0237 养伤 (监工指派 2026-10-11)。
// 证据 (worker-death 复盘挂起期 8 次死亡): #1/#3/#6/#8 死前 20-62 分钟 hp≤10 一直不回血 — food 17 不到 18 不触发自然回血、
//   food 0 饿到 1 血、生鸡被禁吃; 期间决策层照派 MIGRATE/REPLENISH_KIT/GET_PORTAL_KIT/reclaimFurnace, #3 hp1 被 migrate 带向骷髅。
// 人类: 残血先吃饱、原地站着等回血。流程: food <18 → 按 auto_eat 同口径挑吃的 (饿时放开生肉/腐肉/生鸡) 吃到 ≥18;
//   然后原地不动, 每秒看一次, 直到决策层的养伤锁存放手 (healLatchNext: hp 回到 HEAL_RELEASE_HP)。
//   近身威胁交给反射 (self_defense/self_preservation 抢身体时本技能被打断, 不和反射抢)。
// 返回: 回血了 (hp 上升) 或吃了东西 → true; 包里吃不饱 → {failed:'no-food'} (决策层改派 FOOD_FLOOR 去猎); 被打断 → unwind。
// Invoked via: {"skill":"healHold"}  ctx = { skills, world, mc, Vec3, log }
import fs from 'fs';
import path from 'path';
import { pickAutoEatFood } from '../../../src/agent/framework/healing_reflex.js';
import { FOOD_RELEASE, healLatchNext } from '../../../src/agent/framework/food_floor.js';

const PROG = path.resolve(process.cwd(), 'bots', '_supervisor', 'progress.txt');
const prog = (s) => { try { fs.appendFileSync(PROG, `[${new Date().toISOString()}] healHold: ${s}\n`); } catch (e) {} };
export const HEAL_HOLD_MAX_MS = 90000;

export default async function healHold(bot, ctx, opts = {}) {
    const { skills } = ctx;
    const maxMs = (opts && opts.maxMs) || HEAL_HOLD_MAX_MS;
    const stepMs = (opts && opts.stepMs) || 1000;
    const t0 = Date.now();
    const hp0 = bot.health, food0 = bot.food;
    let ate = 0;
    prog(`start hp=${Math.round(hp0)} food=${food0}`);
    while (Date.now() - t0 < maxMs) {
        if (bot.interrupt_code) { prog('interrupted — unwind'); break; }
        if (bot.food < FOOD_RELEASE) {
            const it = pickAutoEatFood(bot.inventory.items(), { health: bot.health, food: bot.food });
            if (it) {
                const f = bot.food;
                try { await skills.consume(bot, it.name); } catch (e) {}
                if (bot.food > f) { ate++; prog(`ate ${it.name} food ${f}→${bot.food}`); continue; }
            }
            if (!it && bot.food < FOOD_RELEASE && !ate && bot.health <= hp0) {
                prog(`no edible to reach food ${FOOD_RELEASE} (food=${bot.food}) — hand over to FOOD_FLOOR`);
                return { failed: true, reason: 'no-food' };
            }
        }
        try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (e) {}
        try { bot.clearControlStates(); } catch (e) {}
        if (!healLatchNext(true, bot.health)) { prog(`healed hp ${Math.round(hp0)}→${Math.round(bot.health)} food=${bot.food}`); return true; }
        await new Promise(r => setTimeout(r, stepMs));
    }
    const progressed = ate > 0 || bot.health > hp0;
    prog(`end hp ${Math.round(hp0)}→${Math.round(bot.health)} food ${food0}→${bot.food} ate=${ate}${progressed ? '' : ' — no progress'}`);
    return progressed ? true : { failed: true, reason: 'no-heal' };
}
