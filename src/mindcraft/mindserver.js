import { Server } from 'socket.io';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import * as mindcraft from './mindcraft.js';
import { readFileSync } from 'fs';
import { mountPanelApi } from './panel/router.js';
import { allowSocketRequest } from './panel/guard.js';
import * as logbus from './panel/logbus.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mindserver is:
// - central hub for communication between all agent processes
// - api to control from other languages and remote users 
// - host for webapp

let io;
let server;
const agent_connections = {};
const agent_listeners = [];

const settings_spec = JSON.parse(readFileSync(path.join(__dirname, 'public/settings_spec.json'), 'utf8'));

// agent 推上来的最新一帧 POV 画面（面板 GET /api/screenshot/latest.jpg 读它）。
// 只留最新一张，不做队列 —— 面板要的是"现在长什么样"，历史帧没有意义。
let latestScreenshot = null;   // {agent, buf:Buffer, t:number}

// agent 上报的皮肤设置结果（面板「Bot 设定」页显示）。{ok, reason, detail, at}
let latestSkinStatus = null;

/**
 * 往某个 agent 的 socket 发事件。
 * ★2026-08-07 修 null-socket TypeError: 原来 set-agent-settings / restart-agent /
 *   chat-message / send-message 都是直接 `agent.socket.emit(...)`。agent 停着的时候
 *   socket 是 null（disconnect handler 会把它清成 null），于是服务端整个抛
 *   TypeError: Cannot read properties of null —— 面板上看到的是"点了没反应"，
 *   服务端日志里是一条谁也不看的堆栈。改成统一走这里，发不出去就返回 false。
 */
function emitToAgent(agentName, event, ...args) {
    const conn = agent_connections[agentName];
    if (!conn || !conn.socket) {
        console.warn(`Agent ${agentName} 当前不在线，事件 ${event} 未送达。`);
        return false;
    }
    try {
        conn.socket.emit(event, ...args);
        return true;
    } catch (err) {
        console.error(`向 agent ${agentName} 发送 ${event} 失败:`, err?.message || err);
        return false;
    }
}

class AgentConnection {
    constructor(settings, viewer_port) {
        this.socket = null;
        this.settings = settings;
        this.in_game = false;
        this.full_state = null;
        this.viewer_port = viewer_port;
    }
    setSettings(settings) {
        this.settings = settings;
    }
}

export function registerAgent(settings, viewer_port) {
    let agentConnection = new AgentConnection(settings, viewer_port);
    agent_connections[settings.profile.name] = agentConnection;
}

export function logoutAgent(agentName) {
    if (agent_connections[agentName]) {
        agent_connections[agentName].in_game = false;
        agentsStatusUpdate();
    }
}

// Initialize the server
export function createMindServer(host_public = false, port = 8080) {
    const app = express();
    server = http.createServer(app);
    
    // Configure Socket.IO with optimized settings for async operations
    io = new Server(server, {
        pingTimeout: 60000,      // 60 seconds - standard timeout (operations should not block)
        pingInterval: 25000,     // 25 seconds - keep default
        connectTimeout: 45000,   // 45 seconds for initial connection
        maxHttpBufferSize: 1e8,  // 100MB buffer for large state transfers
        upgradeTimeout: 30000,   // 30 seconds for transport upgrade
        // ★2026-08-07 收紧: 原来是 origin:'*' + allowRequest 全放行。mindserver 只 bind
        //   localhost 不代表安全 —— 用户浏览器里任何一个页面都能向 127.0.0.1 发起
        //   跨源连接, 而这个 socket 能启停 agent、读全量状态。改成只认本机来源。
        cors: {
            origin: [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/, /^https?:\/\/\[::1\](:\d+)?$/],
            methods: ['GET', 'POST'],
            credentials: true
        },
        // Connection state recovery for quick reconnection
        connectionStateRecovery: {
            maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
            skipMiddlewares: true,
        },
        // Disable compression to reduce CPU load (faster but more bandwidth)
        perMessageDeflate: false,
        // 握手期就把非本机来源挡掉（见 panel/guard.js）
        allowRequest: allowSocketRequest
    });

    // Serve static files
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    app.use(express.static(path.join(__dirname, 'public')));

    // ── 控制面板 REST API ────────────────────────────────────────────────────
    // 面板要的东西（agent 状态、最新一帧画面、给 agent 发消息）都在本模块的模块级
    // 私有变量里，所以用钩子传进去，而不是让 panel 反向 import 本文件（会绕成环）。
    mountPanelApi(app, {
        // 实际监听端口，不是 settings 里的默认值 —— MINDSERVER_PORT 环境变量或占用冲突
        // 都会让两者不一致，面板显示"请访问 8765"而程序其实跑在别的端口会把人带偏。
        getPort: () => (server?.address()?.port) || port,
        getAgentsStatus: () => Object.entries(agent_connections).map(([name, conn]) => ({
            name,
            in_game: conn.in_game,
            viewerPort: conn.viewer_port,
            socket_connected: !!conn.socket,
        })),
        getAgentState: (name) => latestAgentStates[name] || agent_connections[name]?.full_state || null,
        getScreenshot: () => latestScreenshot,
        getSkinStatus: () => latestSkinStatus,
        sendToAgent: (name, event, payload) => emitToAgent(name, event, payload),
    });

    // Texture proxy: resolve item/block textures using minecraft-assets with version fallback
    app.get('/assets/item/:agent/:name.png', async (req, res) => {
        try {
            const agentName = req.params.agent;
            const rawName = req.params.name;
            const itemName = String(rawName).toLowerCase();
            const conn = agent_connections[agentName];
            const preferred = conn?.settings?.minecraft_version;
            const candidates = [];
            if (preferred && preferred !== 'auto') candidates.push(preferred);
            candidates.push('1.21.8');

            // Lazy import to avoid ESM/CJS conflicts
            const mod = await import('minecraft-assets');
            const mcAssetsFactory = mod.default || mod;

            for (const ver of candidates) {
                try {
                    const assets = mcAssetsFactory(ver);
                    // Prefer items path first, then blocks
                    const item = assets.items[itemName];
                    const block = assets.blocks[itemName];
                    const tex = assets.textureContent?.[itemName]?.texture
                        || (item ? assets.textureContent?.[itemName]?.texture : null)
                        || (block ? assets.textureContent?.[itemName]?.texture : null);
                    if (tex) {
                        // textureContent already provides a data URL in many versions
                        if (tex.startsWith('data:image')) {
                            const base64 = tex.split(',')[1];
                            const img = globalThis.Buffer.from(base64, 'base64');
                            res.setHeader('Content-Type', 'image/png');
                            return res.end(img);
                        }
                    }
                    // If textureContent missing, try static path resolution inside package
                    // Helps with some strange blocks like Leaf Litter
                    const guessPaths = [];
                    const base = assets.directory;
                    guessPaths.push(path.join(base, 'items', `${itemName}.png`));
                    guessPaths.push(path.join(base, 'blocks', `${itemName}.png`));
                    for (const p of guessPaths) {
                        try {
                            const fsMod = await import('fs');
                            const buf = fsMod.readFileSync(p);
                            res.setHeader('Content-Type', 'image/png');
                            return res.end(buf);
                        } catch { /* ignore */ }
                    }
                } catch { /* ignore */ }
            }
            // Not found, fallback svg
            res.setHeader('Content-Type', 'image/svg+xml');
            res.status(404).send('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="100%" height="100%" fill="#444"/><text x="50%" y="55%" font-size="12" fill="#bbb" text-anchor="middle">?</text></svg>');
        } catch (e) {
            res.setHeader('Content-Type', 'image/svg+xml');
            res.status(500).send('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="100%" height="100%" fill="#444"/><text x="50%" y="55%" font-size="12" fill="#bbb" text-anchor="middle">!</text></svg>');
        }
    });

    // Socket.io connection handling
    io.on('connection', (socket) => {
        let curAgentName = null;
        console.log(`✅ Client connected [${socket.id}]`);
        
        // Add connection diagnostics and cleanup
        socket.on('disconnect', (reason) => {
            console.log(`⚠️ Client disconnected [${socket.id}] - Agent: ${curAgentName || 'unknown'} - Reason: ${reason}`);
            
            // Cleanup agent connection state
            if (agent_connections[curAgentName]) {
                console.log(`Agent ${curAgentName} disconnected`);
                agent_connections[curAgentName].in_game = false;
                agent_connections[curAgentName].socket = null;
                // Clear cached state for disconnected agent
                delete latestAgentStates[curAgentName];
                agentsStatusUpdate();
            }
            
            // Remove from listeners if applicable
            if (agent_listeners.includes(socket)) {
                removeListener(socket);
            }
        });
        
        socket.on('error', (error) => {
            console.error(`❌ Socket error [${socket.id}] - Agent: ${curAgentName || 'unknown'}:`, error.message);
        });

        agentsStatusUpdate(socket);

        socket.on('create-agent', async (settings, callback) => {
            console.log('API create agent...');
            for (let key in settings_spec) {
                if (!(key in settings)) {
                    if (settings_spec[key].required) {
                        callback({ success: false, error: `Setting ${key} is required` });
                        return;
                    }
                    else {
                        settings[key] = settings_spec[key].default;
                    }
                }
            }
            for (let key in settings) {
                if (!(key in settings_spec)) {
                    delete settings[key];
                }
            }
            if (settings.profile?.name) {
                if (settings.profile.name in agent_connections) {
                    callback({ success: false, error: 'Agent already exists' });
                    return;
                }
                let returned = await mindcraft.createAgent(settings);
                callback({ success: returned.success, error: returned.error });
                let name = settings.profile.name;
                if (!returned.success && agent_connections[name]) {
                    mindcraft.destroyAgent(name);
                    delete agent_connections[name];
                }
                agentsStatusUpdate();
            }
            else {
                console.error('Agent name is required in profile');
                callback({ success: false, error: 'Agent name is required in profile' });
            }
        });

        socket.on('get-settings', (agentName, callback) => {
            if (agent_connections[agentName]) {
                callback({ settings: agent_connections[agentName].settings });
            } else {
                callback({ error: `Agent '${agentName}' not found.` });
            }
        });

        socket.on('connect-agent-process', (agentName) => {
            if (agent_connections[agentName]) {
                agent_connections[agentName].socket = socket;
                agentsStatusUpdate();
            }
        });

        socket.on('login-agent', (agentName) => {
            if (agent_connections[agentName]) {
                agent_connections[agentName].socket = socket;
                agent_connections[agentName].in_game = true;
                curAgentName = agentName;
                agentsStatusUpdate();
            }
            else {
                console.warn(`Unregistered agent ${agentName} tried to login`);
            }
        });


        socket.on('chat-message', (agentName, json) => {
            if (!agent_connections[agentName]) {
                console.warn(`Agent ${agentName} tried to send a message but is not logged in`);
                return;
            }
            console.log(`${curAgentName} sending message to ${agentName}: ${json.message}`);
            emitToAgent(agentName, 'chat-message', curAgentName, json);
        });

        socket.on('set-agent-settings', (agentName, settings) => {
            const agent = agent_connections[agentName];
            if (!agent) {
                console.warn(`Agent ${agentName} 不存在，设置未生效。`);
                return;
            }
            agent.setSettings(settings);
            // agent 没在跑时不用（也没法）叫它重启，下次启动会自己读到新设置
            emitToAgent(agentName, 'restart-agent');
        });

        socket.on('restart-agent', (agentName) => {
            console.log(`Restarting agent: ${agentName}`);
            if (!emitToAgent(agentName, 'restart-agent')) {
                // socket 已断（agent 停着）→ 退回到进程级重启，别静默失败
                mindcraft.startAgent(agentName);
            }
        });

        socket.on('stop-agent', (agentName) => {
            mindcraft.stopAgent(agentName);
        });

        socket.on('start-agent', (agentName) => {
            mindcraft.startAgent(agentName);
        });

        socket.on('destroy-agent', (agentName) => {
            if (agent_connections[agentName]) {
                mindcraft.destroyAgent(agentName);
                delete agent_connections[agentName];
            }
            agentsStatusUpdate();
        });

        socket.on('stop-all-agents', () => {
            console.log('Killing all agents');
            for (let agentName in agent_connections) {
                mindcraft.stopAgent(agentName);
            }
        });

        socket.on('shutdown', () => {
            console.log('Shutting down');
            for (let agentName in agent_connections) {
                mindcraft.stopAgent(agentName);
            }
            // wait 2 seconds
            setTimeout(() => {
                console.log('Exiting MindServer');
                globalThis.process.exit(0);
            }, 2000);
            
        });

		socket.on('send-message', (agentName, data) => {
			emitToAgent(agentName, 'send-message', data);
		});

        socket.on('bot-output', (agentName, message) => {
            io.emit('bot-output', agentName, message);
            // 同时灌进面板日志环形缓冲（脱敏在 logbus 内部做）
            try { logbus.push(message, agentName); } catch { /* 日志绝不能反过来伤主流程 */ }
        });

        // agent 推上来的最新一帧 POV 画面（base64 jpeg）。面板用 REST 拉，
        // 不走 socket 广播 —— 每秒一张 base64 大图广播给所有监听者太浪费。
        socket.on('agent-screenshot', (agentName, base64Jpeg) => {
            try {
                if (typeof base64Jpeg !== 'string' || !base64Jpeg) return;
                const raw = base64Jpeg.startsWith('data:')
                    ? base64Jpeg.slice(base64Jpeg.indexOf(',') + 1)
                    : base64Jpeg;
                const buf = globalThis.Buffer.from(raw, 'base64');
                if (!buf.length) return;
                latestScreenshot = { agent: agentName, buf, t: Date.now() };
            } catch (err) {
                console.warn('agent-screenshot 解码失败:', err?.message || err);
            }
        });

        socket.on('listen-to-agents', () => {
            addListener(socket);
        });

        // Receive pushed state updates from agents (async push pattern)
        socket.on('agent-skin-status', (agentName, status) => {
            if (!status || typeof status !== 'object') return;
            latestSkinStatus = { ...status, agent: agentName, at: Date.now() };
        });

        socket.on('agent-state-push', (agentName, state) => {
            // Add timestamp for freshness checking
            state._timestamp = Date.now();
            latestAgentStates[agentName] = state;
            
            // Immediately broadcast to listeners for real-time updates
            for (let listener of agent_listeners) {
                listener.emit('state-update', { [agentName]: state });
            }
        });
    });

    if (host_public) {
        console.log('Public hosting not supported yet. Using localhost.');
    }
    const host = 'localhost';

    // ★2026-08-07: 端口被占用时给人话，不要抛裸 Node 堆栈。
    //   http.Server 的 EADDRINUSE 是 'error' 事件；不监听它 = Unhandled 'error' event
    //   → 进程当场崩，用户看到的是 `at Server.setupListenHandle (node:net:1937:16)` 这种
    //   完全无法自助的东西。最常见的触发场景就是「用户把启动.bat 双击了两次」。
    // ★2026-10-09 (开发机实测: 控制面板启动失败: listen EACCES ::1:8765, watchdog 每分钟重拉、
    //   bot 永远进不了世界): Windows 上 Hyper-V / WSL / Docker 的 winnat 会按 100 个一段动态
    //   「保留」端口(`netsh int ipv4 show excludedportrange protocol=tcp` 可见, 本机当时
    //   8741-8840 被占), 每次开机位置还会变。被保留的端口任何程序都 listen 不了, 报 EACCES ——
    //   这跟「已被占用」不是一回事: 换个端口就能起来, 不该整个进程退出。
    //   所以 EACCES 时按候选表顺次换端口(都避开常见保留段), 全不行才退回系统分配(端口 0)。
    //   实际端口从 server.address() 读, mindcraft.init 会把它传给 agent 子进程和面板地址。
    //   EADDRINUSE 仍然直接退出: 最常见原因是程序被双开, 换端口只会造出两份在跑的 bot。
    const fallbackPorts = [...new Set([port, 18765, 28765, 38765, 0].map(Number))];
    let attempt = 0;
    server.on('listening', () => {
        const actual = server.address()?.port;
        if (actual !== Number(port)) {
            console.warn(`⚠️ 控制面板端口 ${port} 被系统保留(EACCES), 已改用 ${actual}。`);
        }
        console.log(`MindServer running on port ${actual} on host ${host}`);
    });
    server.on('error', (err) => {
        if (err && err.code === 'EACCES' && attempt + 1 < fallbackPorts.length) {
            console.warn(`控制面板端口 ${fallbackPorts[attempt]} 无权限监听(多半被 Windows 动态保留), 尝试 ${fallbackPorts[attempt + 1] || '系统分配端口'}…`);
            attempt++;
            server.listen(fallbackPorts[attempt], host);
            return;
        }
        if (err && err.code === 'EADDRINUSE') {
            const line = '='.repeat(70);
            console.error(`
${line}
  控制面板端口 ${fallbackPorts[attempt]} 已经被占用，程序无法启动。

  最常见的原因：本程序已经在运行了（黑窗口开了两个？任务栏找找看）。
  同一个端口只能有一个程序用，关掉多余的那个再试。

  如果确认没有重复启动，就是别的软件占了这个端口。可以改端口：
  用记事本打开本文件夹里的 settings.json，把 mindserver_port 改成
  别的数字（比如 8770），保存后重新启动。
${line}
`);
        } else {
            console.error(`控制面板启动失败: ${err && err.message ? err.message : err}`);
        }
        globalThis.process.exit(1);
    });

    server.listen(fallbackPorts[0], host);

    return server;
}

function agentsStatusUpdate(socket) {
    if (!socket) {
        socket = io;
    }
    let agents = [];
    for (let agentName in agent_connections) {
        const conn = agent_connections[agentName];
        agents.push({
            name: agentName, 
            in_game: conn.in_game,
            viewerPort: conn.viewer_port,
            socket_connected: !!conn.socket
        });
    };
    socket.emit('agents-status', agents);
}


// Store latest states pushed from agents
const latestAgentStates = {};

// ★2026-09-07 修：原来这里按"超过 60 秒没更新"就把状态整条删掉，导致
//   **bot 越安静，面板越什么都看不见**。
//   机理：mindserver_proxy 的推送带状态哈希去重（位置/血量/饥饿/动作/背包格数），
//   bot 完全静止时哈希永不变 → 一次也不推 → 60 秒后这里判它"过期"删掉 →
//   GET /api/status 的 state 变 null → 概览页血量/坐标/在做什么全空。
//   而用户恰恰是在"她怎么不动了"的时候来看面板的，正好赶上信息最少的时刻。
//
//   陈旧 ≠ 无效：bot 静止时那份旧状态**就是**当前状态。所以改成只清理
//   **已经断开连接**的 agent（真断开时 disconnect handler 已经会删，这里只兜底
//   兜住"注册过但连接没了"的漏网），活着的 agent 一律保留最后一帧，只打个
//   _stale 标记让前端可以提示"N 秒前"。
setInterval(() => {
    const now = Date.now();
    const staleAfter = 60000; // 60 秒没更新就标记为陈旧（但不删）

    for (const agentName in latestAgentStates) {
        const state = latestAgentStates[agentName];
        const conn = agent_connections[agentName];
        const alive = !!(conn && conn.socket);
        const age = state._timestamp ? now - state._timestamp : Infinity;

        if (!alive) {
            // agent 真的不在了 —— 这才该清
            delete latestAgentStates[agentName];
            console.log(`🧹 Cleaned up state for disconnected agent: ${agentName}`);
        } else if (age > staleAfter) {
            // 活着但很久没更新（= bot 一直静止）。保留数据，只标记新鲜度，
            // 前端可以据此显示"N 秒前"，而不是整片空白。
            state._stale = true;
            state._ageMs = age;
        } else if (state._stale) {
            delete state._stale;
            delete state._ageMs;
        }
    }
}, 30000); // Clean every 30 seconds

let listenerInterval = null;
function addListener(listener_socket) {
    agent_listeners.push(listener_socket);
    if (agent_listeners.length === 1) {
        // Use event-driven push pattern with parallel fallback
        listenerInterval = setInterval(async () => {
            const agentNames = Object.keys(agent_connections).filter(
                name => agent_connections[name].in_game && agent_connections[name].socket
            );
            
            // Check if we have fresh cached states (< 1 second old)
            const now = Date.now();
            const states = {};
            const needFetch = [];
            
            for (let agentName of agentNames) {
                const cachedState = latestAgentStates[agentName];
                if (cachedState && cachedState._timestamp && (now - cachedState._timestamp < 1000)) {
                    // Use fresh cached state
                    states[agentName] = cachedState;
                } else {
                    // Need to fetch
                    needFetch.push(agentName);
                }
            }
            
            // Parallel fetch for agents without fresh cache
            if (needFetch.length > 0) {
                const fetchPromises = needFetch.map(agentName => {
                    return new Promise((resolve) => {
                        const agent = agent_connections[agentName];
                        
                        const timeout = setTimeout(() => {
                            resolve({ name: agentName, state: { error: 'Timeout' } });
                        }, 2000); // Reduced timeout since we expect cached responses
                        
                        agent.socket.emit('get-full-state', (state) => {
                            clearTimeout(timeout);
                            resolve({ name: agentName, state });
                        });
                    });
                });
                
                const results = await Promise.all(fetchPromises);
                results.forEach(({ name, state }) => {
                    states[name] = state;
                });
            }
            
            // Broadcast to all listeners
            for (let listener of agent_listeners) {
                listener.emit('state-update', states);
            }
        }, 500); // ★2026-08-07: 原来 100ms(10Hz)。控制面板不需要 10Hz —— 人眼看状态
                 //   2Hz 足够, 而 agent-state-push 那条事件驱动通道本来就会在健康/死亡/
                 //   位置变化时立刻推。10Hz 轮询纯粹是在给 event loop 加压。
    }
}

function removeListener(listener_socket) {
    agent_listeners.splice(agent_listeners.indexOf(listener_socket), 1);
    if (agent_listeners.length === 0) {
        clearInterval(listenerInterval);
        listenerInterval = null;
    }
}

// Optional: export these if you need access to them from other files
export const getIO = () => io;
export const getServer = () => server;
export const numStateListeners = () => agent_listeners.length;