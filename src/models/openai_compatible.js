// openai_compatible.js — 通用「OpenAI 兼容」供应商实现。
//
// 目标：新增一家国内厂商 = 往 providers.js 的表里加一行，**不用再新建文件**。
// providers.js 里 openai_compatible:true 且 src/models/ 下没有同名手写类的条目，
// 由 _model_map.js 用下面的 makeOpenAICompatibleClass() 现场生成一个类注册进去。
// 手写类（deepseek.js / qwen.js / gpt.js …）优先级更高，永远不会被这里覆盖。
//
// 踩坑记录（别删）：
//   · params 必须**深拷贝**。prompter 在没配 code_model 时把 chat_model 实例直接复用成
//     code_model，是同一个对象；历史上多个 provider 对 this.params 做原地 mutation
//     (delete pack.stop 之类)，一处改动会串到另一处，症状是"聊天正常、写代码莫名其妙"。
//   · 智谱 GLM 的 stop 只接受**数组**，传字符串会 400。
//   · 有些网关即使关了思考也会把思考链塞进 message.reasoning_content，正文照常在
//     content 里。碰到就 warn 一次提醒"思考没关掉"，但不影响使用。

import OpenAIApi from 'openai';
import { getProviderCredentials } from '../utils/keys.js';
import { healThinkingParams } from './providers.js';
import { strictFormat } from '../utils/text.js';
import { stripThink } from '../utils/think.js';

// stop 参数只吃数组的家族。多数网关字符串/数组都收，只有这几家挑食。
const STOP_MUST_BE_ARRAY = new Set(['glm']);

/** 深拷贝 params。含函数/循环引用等 JSON 装不下的东西时退回浅拷贝，绝不因此抛错。 */
function clonePlain(obj) {
    if (!obj || typeof obj !== 'object') return {};
    try {
        return structuredClone(obj);
    } catch {
        try {
            return JSON.parse(JSON.stringify(obj));
        } catch {
            return { ...obj };
        }
    }
}

export class OpenAICompatible {
    /**
     * @param {string|null} model_name
     * @param {string} [url]     profile 里显式写的 base_url（优先级最高）
     * @param {object} [params]  请求体附加字段（含 _model_map 注入的关思考开关）
     * @param {object} spec      providers.js 里的那一行
     */
    constructor(model_name, url, params, spec) {
        if (!spec || !spec.key) {
            throw new Error('OpenAICompatible 需要一条 providers.js 里的供应商记录。');
        }
        this.spec = spec;
        // 不在这里回落到 default_model：embedding 角色是用 model_name===null 来区分
        // "用户显式指定了向量模型" 和 "只是复用聊天模型那家" 的，提前填死会把两者混掉。
        this.model_name = model_name || null;
        this.params = clonePlain(params);
        this._warned_reasoning = false;

        const creds = getProviderCredentials(spec.key, spec.key_name);

        // baseURL 优先级：profile 的 url → keys.json 里该 provider 的 base_url → 注册表默认
        const baseURL = (url && String(url).trim())
            || (creds.base_url && creds.base_url.trim())
            || (spec.base_url && spec.base_url.trim())
            || '';

        let apiKey = creds.api_key || '';
        if (!apiKey) {
            if (spec.key_name) {
                // 本机以外的供应商没配密钥 —— 直接给中文提示，别让用户对着 401 猜
                throw new Error(
                    `还没填「${spec.label}」的 API 密钥。请打开控制面板的「API 配置」页填写，` +
                    `密钥可以在 ${spec.console || '供应商官网'} 申请。`
                );
            }
            // 本机模型（Ollama / LM Studio）不需要密钥，但 SDK 要求非空占位
            apiKey = 'local-no-key-needed';
        }

        const config = { apiKey };
        if (baseURL) config.baseURL = baseURL;
        this.openai = new OpenAIApi(config);
    }

    /** 把 stop 调成该供应商吃得下的形状。 */
    _shapeStop(stop_seq) {
        if (stop_seq === undefined || stop_seq === null || stop_seq === '') return undefined;
        if (STOP_MUST_BE_ARRAY.has(this.spec.key)) {
            return Array.isArray(stop_seq) ? stop_seq : [stop_seq];
        }
        return stop_seq;
    }

    async sendRequest(turns, systemMessage, stop_seq = '***') {
        let messages = [{ role: 'system', content: systemMessage }].concat(turns);
        messages = strictFormat(messages);

        const pack = {
            model: this.model_name || this.spec.default_model || '',
            messages,
            ...clonePlain(this.params),
        };
        const stop = this._shapeStop(stop_seq);
        if (stop !== undefined && pack.stop === undefined) pack.stop = stop;

        if (!pack.model) {
            return `还没给「${this.spec.label}」选模型。请在控制面板的「API 配置」页挑一个模型再试。`;
        }

        let res = null;
        try {
            console.log(`Awaiting ${this.spec.key} api response...`);
            const completion = await this.openai.chat.completions.create(pack);
            const choice = completion?.choices?.[0];
            if (!choice) {
                console.error(`${this.spec.key} 返回了空结果:`, completion);
                return 'My brain disconnected, try again.';
            }
            if (choice.finish_reason === 'length') throw new Error('Context length exceeded');
            console.log('Received.');

            if (choice.message?.reasoning_content && !this._warned_reasoning) {
                this._warned_reasoning = true;
                console.warn(
                    `「${this.spec.label}」这次回复里带了思考过程（reasoning_content），说明思考模式没关掉。` +
                    `换一个不带推理的模型会更快、也更不容易把动作指令搞坏。`
                );
            }

            res = choice.message?.content ?? '';
        } catch (err) {
            const msg = err?.message || '';
            if ((msg === 'Context length exceeded' || err?.code === 'context_length_exceeded') && turns.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                return await this.sendRequest(turns.slice(1), systemMessage, stop_seq);
            }
            // 思考旋钮被这家网关/模型拒 → 解析它支持的档位，改掉重试一次。
            // （各家对"关思考"的取值口径不一致，注册表里写死任何一个都会有模型不认。）
            const healed = healThinkingParams(this.params, err);
            if (healed && !this._thinkingHealed) {
                this._thinkingHealed = true;
                this.params = healed.params;
                console.warn(`⚙️ 「${this.spec.label}」${healed.note}。正在用新档位重试…`);
                return await this.sendRequest(turns, systemMessage, stop_seq);
            }
            // 把真实原因打出来 —— 'My brain disconnected' 对排查毫无信息量
            const why = err?.error?.message || msg || String(err);
            console.error(`❌ 「${this.spec.label}」调用失败（模型 ${pack.model}）: ${why}`);
            console.log(err);
            res = 'My brain disconnected, try again.';
        }
        return stripThink(typeof res === 'string' ? res : String(res ?? ''));
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer) {
        const imageMessages = [...messages];
        imageMessages.push({
            role: 'user',
            content: [
                { type: 'text', text: systemMessage },
                {
                    type: 'image_url',
                    image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` },
                },
            ],
        });
        return await this.sendRequest(imageMessages, systemMessage);
    }

    async embed(text) {
        // 显式配了向量模型就用它；没配就用注册表里这家的默认向量模型
        const model = this.model_name || this.spec.embedding;
        if (!model) {
            throw new Error(
                `「${this.spec.label}」不提供文本向量（embedding）服务。` +
                `想用向量检索的话，可以在角色配置里把 embedding 单独指到别家（例如硅基流动的 BAAI/bge-m3）。`
            );
        }
        let input = text;
        if (typeof input === 'string' && input.length > 8191) input = input.slice(0, 8191);
        const resp = await this.openai.embeddings.create({
            model,
            input,
            encoding_format: 'float',
        });
        return resp.data[0].embedding;
    }
}

/**
 * 由注册表的一行生成一个可直接 new(model, url, params) 的 provider 类。
 * 生成的类带自有 static prefix = spec.key，形状与手写类完全一致。
 * @param {object} spec providers.js 里的一条记录
 */
export function makeOpenAICompatibleClass(spec) {
    const cls = class extends OpenAICompatible {
        constructor(model_name, url, params) {
            super(model_name, url, params, spec);
        }
    };
    Object.defineProperty(cls, 'prefix', { value: spec.key, writable: false, enumerable: false, configurable: true });
    Object.defineProperty(cls, 'name', { value: `OpenAICompatible_${spec.key}`, configurable: true });
    return cls;
}

export default { OpenAICompatible, makeOpenAICompatibleClass };
