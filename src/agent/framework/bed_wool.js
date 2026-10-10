// ★T-0219 床料按【同色】计 (2026-10-10 03:36:36Z 实录): bedErrand 凑到 wool=3 判 materials ready, setBed 却拒做 —
//   "总 3 张但最多单色仅 1 (black), 床要 3 同色" → 秒败 ×3 → GET_BED 冷却 5min (决策层提了 skill 层必拒)。
//   setBed 早就按单色算 (07-03 混色陷阱), bedErrand / world_model 还在数总数。这里是共用口径:
//   单色最多张数 (white 额外 + 线÷4, setBed 的 string→white_wool 路径), 凑毛时只打能把最多那色补到 3 的羊。
export const BED_WOOL_NEEDED = 3;
export const WOOL_COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
    'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const SHEEP_WOOL_META = 17;   // 1.20.2–1.21.x Sheep 元数据: byte, 低 4 位颜色, 0x10 = 已剪

/** 羊的颜色名 (元数据缺失 → null = 未知)。 */
export function sheepColor(e) {
    const m = e && e.metadata;
    const v = m ? m[SHEEP_WOOL_META] : undefined;
    return typeof v === 'number' ? WOOL_COLORS[v & 0x0f] || null : null;
}

/** 单色最多: {color, ct}; white 计入 线÷4 (setBed 会把线合成白羊毛)。 */
export function bestWoolColor(counts) {
    counts = counts || {};
    let color = null, ct = 0;
    for (const c of WOOL_COLORS) {
        const n = (counts[`${c}_wool`] || 0) + (c === 'white' ? Math.floor((counts['string'] || 0) / 4) : 0);
        if (n > ct) { color = c; ct = n; }
    }
    return { color, ct };
}

/** 背包已有床, 或某一色羊毛 (含线折白) ≥3 → setBed 能直接做床。 */
export function bedWoolReady(counts) {
    counts = counts || {};
    if (Object.keys(counts).some(k => /_bed$/.test(k) && counts[k] > 0)) return true;
    return bestWoolColor(counts).ct >= BED_WOOL_NEEDED;
}

/** 凑毛目标色: 背包张数 + 附近该色羊头数 最大的那色 (同分取背包多的); 附近没有任何已知颜色的羊 → 背包最多色或 null。 */
export function targetWoolColor(counts, sheepList) {
    counts = counts || {};
    const near = {};
    for (const s of sheepList || []) { const c = sheepColor(s); if (c) near[c] = (near[c] || 0) + 1; }
    let best = null, bs = -1, bInv = -1;
    for (const c of WOOL_COLORS) {
        const inv = (counts[`${c}_wool`] || 0) + (c === 'white' ? Math.floor((counts['string'] || 0) / 4) : 0);
        if (!near[c] && !inv) continue;
        const score = inv + (near[c] || 0);
        if (score > bs || (score === bs && inv > bInv)) { best = c; bs = score; bInv = inv; }
    }
    return best;
}
