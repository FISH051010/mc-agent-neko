// ★T-0118 砍树/清叶不用镐: 镐/锹/锄/剑对原木和树叶零提速, 每块却照扣耐久 (剑更扣 2)。
// 实录 10-10 16:16→16:20: chopWood 树冠收割/漏斗挖把 3 把木镐磨到 1 把 → 补木↔补镐循环挡住石器时代。
// 人类: 有斧用斧, 没斧空手砍树; 树叶空手/剪刀/锄。equipForBlock 选不出"更快"的工具时会保留手上那把镐,
// 所以必须在它之后按本判据显式空手。
const WOOD_RE = /_log$|_wood$|_stem$|_hyphae$/;
const LEAF_RE = /leaves$/;
export function shouldBareHand(blockName, heldName) {
    const b = String(blockName || ''), h = String(heldName || '');
    if (!h) return false;
    if (WOOD_RE.test(b)) return /_pickaxe$|_shovel$|_hoe$|_sword$/.test(h);
    if (LEAF_RE.test(b)) return /_pickaxe$|_shovel$|_axe$|_sword$/.test(h);
    return false;
}
