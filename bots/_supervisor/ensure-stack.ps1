# ensure-stack — self-check run on every new Neko session (wired as a SessionStart hook in
# .claude/settings.json). If the immortal supervisor watchdog.ps1 isn't running, start it;
# watchdog then brings up / keeps alive main.js + bridge.mjs + botwatch.mjs + ticket-server.mjs
# + overseer.mjs. Idempotent and fast: if watchdog is already alive it does nothing but report.
#
# Run manually:  powershell -NoProfile -ExecutionPolicy Bypass -File bots\_supervisor\ensure-stack.ps1

$ErrorActionPreference = 'SilentlyContinue'
# project root = parent of this script's dir (bots\_supervisor\ -> repo root)
$proj = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$wdPath = Join-Path $proj 'watchdog.ps1'

# Is the watchdog (a detached powershell running watchdog.ps1) alive? Match on -File ...watchdog.ps1
# so this check never matches a transient query of its own.
$wd = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*watchdog.ps1*' -and $_.Name -match 'powershell|pwsh' -and $_.CommandLine -like '*-File*' }

if ($wd) {
    $ticket = Get-NetTCPConnection -LocalPort 48920 -State Listen -ErrorAction SilentlyContinue
    $agent  = Get-NetTCPConnection -LocalPort 48909 -State Listen -ErrorAction SilentlyContinue
    Write-Output ("[ensure-stack] watchdog ALIVE (pid {0}) — board:{1} agent:{2}. Stack supervised." -f $wd.ProcessId, $(if ($ticket) {'up'} else {'starting'}), $(if ($agent) {'up'} else {'starting'}))
    Write-Output "[ensure-stack] board UI: http://localhost:48920  |  onboard: node bots/_supervisor/ticket.mjs onboard"
} else {
    # ★T-0270: launch through WMI, NOT Start-Process. A Start-Process child inherits this hook's Job Object (the Claude
    # session's), so when that session ended the job was terminated and took the watchdog + main/bridge with it — no log
    # line, stack down until another session's hook fired. Win32_Process.Create spawns under WmiPrvSE, outside any job;
    # the watchdog's own Start-Process children then inherit ITS (job-free) state.
    $cmd = "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$wdPath`""
    $launched = $false
    try {
        $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = $proj } -ErrorAction Stop
        $launched = ($r.ReturnValue -eq 0)
    } catch {}
    if (-not $launched) {
        # WMI unavailable: best effort (stays inside the caller's job — dies with that session)
        Start-Process powershell -ArgumentList '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', $wdPath -WindowStyle Hidden
        Write-Output "[ensure-stack] WARN: WMI launch failed — watchdog started inside this session's job (dies with it)"
    }
    Write-Output "[ensure-stack] watchdog was DOWN — started it. It will bring up main/bridge/botwatch/ticket-server/overseer within ~30s."
    Write-Output "[ensure-stack] board UI: http://localhost:48920  |  onboard: node bots/_supervisor/ticket.mjs onboard"
}
