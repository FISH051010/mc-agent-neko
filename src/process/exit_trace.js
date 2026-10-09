// ★2026-10-10 退出留痕: main.js/init_agent "无声退出" 时分不清是部署被杀还是代码自己 exit。
//   外部 TerminateProcess(Stop-Process/watchdog/部署) 不触发任何回调 → 没有记录 = 被外部杀;
//   代码路径调 process.exit() (cleanKill/!restart 等) → 记下退出码 + 调用栈, 落 exit_log.jsonl。
import { appendFileSync } from 'fs';

export function installExitTrace(file) {
    const log = (rec) => {
        try {
            appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, uptimeS: Math.round(process.uptime()), ...rec }) + '\n');
        } catch (e) { /* tracing must never break shutdown */ }
    };
    const realExit = process.exit.bind(process);
    process.exit = (code) => {
        const stack = (new Error('exit called').stack || '').split('\n').slice(2, 8).map((l) => l.trim());
        log({ kind: 'process.exit', code: code ?? process.exitCode ?? 0, stack });
        return realExit(code);
    };
    process.on('exit', (code) => log({ kind: 'exit-event', code }));
}
