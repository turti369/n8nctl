#requires -Version 5.0
<#
.SYNOPSIS
Install n8nctl Claude Code skills to ~/.claude/skills/

.DESCRIPTION
Copies SKILL.md files from this directory to the user's Claude Code
skills directory. Claude Code loads skills from ~/.claude/skills/
automatically.

.EXAMPLE
.\install.ps1                       # install all skills (prompts before overwrite)

.EXAMPLE
.\install.ps1 -Name n8nctl          # install a single skill

.EXAMPLE
.\install.ps1 -Force                # overwrite existing without prompt

.NOTES
Set $env:CLAUDE_SKILLS_DIR to install elsewhere.
#>

[CmdletBinding()]
param(
    [string[]]$Name,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = if ($env:CLAUDE_SKILLS_DIR) { $env:CLAUDE_SKILLS_DIR } else { Join-Path $HOME ".claude\skills" }

if (-not (Test-Path $target)) {
    New-Item -ItemType Directory -Path $target -Force | Out-Null
}

function Install-One {
    param([string]$SkillName)

    $src = Join-Path $scriptDir $SkillName
    $dst = Join-Path $target $SkillName

    if (-not (Test-Path $src -PathType Container)) {
        Write-Error "skill not found: $SkillName"
        return
    }

    if ((Test-Path $dst) -and (-not $Force)) {
        $reply = Read-Host "? overwrite existing '$SkillName'? (y/N)"
        if ($reply -notmatch '^[yY]') {
            Write-Host "  skipped $SkillName"
            return
        }
    }

    New-Item -ItemType Directory -Path $dst -Force | Out-Null
    Copy-Item -Path (Join-Path $src "SKILL.md") -Destination (Join-Path $dst "SKILL.md") -Force
    Write-Host "✓ installed $SkillName → $dst"
}

if ($Name) {
    foreach ($n in $Name) { Install-One $n }
    return
}

Get-ChildItem -Path $scriptDir -Directory | ForEach-Object {
    Install-One $_.Name
}

Write-Host ""
Write-Host "All skills installed to: $target"
Write-Host "Claude Code picks them up automatically on next session."
