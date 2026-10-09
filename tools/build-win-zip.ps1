<#
.SYNOPSIS
    构建 mc-agent 的 Windows 绿色分发包（免安装，解压后双击「启动.bat」即用）。

.DESCRIPTION
    产出布局（$OutDir 就是包根，解压后用户看到的就是这一层）：

        <包根>/
        ├── 启动.bat            ← 用户双击这个
        ├── 使用说明.txt
        ├── bot.json            ← 角色配置（由 app/neko.json 搬过来并改写皮肤路径）
        ├── settings.json       ← 面向玩家的初始设置覆盖层
        ├── skins/
        │   └── neko-skin.png
        ├── node/               ← 便携 Node（用户不用装任何东西）
        │   └── node.exe ...
        └── app/                ← 代码（用户不需要碰）
            ├── main.js  settings.js  env.defaults.json
            ├── src/  profiles/  patches/  bots/
            └── node_modules/

    ★ 用户层的文件（bot.json / settings.json / skins/）**只在包根有一份**，app/ 里
      不留副本。历史上"内外各一份"造成过用户改了一份不生效的投诉，这是根治点。
      运行时 src/utils/paths.js 把 APP_ROOT（= app/）和 HOME_DIR（= 包根）分开，
      bootstrap.js 会 chdir 到包根，所以两层各读各的、不会串。

    ★ 打包用 `git archive HEAD` 做**白名单**，不是 robocopy 黑名单。
      边界声明在仓库根的 .gitattributes（export-ignore）。为什么换掉黑名单，见
      .gitattributes 顶部和 BUILD-WIN-ZIP.md。

.PARAMETER OutDir
    包根目录。会被**清空重建**。默认 D:\Downloads\mc-agent。

.PARAMETER Version
    版本号（不用带 v）。不传就用当天日期，正式发版请显式传。

.PARAMETER NodeVersion
    便携 Node 版本。默认 v22.13.0（mineflayer 4.37 + minecraft-protocol 1.66 要求 >= 22）。

.PARAMETER SkipNode
    不下载便携 Node。缓存里有就用缓存；都没有就退回系统 node，并**强制跳过打 zip**
    （因为这样产出的包不自包含，发出去用户跑不起来）。只适合本地反复迭代。

.PARAMETER NoZip
    只产出目录，不打 zip。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-win-zip.ps1 -Version 0.1.3

.NOTES
    本脚本不支持 -WhatIf。要做语法检查请用：
        $e=$null; $t=$null
        [System.Management.Automation.Language.Parser]::ParseFile('tools\build-win-zip.ps1',[ref]$t,[ref]$e)
        $e
#>
[CmdletBinding()]
param(
    [string] $OutDir      = 'D:\Downloads\mc-agent',
    [string] $Version     = '',
    [string] $NodeVersion = 'v22.13.0',
    # worktree = 打当前工作区（默认；改完代码就能出包，无需为打包造提交）
    # head     = 打已提交的 HEAD（正式发版建议用它，可复现）
    # 两者的白名单性质相同：都只输出 git 认识的文件，被 .gitignore 忽略的物理上进不了包。
    [ValidateSet('worktree', 'head')]
    [string] $Source      = 'worktree',
    [switch] $SkipNode,
    [switch] $NoZip
)

$ErrorActionPreference = 'Stop'
# Expand-Archive / Invoke-WebRequest 的进度条在 WinPS 5.1 上能把耗时拖长一个数量级
$ProgressPreference = 'SilentlyContinue'

$script:StepNo     = 0
$script:StartTime  = Get-Date
$script:SavedTotal = 0L

# ─────────────────────────────────────────────────────────────────────────────
# 小工具
# ─────────────────────────────────────────────────────────────────────────────

function Write-Step {
    param([string] $Message)
    $script:StepNo++
    Write-Host ''
    Write-Host ('[{0}] {1}' -f $script:StepNo, $Message) -ForegroundColor Cyan
}

function Write-Ok {
    param([string] $Message)
    Write-Host ('      · ' + $Message) -ForegroundColor DarkGray
}

function Write-Alert {
    param([string] $Message)
    Write-Host ('      ! ' + $Message) -ForegroundColor Yellow
}

function Stop-Build {
    param([string] $Message, [string[]] $Hint = @())
    Write-Host ''
    Write-Host ('构建中止：' + $Message) -ForegroundColor Red
    foreach ($h in $Hint) { Write-Host ('           ' + $h) -ForegroundColor Red }
    Write-Host ''
    exit 1
}

function Format-Size {
    param([long] $Bytes)
    if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N1} MB' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N0} KB' -f ($Bytes / 1KB)) }
    return ('{0} B' -f $Bytes)
}

function Get-TreeSize {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { return 0L }
    $item = Get-Item -LiteralPath $Path -Force
    if (-not $item.PSIsContainer) { return [long]$item.Length }
    $sum = 0L
    Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
        ForEach-Object { $sum += $_.Length }
    return $sum
}

function Remove-Tree {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    try {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
    } catch {
        # node_modules 嵌套过深会超 MAX_PATH，Remove-Item 直接抛；rd/del 能吃下更长的路径
        $isDir = (Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue)
        if ($isDir -and $isDir.PSIsContainer) {
            cmd.exe /c ('rd /s /q "{0}"' -f $Path) | Out-Null
        } else {
            cmd.exe /c ('del /f /q "{0}"' -f $Path) | Out-Null
        }
        if (Test-Path -LiteralPath $Path) { Stop-Build ('无法删除 {0}' -f $Path) }
    }
}

function Remove-Reported {
    param([string] $Path, [string] $Label)
    if (-not (Test-Path -LiteralPath $Path)) { Write-Ok ('跳过（本来就没有）：' + $Label); return }
    $sz = Get-TreeSize $Path
    Remove-Tree $Path
    $script:SavedTotal += $sz
    Write-Ok ('{0}   −{1}' -f $Label, (Format-Size $sz))
}

# 快速目录遍历（.NET 直调，比 Get-ChildItem -Recurse 快得多），
# 可按「相对路径前缀」剪枝 —— 用来把 node_modules / node 整片跳过。
function Get-FileList {
    param([string] $Root, [string[]] $ExcludeRel = @())
    $rootFull = ([System.IO.Path]::GetFullPath($Root)).TrimEnd('\')
    $excl = @()
    foreach ($e in $ExcludeRel) { $excl += $e.ToLowerInvariant().Replace('/', '\').Trim('\') }
    $out   = New-Object System.Collections.ArrayList
    $stack = New-Object System.Collections.Stack
    $stack.Push($rootFull)
    while ($stack.Count -gt 0) {
        $dir = $stack.Pop()
        $rel = $dir.Substring($rootFull.Length).TrimStart('\').ToLowerInvariant()
        $skip = $false
        foreach ($e in $excl) {
            if ($rel -eq $e -or $rel.StartsWith($e + '\')) { $skip = $true; break }
        }
        if ($skip) { continue }
        try {
            foreach ($d in [System.IO.Directory]::GetDirectories($dir)) { $stack.Push($d) }
            foreach ($f in [System.IO.Directory]::GetFiles($dir))       { [void]$out.Add($f) }
        } catch {
            # 超长路径 / 权限问题：跳过这一层，继续扫其它地方
            Write-Alert ('目录无法枚举，已跳过：' + $dir)
        }
    }
    return $out
}

# ─────────────────────────────────────────────────────────────────────────────
# 兜底断言：最后一道防线，扫产物里的密钥 / 开发机绝对路径 / 不该出现的文件
#
# 扫描范围刻意排除 node/（便携 Node 发行版）与 app/node_modules/（npm 仓库拉下来的
# 第三方包）。理由：密钥和 C:\Users\ 的唯一来源是本仓库的工作区，npm 包不是；而全量
# 扫十万个第三方文件既慢，又会被别人的测试夹具误报，把"最后一道防线"变成狼来了。
# ─────────────────────────────────────────────────────────────────────────────
#
# 关于豁免：唯一允许的豁免形式是下面 $ScanAllowList 里那种**精确到具体字面量**的条目 ——
# 只有当命中位置正好落在那段字面量里才放行，同一个文件里出现别的命中照样拦。每次构建都会
# 把放行项打出来，让它保持可见、不会悄悄腐烂。绝不要为了让构建过去而放宽正则本身。
#
# $SkipContent 只在**改写之前**那一遍扫描里用，用来跳过"已知马上就要被处理掉"的文件。
#
function Invoke-SecretScan {
    param(
        [string]   $Root,
        [string]   $Label,
        [string[]] $SkipContent = @(),
        [object[]] $AllowList   = @()
    )

    $patterns = @(
        @{ Name = 'OpenAI 风格密钥'; Regex = 'sk-[A-Za-z0-9_-]{20,}' },
        @{ Name = 'Google 风格密钥'; Regex = 'AIza[A-Za-z0-9_-]{30,}' },
        # 斜杠写成 [\\/]+ 而不是单个字符，是因为绝对路径出现在 .js/.json 里时反斜杠会被
        # 转义成 `C:\\Users\\wehos\\...`（neko.json 的 skin.path 历史上就是这个形状）。
        # 只匹配单斜杠的话，最该抓的那种形态恰好抓不到 —— 这是实测出来的漏网口。
        @{ Name = '开发机绝对路径';   Regex = '[A-Za-z]:[\\/]+Users[\\/]+' },
        # worktree 的 .git 是个文本指针文件，内容形如 `gitdir: C:/Users/.../.git/worktrees/xxx`
        @{ Name = 'git 工作区指针';   Regex = 'gitdir:\s*\S' }
    )
    $textExt = @('.js', '.mjs', '.cjs', '.json', '.md', '.txt', '.bat', '.cmd', '.ps1',
                 '.patch', '.yml', '.yaml', '.html', '.css', '.py', '.ts', '.env', '.log')

    $rootFull = ([System.IO.Path]::GetFullPath($Root)).TrimEnd('\')
    $files = @(Get-FileList -Root $rootFull -ExcludeRel @('node', 'app\node_modules'))
    $hits    = @()
    $allowed = @()
    $usedAllow = @{}

    foreach ($f in $files) {
        $rel  = $f.Substring($rootFull.Length).TrimStart('\')
        $name = [System.IO.Path]::GetFileName($f)
        # 文件名闸：任何一个叫 keys.json 的文件都不该出现在分发包里
        if ($name -ieq 'keys.json') { $hits += ('文件名命中 keys.json  →  ' + $rel) }
        $ext = [System.IO.Path]::GetExtension($f).ToLowerInvariant()
        if ($textExt -notcontains $ext) { continue }
        if ($SkipContent -contains $rel) { continue }
        $content = ''
        try { $content = [System.IO.File]::ReadAllText($f) } catch { continue }

        # 本文件适用的豁免条目
        $myAllow = @($AllowList | Where-Object { $_.File -ieq $rel })

        foreach ($p in $patterns) {
            foreach ($m in [regex]::Matches($content, $p.Regex)) {
                # 只有当命中位置**正好落在**某条豁免字面量的区间里才放行 ——
                # 这样同一个文件里真出现别的密钥/路径时依然拦得住。
                $hitAllow = $null
                foreach ($a in $myAllow) {
                    $idx = 0
                    while ($idx -ge 0) {
                        $idx = $content.IndexOf($a.Text, $idx, [System.StringComparison]::Ordinal)
                        if ($idx -lt 0) { break }
                        if ($m.Index -ge $idx -and $m.Index -lt ($idx + $a.Text.Length)) { $hitAllow = $a; break }
                        $idx++
                    }
                    if ($hitAllow) { break }
                }
                if ($hitAllow) {
                    $usedAllow[$hitAllow.File + '|' + $hitAllow.Text] = $true
                    $allowed += ('{0}  →  {1}  ({2})' -f $p.Name, $rel, $hitAllow.Why)
                    continue
                }
                $sample = $m.Value
                if ($sample.Length -gt 12) { $sample = $sample.Substring(0, 8) + '…' }
                $hits += ('{0}  →  {1}  (片段: {2})' -f $p.Name, $rel, $sample)
            }
        }
    }

    # 目录闸：开发环境的私有目录一个都不该跟出来
    $badDirs = @('.git', '.worktrees', '.claude', '.codex', '.agents', 'node_modules_bak')
    foreach ($bd in $badDirs) {
        foreach ($probe in @((Join-Path $rootFull $bd), (Join-Path (Join-Path $rootFull 'app') $bd))) {
            if (Test-Path -LiteralPath $probe) { $hits += ('不该出现的目录/文件  →  ' + $probe) }
        }
    }

    if ($hits.Count -gt 0) {
        Write-Host ''
        foreach ($h in $hits) { Write-Host ('      × ' + $h) -ForegroundColor Red }
        Stop-Build ('兜底扫描（{0}）命中 {1} 处，绝不能就这么发出去。' -f $Label, $hits.Count) `
                   @('这通常意味着 .gitattributes 的 export-ignore 没生效，或者有新文件被跟踪进了仓库。',
                     '先修 .gitattributes / 仓库内容 —— 放宽正则或往豁免表里塞条目是最后手段，',
                     '而且豁免必须精确到具体字面量并写清理由。')
    }
    # 放行项每次都打出来，保持可见；否则豁免表会悄悄腐烂成"永久后门"
    foreach ($a in $allowed) { Write-Host ('      ~ 已豁免  ' + $a) -ForegroundColor DarkYellow }
    foreach ($a in $AllowList) {
        if (-not $usedAllow.ContainsKey($a.File + '|' + $a.Text)) {
            Write-Alert ('豁免条目已失效（源码里找不到了），请从 $ScanAllowList 里删掉：{0} / {1}' -f $a.File, $a.Text)
        }
    }
    Write-Ok ('{0}：扫了 {1} 个文件，命中 0 处（放行 {2} 处）。' -f $Label, $files.Count, $allowed.Count)
}

# node_modules 常规瘦身：删 *.md / *.map / test|tests|__tests__|docs|doc 目录。
# $Protect 里的包整片跳过 —— 它们是截图管线（prismarine-viewer / three / gl / canvas /
# node-canvas-webgl）的依赖，截图经 ws 48909 推给 N.E.K.O. 主 agent，是核心功能，
# 任何"这个看着没用"的判断都是错的。
function Invoke-ModuleSweep {
    param([string] $NodeModules, [string[]] $Protect)

    $delDirNames = @('test', 'tests', '__tests__', 'docs', 'doc')
    $delFileExt  = @('.md', '.map')
    $protectFull = @()
    foreach ($p in $Protect) { $protectFull += (Join-Path $NodeModules $p).ToLowerInvariant() }

    $freed = 0L
    $stack = New-Object System.Collections.Stack
    $stack.Push($NodeModules)
    while ($stack.Count -gt 0) {
        $dir = $stack.Pop()
        $dl  = $dir.ToLowerInvariant()
        $skip = $false
        foreach ($p in $protectFull) {
            if ($dl -eq $p -or $dl.StartsWith($p + '\')) { $skip = $true; break }
        }
        if ($skip) { continue }

        $subs = @(); $files = @()
        try {
            $subs  = [System.IO.Directory]::GetDirectories($dir)
            $files = [System.IO.Directory]::GetFiles($dir)
        } catch { continue }

        foreach ($f in $files) {
            $ext = [System.IO.Path]::GetExtension($f).ToLowerInvariant()
            if ($delFileExt -notcontains $ext) { continue }
            try {
                $len = (New-Object System.IO.FileInfo $f).Length
                [System.IO.File]::Delete($f)
                $freed += $len
            } catch { }
        }
        foreach ($s in $subs) {
            $name = [System.IO.Path]::GetFileName($s).ToLowerInvariant()
            if ($delDirNames -contains $name) {
                $freed += (Get-TreeSize $s)
                Remove-Tree $s
            } else {
                $stack.Push($s)
            }
        }
    }
    return $freed
}

# ─────────────────────────────────────────────────────────────────────────────
# 兜底扫描的豁免表 —— 精确到字面量，每条都要写清为什么。
#
# 加条目之前先问一句：能不能改源码把这段路径消掉？能就改源码。豁免是最后手段。
# 条目失效（源码里找不到那段字面量了）时脚本会提醒你删掉它。
# ─────────────────────────────────────────────────────────────────────────────
# 空表 = 零豁免，扫描保持全强度。
# 曾经这里有一条：agent.js 的注释里拿 "C:\Users\张 三\skins\x.png" 举例说明"路径含空格
# 必须加引号"。虽然是虚构示例，但豁免表一旦开了口子就会慢慢长成永久后门 —— 正确做法是
# 改掉注释而不是加豁免，已于 2026-08-07 改成不含盘符的写法并删除该条。
# 往这里加条目前先问一句：能不能直接把源码里那处改掉？十有八九能。
$ScanAllowList = @()

# ═════════════════════════════════════════════════════════════════════════════
# 1. 环境前置检查
# ═════════════════════════════════════════════════════════════════════════════
Write-Step '环境前置检查'

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    Stop-Build '必须在 Windows 上构建。' `
               @('canvas / gl / prismarine-viewer 的 native prebuilt 是 win-x64 专用的，',
                 '跨平台产出的包用户双击起不来（截图管线直接崩）。')
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Stop-Build '找不到 git。打包全靠 `git archive` 做白名单，没有 git 走不下去。'
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'main.js'))) {
    Stop-Build ('看起来不在仓库里：{0} 下没有 main.js。' -f $RepoRoot) `
               @('本脚本必须留在仓库的 tools\ 目录下运行。')
}
& git -C $RepoRoot rev-parse --is-inside-work-tree | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-Build ('{0} 不是一个 git 工作区。' -f $RepoRoot) }

Write-Ok ('仓库：' + $RepoRoot)
Write-Ok ('PowerShell：' + $PSVersionTable.PSVersion.ToString())

# ═════════════════════════════════════════════════════════════════════════════
# 2. 版本号 / HEAD / 工作区状态
# ═════════════════════════════════════════════════════════════════════════════
Write-Step '确认打包来源'

if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = Get-Date -Format 'yyyyMMdd'
    Write-Alert ('没传 -Version，用日期版本号 {0}。正式发版请显式传 -Version 0.1.3 这种。' -f $Version)
}
$Version  = $Version.Trim().TrimStart('v', 'V')
$PkgLabel = 'mc-agent-win-v' + $Version

$headSha     = (& git -C $RepoRoot rev-parse --short HEAD).Trim()
$headSubject = (& git -C $RepoRoot log -1 --pretty=%s).Trim()
Write-Ok ('版本号：{0}' -f $Version)
Write-Ok ('HEAD：{0}  {1}' -f $headSha, $headSubject)

# ─────────────────────────────────────────────────────────────────────────────
# ★ 源码取自哪棵树：-Source worktree（默认） / head
#
# 白名单这条性质来自「只输出 git 认识的文件」，而不是来自「必须已提交」。所以默认
# 模式用一个**临时索引**把工作区快照成一个 tree 对象再喂给 git archive：
#     GIT_INDEX_FILE=<临时> git read-tree HEAD    ← 以 HEAD 的跟踪集打底
#     GIT_INDEX_FILE=<临时> git add -A            ← 用工作区内容更新，且遵守 .gitignore
#     GIT_INDEX_FILE=<临时> git write-tree        ← 产出 tree，不碰 HEAD/分支/暂存区
# 得到的树里：未跟踪且被忽略的东西（keys.json / node_modules / .worktrees / 各种 .log）
# 物理上不存在，与 `git archive HEAD` 的安全性完全等价；区别只是内容取自工作区，
# 于是「改了代码直接打包」成立，不必为了出一个包先造一个提交。
#
# -Source head 保留原行为（打已提交的 HEAD），发正式版建议用它，可复现。
# ─────────────────────────────────────────────────────────────────────────────
$dirty = @(& git -C $RepoRoot status --porcelain)

if ($Source -eq 'head') {
    $SrcTree  = 'HEAD'
    $SrcLabel = ('HEAD {0}' -f $headSha)
    if ($dirty.Count -gt 0) {
        Write-Alert ('工作区有 {0} 项未提交的改动。-Source head 取自 HEAD（{1}），这些改动**不会**进包：' -f $dirty.Count, $headSha)
        $show = $dirty
        if ($show.Count -gt 20) { $show = $show[0..19] }
        foreach ($d in $show) { Write-Host ('        ' + $d) -ForegroundColor Yellow }
        if ($dirty.Count -gt 20) { Write-Host ('        …… 还有 {0} 项' -f ($dirty.Count - 20)) -ForegroundColor Yellow }
    } else {
        Write-Ok '工作区干净，与 HEAD 一致。'
    }
} else {
    $tmpIndex = Join-Path ([System.IO.Path]::GetTempPath()) ('mc-agent-build-index-{0}' -f $PID)
    Remove-Tree $tmpIndex
    $savedIndex = $env:GIT_INDEX_FILE
    try {
        $env:GIT_INDEX_FILE = $tmpIndex
        & git -C $RepoRoot read-tree HEAD
        if ($LASTEXITCODE -ne 0) { Stop-Build '临时索引 read-tree HEAD 失败。' }
        & git -C $RepoRoot add -A
        if ($LASTEXITCODE -ne 0) { Stop-Build '临时索引 git add -A 失败。' }
        $SrcTree = (& git -C $RepoRoot write-tree).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($SrcTree)) { Stop-Build '临时索引 write-tree 失败。' }
    } finally {
        if ($null -eq $savedIndex) { Remove-Item env:GIT_INDEX_FILE -ErrorAction SilentlyContinue }
        else { $env:GIT_INDEX_FILE = $savedIndex }
        Remove-Tree $tmpIndex
    }
    $SrcLabel = ('工作区快照 tree {0}（基于 HEAD {1}）' -f $SrcTree.Substring(0, 12), $headSha)
    if ($dirty.Count -gt 0) {
        Write-Ok ('工作区有 {0} 项改动，本次打包**包含**它们（-Source worktree）。' -f $dirty.Count)
    } else {
        Write-Ok '工作区干净，快照与 HEAD 等价。'
    }
    Write-Host '        注意：被 .gitignore 忽略的文件（keys.json / 日志 / node_modules / .worktrees）不在快照里。' -ForegroundColor DarkGray
}
Write-Ok ('打包来源：' + $SrcLabel)

# .gitattributes 是打包边界的唯一声明，必须存在且含 export-ignore
$gaPath = Join-Path $RepoRoot '.gitattributes'
if (-not (Test-Path -LiteralPath $gaPath)) {
    Stop-Build '仓库根没有 .gitattributes。' @('没有它 git archive 会把 docs/ test/ tasks/ watchdog.ps1 等开发资产全打进包。')
}
if (-not (Select-String -LiteralPath $gaPath -Pattern 'export-ignore' -Quiet)) {
    Stop-Build '.gitattributes 里一条 export-ignore 都没有，打包边界等于没声明。'
}
& git -C $RepoRoot rev-parse --verify --quiet 'HEAD:.gitattributes' | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Alert '.gitattributes 还没提交。本次靠 --worktree-attributes 让工作区那份生效，但请尽快提交它。'
}

# ★ 早失败：这些文件必须在 HEAD 里。放到 npm ci 之后才发现少文件要白等 5 分钟。
$requiredInHead = @(
    'main.js', 'settings.js', 'package.json', 'env.defaults.json', 'eslint.config.js',
    'neko.json', 'skins/neko-skin.png',
    'profiles/defaults/_default.json',
    'bots/execTemplate.js', 'bots/lintTemplate.js',
    'bots/_supervisor/oracle_shared.mjs',
    'src/utils/paths.js', 'src/utils/bootstrap.js', 'src/utils/keys.js',
    'src/models/providers.js',
    # ── 控制面板（本次发行的主角，漏了包就是"能启动但没有面板"）──────────────
    # 2026-08-07 交叉校验补：这几项原先两张表都没有。后果是只提交了上面 15 项就能
    # 通过全部断言，打出一个没有控制面板的包 —— 正是 v0.1.2「63 个技能静默丢失」
    # 那一类事故。新增随包文件时这两张表要一起改。
    'src/models/openai_compatible.js', 'src/models/provider_test.js',
    'src/utils/think.js',
    'src/mindcraft/panel/router.js', 'src/mindcraft/panel/flags_catalog.json',
    'src/mindcraft/public/index.html', 'src/mindcraft/public/app.js',
    'src/mindcraft/public/lib/api.js', 'src/mindcraft/public/views/overview.js',
    'src/mindcraft/public/styles/tokens.css'
)
$missingInHead = @()
foreach ($p in $requiredInHead) {
    & git -C $RepoRoot rev-parse --verify --quiet ($SrcTree + ':' + $p) | Out-Null
    if ($LASTEXITCODE -ne 0) { $missingInHead += $p }
}
if ($missingInHead.Count -gt 0) {
    foreach ($m in $missingInHead) { Write-Host ('      × 源码树里没有：' + $m) -ForegroundColor Red }
    Stop-Build ('有 {0} 个必需文件不在打包源码树里（{1}）。' -f $missingInHead.Count, $SrcLabel) `
               @('打包只输出 git 认识的文件，所以被 .gitignore 忽略的文件进不了包。',
                 '打出来的包会是残废的（缺 paths.js 就是缺整个路径基准）。',
                 '若用 -Source head：请先 git add + git commit 这些文件。',
                 '若用 -Source worktree：检查它们是不是被 .gitignore 误伤了（git check-ignore -v <文件>）。')
}
Write-Ok ('必需文件齐了（{0} 项）。' -f $requiredInHead.Count)

# ═════════════════════════════════════════════════════════════════════════════
# 3. 准备输出目录
# ═════════════════════════════════════════════════════════════════════════════
Write-Step '准备输出目录'

if (-not [System.IO.Path]::IsPathRooted($OutDir)) { $OutDir = Join-Path (Get-Location).Path $OutDir }
$OutDir   = ([System.IO.Path]::GetFullPath($OutDir)).TrimEnd('\')
$outLower = $OutDir.ToLowerInvariant()
$repoFull = ([System.IO.Path]::GetFullPath($RepoRoot)).TrimEnd('\')

# 这个目录马上要被整片删掉，护栏必须硬
$outParent = Split-Path -Parent $OutDir
if ([string]::IsNullOrEmpty($outParent)) {
    Stop-Build ('-OutDir 不能是盘符根目录：{0}' -f $OutDir) @('本脚本会先把它清空。')
}
if ($outLower -eq $repoFull.ToLowerInvariant()) {
    Stop-Build '-OutDir 不能就是仓库本身。'
}
if ($repoFull.ToLowerInvariant().StartsWith($outLower + '\')) {
    Stop-Build ('-OutDir（{0}）把仓库包在里面了，清空它会把仓库一起删掉。' -f $OutDir)
}
if (-not (Test-Path -LiteralPath $outParent)) {
    Stop-Build ('上级目录不存在：{0}' -f $outParent) @('请先建好，或换一个 -OutDir。')
}

if (Test-Path -LiteralPath $OutDir) {
    # ★ 只肯清空"空目录"或"上一次的分发包"。
    #   默认值是 D:\Downloads\mc-agent，少打一层就变成 D:\Downloads —— 无脑
    #   Remove-Item -Recurse 会把人家整个下载目录端掉。用结构特征认包，不用标记文件
    #   （标记文件要么进 zip 添乱，要么放包外容易走丢）。
    $existing = @(Get-ChildItem -LiteralPath $OutDir -Force -ErrorAction SilentlyContinue)
    $looksLikePkg = (Test-Path -LiteralPath (Join-Path $OutDir 'app\main.js')) -or
                    (Test-Path -LiteralPath (Join-Path $OutDir '启动.bat'))     -or
                    (Test-Path -LiteralPath (Join-Path $OutDir 'node\node.exe'))
    if ($existing.Count -gt 0 -and -not $looksLikePkg) {
        Stop-Build ('{0} 里有 {1} 项内容，但看着不像上一次打的分发包。' -f $OutDir, $existing.Count) `
                   @('为防误删，脚本拒绝清空一个"不认识"的非空目录。',
                     '认包的判据是里面有 app\main.js 或 启动.bat 或 node\node.exe。',
                     '请换一个空目录/新目录当 -OutDir，或者自己确认无误后手动删掉它再重跑。')
    }
    Write-Alert ('{0} 已存在，先清空。' -f $OutDir)
    Remove-Tree $OutDir
}
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$AppDir = Join-Path $OutDir 'app'
Write-Ok ('包根：' + $OutDir)

# ═════════════════════════════════════════════════════════════════════════════
# 4. 导出源码（git archive = 白名单）
# ═════════════════════════════════════════════════════════════════════════════
Write-Step ('导出源码到 app\（git archive，白名单；来源 {0}）' -f $SrcLabel)

$tmpSrcZip = Join-Path ([System.IO.Path]::GetTempPath()) ('mc-agent-src-{0}.zip' -f $PID)
Remove-Tree $tmpSrcZip
# --worktree-attributes：让工作区的 .gitattributes 也参与判定。
#   git archive 默认只读**被归档那棵树里**的 .gitattributes，本文件刚加上还没提交时
#   一条 export-ignore 都不会生效 —— 这个坑不加这个开关就会踩。
& git -C $RepoRoot archive --worktree-attributes --format=zip -o $tmpSrcZip $SrcTree
if ($LASTEXITCODE -ne 0) { Stop-Build 'git archive 执行失败。' }

New-Item -ItemType Directory -Path $AppDir -Force | Out-Null
Expand-Archive -LiteralPath $tmpSrcZip -DestinationPath $AppDir -Force
Remove-Tree $tmpSrcZip

$srcFiles = @(Get-FileList -Root $AppDir)
Write-Ok ('源码 {0} 个文件，{1}' -f $srcFiles.Count, (Format-Size (Get-TreeSize $AppDir)))

# ═════════════════════════════════════════════════════════════════════════════
# 5. 源码断言：该有的必须有，不该有的必须没有
# ═════════════════════════════════════════════════════════════════════════════
Write-Step '源码断言'

$mustExist = @(
    'main.js', 'settings.js', 'package.json', 'env.defaults.json', 'eslint.config.js',
    'neko.json', 'skins\neko-skin.png',
    'profiles\defaults\_default.json',
    'bots\execTemplate.js', 'bots\lintTemplate.js',
    'bots\_supervisor\oracle_shared.mjs',
    'src\utils\paths.js', 'src\utils\bootstrap.js', 'src\utils\keys.js',
    'src\models\providers.js',
    # ── 控制面板（与 $requiredInHead 保持同步，理由见那里的注释）─────────────
    'src\models\openai_compatible.js', 'src\models\provider_test.js',
    'src\utils\think.js',
    'src\mindcraft\panel\router.js', 'src\mindcraft\panel\flags_catalog.json',
    'src\mindcraft\public\index.html', 'src\mindcraft\public\app.js',
    'src\mindcraft\public\lib\api.js', 'src\mindcraft\public\views\overview.js',
    'src\mindcraft\public\styles\tokens.css'
)
$lack = @()
foreach ($rel in $mustExist) {
    if (-not (Test-Path -LiteralPath (Join-Path $AppDir $rel))) { $lack += $rel }
}
if ($lack.Count -gt 0) {
    foreach ($l in $lack) { Write-Host ('      × 缺：app\' + $l) -ForegroundColor Red }
    Stop-Build ('产物缺 {0} 个必需文件。' -f $lack.Count) `
               @('要么是 .gitattributes 把不该排的东西排掉了，要么是文件没提交。')
}
Write-Ok ('必需文件齐了（{0} 项）。' -f $mustExist.Count)

# 热加载技能：world_model 提案端硬接线技能名，丢文件 = customSkill 找不到 →
# 3-strike → 5min 冷却的永久空转风暴。数量兜底 > 50。
$skillDir = Join-Path $AppDir 'bots\_supervisor\skills'
$skillCount = @(Get-ChildItem -LiteralPath $skillDir -Filter '*.js' -File -ErrorAction SilentlyContinue).Count
if ($skillCount -le 50) {
    Stop-Build ('热加载技能只有 {0} 个（应当 > 50）。' -f $skillCount) `
               @('检查 .gitattributes 有没有误伤 bots/_supervisor/skills/。',
                 '注意：给目录标 export-ignore 会让 git archive 整棵剪掉、不再下钻，',
                 '所以 bots/_supervisor 必须逐类排除，不能整目录排。')
}
Write-Ok ('热加载技能 {0} 个。' -f $skillCount)

# patches：npm 的 postinstall 会跑 patch-package 把这些补丁打上去（修 mineflayer /
# minecraft-data / prismarine-viewer 的已知 bug）。补丁没进包 = 老 bug 全回来。
$patchCount = @(Get-ChildItem -LiteralPath (Join-Path $AppDir 'patches') -Filter '*.patch' -File -ErrorAction SilentlyContinue).Count
if ($patchCount -lt 1) { Stop-Build 'app\patches\ 里一个 .patch 都没有，patch-package 会空跑，已修的上游 bug 会全部回来。' }
Write-Ok ('补丁 {0} 个。' -f $patchCount)

# 边界断言：这些东西出现在包里，说明 export-ignore 没生效
$mustNotExist = @(
    '.git', '.gitattributes', '.gitignore', '.dockerignore', '.worktrees', '.claude', '.codex', '.agents',
    'docs', 'test', 'tasks', 'services', 'tools',
    'BUILD-WIN-ZIP.md', 'minecollab.md', 'keys.example.json', 'keys.json',
    'watchdog.ps1', 'start-neko.ps1', 'start-neko-direct.bat',
    'agent_ws_server.py', 'test_websocket_client.js', 'requirements.txt',
    'Dockerfile', 'Tasks.Dockerfile', 'docker-compose.yml',
    'bots\_supervisor\core', 'bots\_supervisor\test',
    'bots\_supervisor\bot-medic.mjs', 'bots\_supervisor\ore-oracle.mjs',
    'bots\_supervisor\arbitration.json'
)
$leaked = @()
foreach ($rel in $mustNotExist) {
    if (Test-Path -LiteralPath (Join-Path $AppDir $rel)) { $leaked += $rel }
}
if ($leaked.Count -gt 0) {
    foreach ($l in $leaked) { Write-Host ('      × 不该在包里：app\' + $l) -ForegroundColor Red }
    Stop-Build ('有 {0} 项开发资产漏进了产物。' -f $leaked.Count) `
               @('.gitattributes 的 export-ignore 没生效或写漏了。先修它，别在这里删。')
}
Write-Ok ('边界断言通过（检查了 {0} 项不该出现的路径）。' -f $mustNotExist.Count)

# app\neko.json 这一遍先跳过内容扫描：它的 skin.path 现在还是开发机绝对路径
# （C:/Users/Administrator/...），第 10 步会把它改写进包根的 bot.json 并删掉原文件。
# 第 12 步的最终扫描时它已经不在 app\ 里了 —— 那一遍才是真正的闸：万一改写没发生，
# 或者改写完还留着绝对路径，最终扫描一定会拦下来。
Invoke-SecretScan -Root $OutDir -Label '源码兜底扫描' -SkipContent @('app\neko.json') -AllowList $ScanAllowList

# ═════════════════════════════════════════════════════════════════════════════
# 6. 便携 Node
# ═════════════════════════════════════════════════════════════════════════════
Write-Step ('准备便携 Node（{0}）' -f $NodeVersion)

$NodeDir   = Join-Path $OutDir 'node'
$nodeDist  = 'node-{0}-win-x64' -f $NodeVersion
$cacheDir  = Join-Path $env:LOCALAPPDATA 'mc-agent-build\node-cache'
$cacheZip  = Join-Path $cacheDir ($nodeDist + '.zip')
$portable  = $true

if (-not (Test-Path -LiteralPath $cacheZip)) {
    if ($SkipNode) {
        Write-Alert '-SkipNode 且缓存里没有便携 Node，退回系统 node。'
        $portable = $false
    } else {
        New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
        $url   = 'https://nodejs.org/dist/{0}/{1}.zip' -f $NodeVersion, $nodeDist
        $tmpDl = $cacheZip + '.part'
        Remove-Tree $tmpDl
        Write-Ok ('下载 ' + $url)
        if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
            & curl.exe -fL --retry 3 --retry-delay 2 -o $tmpDl $url
            if ($LASTEXITCODE -ne 0) { Stop-Build ('下载失败：' + $url) @('检查网络，或手工下好放到 ' + $cacheZip) }
        } else {
            Invoke-WebRequest -Uri $url -OutFile $tmpDl -UseBasicParsing
        }
        Move-Item -LiteralPath $tmpDl -Destination $cacheZip -Force
    }
} else {
    Write-Ok ('用缓存：' + $cacheZip)
}

if ($portable) {
    $tmpNode = Join-Path ([System.IO.Path]::GetTempPath()) ('mc-agent-node-{0}' -f $PID)
    Remove-Tree $tmpNode
    Expand-Archive -LiteralPath $cacheZip -DestinationPath $tmpNode -Force
    $inner = Join-Path $tmpNode $nodeDist
    if (-not (Test-Path -LiteralPath $inner)) {
        Stop-Build ('Node 压缩包里没有预期的目录 {0}。' -f $nodeDist) @('缓存文件可能损坏，删掉 ' + $cacheZip + ' 重下。')
    }
    # 拍平成 <包根>\node\node.exe —— 启动.bat 里就不用写死 Node 版本号了
    Move-Item -LiteralPath $inner -Destination $NodeDir -Force
    Remove-Tree $tmpNode
}

if ($portable) {
    $NodeExe = Join-Path $NodeDir 'node.exe'
    $NpmCmd  = Join-Path $NodeDir 'npm.cmd'
    if (-not (Test-Path -LiteralPath $NodeExe)) { Stop-Build ('没找到 ' + $NodeExe) }
    if (-not (Test-Path -LiteralPath $NpmCmd))  { Stop-Build ('没找到 ' + $NpmCmd) }
    $env:PATH = $NodeDir + ';' + $env:PATH
    Write-Ok ('便携 Node 就位：{0}（{1}）' -f $NodeDir, (Format-Size (Get-TreeSize $NodeDir)))
} else {
    $sysNode = Get-Command node.exe -ErrorAction SilentlyContinue
    $sysNpm  = Get-Command npm.cmd  -ErrorAction SilentlyContinue
    if (-not $sysNode -or -not $sysNpm) { Stop-Build '系统里也找不到 node.exe / npm.cmd，去掉 -SkipNode 重跑。' }
    $NodeExe = $sysNode.Source
    $NpmCmd  = $sysNpm.Source
    $NoZip   = $true
    Write-Alert ('用系统 Node：{0}。产出的包**不自包含**（没有 node\），已强制跳过打 zip。' -f $NodeExe)
}
Write-Ok ('node -v = ' + (& $NodeExe -v))

# ═════════════════════════════════════════════════════════════════════════════
# 7. 安装依赖
# ═════════════════════════════════════════════════════════════════════════════
Write-Step '安装依赖（npm ci）'

# package-lock.json 被 .gitignore 忽略，git archive 里没有，必须显式从仓库复制。
# 没有它 npm ci 直接报错；用 npm install 又会漂版本，产物不可复现。
$lockSrc = Join-Path $RepoRoot 'package-lock.json'
if (-not (Test-Path -LiteralPath $lockSrc)) {
    Stop-Build ' 仓库里没有 package-lock.json。' `
               @('它被 .gitignore 忽略，所以不会进 git archive，必须从工作区复制。',
                 '请先在仓库里跑一次 npm install 生成它，再重跑本脚本。')
}
Copy-Item -LiteralPath $lockSrc -Destination (Join-Path $AppDir 'package-lock.json') -Force
Write-Ok '已复制 package-lock.json（gitignored，不会随 git archive 出来）。'

# ★ 绝对不能加 --omit=dev。
#   package.json 的 postinstall 是 `patch-package`，而 patch-package 是 devDependency。
#   --omit=dev 之后它不在 node_modules 里，postinstall 照样触发，报
#   "patch-package is not recognized" 然后 npm ci exit 1。
#   代价是多几十 MB devDep，可接受；下面的瘦身会把最大的两坨（typescript / npm）删掉。
$env:npm_config_fund   = 'false'
$env:npm_config_audit  = 'false'
Push-Location -LiteralPath $AppDir
try { & $NpmCmd ci } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { Stop-Build ('npm ci 失败（退出码 {0}）。' -f $LASTEXITCODE) }

$NM = Join-Path $AppDir 'node_modules'
if (-not (Test-Path -LiteralPath $NM)) { Stop-Build 'npm ci 跑完了但没有 node_modules。' }
Write-Ok ('node_modules：' + (Format-Size (Get-TreeSize $NM)))

# ═════════════════════════════════════════════════════════════════════════════
# 8. native prebuilt 断言
# ═════════════════════════════════════════════════════════════════════════════
Write-Step '依赖可加载断言（canvas / gl / eslint）'

# -e 的内容保持纯 ASCII：WinPS 5.1 往原生 exe 传非 ASCII 参数会受控制台代码页影响，
# 没必要在一个断言上冒这个险。中文说明由 PowerShell 自己打。
Push-Location -LiteralPath $AppDir
try { & $NodeExe -e "require('canvas');require('gl');console.log('canvas + gl loaded ok')" } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) {
    Stop-Build 'canvas / gl 加载失败。' `
               @('这两个是截图管线的地基，加载不了 = bot 不给主 agent 发画面。',
                 '常见原因：不是在 win-x64 上构建，或 prebuilt 没下下来（网络）。')
}

# ★ eslint 单独查一遍：src/agent/coder.js 第 9 行是**顶层静态** import {ESLint} from "eslint"，
#   也就是说它是**运行时硬依赖**；但 package.json 里它被声明在 devDependencies。
#   现在靠"npm ci 不加 --omit=dev"兜着，能装上；可一旦有人为了瘦身加上 --omit=dev
#   （或者把 eslint 从 devDeps 里挪走），coder.js 会在 import 阶段就崩，newAction 整条
#   写代码/跑代码的路径直接废掉 —— 而这在打包时是完全看不出来的。这条断言把它焊住：
#   不管声明在哪儿，装不上就不许出包。
Push-Location -LiteralPath $AppDir
try { & $NodeExe -e "require.resolve('eslint');console.log('eslint resolvable ok')" } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) {
    Stop-Build 'eslint 装不上（它是 coder.js 的运行时硬依赖）。' `
               @('src/agent/coder.js 顶层 import {ESLint} from "eslint"，缺了它 newAction 整条路径都废。',
                 '注意 eslint 目前声明在 devDependencies —— npm ci 绝不能加 --omit=dev。',
                 '更彻底的修法是把 eslint 挪回 dependencies。')
}
# eslint.config.js 也必须在 app 根：ESLint 9 的 flat config 是从 cwd 往上找的，
# coder.js 显式传了 cwd: APP_ROOT，所以配置文件必须躺在 app\ 根目录。
if (-not (Test-Path -LiteralPath (Join-Path $AppDir 'eslint.config.js'))) {
    Stop-Build 'app\eslint.config.js 不见了，运行时 ESLint 会找不到 flat config。'
}

# ═════════════════════════════════════════════════════════════════════════════
# 9. 瘦身
# ═════════════════════════════════════════════════════════════════════════════
Write-Step '瘦身'

$sizeBeforeSlim = Get-TreeSize $NM

# minecraft-data 的 bedrock 数据 320 MB —— Java 版 bot 一个字节都用不到。
# ★ 但 bedrock/common/ 必须留：minecraft-data/index.js 顶部 eager require 了
#   ./minecraft-data/data/bedrock/common/{protocolVersions,versions,legacy}.json，
#   删了会在 import 阶段直接崩。
# ★ 必须递归找**所有** minecraft-data 副本，不能只处理顶层那一份。
#   实测（v0.2.0 首次构建）：mineflayer-pvp 依赖的 mineflayer-utils 自带一份嵌套
#   node_modules\minecraft-data，里面又是 41.4 MB 的 bedrock —— 只删顶层会漏掉它。
#   npm 的依赖提升不保证只有一份副本，所以这里按目录结构搜，不写死路径。
$bedrockDirs = @(Get-ChildItem -LiteralPath $NM -Recurse -Directory -Force -Filter 'bedrock' -ErrorAction SilentlyContinue |
                 Where-Object { $_.FullName -match '\\minecraft-data\\data\\bedrock$' })
if ($bedrockDirs.Count -gt 0) {
    $bedrockSaved = 0
    foreach ($bd in $bedrockDirs) {
        $before = Get-TreeSize $bd.FullName
        Get-ChildItem -LiteralPath $bd.FullName -Directory -Force |
            Where-Object { $_.Name -ne 'common' } |
            ForEach-Object { Remove-Tree $_.FullName }
        $bedrockSaved += $before - (Get-TreeSize $bd.FullName)
        # bedrock/common/ 必须留：minecraft-data/index.js 顶部 eager require 了
        # ./minecraft-data/data/bedrock/common/{protocolVersions,versions,legacy}.json，
        # 删了会在 import 阶段直接崩。
        if (-not (Test-Path -LiteralPath (Join-Path $bd.FullName 'common\protocolVersions.json'))) {
            Stop-Build ('bedrock\common\protocolVersions.json 被删掉了（{0}），minecraft-data 一 import 就会崩。' -f $bd.FullName)
        }
    }
    $script:SavedTotal += $bedrockSaved
    Write-Ok ('minecraft-data 的 bedrock 版本数据，{0} 份副本（各保留 common/）   −{1}' -f $bedrockDirs.Count, (Format-Size $bedrockSaved))
} else {
    Write-Alert ' 没找到 minecraft-data 的 bedrock 目录（上游改布局了？跳过）。'
}

# minecraft-assets —— 控制面板背包格的物品图标走 mindserver 的 /assets/item/… 代理。
# 整包 112 MB / 22 个版本的贴图，而代理只按「世界版本 → 回落 1.21.8」两档取图
# （src/mindcraft/mindserver.js 的 candidates）。方块/物品贴图在小版本间几乎不变，
# 保留下面这几个版本足够覆盖，取不到时代理本来就有 SVG 占位兜底、不会报错。
# ★ 这些是 PNG，压缩率极低 —— 首次构建时它一个人就让 zip 从 ~210 MB 涨到 246 MB。
# ★ common/ 是各版本共用的数据，不是版本目录，必须留（1.20.1 在该包里不存在，是 1.20.2 —— 别凭印象写版本号）。
$KEEP_ASSET_VERSIONS = @('common', '1.20.2', '1.21.1', '1.21.8')
$assetsData = Join-Path $NM 'minecraft-assets\minecraft-assets\data'
if (Test-Path -LiteralPath $assetsData) {
    $before   = Get-TreeSize $assetsData
    $allDirs  = @(Get-ChildItem -LiteralPath $assetsData -Directory -Force | Select-Object -ExpandProperty Name)
    # 先校验再动手：版本号写错就整包图标失效，而且是静默的（代理有 SVG 兜底不会报错）
    $absent = @($KEEP_ASSET_VERSIONS | Where-Object { $allDirs -notcontains $_ })
    if ($absent.Count -gt 0) {
        Stop-Build ('minecraft-assets 里没有这些要保留的目录：{0}' -f ($absent -join ', ')) `
                   @(('该包实际有：' + ($allDirs -join ', ')),
                     '请更新 $KEEP_ASSET_VERSIONS。写错版本号不会报错，只会让面板图标全变问号。')
    }
    $kept = @()
    Get-ChildItem -LiteralPath $assetsData -Directory -Force | ForEach-Object {
        if ($KEEP_ASSET_VERSIONS -contains $_.Name) { $kept += $_.Name }
        else { Remove-Tree $_.FullName }
    }
    $saved = $before - (Get-TreeSize $assetsData)
    $script:SavedTotal += $saved
    Write-Ok ('minecraft-assets 贴图，只留 {0}   −{1}' -f ($kept -join '/'), (Format-Size $saved))
} else {
    Write-Alert ' 没找到 minecraft-assets\data（上游改布局了？跳过）。'
}

Remove-Reported (Join-Path $NM 'typescript') 'node_modules\typescript'
# ★ 删的是 app\node_modules\npm（依赖树里的那份），不是便携 Node 自带的
#   node\node_modules\npm —— 后者是 npm.cmd 的本体，删了以后就没法再 npm ci。
Remove-Reported (Join-Path $NM 'npm') 'node_modules\npm'

# ★ 截图管线的包整片保护，一个字节都不动。
#   截图经 ws 48909 推给 N.E.K.O. 主 agent，是核心功能，不是"可选的可视化"。
$visionPkgs = @('prismarine-viewer', 'three', 'gl', 'canvas', 'node-canvas-webgl')
Write-Ok ('保护不动：' + ($visionPkgs -join '、') + '（截图管线依赖）')
$sweepFreed = Invoke-ModuleSweep -NodeModules $NM -Protect $visionPkgs
$script:SavedTotal += $sweepFreed
Write-Ok ('node_modules 里的 *.md / *.map / test|docs 目录   −{0}' -f (Format-Size $sweepFreed))

$sizeAfterSlim = Get-TreeSize $NM
Write-Ok ('node_modules：{0}  →  {1}（共省 {2}）' -f (Format-Size $sizeBeforeSlim), (Format-Size $sizeAfterSlim), (Format-Size $script:SavedTotal))

# ═════════════════════════════════════════════════════════════════════════════
# 10. 铺开用户层
#
# ★ 这一层的文件**只在包根有一份**，app\ 里绝不留副本。
#   历史投诉"内外各一份、改了不生效"的根治点就在这里：下面用的是 Move，不是 Copy。
# ═════════════════════════════════════════════════════════════════════════════
Write-Step '铺开用户层（包根）'

# 10a. bot.json —— 由 app\neko.json 搬过来，顺手把皮肤路径从开发机绝对路径改成相对写法。
#      用 node 改写而不是 PowerShell 的 ConvertTo-Json：
#        · 保证输出是 UTF-8 **无 BOM**（main.js 读 profile 是裸 JSON.parse，带 BOM 当场抛）
#        · 保证 conversing 那一大段提示词里的转义原样保真
$nekoSrc = Join-Path $AppDir 'neko.json'
if (-not (Test-Path -LiteralPath $nekoSrc)) { Stop-Build 'app\neko.json 不见了，没法生成 bot.json。' }

# ★2026-09-07 改：默认配置落到 app\defaults\，不再直接放包根。
#   升级分发包的自然做法是「把新 zip 覆盖解压到原目录」；bot.json / settings.json
#   要是躺在包根，这一下就把用户的 bot 名字、人设、模型选择、局域网端口全盖回出厂值。
#   放进 app\defaults\ 当种子，首次启动由 bootstrap.js 播种到包根（且只在缺文件时），
#   覆盖解压就只换 app\，用户层一个字节都不动。
$defaultsDir = Join-Path $AppDir 'defaults'
New-Item -ItemType Directory -Path $defaultsDir -Force | Out-Null
$botDst    = Join-Path $defaultsDir 'bot.json'
$editorJs  = Join-Path ([System.IO.Path]::GetTempPath()) ('mc-agent-mkbot-{0}.cjs' -f $PID)
$editorSrc = @'
const fs = require('fs');
const [src, dst] = process.argv.slice(2);
let raw = fs.readFileSync(src, 'utf8');
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
const o = JSON.parse(raw);

// 皮肤：开发机绝对路径 → 相对包根的写法（agent.js 用 expandUserPath 展开成绝对路径
// 再发给服务端的 FabricTailor —— 路径是**服务端**解析的，所以必须展开，不能直接发相对路径）
if (o.skin && typeof o.skin === 'object') o.skin.path = 'skins/neko-skin.png';

// 模型：清空。仓库里 neko.json 钉的是开发机在用的 OpenAI 模型，直接发给玩家会让首次
// 启动提示"缺 OpenAI 密钥"——而这个包主要面向用国内供应商的玩家。清空之后 main.js 会
// 走"还没有选择 AI 供应商"这一支，把人直接引到控制面板的「AI 配置」页去选，这才是
// 我们想要的首启动路径。玩家在面板里选好供应商后，面板会把这几个字段写回来。
o.model = '';
o.code_model = '';
delete o.vision_model;
o.thinking = 'off';       // 默认关思考（低延迟动作 > 长篇推理）

fs.writeFileSync(dst, JSON.stringify(o, null, 4), 'utf8');
'@
[System.IO.File]::WriteAllText($editorJs, $editorSrc, (New-Object System.Text.UTF8Encoding $false))
& $NodeExe $editorJs $nekoSrc $botDst
if ($LASTEXITCODE -ne 0) { Stop-Build '生成 bot.json 失败。' }
Remove-Tree $editorJs
Remove-Tree $nekoSrc
if (-not (Test-Path -LiteralPath $botDst)) { Stop-Build 'bot.json 没生成出来。' }
Write-Ok 'bot.json 已生成（skin.path 改写为 skins/neko-skin.png），app\neko.json 已移除。'

# 10b. skins\ —— 整个搬到包根
$skinSrc = Join-Path $AppDir 'skins'
if (-not (Test-Path -LiteralPath $skinSrc)) { Stop-Build 'app\skins 不见了。' }
Move-Item -LiteralPath $skinSrc -Destination (Join-Path $OutDir 'skins') -Force
if (-not (Test-Path -LiteralPath (Join-Path $OutDir 'skins\neko-skin.png'))) {
    Stop-Build 'skins\neko-skin.png 没搬过来。'
}
Write-Ok 'skins\ 已搬到包根，app\skins 已移除。'

# 10c. settings.json —— 面向玩家的初始覆盖层。
#      main.js 会把这里的键**覆盖**到 app\settings.js 的默认值上（下划线开头的键跳过，
#      所以中文说明可以直接写在文件里）。写 UTF-8 无 BOM。
$settingsJson = @'
{
    "_说明": "这是给你改的设置文件。程序自带的默认值在 app\\settings.js 里（那份别动），这里写什么就覆盖什么。改完保存、重启程序生效。下划线开头的说明字段程序会自动跳过，可以随便留着。",

    "_说明_游戏连接": "填你自己那局 Minecraft 的地址和端口。单人存档按 ESC 选「对局域网开放」之后，游戏聊天框会打出一行「本地游戏已在 xxxxx 端口开启」，把那个数字填到下面的 port。注意：每次重新开放局域网，端口都会变，记得回来改（也可以直接在控制面板的「游戏连接」页里改）。",
    "host": "localhost",
    "port": 25565,

    "_说明_控制面板": "程序启动后会自动在浏览器打开控制面板。不想让它自动弹就把 auto_open_ui 改成 false，自己访问 http://localhost:8765 一样用。",
    "auto_open_ui": true,
    "mindserver_port": 8765
}
'@
[System.IO.File]::WriteAllText((Join-Path $defaultsDir 'settings.json'), $settingsJson, (New-Object System.Text.UTF8Encoding $false))
Write-Ok 'app\defaults\settings.json 已写入（首启动播种到包根；端口是占位值）。'

# 10d. 启动.bat / 使用说明.txt / 启动脚本的中文提示文案
#
# ★ 启动.bat 必须是**纯 ASCII + CRLF**，中文一律放在 app\dist-msg\*.txt 里用 type 打出来。
#   实测（2026-08-07, Win11）：中文直接写在 .bat 里，在下面 18 种组合里**全部**失败 ——
#       {UTF-8 带 BOM, UTF-8 不带 BOM, GBK} × {chcp 65001, chcp 936, 不 chcp}
#       × {控制台代码页 936, 65001}
#   症状是 cmd 的批处理解析器在多字节字符上把文件偏移算错，从行中间继续解析，
#   把后半句当命令执行（'xxxx' 不是内部或外部命令）。加 BOM 不解决问题。
#   唯一可行的组合是：.bat 纯 ASCII + chcp 65001 + type 一个 UTF-8(无 BOM) 文件。
#   另外 .bat 必须是 CRLF 换行 —— LF 换行会让 `goto :label` 报
#   "The system cannot find the batch label specified"（实测踩到过）。
#   下面这两条断言就是防止有人好心把中文"补"回 .bat 里。
$distTpl = Join-Path $PSScriptRoot 'dist'
foreach ($f in @('启动.bat', '使用说明.txt')) {
    $src = Join-Path $distTpl $f
    if (-not (Test-Path -LiteralPath $src)) { Stop-Build ('模板不见了：' + $src) }
    Copy-Item -LiteralPath $src -Destination (Join-Path $OutDir $f) -Force
}

$batBytes = [System.IO.File]::ReadAllBytes((Join-Path $OutDir '启动.bat'))
$nonAscii = @($batBytes | Where-Object { $_ -gt 127 }).Count
if ($nonAscii -gt 0) {
    Stop-Build ('启动.bat 里有 {0} 个非 ASCII 字节。' -f $nonAscii) `
               @('cmd.exe 的批处理解析器会在多字节字符上错位，把中文写进 .bat 必然坏。',
                 '请把中文挪到 tools\dist\msg\*.txt，在 .bat 里用 type 打出来。')
}
$loneLf = 0
for ($i = 0; $i -lt $batBytes.Length; $i++) {
    if ($batBytes[$i] -eq 10 -and ($i -eq 0 -or $batBytes[$i - 1] -ne 13)) { $loneLf++ }
}
if ($loneLf -gt 0) {
    Stop-Build ('启动.bat 有 {0} 处 LF 换行（必须是 CRLF）。' -f $loneLf) `
               @('LF 换行会让 goto :label 报 "cannot find the batch label specified"。',
                 '仓库根 .gitattributes 已给 tools/dist/** 声明 eol=crlf，检查 checkout 是否正常。')
}

$msgSrc = Join-Path $distTpl 'msg'
$msgDst = Join-Path $AppDir 'dist-msg'
New-Item -ItemType Directory -Path $msgDst -Force | Out-Null
foreach ($m in @('startup.txt', 'stopped.txt', 'crashed.txt', 'incomplete.txt')) {
    $src = Join-Path $msgSrc $m
    if (-not (Test-Path -LiteralPath $src)) { Stop-Build ('启动提示文案不见了：' + $src) }
    # UTF-8 必须无 BOM：type 会把 BOM 原样吐到屏幕上，变成开头三个乱码字符
    $head = [System.IO.File]::ReadAllBytes($src)
    if ($head.Length -ge 3 -and $head[0] -eq 0xEF -and $head[1] -eq 0xBB -and $head[2] -eq 0xBF) {
        Stop-Build ('{0} 带了 UTF-8 BOM。' -f $m) @('type 会把 BOM 直接打到屏幕上。请存成 UTF-8 无 BOM。')
    }
    Copy-Item -LiteralPath $src -Destination (Join-Path $msgDst $m) -Force
}
Write-Ok '启动.bat（纯 ASCII / CRLF 已校验）、使用说明.txt、app\dist-msg\ 中文提示文案均已就位。'

# ★ 刻意**不**生成 keys.json：密钥一律走控制面板 GUI，首次启动 bootstrap.js 会自己建空壳。
#   打包机器上的 keys.json 是真密钥，任何"顺手复制一份"的写法都是泄密。

# 10e. 用户层完整性 + "只有一份"断言
#
# ★ app\ 里绝不能再留 neko.json / skins\：settings.js 的 profiles 里写的是 "./neko.json"，
#   main.js 的 resolveProfile 会依次试 homePath → appPath → 原样。只要 app\neko.json 还在，
#   它就会**赢过**包根的 bot.json —— 用户在 bot.json 里改名字改人设全部不生效，
#   这正是历史上"内外各一份、改了没用"那条投诉的机理。这两条断言就是焊死它。
foreach ($rel in @('skins\neko-skin.png', '启动.bat', '使用说明.txt')) {
    if (-not (Test-Path -LiteralPath (Join-Path $OutDir $rel))) { Stop-Build ('包根缺少 ' + $rel) }
}
# bot.json / settings.json 现在是**种子**，随 app\defaults\ 发行，首次启动由
# bootstrap.js 播种到包根。这样覆盖解压升级不会盖掉用户配置（见 bootstrap.seedUserFiles）。
foreach ($rel in @('defaults\bot.json', 'defaults\settings.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $AppDir $rel))) { Stop-Build ('app\' + $rel + ' 缺失 —— 新用户首次启动会没有配置文件。') }
}
foreach ($rel in @('neko.json', 'skins', 'bot.json', 'settings.json', 'keys.json')) {
    if (Test-Path -LiteralPath (Join-Path $AppDir $rel)) {
        Stop-Build ('app\{0} 不该存在 —— 用户层文件只能在包根有一份。' -f $rel) `
                   @('app\ 里留一份副本会在 resolveProfile 里赢过包根那份，',
                     '用户改了包根的 bot.json 却毫无效果（历史投诉的机理）。')
    }
}
Write-Ok '用户层完整；app\ 里没有残留副本。'

# ═════════════════════════════════════════════════════════════════════════════
# 11. 冒烟：node app\main.js --doctor
#
# 这是防止再打出"bot 是残废的"包的唯一机制手段 —— v0.1.2 就是因为技能目录找不到、
# customSkill 只 log 不抛，分发出去 63 个技能一个都没加载，而没人在打包时发现。
# ═════════════════════════════════════════════════════════════════════════════
Write-Step '冒烟自检（node app\main.js --doctor）'

# --doctor 只检「安装包完整性」（路径基准 / 技能可读 / 依赖可加载 / 渲染器可初始化），
# 密钥与 provider 选择属于**用户配置**，它只报告不计入退出码 —— 所以这里不需要再塞假
# 密钥骗过检查。（早先版本塞过一个假 OPENAI_API_KEY，那是把两类事情混在一起的补丁。）
Push-Location -LiteralPath $OutDir          # 模拟启动.bat 的 CWD = 包根
try { & $NodeExe (Join-Path $AppDir 'main.js') --doctor } finally { Pop-Location }
$doctorCode = $LASTEXITCODE

if ($doctorCode -ne 0) {
    Stop-Build ('自检未通过（退出码 {0}）。' -f $doctorCode) `
               @('上面标 FAIL 的那几行就是问题所在。绝对不要跳过这一步 ——',
                 '自检不过 = 打出来的 bot 是残废的，用户装了也用不了。')
}
Write-Ok '自检全部通过。'

# 自检时 bootstrap.js 会在包根建 keys.json 空壳和空的 bots\ 树，清掉，保持包干净
Remove-Tree (Join-Path $OutDir 'keys.json')
Remove-Tree (Join-Path $OutDir 'runtime-flags.json')
# 自检时 bootstrap 会从 app\defaults\ 播种出这两个文件 —— 清掉，让出厂包里不存在它们，
# 由用户机器上的首次启动去生成。留着的话覆盖解压升级又会把用户配置盖回出厂值。
Remove-Tree (Join-Path $OutDir 'bot.json')
Remove-Tree (Join-Path $OutDir 'settings.json')
Remove-Tree (Join-Path $OutDir 'bot.json.bak')
$botsDir = Join-Path $OutDir 'bots'
if (Test-Path -LiteralPath $botsDir) {
    $leftover = @(Get-ChildItem -LiteralPath $botsDir -Recurse -File -Force -ErrorAction SilentlyContinue).Count
    if ($leftover -eq 0) { Remove-Tree $botsDir }
    else { Write-Alert ('包根的 bots\ 里有 {0} 个文件残留，请人工确认是不是运行时产物。' -f $leftover) }
}
Write-Ok '已清掉自检产生的 keys.json / 空目录（首次启动程序会自己重建）。'

# ═════════════════════════════════════════════════════════════════════════════
# 12. 最终兜底扫描
# ═════════════════════════════════════════════════════════════════════════════
Write-Step '最终兜底扫描'
Invoke-SecretScan -Root $OutDir -Label '成品兜底扫描' -AllowList $ScanAllowList

# ═════════════════════════════════════════════════════════════════════════════
# 13. 打 zip
# ═════════════════════════════════════════════════════════════════════════════
$zipPath = ''
if ($NoZip) {
    Write-Step '跳过打 zip（-NoZip 或 -SkipNode 退回系统 Node）'
} else {
    Write-Step '打 zip'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zipPath = Join-Path $outParent ($PkgLabel + '.zip')
    Remove-Tree $zipPath
    try {
        # Compress-Archive 在十万级文件上慢到不可用，直接调 .NET
        # 第四个参数 $true = 把 $OutDir 这层目录本身也放进 zip，
        # 用户解压后会得到一个名叫「{0}」的文件夹而不是一地散文件。
        [System.IO.Compression.ZipFile]::CreateFromDirectory(
            $OutDir, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $true)
    } catch {
        Stop-Build ('打 zip 失败：' + $_.Exception.Message) `
                   @('如果报的是路径过长，把 -OutDir 换到更短的路径（比如 D:\b）再试。')
    }
    Write-Ok ('{0}   {1}' -f $zipPath, (Format-Size (Get-TreeSize $zipPath)))
    Write-Ok ('SHA256  ' + (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash)
    Write-Ok ('解压后会得到文件夹：' + (Split-Path -Leaf $OutDir))
}

# ═════════════════════════════════════════════════════════════════════════════
# 收尾
# ═════════════════════════════════════════════════════════════════════════════
$elapsed = (Get-Date) - $script:StartTime
Write-Host ''
Write-Host '════════════════════════════════════════════════════════════════' -ForegroundColor Green
Write-Host ('  构建完成：{0}' -f $PkgLabel) -ForegroundColor Green
Write-Host ('  包根      {0}   {1}' -f $OutDir, (Format-Size (Get-TreeSize $OutDir)))
if ($zipPath) { Write-Host ('  压缩包    {0}' -f $zipPath) }
# 别在这里无条件写 HEAD：-Source worktree 时包里装的是**未提交的工作区**，
# 只印 HEAD 会让人以为 zip 等价于那个 commit，追溯时按 commit 重建根本对不上。
Write-Host ('  来源      {0}' -f $SrcLabel)
Write-Host ('            HEAD {0}  {1}' -f $headSha, $headSubject)
Write-Host ('  耗时      {0:N1} 分钟' -f $elapsed.TotalMinutes)
Write-Host '════════════════════════════════════════════════════════════════' -ForegroundColor Green
Write-Host ''
Write-Host '  下一步：按 BUILD-WIN-ZIP.md 的「验收清单」在一台干净机器上实测一遍，再上传网盘。'
Write-Host ''
exit 0
