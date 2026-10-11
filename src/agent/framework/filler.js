// ONE shared "placeable filler block we carry" matcher for every wall/seal/interpose consumer (modes.js creeperInterpose +
// self_preservation's fillerOf) and for the decision layer's pre-dusk stocking (★T-0262). Context-specific policy is applied
// after matching: seal/pillar paths exclude planks, while the one-block creeper interpose may still spend one.
// ★C280 drift lesson: red_sand added to one FILL_RE but not the others → bot dug 163 red_sand yet fillerOf()=undefined →
// couldn't seal → died 3×. Add new block families HERE only, never in a local copy.
export const FILL_RE = /cobblestone|cobbled|deepslate|^dirt$|andesite|diorite|granite|^stone$|tuff|gravel|^sand$|red_sand|sandstone|netherrack|_planks$|_log$|_wood$|^planks$|hyphae|^mud$|^clay$|terracotta|dirt_path|coarse_dirt|rooted_dirt|mossy|calcite|blackstone|basalt/;
// 封坑/垫柱可花的填充 (不含木料: 木板/原木是合成与燃料的稀缺料, 封坑路径本就排除木板)。
const WOOD_RE = /_planks$|^planks$|_log$|_wood$|hyphae/;
export function sealFillerCount(counts) {
    let n = 0;
    for (const [k, v] of Object.entries(counts || {})) if (FILL_RE.test(k) && !WOOD_RE.test(k)) n += v || 0;
    return n;
}
// ★T-0262: 封一个夜坑 (顶 + 四壁 + 余量) 的最少填充数, 与备料目标。
export const SEAL_FILLER_MIN = 8;
export const SEAL_FILLER_TARGET = 16;
