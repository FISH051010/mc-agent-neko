// This code uses Dashscope and HTTP to ensure the latest support for the Qwen model.
// Qwen is also compatible with the OpenAI API format;

import { promises as fs } from 'fs';
import path from 'path';
import OpenAIApi from 'openai';
import { getKey, hasKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';
import { dataPath } from '../utils/paths.js';

export class VLLM {
    static prefix = 'vllm';
    // ★2026-08-07: 补上 params 形参。此前构造函数不收 params，pack 里也完全不含 params，
    //   profile 里写的温度/max_tokens/关思考开关全被静默丢弃。
    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.params = params ? { ...params } : {};

        // Currently use self-hosted SGLang API for text generation; use OpenAI text-embedding-3-small model for simple embedding.
        let vllm_config = {};
        if (url)
            vllm_config.baseURL = url;
        else
            vllm_config.baseURL = 'http://0.0.0.0:8000/v1';

        vllm_config.apiKey = ""

        this.vllm = new OpenAIApi(vllm_config);
    }

    async sendRequest(turns, systemMessage, stop_seq = '***') {
        let messages = [{ 'role': 'system', 'content': systemMessage }].concat(turns);
        let model = this.model_name || "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B";  
        
        if (model.includes('deepseek') || model.includes('qwen')) {
            messages = strictFormat(messages);
        } 

        const pack = {
            model: model,
            messages,
            stop: stop_seq,
            ...(this.params || {})
        };

        let res = null;
        try {
            console.log('Awaiting openai api response...')
            // console.log('Messages:', messages);
            // todo set max_tokens, temperature, top_p, etc. in pack
            let completion = await this.vllm.chat.completions.create(pack);
            if (completion.choices[0].finish_reason == 'length')
                throw new Error('Context length exceeded');
            console.log('Received.')
            res = completion.choices[0].message.content;
        }
        catch (err) {
            if ((err.message == 'Context length exceeded' || err.code == 'context_length_exceeded') && turns.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                return await this.sendRequest(turns.slice(1), systemMessage, stop_seq);
            } else {
                console.log(err);
                res = 'My brain disconnected, try again.';
            }
        }
        return res;
    }

    async saveToFile(logFile, logEntry) {
        let task_id = this.agent.task.task_id;
        console.log(task_id)
        // ★2026-08-07: 原来这里用 __dirname 拼 ../../bots，而 __dirname/fs/path 在本文件里
        //   压根没 import —— 一调用就 ReferenceError。改走 dataPath()，与 prompter 的日志目录同源。
        let logDir;
        if (this.task_id === null) {
            logDir = dataPath('bots', this.agent.name, 'logs');
        } else {
            logDir = dataPath('bots', this.agent.name, 'logs', String(task_id));
        }

        await fs.mkdir(logDir, { recursive: true });

        logFile = path.join(logDir, logFile);
        await fs.appendFile(logFile, String(logEntry), 'utf-8');
    }

}