// logbus.js — 面板日志总线：800 条环形缓冲 + 自增 seq，供 GET /api/logs?since= 增量拉取。
//
// 为什么需要它：agent 子进程原本是 stdio:'inherit'，日志直接进父进程的终端，面板
// 一个字也拿不到 —— 这就是老面板没有日志区的根因。现在 agent_process.js 把 stdout/
// stderr 接过来，一路照旧写终端，一路灌进这里。
//
// ★脱敏是硬要求：日志里出现 API key 是家常便饭（HTTP 客户端报错会把请求头打出来，
//   用户自己也可能把 key 粘到聊天里）。面板日志会被截图、被贴进群里求助。
//   所以入库前一律正则打码，**存进缓冲区的就是脱敏后的文本**，不留原文副本。

const CAPACITY = 800;

const buffer = [];      // [{seq, t, text}]
let seq = 0;

// ── 脱敏 ────────────────────────────────────────────────────────────────────
// 宁可多打码也不能漏。这些规则按"从具体到笼统"排，先命中的先替换。
const REDACTIONS = [
    // Anthropic（要排在通用 sk- 前面，否则会被前者先吃掉）
    [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-****已隐藏****'],
    // OpenAI / DeepSeek / Moonshot / 通义 / 硅基流动 等：sk- 开头
    [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-****已隐藏****'],
    // Google AI Studio
    [/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza****已隐藏****'],
    // HTTP Authorization 头
    [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 ****已隐藏****'],
    // 各种 "api_key": "xxx" / api-key=xxx / X-Api-Key: xxx
    [/((?:api[_-]?key|access[_-]?token|apikey|x-api-key)["'\s]*[:=]["'\s]*)([A-Za-z0-9._~+/=-]{8,})/gi, '$1****已隐藏****'],
    // URL 查询串里的 key= / token=
    [/([?&](?:key|api_key|token)=)([A-Za-z0-9._~+/=-]{8,})/gi, '$1****已隐藏****'],
];

export function redact(text) {
    let s = String(text);
    for (const [re, to] of REDACTIONS) s = s.replace(re, to);
    return s;
}

// ANSI 转义：CSI（颜色/光标）、OSC（窗口标题）、单字符 Fe 序列。
// 终端里看着好看，面板里是一堆乱码，一律剥掉。
// ★用 new RegExp + 字符串转义，不写字面控制字符 —— 源码里的裸 ESC(0x1B) 经过
//   编辑器/补丁工具很容易被吞掉，吞掉后这条正则会变成"匹配任意方括号"的灾难。
const ANSI_RE = new RegExp(
    '\\u001B\\[[0-9;?]*[ -/]*[@-~]'                     // CSI: ESC [ … 终止符
    + '|\\u001B\\][\\s\\S]*?(?:\\u0007|\\u001B\\\\)'    // OSC: ESC ] … BEL 或 ESC \
    + '|\\u001B[@-Z\\\\-_]',                            // 单字符 Fe 序列
    'g');

export function stripAnsi(text) {
    return String(text).replace(ANSI_RE, '');
}

/** 清洗一行：剥 ANSI → 脱敏 → 去掉行尾回车 → 截断超长行。 */
function clean(line) {
    let s = stripAnsi(String(line)).replace(/\r$/, '');
    s = redact(s);
    if (s.length > 4000) s = s.slice(0, 4000) + ' …（本行过长已截断）';
    return s;
}

/**
 * 推一行（或一段含换行的文本）进缓冲区。
 * @param {string} text
 * @param {string} [source] 来源标签，会加到行首，如 'bot' / 'sys'
 */
export function push(text, source = '') {
    if (text === null || text === undefined) return;
    const chunk = String(text);
    if (!chunk) return;
    const prefix = source ? `[${source}] ` : '';
    for (const rawLine of chunk.split('\n')) {
        const line = clean(rawLine);
        if (!line.trim()) continue;
        buffer.push({ seq: ++seq, t: Date.now(), text: prefix + line });
    }
    while (buffer.length > CAPACITY) buffer.shift();
}

/**
 * 按行拼接的流式写入器（stdout/stderr 是按块到的，不保证按行切）。
 * 返回一个 write(chunk) 函数，内部自己缓着半行等下一块。
 */
export function lineWriter(source = '') {
    let pending = '';
    return (chunk) => {
        pending += String(chunk);
        const parts = pending.split('\n');
        pending = parts.pop() ?? '';
        for (const line of parts) push(line, source);
        // 半行卡太久也要吐出去，否则最后一条日志永远看不到
        if (pending.length > 8000) { push(pending, source); pending = ''; }
    };
}

/**
 * 增量读取。
 * @param {number} sinceSeq 上次拿到的最大 seq；传 0 或不传 = 从缓冲区头开始
 * @returns {{seq:number, lines:Array<{seq:number,t:number,text:string}>}}
 */
export function since(sinceSeq = 0) {
    const from = Number(sinceSeq) || 0;
    const lines = from > 0 ? buffer.filter(l => l.seq > from) : buffer.slice();
    return { seq, lines };
}

export function currentSeq() { return seq; }

export function clear() {
    buffer.length = 0;
}

export default { push, since, lineWriter, redact, stripAnsi, currentSeq, clear };
