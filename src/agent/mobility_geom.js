// Mobility geometry moved verbatim out of modes.js so test/sealed_room.test.mjs can pin it. No behavior change.

// ★C341 (T-0074): SEALED-ROOM detection. The mobility state machine reads any adjacent walkable air as
// an `exit` → a bot boxed into a 3x3 cobble room (interior air, but EVERY wall solid, no way out) is
// mislabeled FREE → no escape reflex fires → it sits trapped forever WITH a pickaxe in the bag (用户实锤:
// claude-A 的 bunker 把她封进 3x3x2 cobble 密室). ENTOMBED only covers the 1x1 point-blank case (head
// solid); a roomy seal has air to stand in, so it never triggers. Distinguish a sealed room from genuine
// open space by a BOUNDED flood-fill of the reachable air: if the flood EXHAUSTS within a small cap (fully
// walled, no exit), it's sealed; if it spills past the cap (a tunnel to a cave / the open surface / a
// chimney to sky), it's free. No per-cell sky probe needed — any opening lets the flood escape past the
// cap. Cheap, and the caller only runs it when locally FREE/POCKET *and* covered-above (the only state
// that can BE a sealed room), so it costs ~0 in the open. Returns {sealed, cells}.
export function detectSealedRoom(bot) {
    try {
        if (!bot || !bot.entity) return { sealed: false };
        const solid = (b) => b && b.boundingBox === 'block';
        const start = bot.entity.position.floored();
        const stand = (q) => {                 // a cell the body can occupy: feet+head non-solid, non-lava
            const f = bot.blockAt(q), h = bot.blockAt(q.offset(0, 1, 0));
            if (solid(f) || solid(h)) return false;
            if (/lava/.test((f && f.name) || '') || /lava/.test((h && h.name) || '')) return false;
            return true;
        };
        if (!stand(start)) return { sealed: false, reason: 'no-stand' };   // mid-step / standing in a fresh breach — NOT evidence of open space
        const CAP = 130;                       // > CAP reachable cells ⇒ "open enough", not a trap
        const seen = new Set([`${start.x},${start.y},${start.z}`]);
        const q = [start];
        let head = 0;
        while (head < q.length) {
            if (seen.size > CAP) return { sealed: false, reason: 'spill' };   // flood spilled out → open
            const c = q[head++];
            for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
                const n = c.offset(dx, dy, dz);
                const k = `${n.x},${n.y},${n.z}`;
                if (seen.has(k)) continue;
                if (stand(n)) { seen.add(k); q.push(n); }
            }
        }
        return { sealed: true, cells: seen.size };                 // flood exhausted within cap + covered ⇒ sealed
    } catch (e) { return { sealed: false }; }
}

// ★T-0135 SEALED ESCAPE EPISODE. The classifier only escalates FREE→SEALED after the room has stayed sealed
// ~10s with the bot barely moving (C341 debounce, so a MINING bot isn't flagged on every transient pocket).
// But once a trap is confirmed, each dug cell made detectSealedRoom answer 'no-stand' (bot mid-step / in the
// breach) → debounce reset → another 10s wait per cell: live 10-10 18:38:58→18:40:50 SEALED↔FREE every
// 6-11s, ~17s per cell. A human mining out of a sealed room keeps digging the same way. So: a confirmed trap
// opens an episode; inside it the room stays SEALED (no re-debounce) until the flood genuinely spills
// ('spill' = open space reached), the cover lifts (sky), night falls (the room is then a shelter), or the
// episode ages out. Pure — pinned by test/sealed_escape.test.mjs.
export const SEALED_EPISODE_MAX_MS = 5 * 60000;
export function sealedEscapeStep({ episode, sr, enc, night, now, debounceSealed, working = false }) {
    if (night || !enc) return { st: null, episode: null };
    // ★T-0163: own mine tunnels are always bounded — a skill digging/smelting/crafting = not trapped (live 20:38:58
    //   a ridealong episode interrupted smeltSafe). End/skip the episode; the skill owns the body.
    if (working) return { st: null, episode: null };
    if (episode && now - episode.since > SEALED_EPISODE_MAX_MS) episode = null;
    if (episode) {
        if (sr && (sr.sealed || sr.reason === 'no-stand')) return { st: 'SEALED', episode: { ...episode, lastAt: now } };
        return { st: null, episode: null };                       // flood spilled → escaped
    }
    if (debounceSealed) return { st: 'SEALED', episode: { since: now, lastAt: now } };
    return { st: null, episode: null };
}

// fleeMove heading choice (moved verbatim from modes.js). dx,dz = unit vector away from the threat;
// probe(ux,uz) → {foot, head, above, water, drop}. Returns {hx, hz, needJump, found}.
/**
 * ★T-0180 ③ (death #12 10-10 23:55: night branchMine broke into a dripstone cave; self_preservation then sprinted
 * DEEPER into the unexplored cavity — unknown drops/pointed dripstone — and died at y-7). Underground, flee back
 * along the way we came: pick the most recent breadcrumb (cells we actually walked) 6..20b away that is farther
 * from the nearest threat than we are now. null → caller keeps its old target logic.
 * @param crumbs [{x,y,z,t}] oldest→newest ; me {x,y,z} ; threat {x,z}|null
 */
export function backtrackTarget(crumbs, me, threat, { maxRise = 3 } = {}) {
    if (!Array.isArray(crumbs) || !crumbs.length || !me) return null;
    const dMe = threat ? Math.hypot(me.x - threat.x, me.z - threat.z) : 0;
    for (let i = crumbs.length - 1; i >= 0; i--) {
        const c = crumbs[i];
        const d = Math.hypot(c.x - me.x, c.z - me.z);
        if (d < 6 || d > 20) continue;
        // ★T-0182 #24: 摔下来的 (death #13 y15→y3) 来路在头顶 12 格 — 走不回去的面包屑不是退路
        if (typeof c.y === 'number' && typeof me.y === 'number' && c.y - me.y > maxRise) continue;
        if (threat && Math.hypot(c.x - threat.x, c.z - threat.z) <= dMe) continue;   // don't run back INTO the mob
        return c;
    }
    return null;
}

/**
 * ★T-0200 (death #14 10-10 01:06:05: 苦力怕 7.8b 逼近, 地形可跑的方向全被 17b 外"大致同向"的另一只苦力怕否决
 * → 原地 bunker/hold → 被炸)。逃跑走廊风险分两级 (纯函数, 判据与旧 creeperCorridorRisk 同口径):
 *   hard — 目标苦力怕 ≤5.5b 且方向不背离 (toward>-0.1) / 5.5–10b 且朝它 (toward>0.25); 任一苦力怕 6 步投影内 <7.5b
 *   soft — 非目标苦力怕 <18b 且大致同向 (toward>0.15) 但投影始终 ≥7.5b (还远, 先躲近的)
 * creepers: [{x,y,z,isTarget}] ; p0 {x,y,z} ; (rx,rz) 单位方向
 * @returns {{hard, soft, minProjected, worst}}
 */
export function creeperCorridorAssess(creepers, p0, rx, rz, melee = []) {
    let hard = false, soft = false, minProjected = Infinity, worst = null;
    // ★T-0218 (death #19): 后撤也要背离贴身近战怪 — ≤3b 的近战怪在这条路上 (朝它跑 toward>0.25, 或 6 步投影擦身 <1.5b) = hard。
    for (const m of melee || []) {
        const d0 = Math.hypot(m.x - p0.x, m.z - p0.z);
        if (d0 > 3) continue;
        const toward = d0 < 0.001 ? 1 : (rx * (m.x - p0.x) + rz * (m.z - p0.z)) / d0;
        let proj = Infinity;   // where we WILL be along the lane, not where we are now
        for (const step of [1, 2, 3]) proj = Math.min(proj, Math.hypot(m.x - (p0.x + rx * step), m.z - (p0.z + rz * step)));
        if (toward > 0.25 || proj < 1.5) { hard = true; worst = { d: d0, toward, projected: proj, level: 'hard', melee: true }; }
    }
    for (const e of creepers || []) {
        const d0 = Math.hypot(e.x - p0.x, (e.y ?? p0.y) - p0.y, e.z - p0.z);
        if (d0 > 24) continue;
        const vx = e.x - p0.x, vz = e.z - p0.z, h = Math.hypot(vx, vz);
        const toward = h < 0.001 ? 1 : (rx * vx + rz * vz) / h;
        let projected = h < 0.001 ? 0 : d0;
        for (const step of [2, 4, 6]) projected = Math.min(projected, Math.hypot(e.x - (p0.x + rx * step), e.z - (p0.z + rz * step)));
        minProjected = Math.min(minProjected, projected);
        let lvl = null;
        if (h < 0.001) lvl = 'hard';
        else if (e.isTarget) {
            if ((d0 <= 5.5 && toward > -0.1) || (d0 > 5.5 && d0 < 10 && toward > 0.25)) lvl = 'hard';
        } else if (projected < 7.5) lvl = 'hard';
        else if (d0 < 18 && toward > 0.15) lvl = 'soft';
        if (lvl === 'hard') hard = true;
        if (lvl === 'soft') soft = true;
        if (lvl && (!worst || lvl === 'hard')) worst = { d: d0, toward, projected, level: lvl };
    }
    return { hard, soft, minProjected, worst };
}

/**
 * ★T-0218 (death #19 03:43:01: self_defense 正在打 1.7b 僵尸, 8b 外苦力怕触发 self_preservation 后撤抢身体 → 背对僵尸被追打 6s −12)。
 * 苦力怕后撤抢断近战接战的条件: 苦力怕 ≤5b 或正在点燃 (fuse) — 起爆距离 ~3b, 8b 外不急; 否则若 ≤3b 有够得着的近战怪且手里有武器,
 * 让 self_defense 先打完贴身怪 (它才是此刻的伤害源)。无武器 → 照旧后撤 (方向由 creeperCorridorAssess 同时背离近战怪)。
 */
export function creeperBackoffPreempts({ creeperDist, creeperFusing, meleeNearDist, hasWeapon }) {
    if (creeperFusing) return true;
    if (Number.isFinite(creeperDist) && creeperDist <= 5) return true;
    if (hasWeapon && Number.isFinite(meleeNearDist) && meleeNearDist <= 3) return false;
    return true;
}

/**
 * ★T-0223 death #20 (10-10 04:22:34): 地下逃跑沿面包屑回撤进自己挖的死胡同矿道, 到头左右折返, 僵尸追上打死。人类在 1 宽隧道里被近战怪追:
 * 转身在两人之间垫两块把隧道堵死。判据 (纯): 近战怪 ≤3.5b 且同层 (|dy|≤1), bot 处在朝它方向的 1 宽走廊里 —
 * 垂直于该方向的两侧, 脚/头格都是实心。me/mob {x,y,z}; solidAt(x,y,z)→bool。
 */
export function tunnelWallOffWanted(solidAt, me, mob) {
    if (!me || !mob) return false;
    const d = Math.hypot(mob.x - me.x, mob.z - me.z);
    if (d > 3.5 || d < 1.2 || Math.abs(mob.y - me.y) > 1) return false;
    const ax = Math.abs(mob.x - me.x) >= Math.abs(mob.z - me.z);
    const fx = Math.floor(me.x), fy = Math.floor(me.y), fz = Math.floor(me.z);
    const sides = ax ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    for (const [sx, sz] of sides) for (const dy of [0, 1]) if (!solidAt(fx + sx, fy + dy, fz + sz)) return false;
    return true;
}

/**
 * ★T-0226 death #22: 逃跑中被射手打中 → 先挡视线再说。不挡的情形: 射手 <1.5b (中间放不下, 交给近战) 或
 * 4b 内有近战怪在追 (停下垫块会被近战怪贴上 — 那时继续跑/堵隧道)。
 */
export function fleeCoverFirst({ shooterDist, meleeNear }) {
    if (!Number.isFinite(shooterDist) || shooterDist < 1.5 || shooterDist >= 16) return false;
    return !meleeNear;
}

/**
 * ★T-0233 (#4 21:51:50 隧道里 'running from the swarm' 坐标 3s 不变; #5 21:59:14 坑里 'sprinting away' 对墙冲刺, 僵尸贴身 15→0):
 * 逃跑没有位移 = 没在逃, 只是背对怪站着挨打。卡住 ≥900ms 且 4b 内有怪 (非苦力怕, 那有专枝) → 'interpose' (两者之间垫块挡);
 * 调用方垫不住且近战怪 ≤2.5b、手上有方块 → 再往上垫柱。纯函数。
 */
export function fleeStuckAction({ stuckMs, nearestMob }) {
    if (!(stuckMs >= 900)) return null;
    if (!nearestMob || !(nearestMob.d <= 4) || /creeper/i.test(nearestMob.name || '')) return null;
    return 'interpose';
}

/** 选逃跑方向: 先要零风险; 没有 → 无硬风险里投影最远的 (软风险只排序不否决)。cands: [{dir:[x,z], ok:bool(地形), assess}] */
export function pickCreeperRunDir(cands) {
    const okTerrain = (cands || []).filter(c => c && c.ok);
    const clean = okTerrain.find(c => !c.assess.hard && !c.assess.soft);
    if (clean) return { ...clean, tier: 'clean' };
    let best = null;
    for (const c of okTerrain) if (!c.assess.hard && (!best || c.assess.minProjected > best.assess.minProjected)) best = c;
    return best ? { ...best, tier: 'soft' } : null;
}

export function chooseFleeHeading(dx, dz, probe) {
    let hx = dx, hz = dz, needJump = true;   // boxed-in fallback: jump + push straight
    let _found = false;
    // ★C334-A (T-0068 "逃怪缺翻越地形脱离"): 旧扇形只搜前向 ±90° 弧[0,±45,±90]——若前向被
    // 2 格墙/台地挡满(U 形角落), 5 个朝向全 head-blocked → fallback 直冲撞墙 → 被地形逼角
    // 无限 kite till dawn 甩不掉群(今日多条夜群杀死)。修: 扇形扩到【全 360°】(加 ±135°,180°),
    // 被前向逼角时能向后/绕行找到任意开口脱离, 而非撞死墙角。偏好序不变(away 方向 0/±45/±90
    // 先试, 背向 ±135/180 只在前向弧全堵=真逼角时才用——first-match 保证仅最后兜底), 故正常逃
    // 仍优先远离威胁, 只有走投无路才回绕。dry/wet 两遍+跌落守卫保留。
    const _FAN = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, 3 * Math.PI / 4, -3 * Math.PI / 4, Math.PI];
    for (const pass = { dry: true }, arr = [true, false]; arr.length && !_found;) {
        pass.dry = arr.shift();
        for (const a of _FAN) {
            const ca = Math.cos(a), sa = Math.sin(a);
            const ux = dx * ca - dz * sa, uz = dx * sa + dz * ca;   // rotate desired heading by a
            const p = probe(ux, uz);
            // ★#1 (review-2026-07-06 坑里跳不出): step-up(p.foot=有台阶)且落脚后头顶(y2)实心 =
            //   2 格墙唇/低天花板, jump 只上 1 格必撞顶翻不过 → 原地死跳(实录被钉死跳 10s 被追死)。
            //   拒该朝向, 让扇形换向或落到凿墙出口; 平走(p.foot=false)不受影响。
            if (!p.head && !p.drop && (!pass.dry || !p.water) && !(p.foot && p.above)) { hx = ux; hz = uz; needJump = p.foot; _found = true; break; }   // head clear + no ledge (+dry) + 非2格唇 → run
        }
    }
    // ★T-0180 (death #12 10-10 23:55:25 @y-7, hp5.7: every heading blocked/droppy → the boxed-in fallback pushed
    //   forward+sprint+jump straight off an ~8-block cave drop). The fallback is for WALLS (push / dig through);
    //   if the straight heading is itself a LEDGE, hold at the edge instead — a fleeing human stops at a cliff,
    //   they don't jump it. Callers stop moving on `hold` and let fight/bunker handle the threat.
    let hold = false;
    if (!_found) { try { hold = !!probe(hx, hz).drop; } catch (e) {} }
    return { hx, hz, needJump, found: _found, hold };
}

// ★C305-A (T-0036) POCKET escape plan, PURE (choice logic moved verbatim from modes.js mobility POCKET branch).
// A) CLIMB OUT first: own head-room above, a neighbour whose FOOT cell is a solid step with air above it →
//    jump onto it (no digging). The foot-slot case the old head-only carve missed (spun ~4min with zero motion).
// B) else DIG a step-out: BOTH foot (dy0) and head (dy1) neighbour walls count (old code dug head only), only
//    over a solid non-fluid floor; stone without a pick is gated unless enclosed (bare-hand breakout allowed).
// Returns { action: {kind:'climb',dx,dz,onto} | {kind:'dig',dx,dz,wall,other} | null, gated: [walls skipped by the no-pick gate] }.
export function planPocketEscape(blockAt, m2, { hasPick, enclosed, stonyRe }) {
    const _pPassable = (b) => !b || (b.boundingBox !== 'block' && !/water|lava/.test(b.name || ''));
    const _pSolid = (b) => !!(b && b.boundingBox === 'block');
    const _pDiggable = (b) => _pSolid(b) && !/bedrock|water|lava/.test(b.name || '');
    const _pNoPickGated = (b) => (!hasPick && stonyRe.test(b.name || '') && !enclosed);
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (_pPassable(blockAt(m2.offset(0, 2, 0)))) {
        for (const [dx, dz] of DIRS) {
            const bFoot = blockAt(m2.offset(dx, 0, dz));
            const bHead = blockAt(m2.offset(dx, 1, dz));
            const bAbove = blockAt(m2.offset(dx, 2, dz));
            if (_pSolid(bFoot) && !/water|lava/.test(bFoot.name || '') && _pPassable(bHead) && _pPassable(bAbove)) {
                return { action: { kind: 'climb', dx, dz, onto: bFoot.name }, gated: [] };
            }
        }
    }
    const gated = [];
    for (const [dx, dz] of DIRS) {
        const bFoot = blockAt(m2.offset(dx, 0, dz));
        const bHead = blockAt(m2.offset(dx, 1, dz));
        const bFloor = blockAt(m2.offset(dx, -1, dz));
        if (!_pSolid(bFloor) || /water|lava/.test(bFloor.name || '')) continue;
        const wall = _pDiggable(bFoot) ? bFoot : (_pDiggable(bHead) ? bHead : null);
        if (!wall) continue;
        if (_pNoPickGated(wall)) { gated.push(wall); continue; }
        const otherB = wall === bFoot ? blockAt(m2.offset(dx, 1, dz)) : blockAt(m2.offset(dx, 0, dz));
        const other = (_pDiggable(otherB) && !_pNoPickGated(otherB)) ? otherB : null;
        return { action: { kind: 'dig', dx, dz, wall, other }, gated };
    }
    return { action: null, gated };
}

// ★T-0165 浅水上岸台阶 (live 10-09 20:42-20:46 @-40,62,21, 1 格深池塘 3.5min): 水面漂浮最高 ~y+0.83, 脚下垫块
//   (placeBlockUnderFeet) 要 y+0.92 → 在水面上物理够不着。人类做法: 往相邻水格 (底实心可当放置参照、上两格空
//   能站) 垫一块当台阶, 游泳跳上去。blockAt(x,y,z) 风格读数; prefer={x,z} 岸的方向 (可空)。无可行台阶 → null。
export function planWaterStep(blockAt, feet, prefer = null) {
    const nm = (b) => (b && b.name) || 'air';
    const airy = (b) => /^(air|cave_air|void_air|short_grass|tall_grass|fern)$/.test(nm(b));
    const solid = (b) => !!(b && b.boundingBox === 'block' && !/water|lava/.test(nm(b)));
    if (!airy(blockAt(feet.x, feet.y + 2, feet.z))) return null;          // no room to rise onto a step
    let best = null, bestScore = -Infinity;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = feet.x + dx, z = feet.z + dz;
        if (nm(blockAt(x, feet.y, z)) !== 'water') continue;             // placeBlock replaces 'water' only
        if (!solid(blockAt(x, feet.y - 1, z))) continue;                   // floor to place against
        if (!airy(blockAt(x, feet.y + 1, z)) || !airy(blockAt(x, feet.y + 2, z))) continue;   // stand on it
        const score = prefer ? (dx * (prefer.x - feet.x) + dz * (prefer.z - feet.z)) : 0;
        if (score > bestScore) { bestScore = score; best = { x, y: feet.y, z, dx, dz }; }
    }
    return best;
}
