import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { PROVIDERS, THINKING_DIALECTS, resolveThinking } from './providers.js';
import { makeOpenAICompatibleClass } from './openai_compatible.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 这几个是基建文件，不是 provider 实现，扫描时跳过。
const INFRA_FILES = new Set([
    '_model_map.js',
    'prompter.js',
    'providers.js',
    'openai_compatible.js',
    'provider_test.js',
]);

// Dynamically discover model classes in this directory.
// Each model class must export a static `prefix` string.
//
// 两轮注册（2026-08-07）：
//   第一轮 —— 扫描 src/models/*.js 的手写类（保持原有行为，手写类优先）
//   第二轮 —— providers.js 里 openai_compatible:true 且第一轮没占到同名 prefix 的，
//             用 openai_compatible.js 的工厂现场生成一个类补上
// 于是「新增一家国内厂商」= 往 providers.js 加一行，不用再新建文件。
const apiMap = await (async () => {
    const map = {};
    const files = (await fs.readdir(__dirname))
        .filter(f => f.endsWith('.js') && !INFRA_FILES.has(f))
        .sort(); // fs.readdir 顺序不保证，排序后注册顺序才是确定的
    for (const file of files) {
        try {
            const moduleUrl = pathToFileURL(path.join(__dirname, file)).href;
            const mod = await import(moduleUrl);
            for (const exported of Object.values(mod)) {
                if (typeof exported === 'function' && Object.prototype.hasOwnProperty.call(exported, 'prefix')) {
                    const prefix = exported.prefix;
                    if (typeof prefix === 'string' && prefix.length > 0) {
                        map[prefix] = exported;
                    }
                }
            }
        } catch (e) {
            // ★别降级成 warn：这里失败意味着某家供应商**整个不可用**，而症状只是
            //   "选了这个模型说 Unknown api"，用户根本联想不到是加载失败。
            console.error(`供应商模块加载失败: ${file} —— ${e?.message || e}`);
            if (e?.stack) console.error(e.stack);
        }
    }
    for (const spec of PROVIDERS) {
        if (!spec.openai_compatible) continue;
        if (map[spec.key]) continue; // 手写类优先
        try {
            map[spec.key] = makeOpenAICompatibleClass(spec);
        } catch (e) {
            console.error(`供应商 ${spec.key} 自动注册失败 —— ${e?.message || e}`);
        }
    }
    return map;
})();

/** 可用供应商清单（报错文案里给用户看的）。 */
function availableApis() {
    return Object.keys(apiMap).sort().join('、');
}

// 少数模型名不带供应商前缀，只能靠关键字猜。放在路由链最后一环。
const KEYWORD_TABLE = [
    [m => m.includes('gpt') || m.includes('o1') || m.includes('o3'), 'openai'],
    [m => m.includes('claude'), 'anthropic'],
    [m => m.includes('gemini'), 'google'],
    [m => m.includes('grok'), 'xai'],
    [m => m.includes('mistral'), 'mistral'],
    [m => m.includes('deepseek'), 'deepseek'],
    [m => m.includes('qwen'), 'qwen'],
];

const SEPARATORS = ['-', '/', ':', '_', '.'];

function matchesKeyWithSeparator(model, key) {
    if (model === key) return true;
    return SEPARATORS.some(sep => model.startsWith(key + sep));
}

/**
 * 决定 profile 用哪家 API，并把模型名里的供应商前缀剥掉。
 * ★不会原地修改传入的对象 —— 返回一个新对象。
 *
 * 路由顺序（确定性，不依赖 fs.readdir 的返回顺序）：
 *   1. profile.api 显式指定
 *   2. model 形如 `<供应商key>/<模型名>`
 *   3. 注册表 key + 分隔符 精确前缀（如 glm-4-flash → glm）
 *   4. 已注册的所有 api key 裸前缀（长的优先，兼容 groq/cerebras 等老写法）
 *   5. 关键字表（gpt/claude/gemini…）
 */
export function selectAPI(profile) {
    let p;
    if (typeof profile === 'string' || profile instanceof String) {
        p = { model: String(profile) };
    } else {
        p = { ...(profile || {}) };
    }

    // backwards compatibility with local->ollama
    if (p.api?.includes('local') || p.model?.includes('local')) {
        p.api = 'ollama';
        if (p.model) {
            p.model = p.model.replace('local', 'ollama');
        }
    }

    if (!p.api) {
        const model = typeof p.model === 'string' ? p.model : '';
        if (!model) {
            throw new Error(
                `没写要用哪个模型。请在控制面板的「API 配置」页选一个供应商和模型。` +
                `当前可用的供应商：${availableApis()}`
            );
        }

        // 2. `<供应商key>/<模型名>`
        const slash = model.indexOf('/');
        if (slash > 0) {
            const head = model.slice(0, slash);
            if (apiMap[head]) p.api = head;
        }

        // 3. 注册表 key + 分隔符
        if (!p.api) {
            const hit = PROVIDERS.find(spec => apiMap[spec.key] && matchesKeyWithSeparator(model, spec.key));
            if (hit) p.api = hit.key;
        }

        // 4. 已注册 api key 的裸前缀，长的优先（避免 'qwen' 抢走 'qwen2.5:7b' 之外的歧义）
        if (!p.api) {
            const keys = Object.keys(apiMap).sort((a, b) => (b.length - a.length) || a.localeCompare(b));
            const hit = keys.find(key => model.startsWith(key));
            if (hit) p.api = hit;
        }

        // 5. 关键字表
        if (!p.api) {
            const lower = model.toLowerCase();
            const hit = KEYWORD_TABLE.find(([test]) => test(lower));
            if (hit) p.api = hit[1];
        }

        if (!p.api) {
            throw new Error(
                `认不出模型「${model}」是哪家的。请在模型名前加上供应商，写成「供应商/模型名」` +
                `（例如 deepseek/deepseek-chat），或在配置里直接指定供应商。` +
                `当前可用的供应商：${availableApis()}`
            );
        }
    }

    if (!apiMap[p.api]) {
        throw new Error(
            `没有名为「${p.api}」的供应商（模型：${p.model ?? '未指定'}）。` +
            `当前可用的供应商：${availableApis()}`
        );
    }

    if (typeof p.model === 'string') {
        const model_name = p.model.replace(p.api + '/', ''); // remove prefix
        p.model = model_name === '' ? null : model_name; // if model is empty, set to null
    }
    return p;
}

/**
 * OpenAI 的 reasoning 旋钮只有推理模型认，普通模型（gpt-4o 系）收到会直接 400。
 * 所以对 openai 这一家额外加一道模型能力闸，别把整个机器人打挂。
 */
function openaiReasoningCapable(model) {
    if (!model) return false;
    const m = String(model).toLowerCase();
    return /(^|[/_-])(o1|o3|o4)([-.]|$)/.test(m) || m.includes('gpt-5');
}

/** Gemini 只有 2.5 及以后的型号有思考预算旋钮；给 2.0-flash 发过去会 400。 */
function geminiThinkingCapable(model) {
    if (!model) return false;
    const m = String(model).toLowerCase();
    return /gemini-(2\.5|3)/.test(m);
}

/**
 * 取该 profile 要注入的「关思考」请求体片段。
 * 这是全仓唯一的 thinking 注入点 —— createModel 是唯一的模型构造口。
 *
 * 注册表给的是各家 **OpenAI 兼容层** 的方言；有两家走的是自己的原生 SDK，
 * 字段形状对不上，在这里做一次纠偏（改注册表会影响面板展示，所以放这儿）。
 */
function thinkingPatch(p) {
    const mode = p.thinking ?? 'off';
    if (!mode || mode === 'auto') return null;

    if (p.api === 'openai') {
        if (!openaiReasoningCapable(p.model)) return null;
        // gpt.js 设了 url 走 chat.completions（顶层 reasoning_effort），
        // 没设 url 走 Responses API（嵌套 reasoning 对象）。两条路的字段名不通用。
        if (p.url) {
            const shape = THINKING_DIALECTS.openai?.[mode === 'off' ? 'off' : 'low'];
            return shape ? JSON.parse(JSON.stringify(shape)) : null;
        }
    }

    if (p.api === 'google') {
        // gemini.js 用的是 @google/genai 原生 SDK，params 直接摊进 config，
        // 认的是驼峰的 thinkingConfig，不是 OpenAI 兼容层那套 extra_body 嵌套。
        if (!geminiThinkingCapable(p.model)) return null;
        return { thinkingConfig: { thinkingBudget: mode === 'off' ? 0 : 512 } };
    }

    return resolveThinking(p.api, mode);
}

/**
 * 构造模型实例。
 * @param {object} profile selectAPI() 的返回值（或至少带 api）
 * @param {'chat'|'code'|'vision'|'embedding'} [role] 角色。embedding 不注入思考开关。
 */
export function createModel(profile, role = 'chat') {
    const p = { ...(profile || {}) };
    if (apiMap[p.model]) {
        // if the model value is an api (instead of a specific model name)
        // then set model to null so it uses the default model for that api
        p.model = null;
    }
    if (!apiMap[p.api]) {
        throw new Error(
            `没有名为「${p.api ?? '(未指定)'}」的供应商（模型：${p.model ?? '未指定'}）。` +
            `当前可用的供应商：${availableApis()}`
        );
    }

    const had_params = p.params !== undefined && p.params !== null;
    const params = had_params ? { ...p.params } : {};
    let injected = false;
    if (role !== 'embedding') {
        const patch = thinkingPatch(p);
        if (patch) {
            for (const [k, v] of Object.entries(patch)) {
                // 用户在 profile 里手写的 params 永远优先，不覆盖
                if (params[k] === undefined) {
                    params[k] = v;
                    injected = true;
                }
            }
        }
    }

    const Cls = apiMap[p.api];
    return new Cls(p.model, p.url, (had_params || injected) ? params : undefined);
}

/** 已注册的供应商 key 列表（面板 / 自检用）。 */
export function listRegisteredApis() {
    return Object.keys(apiMap).sort();
}
