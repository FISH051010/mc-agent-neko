// think.js — 思考链（<think>…</think>）剥壳的唯一实现。
//
// 背景 (2026-08-07): 全仓原本有 7 处各写各的剥壳逻辑，行为互不一致；
// prompter.js 的 promptCoding / promptShouldRespondToBot 干脆一点都没剥 ——
// 后者拿 `res.trim().toLowerCase() === 'respond'` 做全等判断，只要模型吐了思考链
// 就永远判 false，机器人之间的对话直接哑火。
//
// 规则（保持极简，别加聪明劲）：
//   1) 成对的 <think>…</think> 整段删掉（可能出现多段，可跨行）
//   2) 只有闭合标签、没有开标签（网关吞了开标签 / 流式被截断）—— 取最后一个 </think> 之后
//   3) 两种标签都没有 —— 原样返回，一个字符都不动
//
// 注意：只有开标签没有闭合标签时也原样返回。那种情况说明这次生成被截断了，
// 正文根本没出来，交给调用方按"空回复"处理，别在这里瞎猜。

const THINK_PAIR = /<think>[\s\S]*?<\/think>/gi;
const CLOSE_TAG = /<\/think\s*>/i;

/**
 * 去掉模型回复里的思考链外壳。
 * @param {string} text
 * @returns {string} 剥壳后的正文（非字符串输入原样返回）
 */
export function stripThink(text) {
    if (typeof text !== 'string' || !text) return text;
    const lower = text.toLowerCase();
    if (!lower.includes('<think>') && !lower.includes('</think>')) return text;

    // 1) 成对的整段删掉
    let out = text.replace(THINK_PAIR, '');

    // 2) 还剩孤立的闭合标签 —— 正文在最后一个 </think> 之后（循环处理多个残留）
    let m;
    while ((m = out.match(CLOSE_TAG)) !== null) {
        out = out.slice(m.index + m[0].length);
    }

    return out.trim();
}

export default stripThink;
