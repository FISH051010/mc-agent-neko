// providers.js — LLM 供应商注册表（数据驱动，全仓唯一真值源）。
//
// 设计取自 N.E.K.O. 主仓的 config/api_providers.json + config/providers.py：
//   · provider 清单是**数据**不是代码 —— 新增一家国内厂商 = 往下面的表里加一条
//   · thinking(思考模式) 的关闭参数各家方言不同，集中成 THINKING 常量表统一映射
//   · 默认一律关思考：游戏 bot 要的是低延迟动作，不是长篇推理；而且不少模型会把
//     思考链直接倒进 content，混进 !command 解析里会直接把动作解析坏掉
//
// 模型名说明：models[] 只是**建议起点**。控制面板在配好 key 后会调
// `GET {base_url}/models` 拉真实清单，所以这里的名字过期也不影响使用。
// base_url 相对稳定，模型名不稳定 —— 不要把这里的模型名当权威。

// ── thinking 方言 ────────────────────────────────────────────────────────────
// 每种方言给出 off / low 两档要注入的请求体片段。null = 该档不注入任何东西。
export const THINKING_DIALECTS = {
    // DashScope(通义千问) / 硅基流动 等 OpenAI 兼容网关的方言。OpenAI 官方不认这个字段。
    qwen:      { off: { enable_thinking: false },                 low: { enable_thinking: true } },
    // 智谱 GLM / 月之暗面 Kimi / 火山方舟豆包 —— 形状与 Anthropic 同构，但走 OpenAI 兼容层
    disabled:  { off: { thinking: { type: 'disabled' } },         low: { thinking: { type: 'enabled' } } },
    // OpenAI 原生 Chat Completions：顶层字段。注意嵌套写法 {reasoning:{effort}} 在此会 400。
    openai:    { off: { reasoning_effort: 'none' },               low: { reasoning_effort: 'low' } },
    // OpenAI Responses API（gpt.js 在未设 url 时走这条）：reasoning 是对象
    responses: { off: { reasoning: { effort: 'none' } },          low: { reasoning: { effort: 'low' } } },
    // OpenRouter 聚合
    openrouter:{ off: { reasoning: { effort: 'none' } },          low: { reasoning: { effort: 'low' } } },
    // Anthropic 原生 Messages API：只关不开（新版 Opus 收到 {type:'enabled'} 会 400）
    anthropic: { off: { thinking: { type: 'disabled' } },         low: null },
    // Gemini OpenAI 兼容层：双层嵌套，少一层会报 Unknown name 'google'
    gemini:    { off: { extra_body: { google: { thinking_config: { thinking_budget: 0 } } } },
                 low: { extra_body: { google: { thinking_config: { thinking_budget: 512 } } } } },
    // 无可用旋钮：靠选非推理模型规避
    none:      { off: null, low: null },
};

// ── provider 注册表 ──────────────────────────────────────────────────────────
// region: 'cn' 国内直连 | 'intl' 需境外网络 | 'local' 本机
// verified: 该条目的 base_url / 默认模型是否经本仓实测。false = 仅按公开资料填写，
//           面板会提示用户先点「测试连接」。
export const PROVIDERS = [
    // ───────────────── 国内厂商 ─────────────────
    {
        // ★2026-09-09 实测修正（用户质疑「V4 应该有开关了吧」，一查确实是我写错了）：
        //   旧条目写 thinking:'none' + 模型 deepseek-chat/deepseek-reasoner，那是 V3 时代的
        //   「靠选推理/非推理模型」形态。V4 之后：
        //     · deepseek-chat / deepseek-reasoner **已从 API 下线**（GET /models 只返回下面三个）
        //     · 有了真正的开关 {"thinking":{"type":"disabled"}}，与 GLM/Kimi/豆包同形
        //     · **思考默认是开的**（默认 effort=high）—— 不显式关掉，游戏 bot 每步都会深度推理
        //   实测（真实 key 打 /chat/completions，看响应里有没有 reasoning_content）：
        //     不传参数              → 有 reasoning_content（思考开着）
        //     thinking.type=disabled → 无 reasoning_content  ✅
        //     reasoning_effort='low' → 仍有（顶层参数只调深度，关不掉）
        //     enable_thinking:false  → HTTP 200 但**被静默忽略**，思考照开 ⚠️ 填错方言不报错
        key: 'deepseek', label: 'DeepSeek 深度求索', region: 'cn',
        base_url: 'https://api.deepseek.com/v1', key_name: 'DEEPSEEK_API_KEY',
        openai_compatible: true, thinking: 'disabled', verified: true,
        console: 'https://platform.deepseek.com/api_keys',
        note: '思考模式默认开启，本程序会显式关掉（游戏 bot 要的是低延迟动作）。注意：开思考时 temperature 等采样参数会被忽略。',
        models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp'],
        default_model: 'deepseek-v4-flash',
        embedding: null,
    },
    {
        key: 'qwen', label: '通义千问 / 阿里百炼', region: 'cn',
        base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', key_name: 'QWEN_API_KEY',
        openai_compatible: true, thinking: 'qwen', verified: true,
        console: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
        models: ['qwen-plus', 'qwen-turbo', 'qwen-max'], default_model: 'qwen-plus',
        embedding: 'text-embedding-v3',
    },
    {
        key: 'glm', label: '智谱 GLM', region: 'cn',
        base_url: 'https://open.bigmodel.cn/api/paas/v4', key_name: 'ZHIPU_API_KEY',
        openai_compatible: true, thinking: 'disabled', verified: false,
        console: 'https://open.bigmodel.cn/usercenter/apikeys',
        note: 'stop 参数只接受数组形式。',
        models: ['glm-4-flash', 'glm-4-plus', 'glm-4-air'], default_model: 'glm-4-flash',
        embedding: 'embedding-3',
    },
    {
        key: 'kimi', label: '月之暗面 Kimi', region: 'cn',
        base_url: 'https://api.moonshot.cn/v1', key_name: 'MOONSHOT_API_KEY',
        openai_compatible: true, thinking: 'disabled', verified: false,
        console: 'https://platform.moonshot.cn/console/api-keys',
        models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2-0905-preview'], default_model: 'moonshot-v1-32k',
        embedding: null,
    },
    {
        key: 'doubao', label: '豆包 / 火山方舟', region: 'cn',
        base_url: 'https://ark.cn-beijing.volces.com/api/v3', key_name: 'ARK_API_KEY',
        openai_compatible: true, thinking: 'disabled', verified: false,
        console: 'https://console.volcengine.com/ark',
        note: '模型名要填方舟控制台里的「接入点 ID」(ep-xxxx) 或模型全名。',
        models: [], default_model: '',
        embedding: null,
    },
    {
        key: 'siliconflow', label: '硅基流动 SiliconFlow', region: 'cn',
        base_url: 'https://api.siliconflow.cn/v1', key_name: 'SILICONFLOW_API_KEY',
        openai_compatible: true, thinking: 'qwen', verified: false,
        console: 'https://cloud.siliconflow.cn/account/ak',
        note: '模型名带组织前缀，如 deepseek-ai/DeepSeek-V3。也提供 embedding，适合给没有 embedding 的 provider 兜底。',
        models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'], default_model: 'deepseek-ai/DeepSeek-V3',
        embedding: 'BAAI/bge-m3',
    },
    {
        key: 'stepfun', label: '阶跃星辰 StepFun', region: 'cn',
        base_url: 'https://api.stepfun.com/v1', key_name: 'STEPFUN_API_KEY',
        openai_compatible: true, thinking: 'none', verified: false,
        console: 'https://platform.stepfun.com/interface-key',
        models: ['step-1-8k', 'step-1v-8k'], default_model: 'step-1-8k',
        embedding: null,
    },
    {
        key: 'minimax', label: 'MiniMax 稀宇', region: 'cn',
        base_url: 'https://api.minimaxi.com/v1', key_name: 'MINIMAX_API_KEY',
        openai_compatible: true, thinking: 'none', verified: false,
        console: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
        note: 'MiniMax 的 reasoning_split 不是开关，只控思考链输出到哪个字段，故不做 thinking 映射。',
        models: ['MiniMax-Text-01'], default_model: 'MiniMax-Text-01',
        embedding: null,
    },
    {
        key: 'hunyuan', label: '腾讯混元', region: 'cn',
        base_url: 'https://api.hunyuan.cloud.tencent.com/v1', key_name: 'HUNYUAN_API_KEY',
        openai_compatible: true, thinking: 'none', verified: false,
        console: 'https://console.cloud.tencent.com/hunyuan/api-key',
        models: ['hunyuan-turbos-latest', 'hunyuan-lite'], default_model: 'hunyuan-turbos-latest',
        embedding: null,
    },
    {
        key: 'baichuan', label: '百川智能', region: 'cn',
        base_url: 'https://api.baichuan-ai.com/v1', key_name: 'BAICHUAN_API_KEY',
        openai_compatible: true, thinking: 'none', verified: false,
        console: 'https://platform.baichuan-ai.com/console/apikey',
        models: ['Baichuan4-Turbo', 'Baichuan4-Air'], default_model: 'Baichuan4-Air',
        embedding: null,
    },
    {
        key: 'yi', label: '零一万物 Yi', region: 'cn',
        base_url: 'https://api.lingyiwanwu.com/v1', key_name: 'YI_API_KEY',
        openai_compatible: true, thinking: 'none', verified: false,
        console: 'https://platform.lingyiwanwu.com/apikeys',
        models: ['yi-lightning'], default_model: 'yi-lightning',
        embedding: null,
    },
    {
        key: 'moda', label: '魔搭 ModelScope', region: 'cn',
        base_url: 'https://api-inference.modelscope.cn/v1', key_name: 'MODELSCOPE_API_KEY',
        openai_compatible: true, thinking: 'qwen', verified: false,
        console: 'https://modelscope.cn/my/myaccesstoken',
        models: ['Qwen/Qwen2.5-72B-Instruct'], default_model: 'Qwen/Qwen2.5-72B-Instruct',
        embedding: null,
    },
    {
        key: 'mimo', label: '小米 MiMo', region: 'cn',
        base_url: 'https://api.xiaomimimo.com/v1', key_name: 'MIMO_API_KEY',
        openai_compatible: true, thinking: 'none', verified: false,
        console: 'https://xiaomimimo.com',
        models: [], default_model: '',
        embedding: null,
    },

    // ───────────────── 境外厂商 ─────────────────
    {
        key: 'openai', label: 'OpenAI', region: 'intl',
        base_url: '', key_name: 'OPENAI_API_KEY',
        openai_compatible: true, thinking: 'responses', verified: true,
        console: 'https://platform.openai.com/api-keys',
        note: '不填 base_url 时走官方 Responses API。',
        models: ['gpt-4o-mini', 'gpt-4o'], default_model: 'gpt-4o-mini',
        embedding: 'text-embedding-3-small',
    },
    {
        key: 'anthropic', label: 'Anthropic Claude', region: 'intl',
        base_url: '', key_name: 'ANTHROPIC_API_KEY',
        openai_compatible: false, thinking: 'anthropic', verified: true,
        console: 'https://console.anthropic.com/settings/keys',
        models: ['claude-sonnet-4-5', 'claude-haiku-4-5-20251001'], default_model: 'claude-haiku-4-5-20251001',
        embedding: null,
    },
    {
        key: 'google', label: 'Google Gemini', region: 'intl',
        base_url: '', key_name: 'GEMINI_API_KEY',
        openai_compatible: false, thinking: 'gemini', verified: true,
        console: 'https://aistudio.google.com/apikey',
        models: ['gemini-2.0-flash', 'gemini-2.5-flash'], default_model: 'gemini-2.0-flash',
        embedding: 'text-embedding-004',
    },
    {
        key: 'openrouter', label: 'OpenRouter 聚合', region: 'intl',
        base_url: 'https://openrouter.ai/api/v1', key_name: 'OPENROUTER_API_KEY',
        openai_compatible: true, thinking: 'openrouter', verified: true,
        console: 'https://openrouter.ai/keys',
        note: '模型名带 provider 前缀，如 deepseek/deepseek-chat。',
        models: ['deepseek/deepseek-chat', 'google/gemini-2.0-flash-001'], default_model: 'deepseek/deepseek-chat',
        embedding: null,
    },
    {
        key: 'xai', label: 'xAI Grok', region: 'intl',
        base_url: 'https://api.x.ai/v1', key_name: 'XAI_API_KEY',
        openai_compatible: true, thinking: 'none', verified: true,
        console: 'https://console.x.ai',
        models: ['grok-2-latest'], default_model: 'grok-2-latest',
        embedding: null,
    },

    // ───────────────── 本机 ─────────────────
    {
        key: 'ollama', label: 'Ollama（本机）', region: 'local',
        base_url: 'http://127.0.0.1:11434', key_name: null,
        openai_compatible: false, thinking: 'none', verified: true,
        console: 'https://ollama.com',
        note: '本机跑模型，不需要 API 密钥。',
        models: ['qwen2.5:7b', 'llama3.1:8b'], default_model: 'qwen2.5:7b',
        embedding: 'nomic-embed-text',
    },
    {
        key: 'lmstudio', label: 'LM Studio（本机）', region: 'local',
        base_url: 'http://localhost:1234/v1', key_name: null,
        openai_compatible: true, thinking: 'none', verified: true,
        console: 'https://lmstudio.ai',
        note: '本机跑模型，不需要 API 密钥。',
        models: [], default_model: '',
        embedding: null,
    },
];

const BY_KEY = Object.fromEntries(PROVIDERS.map(p => [p.key, p]));

export function getProvider(key) { return BY_KEY[key] || null; }

/**
 * 从 profile 的一个模型字段推断出 provider 内部 key。推不出来返回 null。
 *
 * 字段有两种写法：字符串 `"deepseek/deepseek-chat"` / `"gpt-4o-mini"`，
 * 或对象 `{api:'deepseek', model:'deepseek-chat', url:'…'}`（面板写的是后者）。
 *
 * ★ 纯函数，不碰密钥、不 import keys.js —— providers.js 是零依赖的数据层，
 *   keys.js 反过来 import 它，这里加 import 会成环。
 */
export function inferProviderKey(field) {
    if (!field) return null;
    const spec = typeof field === 'string' ? { model: field } : field;
    const explicit = spec.api || spec.provider;
    if (explicit && BY_KEY[explicit]) return explicit;

    const model = typeof spec.model === 'string' ? spec.model : '';
    if (!model) return null;

    const slash = model.indexOf('/');
    if (slash > 0 && BY_KEY[model.slice(0, slash)]) return model.slice(0, slash);

    // 裸模型名的关键字回落，与 _model_map.selectAPI 的兜底表保持一致
    const m = model.toLowerCase();
    if (m.includes('deepseek')) return 'deepseek';
    if (m.startsWith('qwen')) return 'qwen';
    if (m.startsWith('glm')) return 'glm';
    if (m.startsWith('moonshot') || m.startsWith('kimi')) return 'kimi';
    if (m.includes('claude')) return 'anthropic';
    if (m.includes('gemini')) return 'google';
    if (m.includes('grok')) return 'xai';
    if (m.includes('gpt') || m.startsWith('o1') || m.startsWith('o3')) return 'openai';
    return null;
}

/** 该 provider 是否根本不需要密钥（本机模型）。 */
export function needsNoKey(providerKey) {
    const p = BY_KEY[providerKey];
    return !!p && (p.region === 'local' || !p.key_name);
}
export function listProviders() { return PROVIDERS; }

/**
 * 把 thinking 档位翻译成该 provider 要注入的请求体片段。
 * @param {string} providerKey
 * @param {'off'|'low'|'auto'} mode  auto = 不注入，随模型自己的默认
 * @returns {object|null}
 */
export function resolveThinking(providerKey, mode) {
    if (!mode || mode === 'auto') return null;
    const p = BY_KEY[providerKey];
    if (!p) return null;
    const dialect = THINKING_DIALECTS[p.thinking || 'none'];
    if (!dialect) return null;
    const shape = dialect[mode === 'off' ? 'off' : 'low'];
    return shape ? JSON.parse(JSON.stringify(shape)) : null;
}

// ── 思考旋钮的运行时自愈 ────────────────────────────────────────────────────
//
// ★2026-09-07 事故（实测于分发包）：OpenAI 的 reasoning.effort 档位**按模型分裂**，
//   没有一个全家通用的"最低档"：
//       gpt-5.6-*  支持 none/low/medium/high/xhigh/max，**不支持 minimal**
//       gpt-5-nano 支持 minimal，**不支持 none**
//   注册表里写死任何一个值，都必然有一批模型 400。当时写成 minimal，用户的
//   gpt-5.6-terra 每次调用都被拒 → gpt.js 吞成 "My brain disconnected, try again."
//   → bot 没脑子 → self-prompt 空转 → "I'm stuck!"。表象离病根隔了三层，极难排查。
//
// 所以不靠猜：服务端 400 时它会**把支持的档位列在报错里**，直接解析出来挑一个。
// 偏好顺序 = 越靠前越"关"，因为我们的默认意图就是关思考。
const EFFORT_PREFERENCE = ['none', 'minimal', 'low', 'medium', 'high'];

/** 从报错文本里抠出 "Supported values are: 'a', 'b', and 'c'." 里的档位。 */
function parseSupportedEfforts(message) {
    const m = /Supported values are:\s*([^.]+)/i.exec(String(message || ''));
    if (!m) return [];
    return m[1]
        .split(/[,;]|\band\b/)
        .map(s => s.replace(/['"`\s]/g, ''))
        .filter(Boolean);
}

/**
 * 思考旋钮被服务端拒了 → 返回修正后的 params；与思考无关的错误返回 null。
 *
 * @param {object} params 当前请求参数（会被浅拷贝，不原地改）
 * @param {any}    err    provider SDK 抛出的错误
 * @returns {{params:object, note:string}|null}
 */
export function healThinkingParams(params, err) {
    if (!params || typeof params !== 'object') return null;

    const param = err?.param || err?.error?.param || '';
    const code = err?.code || err?.error?.code || '';
    const msg = err?.error?.message || err?.message || '';

    const aboutEffort = /reasoning(_effort|\.effort)/i.test(String(param))
        || /reasoning[_.]?effort/i.test(msg);
    const rejected = code === 'unsupported_value'
        || /unsupported value|not supported with the/i.test(msg);
    if (!aboutEffort || !rejected) return null;

    // 当前设的是哪个值、放在哪种形状里
    const nested = params.reasoning && typeof params.reasoning === 'object';
    const current = nested ? params.reasoning.effort : params.reasoning_effort;
    if (current === undefined) return null;

    const supported = parseSupportedEfforts(msg);
    const pick = EFFORT_PREFERENCE.find(v => supported.includes(v));

    const next = { ...params };
    if (pick) {
        if (nested) next.reasoning = { ...params.reasoning, effort: pick };
        else next.reasoning_effort = pick;
        return {
            params: next,
            note: `该模型不接受思考档位 "${current}"，已自动改用它支持的 "${pick}"`
                + (supported.length ? `（它支持: ${supported.join('/')}）` : ''),
        };
    }

    // 报错里没列出可用档位 —— 索性把旋钮整个摘掉，让模型用自己的默认
    if (nested) delete next.reasoning; else delete next.reasoning_effort;
    return { params: next, note: `该模型不接受思考档位 "${current}"，且未告知可用值，已移除该参数改用模型默认` };
}

/** provider 是否有可用的思考旋钮（面板据此决定开关是否置灰）。 */
export function hasThinkingSwitch(providerKey) {
    const p = BY_KEY[providerKey];
    return !!(p && p.thinking && p.thinking !== 'none');
}

/** 面板用：不含任何密钥的目录视图。 */
export function catalogForPanel() {
    return PROVIDERS.map(p => ({
        key: p.key, label: p.label, region: p.region,
        base_url: p.base_url, key_name: p.key_name,
        needs_key: p.key_name !== null,
        openai_compatible: p.openai_compatible,
        has_thinking_switch: hasThinkingSwitch(p.key),
        verified: !!p.verified, console: p.console || '', note: p.note || '',
        models: p.models || [], default_model: p.default_model || '',
        embedding: p.embedding || null,
    }));
}

export default { PROVIDERS, THINKING_DIALECTS, getProvider, listProviders, resolveThinking, hasThinkingSwitch, catalogForPanel };
