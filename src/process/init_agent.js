// ★2026-08-07 路径统一: agent 是独立 spawn 的子进程, 必须自己走一遍 bootstrap
// (建目录 / 装 env 默认值 / chdir 到 HOME_DIR), 否则它的 CWD 跟主进程不一致,
// 所有运行时状态会落到分发包的代码目录里。必须是**第一条 import**。
import '../utils/bootstrap.js';
import { Agent } from '../agent/agent.js';
import { serverProxy } from '../agent/mindserver_proxy.js';
import yargs from 'yargs';
import { EventEmitter } from 'events';

// Increase the default max listeners globally to prevent memory leak warnings
// This is needed because bot events are listened to by many systems simultaneously
EventEmitter.defaultMaxListeners = 50;

// 退出留痕 (见 exit_trace.js): 没有 exit_log 记录的退出 = 被外部强杀(部署/watchdog)。
import { installExitTrace } from './exit_trace.js';
import { dataPath } from '../utils/paths.js';
installExitTrace(dataPath('bots', '_supervisor', 'exit_log.jsonl'));

// Global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    console.error('Stack:', error.stack);
    // Don't exit - let the agent try to recover
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Promise Rejection at:', promise);
    console.error('Reason:', reason);
    // Don't exit - let the agent try to recover
});

// Memory monitoring to detect leaks early
let lastMemoryCheck = Date.now();
setInterval(() => {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const externalMB = Math.round(memUsage.external / 1024 / 1024);
    
    // Log memory every 5 minutes
    const now = Date.now();
    if (now - lastMemoryCheck > 300000) { // 5 minutes
        console.log(`📊 Memory: ${heapUsedMB}/${heapTotalMB} MB (heap), ${externalMB} MB (external)`);
        lastMemoryCheck = now;
    }
    
    // Warning if heap usage is high
    if (heapUsedMB > 3000) {
        console.warn(`⚠️ High memory usage: ${heapUsedMB} MB`);
    }
    
    // Critical warning if approaching limit
    if (heapUsedMB > 3500) {
        console.error(`🚨 CRITICAL: Memory usage ${heapUsedMB} MB - approaching heap limit!`);
        console.error('   Consider restarting the agent if memory continues to grow.');
        
        // Force garbage collection if available
        if (global.gc) {
            console.log('   Forcing garbage collection...');
            global.gc();
        }
    }
}, 60000); // Check every 60 seconds

const args = process.argv.slice(2);
if (args.length < 1) {
    console.log('Usage: node init_agent.js -n <agent_name> -p <port> -l <load_memory> -m <init_message> -c <count_id>');
    process.exit(1);
}

const argv = yargs(args)
    .option('name', {
        alias: 'n',
        type: 'string',
        description: 'name of agent'
    })
    .option('load_memory', {
        alias: 'l',
        type: 'boolean',
        description: 'load agent memory from file on startup'
    })
    .option('init_message', {
        alias: 'm',
        type: 'string',
        description: 'automatically prompt the agent on startup'
    })
    .option('count_id', {
        alias: 'c',
        type: 'number',
        default: 0,
        description: 'identifying count for multi-agent scenarios',
    })
    .option('port', {
        alias: 'p',
        type: 'number',
        description: 'port of mindserver'
    })
    .argv;

(async () => {
    try {
        console.log('Connecting to MindServer');
        await serverProxy.connect(argv.name, argv.port);
        console.log('Starting agent');
        const agent = new Agent();
        serverProxy.setAgent(agent);
        await agent.start(argv.load_memory, argv.init_message, argv.count_id);
    } catch (error) {
        console.error('Failed to start agent process:');
        console.error(error.message);
        console.error(error.stack);
        process.exit(1);
    }
})();
