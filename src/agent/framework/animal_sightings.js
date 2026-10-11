// ★T-0209 动物目击记忆 (监工拍板 2026-10-10): 比起盲目放大侦察半径, 记住"哪儿见过羊/牛/猪/鸡"。
// 证据: 第 3 天 18:04 在约 41b 外看到过羊 (bot 在 71,-2 附近), bedErrand 两轮 96b 盲搜却都没找到 — 这一带有羊, 只是没记住。
// 存在 bot._landmarks (landmarks.json, 世界级坐标态, 已纳入 T-0065 换世界归档) 里, kind='sighting',
// 键 = 种类 + 区块 (同区块去重), 保留 24h。不碰既有的 'animal' landmark (FOOD_FLOOR 的 25s 新鲜目标照旧)。
export const SIGHTING_TYPES_RE = /^(sheep|cow|pig|chicken|mooshroom)$/;
export const SIGHTING_MAX_AGE_MS = 24 * 3600 * 1000;
export const SIGHTING_TARGET_MAX_DIST = 200;

/** 扫一遍实体登记目击 (同种类同区块去重, count=本次该区块该种类头数), 顺带清掉 >24h 的旧记录。返回是否有改动。 */
export const SIGHTING_CLEAR_R = 24;
/** ★T-0273 补 (06:02-06:05Z 实录: 出生点一带 581 条目击, 最近的全是 3.5-5h 前的单只鸡 (早被 bot 吃掉), 侦察每轮挑最近的旧点
 *  扑空 → 下一轮再挑旁边的旧点, 两轮 600+ 格零动物): observer 在目击点 SIGHTING_CLEAR_R 内而这一拍没刷新到 (该区块已无此种类)
 *  → 亲眼看过是空的, 删掉; 杀掉/吃掉的动物同理。侦察就会往外推, 不在吃空的区域打转。 */
export function recordSightings(lm, entities, now = Date.now(), observer = null) {
    if (!lm) return false;
    let dirty = false;
    const seen = new Map();
    for (const e of Object.values(entities || {})) {
        if (!e || !e.position || !SIGHTING_TYPES_RE.test(e.name || '')) continue;
        const cx = Math.floor(e.position.x / 16), cz = Math.floor(e.position.z / 16);
        const key = `sighting:${e.name}@${cx},${cz}`;
        const s = seen.get(key) || { kind: 'sighting', type: e.name, x: Math.round(e.position.x), y: Math.round(e.position.y), z: Math.round(e.position.z), ts: now, count: 0 };
        s.count++;
        seen.set(key, s);
    }
    for (const [key, s] of seen) {
        const prev = lm[key];
        if (!prev || prev.ts !== s.ts || prev.count !== s.count) dirty = true;
        lm[key] = s;
    }
    for (const key of Object.keys(lm)) {
        const n = lm[key];
        if (!n || n.kind !== 'sighting') continue;
        if (now - (n.ts || 0) > SIGHTING_MAX_AGE_MS) { delete lm[key]; dirty = true; continue; }
        if (observer && Number.isFinite(observer.x) && !seen.has(key) && Math.hypot(n.x - observer.x, n.z - observer.z) <= SIGHTING_CLEAR_R) { delete lm[key]; dirty = true; }
    }
    return dirty;
}

/** ★T-0273 ③ (监工拍板): 目击权重 — 群体 (猪/牛/羊/哞菇 ≥2) 优先, 单只鸡随时间衰减 (>2h 几乎不算: 多半已被吃掉/走散)。
 *  家畜群体不会自己消失 (不刷新也不 despawn), 衰减慢; 单只 (尤其鸡) 衰减快。 */
export const SIGHTING_HOUR_MS = 3600 * 1000;
export function sightingWeight(n, age) {
    const herd = (n.count || 1) >= 2;
    const chicken = n.type === 'chicken';
    const base = herd && !chicken ? 3 : herd ? 1.5 : chicken ? 1 : 1.2;
    const decay = (!herd && chicken)
        ? (age <= 2 * SIGHTING_HOUR_MS ? 1 - 0.5 * age / (2 * SIGHTING_HOUR_MS) : 0.05)
        : Math.max(0.25, 1 - age / (24 * SIGHTING_HOUR_MS));
    return base * decay;
}
/** 最佳目击 (按 距离/权重 最小; 权重见 sightingWeight): ≤maxDist、≤maxAgeMs。返回 {type,x,y,z,dist,ageMs,count} 或 null。 */
export function nearestSighting(lm, typeRe, pos, { maxDist = SIGHTING_TARGET_MAX_DIST, maxAgeMs = SIGHTING_MAX_AGE_MS, now = Date.now(), newerThan = 0 } = {}) {
    if (!lm || !pos) return null;
    let best = null, bestScore = Infinity;
    for (const key of Object.keys(lm)) {
        const n = lm[key];
        if (!n || n.kind !== 'sighting' || !typeRe.test(n.type || '')) continue;
        const age = now - (n.ts || 0);
        if (age > maxAgeMs || (n.ts || 0) <= newerThan) continue;
        const d = Math.hypot(n.x - pos.x, n.z - pos.z);
        if (d > maxDist) continue;
        const score = Math.max(d, 1) / sightingWeight(n, age);
        if (score < bestScore) { bestScore = score; best = { type: n.type, x: n.x, y: n.y, z: n.z, dist: +d.toFixed(1), ageMs: age, count: n.count || 1 }; }
    }
    return best;
}

/** 侦察计划: 有目击 → 朝它出发, 半径放宽到能够到它 (≤200b, 有目标的出行); 没有 → 盲搜 baseRadius。 */
export function scoutPlanToward(sighting, baseRadius = 96) {
    if (!sighting) return { toward: null, radius: baseRadius, targeted: false };
    return { toward: { x: sighting.x, z: sighting.z }, radius: Math.min(SIGHTING_TARGET_MAX_DIST, Math.max(baseRadius, Math.ceil(sighting.dist + 16))), targeted: true };
}
