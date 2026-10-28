<#
.SYNOPSIS
    把 Calicat 文件里的需求卡片拉回仓库 docs/，作为单一真源（Calicat 为主，仓库为镜像）。

.DESCRIPTION
    依赖本机已登录的 calicat CLI（`calicat status` 应显示 loggedIn: true）。
    卡片内容直接取自服务端，避免人工转述失真。

.EXAMPLE
    pwsh ./scripts/sync-calicat-docs.ps1
    pwsh ./scripts/sync-calicat-docs.ps1 -FileId 2112052273649823744
#>
param(
    [string]$FileId = '2112052273649823744'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$docs = Join-Path $root 'docs'
if (-not (Test-Path $docs)) { New-Item -ItemType Directory -Path $docs -Force | Out-Null }

# 卡片 prd_id -> 仓库文件。Dir 为空表示放 docs/ 根目录，否则放子目录。
# 约定：只有定稿放根目录，历史增量卡一律进 _archive。
$cards = @(
    @{ Id = '045d2911-e7f7-46be-b197-ba8329361c4f'; Dir = '';         Out = 'SerialMind-V1.0-定稿.md' }
    @{ Id = '8f140388-cec2-40e4-8a22-ed58b553c353'; Dir = '_archive'; Out = '01-产品与技术方案-V0.1.md' }
    @{ Id = '9c7ec9b0-1d07-45b8-85f9-e7c0558f2434'; Dir = '_archive'; Out = '02-项目模型与自动化测试-V0.2.md' }
    @{ Id = '978fd3f5-d7cc-4dba-ab41-6f4c64d7f951'; Dir = '_archive'; Out = '03-自动发送与事件驱动-V0.3.md' }
    @{ Id = '0d7786f4-158b-4537-a07b-58ba432a720e'; Dir = '_archive'; Out = '04-定位收敛与测试模型-V0.4.md' }
    @{ Id = '6a73a147-083f-448f-be1b-d006e3f374ba'; Dir = '_archive'; Out = '05-管理模块与AI边界-V0.5.md' }
    @{ Id = '937ca4f2-be43-4fc1-9afd-ba406f572b21'; Dir = '_archive'; Out = '06-层级定稿与本地优先-V0.6.md' }
)

foreach ($card in $cards) {
    $argsJson = '{\"file_id\":\"' + $FileId + '\",\"prd_id\":\"' + $card.Id + '\"}'
    $resp = (calicat tools-call --name get_prd_full_content --args $argsJson 2>&1 | Out-String) | ConvertFrom-Json

    if ($resp.isError) { throw "calicat 调用失败：$($card.Id)" }

    $inner = $resp.content[0].text | ConvertFrom-Json
    if ($inner.status -ne 'success') { throw "接口返回异常：$($inner.status)（$($card.Id)）" }

    $title = $inner.result.title
    $md = $inner.result.content

    # 服务端会自动在正文首行加一条同名 H1，去掉以免重复
    $prefix = "# $title"
    if ($md.StartsWith($prefix)) {
        $md = $md.Substring($prefix.Length).TrimStart("`r", "`n")
    }

    $dir = $docs
    if ($card.Dir) {
        $dir = Join-Path $docs $card.Dir
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    }
    $path = Join-Path $dir $card.Out
    # Windows PowerShell 5.1 的 Set-Content -Encoding utf8 会带 BOM，改用 .NET 写无 BOM UTF-8
    [System.IO.File]::WriteAllText($path, $md, (New-Object System.Text.UTF8Encoding($false)))
    $rel = if ($card.Dir) { "$($card.Dir)/$($card.Out)" } else { $card.Out }
    Write-Output ("{0,-42} <- {1}  ({2:N0} 字符)" -f $rel, $title, $md.Length)
}

Write-Output '同步完成。'
