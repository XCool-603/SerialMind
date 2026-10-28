<#
  SerialMind 推送脚本

  本机情况（已配好）：
    · remote origin = git@github.com:XCool-603/SerialMind.git
    · ~/.ssh/config 里把 github.com 指向 ssh.github.com:443（github.com:443 直连被墙）
    · SSH 公钥已登记到 GitHub

  日常推送：
    .\scripts\push-github.ps1
    .\scripts\push-github.ps1 -Message "feat: 新增 xxx"

  换仓库：
    .\scripts\push-github.ps1 -Repo git@github.com:用户名/仓库.git
#>
param(
  [string]$Repo,
  [string]$Branch = "main",
  [string]$Message,
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

if (-not (Test-Path ".git")) {
  Bad "当前目录不是 git 仓库：$(Get-Location)"
  exit 1
}

if ($Repo) {
  $url = $Repo.Trim()
  if ($url -match '^https://github\.com/([^/]+)/([^/]+?)(\.git)?$') {
    $url = "git@github.com:$($Matches[1])/$($Matches[2]).git"
    Info "已转成 SSH 地址：$url"
  }
  $existing = git remote 2>$null
  if ($existing -contains "origin") { git remote set-url origin $url | Out-Null } else { git remote add origin $url | Out-Null }
  Ok "origin -> $url"
}

$remote = git remote get-url origin 2>$null
if (-not $remote) {
  Bad "还没配 remote。先运行： .\scripts\push-github.ps1 -Repo git@github.com:用户名/仓库.git"
  exit 1
}
Info "remote: $remote"

$dirty = git status --porcelain
if ($dirty) {
  $msg = if ($Message) { $Message } else { "chore: 自动提交 $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
  git add -A | Out-Null
  git -c core.autocrlf=false commit -q -m $msg | Out-Null
  Ok "已提交：$msg"
} else {
  Info "工作区干净，无需提交"
}

if ($remote -match '^git@|^ssh://') {
  $t = Test-NetConnection -ComputerName ssh.github.com -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue
  if (-not $t) {
    Bad "连不上 ssh.github.com:443，检查网络 / 代理"
    exit 2
  }
  Ok "ssh.github.com:443 可达"
}

Write-Host ""
Info "推送 $Branch …"
$pushArgs = @("push", "-u", "origin", $Branch)
if ($Force) { $pushArgs += "--force" }
$env:GIT_SSH_COMMAND = "ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20"
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"   # git 把进度写 stderr，别当成异常
try {
  & git @pushArgs 2>&1 | ForEach-Object { Write-Host "  $_" }
  $code = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $prevEap
  Remove-Item Env:GIT_SSH_COMMAND -ErrorAction SilentlyContinue
}

if ($code -eq 0) {
  Write-Host ""
  Ok "推送成功"
  $web = $remote -replace '^git@github\.com:', 'https://github.com/' -replace '\.git$', ''
  Info "仓库：$web"
  Info "提交：$(git log --oneline -1)"
  exit 0
} else {
  Write-Host ""
  Bad "推送失败（退出码 $code）"
  Info "· 仓库不存在 / 没权限 -> 检查地址和 SSH key"
  Info "· 远程有本地没有的提交 -> 先 git pull --rebase origin $Branch"
  exit 1
}