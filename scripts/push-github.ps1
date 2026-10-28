<#
  一键推送到 GitHub

  用法（在本机网络能通 github.com 的时候执行）：

    # 方式 A：用浏览器登录的凭证（推荐，不落盘 Token）
    .\scripts\push-github.ps1 -Repo https://github.com/你的用户名/SerialMind.git

    # 方式 B：用 Personal Access Token（网络恢复后临时用）
    $env:GITHUB_TOKEN = "ghp_xxx"
    .\scripts\push-github.ps1 -Repo https://github.com/你的用户名/SerialMind.git -UseToken

  前提：
    - GitHub 上已经建好空仓库（不要勾选 README / .gitignore / license，否则要先 pull）
    - 能访问 github.com

  说明：
    脚本只做 remote 配置 + push，不会改写历史，也不会删除本地文件。
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Repo,

  [string]$Branch = "main",

  [switch]$UseToken,

  [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

function Info($m) { Write-Host "  $m" }
function Ok($m) { Write-Host "  [OK] $m" -ForegroundColor Green }
function Bad($m) { Write-Host "  [X]  $m" -ForegroundColor Red }

Write-Host ""
Write-Host "SerialMind -> GitHub" -ForegroundColor Cyan
Write-Host ("-" * 52)

# 1. 基本检查
if (-not (Test-Path ".git")) {
  Bad "当前目录不是 git 仓库：$(Get-Location)"
  exit 1
}

$repoUrl = $Repo.Trim()
if ($repoUrl -notmatch '^https://github\.com/.+/.+?\.git$') {
  if ($repoUrl -match '^https://github\.com/[^/]+/[^/]+$') {
    $repoUrl = "$repoUrl.git"
    Info "已补全 .git 后缀：$repoUrl"
  } else {
    Bad "仓库地址格式不对，应形如 https://github.com/用户名/SerialMind.git"
    exit 1
  }
}

# 2. 网络检查
Info "检查 github.com 连通性…"
$reachable = $false
try {
  $null = Invoke-WebRequest "https://github.com" -UseBasicParsing -TimeoutSec 10
  $reachable = $true
} catch {
  $reachable = $false
}
if (-not $reachable) {
  Bad "连不上 github.com。请先解决网络（代理 / VPN），再重新运行本脚本。"
  Info "本地仓库已就绪，随时可以推："
  Info "  git remote add origin $repoUrl"
  Info "  git push -u origin $Branch"
  exit 2
}
Ok "github.com 可达"

# 3. 配 remote
$existing = git remote 2>$null
if ($existing -contains "origin") {
  git remote set-url origin $repoUrl | Out-Null
  Info "已更新 origin -> $repoUrl"
} else {
  git remote add origin $repoUrl | Out-Null
  Info "已添加 origin -> $repoUrl"
}

# 4. 确认工作区干净
$dirty = git status --porcelain
if ($dirty) {
  Info "有未提交改动，先自动提交…"
  git add -A | Out-Null
  git -c core.autocrlf=false commit -q -m "chore: 推送前自动提交" | Out-Null
  Ok "已提交"
}

# 5. 推送
Write-Host ""
Info "开始推送 $Branch …"

$pushArgs = @("push", "-u", "origin", $Branch)
if ($Force) { $pushArgs += "--force" }

if ($UseToken) {
  if (-not $env:GITHUB_TOKEN) {
    Bad "你用了 -UseToken，但没设置环境变量 GITHUB_TOKEN"
    Info '先在当前窗口执行： $env:GITHUB_TOKEN = "ghp_xxx"'
    exit 1
  }
  # 用临时 askpass 传 token，不写进 .git/config
  $askpass = Join-Path $env:TEMP "sm-askpass-$PID.cmd"
  @"
@echo off
echo %~1 | findstr /i "Username" >nul && (echo x-access-token) || (echo %GITHUB_TOKEN%)
"@ | Set-Content -Path $askpass -Encoding ASCII
  $env:GIT_ASKPASS = $askpass
  $env:GIT_TERMINAL_PROMPT = "0"
  try {
    & git @pushArgs
  } finally {
    Remove-Item $askpass -ErrorAction SilentlyContinue
    Remove-Item Env:GIT_ASKPASS -ErrorAction SilentlyContinue
    Remove-Item Env:GIT_TERMINAL_PROMPT -ErrorAction SilentlyContinue
  }
} else {
  & git @pushArgs
}

if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Ok "推送成功"
  $url = $repoUrl -replace '\.git$', ''
  Info "仓库地址：$url"
  Info "提交：$(git log --oneline -1)"
  exit 0
} else {
  Write-Host ""
  Bad "推送失败（退出码 $LASTEXITCODE）"
  Info "常见原因："
  Info "  · 仓库不存在 / 名字不对 -> 先到 GitHub 建空仓库"
  Info "  · 没权限 -> 用 -UseToken 并设置 GITHUB_TOKEN"
  Info "  · 远程已有提交 -> 先 git pull --rebase origin $Branch"
  exit 1
}
