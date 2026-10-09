import { readFileSync, mkdirSync, writeFileSync} from 'fs';
import { Examples } from '../utils/examples.js';
import { getCommandDocs } from '../agent/commands/index.js';
import { SkillLibrary } from "../agent/library/skill_library.js";
import { stringifyTurns } from '../utils/text.js';
import { getCommand } from '../agent/commands/index.js';
import settings from '../agent/settings.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { selectAPI, createModel } from './_model_map.js';
import { hasProviderKey } from '../utils/keys.js';
import { getProvider, listProviders } from './providers.js';
import { stripThink } from '../utils/think.js';
import { dataPath } from '../utils/paths.js';
import { withTimeout, EMBED_TIMEOUT_MS } from '../utils/timeout.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class Prompter {
    constructor(agent, profile) {
        this.agent = agent;
        this.profile = profile;
        // ★合并前先记下**角色配置里显式写的**思考档位/供应商。合并之后 _default.json 的
        //   "thinking": "off" 会填进来，就分不清"用户特意写的"和"默认补的"了。
        //   优先级：角色配置 > settings.js 顶层 > profiles/defaults 里的默认值 > 'off'
        const explicit_thinking = profile ? profile.thinking : undefined;
        const explicit_provider = profile ? profile.provider : undefined;
        const defaults_dir = path.join(__dirname, '../../profiles/defaults');
        let default_profile = JSON.parse(readFileSync(path.join(defaults_dir, '_default.json'), 'utf8'));
        let base_fp = '';
        if (settings.base_profile.includes('survival')) {
            base_fp = path.join(defaults_dir, 'survival.json');
        } else if (settings.base_profile.includes('assistant')) {
            base_fp = path.join(defaults_dir, 'assistant.json');
        } else if (settings.base_profile.includes('creative')) {
            base_fp = path.join(defaults_dir, 'creative.json');
        } else if (settings.base_profile.includes('god_mode')) {
            base_fp = path.join(defaults_dir, 'god_mode.json');
        }
        let base_profile = JSON.parse(readFileSync(base_fp, 'utf8'));

        // first use defaults to fill in missing values in the base profile
        for (let key in default_profile) {
            if (base_profile[key] === undefined)
                base_profile[key] = default_profile[key];
        }
        // then use base profile to fill in missing values in the individual profile
        for (let key in base_profile) {
            if (this.profile[key] === undefined)
                this.profile[key] = base_profile[key];
        }
        // base overrides default, individual overrides base

        this.convo_examples = null;
        this.coding_examples = null;
        
        let name = this.profile.name;
        this.cooldown = this.profile.cooldown ? this.profile.cooldown : 0;
        this.last_prompt_time = 0;
        this.awaiting_coding = false;

        // for backwards compatibility, move max_tokens to params
        let max_tokens = null;
        if (this.profile.max_tokens)
            max_tokens = this.profile.max_tokens;

        // 顶层的 thinking / provider 下发给 model / code_model / vision_model：
        // 子项自己写了就以自己的为准，没写才继承。
        this.thinking = explicit_thinking ?? settings.thinking ?? this.profile.thinking ?? 'off';
        const top_provider = explicit_provider ?? this.profile.provider ?? null;
        const inherit = (spec) => {
            if (spec === null || spec === undefined) return spec;
            const obj = (typeof spec === 'string' || spec instanceof String)
                ? { model: String(spec) }
                : { ...spec };
            if (obj.thinking === undefined) obj.thinking = this.thinking;
            if (!obj.api && top_provider) obj.api = top_provider;
            return obj;
        };

        let chat_model_profile = selectAPI(inherit(this.profile.model));
        this.chat_model = createModel(chat_model_profile, 'chat');

        if (this.profile.code_model) {
            let code_model_profile = selectAPI(inherit(this.profile.code_model));
            this.code_model = createModel(code_model_profile, 'code');
        }
        else {
            this.code_model = this.chat_model;
        }

        if (this.profile.vision_model) {
            let vision_model_profile = selectAPI(inherit(this.profile.vision_model));
            this.vision_model = createModel(vision_model_profile, 'vision');
        }
        else {
            this.vision_model = this.chat_model;
        }


        let embedding_model_profile = null;
        if (this.profile.embedding) {
            try {
                embedding_model_profile = selectAPI(inherit(this.profile.embedding));
            } catch (e) {
                console.warn(`认不出 embedding 配置「${JSON.stringify(this.profile.embedding)}」，改用聊天模型那家。原因：${e?.message || e}`);
                embedding_model_profile = null;
            }
        }
        if (embedding_model_profile) {
            this.embedding_model = createModel(embedding_model_profile, 'embedding');
        }
        else {
            // ★2026-09-09: 聊天那家没有向量服务时**自动借用别家**，而不是直接退化。
            //   实录: 用户选了 DeepSeek(无 embedding) → skill_library 每次都
            //   "Error with embedding model, using word-overlap instead." → 挑技能/示例
            //   退成字面词重叠，选得牛头不对马嘴，而用户完全无从察觉（只是觉得"她好像变笨了"）。
            //   而这个用户往往已经配了别家的密钥（本例还配了 OpenAI），白白浪费。
            //   所以: 在**已配好密钥**的供应商里找一个自带向量模型的顶上，找不到才退化。
            const chat_spec = getProvider(chat_model_profile.api);
            let borrowed = null;
            if (chat_spec && !chat_spec.embedding) {
                for (const p of listProviders()) {
                    if (!p.embedding) continue;                                  // 这家没有向量服务
                    if (p.key === chat_model_profile.api) continue;              // 就是聊天那家(已知没有)
                    if (p.key_name && !hasProviderKey(p.key, p.key_name)) continue;   // 没配密钥，用不了
                    if (p.region === 'local') continue;                          // 本机模型未必起着，别赌
                    borrowed = p;
                    break;
                }
            }
            if (borrowed) {
                try {
                    this.embedding_model = createModel(
                        { api: borrowed.key, model: borrowed.embedding }, 'embedding');
                    console.log(
                        `📐 「${chat_spec.label}」不提供文本向量服务，已自动借用你已配置的「${borrowed.label}」` +
                        `(${borrowed.embedding}) 来做示例/技能检索。想换别家就在「Bot 设定」里显式指定。`
                    );
                } catch (e) {
                    console.warn(`借用「${borrowed.label}」的向量服务失败(${e?.message || e})，退回字面词匹配。`);
                    borrowed = null;
                }
            }
            if (!borrowed) {
                if (chat_spec && !chat_spec.embedding) {
                    console.warn(
                        `提示：「${chat_spec.label}」不提供文本向量服务，也没有别的已配置供应商能顶上，` +
                        `机器人挑选参考示例时只能按字面词相似度粗选，效果会打折。` +
                        `配一个硅基流动的密钥即可自动接管（它的 BAAI/bge-m3 免费额度足够）。`
                    );
                }
                this.embedding_model = createModel({api: chat_model_profile.api}, 'embedding');
            }
        }

        // Time-bound every embed call: on this network the embeddings endpoint
        // can stall forever (DNS poisoning) without erroring, which used to hang
        // initExamples() and block startup before MC login. A timeout turns the
        // stall into a rejection that the callers' existing catch->word-overlap
        // fallbacks handle. Startup embeds run in parallel, so total startup
        // delay in the worst case is ~one EMBED_TIMEOUT_MS budget.
        const raw_embedding_model = this.embedding_model;
        if (raw_embedding_model && typeof raw_embedding_model.embed === 'function') {
            this.embedding_model = {
                embed: (text) => withTimeout(
                    (async () => await raw_embedding_model.embed(text))(),
                    EMBED_TIMEOUT_MS,
                    'embedding request'
                )
            };
        }

        this.skill_libary = new SkillLibrary(agent, this.embedding_model);
        // ★2026-08-07: 原来这里是 CWD 相对的 `./bots/<name>`，而 _saveToFile 用的是
        //   __dirname 相对的 `../../bots/<name>/logs` —— 分发包里 CWD 和代码目录不是同一层，
        //   同一个机器人的 last_profile 和 logs 会落到两个地方。统一走 dataPath()。
        const bot_dir = dataPath('bots', name);
        mkdirSync(bot_dir, { recursive: true });
        // ★fix 2026-07-09: writeFileSync is SYNCHRONOUS — its 3rd arg is `options`, not a callback,
        // so the error-handling/success-log callback here never ran (and `new Error(msg, err)` ignores
        // its 2nd arg). This is a one-time boot save (kept sync); wrap it properly instead.
        try {
            writeFileSync(path.join(bot_dir, 'last_profile.json'), JSON.stringify(this.profile, null, 4));
            console.log("Copy profile saved.");
        } catch (err) {
            throw new Error(`Failed to save profile: ${err && err.message}`);
        }
    }

    getName() {
        return this.profile.name;
    }

    getInitModes() {
        return this.profile.modes;
    }

    async initExamples() {
        try {
            this.convo_examples = new Examples(this.embedding_model, settings.num_examples);
            this.coding_examples = new Examples(this.embedding_model, settings.num_examples);
            
            // Wait for both examples to load before proceeding
            await Promise.all([
                this.convo_examples.load(this.profile.conversation_examples),
                this.coding_examples.load(this.profile.coding_examples),
                this.skill_libary.initSkillLibrary()
            ]).catch(error => {
                // Preserve error details
                console.error('Failed to initialize examples. Error details:', error);
                console.error('Stack trace:', error.stack);
                throw error;
            });

            console.log('Examples initialized.');
        } catch (error) {
            console.error('Failed to initialize examples:', error);
            console.error('Stack trace:', error.stack);
            throw error; // Re-throw with preserved details
        }
    }

    async replaceStrings(prompt, messages, examples=null, to_summarize=[], last_goals=null) {
        prompt = prompt.replaceAll('$NAME', this.agent.name);

        if (prompt.includes('$STATS')) {
            let stats = await getCommand('!stats').perform(this.agent) + '\n';
            stats += await getCommand('!entities').perform(this.agent) + '\n';
            stats += await getCommand('!nearbyBlocks').perform(this.agent);
            prompt = prompt.replaceAll('$STATS', stats);
        }
        if (prompt.includes('$INVENTORY')) {
            let inventory = await getCommand('!inventory').perform(this.agent);
            prompt = prompt.replaceAll('$INVENTORY', inventory);
        }
        if (prompt.includes('$ACTION')) {
            prompt = prompt.replaceAll('$ACTION', this.agent.actions.currentActionLabel);
        }
        if (prompt.includes('$COMMAND_DOCS'))
            prompt = prompt.replaceAll('$COMMAND_DOCS', getCommandDocs(this.agent));
        if (prompt.includes('$CODE_DOCS')) {
            const code_task_content = messages.slice().reverse().find(msg =>
                msg.role !== 'system' && msg.content.includes('!newAction(')
            )?.content?.match(/!newAction\((.*?)\)/)?.[1] || '';

            // Relevant `skills.*`/`world.*` primitives + the custom-skill catalog, so the
            // coding model reaches for a tested procedure (realNetherPortal, chopWood, …)
            // instead of re-deriving it inside newAction. Catalog is best-effort ('' on failure).
            let code_docs = await this.skill_libary.getRelevantSkillDocs(code_task_content, settings.relevant_docs_count);
            try { code_docs += this.skill_libary.getCustomSkillManifest('code'); } catch (e) {}
            prompt = prompt.replaceAll('$CODE_DOCS', code_docs);
        }
        if (prompt.includes('$EXAMPLES') && examples !== null)
            prompt = prompt.replaceAll('$EXAMPLES', await examples.createExampleMessage(messages));
        if (prompt.includes('$MEMORY'))
            prompt = prompt.replaceAll('$MEMORY', this.agent.history.memory);
        if (prompt.includes('$TO_SUMMARIZE'))
            prompt = prompt.replaceAll('$TO_SUMMARIZE', stringifyTurns(to_summarize));
        if (prompt.includes('$CONVO'))
            prompt = prompt.replaceAll('$CONVO', 'Recent conversation:\n' + stringifyTurns(messages));
        if (prompt.includes('$SELF_PROMPT')) {
            // if active or paused, show the current goal
            let self_prompt = !this.agent.self_prompter.isStopped() ? `YOUR CURRENT ASSIGNED GOAL: "${this.agent.self_prompter.prompt}"\n` : '';
            prompt = prompt.replaceAll('$SELF_PROMPT', self_prompt);
        }
        if (prompt.includes('$LAST_GOALS')) {
            let goal_text = '';
            for (let goal in last_goals) {
                if (last_goals[goal])
                    goal_text += `You recently successfully completed the goal ${goal}.\n`
                else
                    goal_text += `You recently failed to complete the goal ${goal}.\n`
            }
            prompt = prompt.replaceAll('$LAST_GOALS', goal_text.trim());
        }
        if (prompt.includes('$BLUEPRINTS')) {
            if (this.agent.npc.constructions) {
                let blueprints = '';
                for (let blueprint in this.agent.npc.constructions) {
                    blueprints += blueprint + ', ';
                }
                prompt = prompt.replaceAll('$BLUEPRINTS', blueprints.slice(0, -2));
            }
        }

        // check if there are any remaining placeholders with syntax $<word>
        let remaining = prompt.match(/\$[A-Z_]+/g);
        if (remaining !== null) {
            console.warn('Unknown prompt placeholders:', remaining.join(', '));
        }
        return prompt;
    }

    async checkCooldown() {
        // ★2026-07-08 (用户令): admin/mission 独占回合(agent._extIntentActive)免 profile 冷却 —— 指令期间
        //   的多轮 LLM 调用(!inventory/!getWood…)不再被 3s 节流, 快速连跑; 自主/普通回合仍按冷却节流。
        //   信号复用 bot._extIntentUntil(begin/tick 续期, end 清; 覆盖 admin 首轮 + mission 全程 self-prompt
        //   轮)。env MC_ADMIN_NO_COOLDOWN=0 秒回退到全局冷却。模型 API 延迟本身即天然限速, 不会空转。
        let elapsed = Date.now() - this.last_prompt_time;
        let adminFast = false;
        if (process.env.MC_ADMIN_NO_COOLDOWN !== '0') {
            try { adminFast = !!(this.agent && this.agent._extIntentActive && this.agent._extIntentActive()); } catch (e) {}
        }
        if (!adminFast && elapsed < this.cooldown && this.cooldown > 0) {
            await new Promise(r => setTimeout(r, this.cooldown - elapsed));
        }
        this.last_prompt_time = Date.now();
    }

    async promptConvo(messages) {
        this.most_recent_msg_time = Date.now();
        let current_msg_time = this.most_recent_msg_time;

        for (let i = 0; i < 3; i++) { // try 3 times to avoid hallucinations
            await this.checkCooldown();
            if (current_msg_time !== this.most_recent_msg_time) {
                return '';
            }

            let prompt = this.profile.conversing;
            prompt = await this.replaceStrings(prompt, messages, this.convo_examples);
            let generation;

            try {
                generation = await this.chat_model.sendRequest(messages, prompt);
                if (typeof generation !== 'string') {
                    console.error('Error: Generated response is not a string', generation);
                    throw new Error('Generated response is not a string');
                }
                console.log("Generated response:", generation);
                await this._saveLog(prompt, messages, generation, 'conversation');

            } catch (error) {
                console.error('Error during message generation or file writing:', error);
                continue;
            }

            // Check for hallucination or invalid output
            if (generation?.includes('(FROM OTHER BOT)')) {
                console.warn('LLM hallucinated message as another bot. Trying again...');
                continue;
            }

            if (current_msg_time !== this.most_recent_msg_time) {
                console.warn(`${this.agent.name} received new message while generating, discarding old response.`);
                return '';
            }

            // 思考链剥壳统一走 stripThink（原来是手写切片，7 处行为各不相同）
            generation = stripThink(generation);

            return generation;
        }

        return '';
    }

    async promptCoding(messages) {
        if (this.awaiting_coding) {
            console.warn('Already awaiting coding response, returning no response.');
            return '```//no response```';
        }
        this.awaiting_coding = true;
        await this.checkCooldown();
        let prompt = this.profile.coding;
        prompt = await this.replaceStrings(prompt, messages, this.coding_examples);

        let resp = await this.code_model.sendRequest(messages, prompt);
        this.awaiting_coding = false;
        await this._saveLog(prompt, messages, resp, 'coding');
        // ★2026-08-07: 这里以前完全没剥思考链。思考链里常带 ``` 代码块示例，
        //   会被 newAction 的代码提取抢先切走，跑的是模型"想了想又否掉"的那版代码。
        return stripThink(resp);
    }

    async promptMemSaving(to_summarize) {
        await this.checkCooldown();
        let prompt = this.profile.saving_memory;
        prompt = await this.replaceStrings(prompt, null, null, to_summarize);
        let resp = await this.chat_model.sendRequest([], prompt);
        await this._saveLog(prompt, to_summarize, resp, 'memSaving');
        return stripThink(resp);
    }

    async promptShouldRespondToBot(new_message) {
        await this.checkCooldown();
        let prompt = this.profile.bot_responder;
        let messages = this.agent.history.getHistory();
        messages.push({role: 'user', content: new_message});
        prompt = await this.replaceStrings(prompt, null, null, messages);
        let res = await this.chat_model.sendRequest([], prompt);
        // ★2026-08-07: 这里以前完全没剥思考链，而判据是**全等** 'respond' ——
        //   只要模型吐了思考链就永远判 false，机器人之间的对话直接哑火。
        const decision = stripThink(res || '').trim().toLowerCase();
        return decision === 'respond';
    }

    async promptVision(messages, imageBuffer) {
        await this.checkCooldown();
        let prompt = this.profile.image_analysis;
        prompt = await this.replaceStrings(prompt, messages, null, null, null);
        return await this.vision_model.sendVisionRequest(messages, prompt, imageBuffer);
    }

    async promptGoalSetting(messages, last_goals) {
        // deprecated
        let system_message = this.profile.goal_setting;
        system_message = await this.replaceStrings(system_message, messages);

        let user_message = 'Use the below info to determine what goal to target next\n\n';
        user_message += '$LAST_GOALS\n$STATS\n$INVENTORY\n$CONVO'
        user_message = await this.replaceStrings(user_message, messages, null, null, last_goals);
        let user_messages = [{role: 'user', content: user_message}];

        let res = await this.chat_model.sendRequest(user_messages, system_message);

        let goal = null;
        try {
            let data = res.split('```')[1].replace('json', '').trim();
            goal = JSON.parse(data);
        } catch (err) {
            console.log('Failed to parse goal:', res, err);
        }
        if (!goal || !goal.name || !goal.quantity || isNaN(parseInt(goal.quantity))) {
            console.log('Failed to set goal:', res);
            return null;
        }
        goal.quantity = parseInt(goal.quantity);
        return goal;
    }

    async _saveLog(prompt, messages, generation, tag) {
        if (!settings.log_all_prompts)
            return;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let logEntry;
        let task_id = this.agent.task.task_id;
        if (task_id == null) {
            logEntry = `[${timestamp}] \nPrompt:\n${prompt}\n\nConversation:\n${JSON.stringify(messages, null, 2)}\n\nResponse:\n${generation}\n\n`;
        } else {
            logEntry = `[${timestamp}] Task ID: ${task_id}\nPrompt:\n${prompt}\n\nConversation:\n${JSON.stringify(messages, null, 2)}\n\nResponse:\n${generation}\n\n`;
        }
        const logFile = `${tag}_${timestamp}.txt`;
        await this._saveToFile(logFile, logEntry);
    }

    async _saveToFile(logFile, logEntry) {
        let task_id = this.agent.task.task_id;
        // ★2026-08-07: 从 __dirname 相对改成 dataPath()，与上面的 last_profile.json 同源。
        let logDir;
        if (task_id == null) {
            logDir = dataPath('bots', this.agent.name, 'logs');
        } else {
            logDir = dataPath('bots', this.agent.name, 'logs', String(task_id));
        }

        await fs.mkdir(logDir, { recursive: true });

        logFile = path.join(logDir, logFile);
        await fs.appendFile(logFile, String(logEntry), 'utf-8');
    }
}
