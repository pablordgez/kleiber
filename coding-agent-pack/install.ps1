#requires -version 5.1
$ErrorActionPreference = "Stop"

$Mode = "project"
$Root = (Get-Location).Path
$LinkMode = "link"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BundleRoot = $ScriptDir

$Agents = @(
    "requirements-engineer",
    "brainstormer",
    "requirements-refiner",
    "architect",
    "security-analyst",
    "ui-ux-designer",
    "task-planner",
    "project-manager",
    "documentation-writer",
    "specification-reviewer",
    "security-reviewer",
    "test-engineer",
    "field-tester",
    "project-spec-utils"
)

$Commands = @{
    "requirements-engineer"   = "requirements"
    "brainstormer"            = "brainstorm"
    "requirements-refiner"    = "refine-requirements"
    "architect"               = "architect"
    "security-analyst"        = "security-plan"
    "ui-ux-designer"          = "uiux"
    "task-planner"            = "task-plan"
    "project-manager"         = "execute-plan"
    "documentation-writer"    = "write-docs"
    "specification-reviewer"  = "review-spec"
    "security-reviewer"       = "review-security"
    "test-engineer"           = "test-engineer"
    "field-tester"            = "field-test"
}

function Show-Usage {
@"
Usage: .\install.ps1 [--mode project|global] [--root PATH] [--copy]

Options:
  --mode   Install into a project directory (default) or user-global locations.
  --root   Project root for --mode project. Defaults to current directory.
  --copy   Copy files instead of creating links where possible.
"@ | Write-Host
}

function Parse-Args {
    param([string[]]$ArgsToParse)

    $i = 0
    while ($i -lt $ArgsToParse.Count) {
        $arg = $ArgsToParse[$i]

        switch ($arg) {
            "--mode" {
                if ($i + 1 -ge $ArgsToParse.Count) {
                    throw "Missing value for --mode"
                }
                $script:Mode = $ArgsToParse[$i + 1]
                $i += 2
            }
            "--root" {
                if ($i + 1 -ge $ArgsToParse.Count) {
                    throw "Missing value for --root"
                }
                $script:Root = $ArgsToParse[$i + 1]
                $i += 2
            }
            "--copy" {
                $script:LinkMode = "copy"
                $i += 1
            }
            "-h" {
                Show-Usage
                exit 0
            }
            "--help" {
                Show-Usage
                exit 0
            }
            default {
                throw "Unknown option: $arg"
            }
        }
    }
}

function Ensure-Directory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Remove-Existing {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $item = Get-Item -LiteralPath $Path -Force
    $isReparsePoint = (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)

    if ($isReparsePoint) {
        Remove-Item -LiteralPath $Path -Force
    } else {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
}

function Copy-File {
    param(
        [Parameter(Mandatory = $true)][string]$Src,
        [Parameter(Mandatory = $true)][string]$Dst
    )

    if (-not (Test-Path -LiteralPath $Src)) {
        throw "Source file not found: $Src"
    }

    $parent = Split-Path -Parent $Dst
    Ensure-Directory $parent
    Copy-Item -LiteralPath $Src -Destination $Dst -Force
}

function Install-Path {
    param(
        [Parameter(Mandatory = $true)][string]$Src,
        [Parameter(Mandatory = $true)][string]$Dst
    )

    if (-not (Test-Path -LiteralPath $Src)) {
        throw "Source path not found: $Src"
    }

    $parent = Split-Path -Parent $Dst
    Ensure-Directory $parent
    Remove-Existing $Dst

    if ($script:LinkMode -eq "copy") {
        Copy-Item -LiteralPath $Src -Destination $Dst -Recurse -Force
        return
    }

    $resolvedSrc = (Resolve-Path -LiteralPath $Src).Path

    try {
        # Use a junction for directory links on Windows.
        $null = cmd.exe /c "mklink /J `"$Dst`" `"$resolvedSrc`"" 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "mklink failed with exit code $LASTEXITCODE"
        }
    } catch {
        Write-Warning "Could not create link for '$Dst'. Falling back to copy. $($_.Exception.Message)"
        Copy-Item -LiteralPath $Src -Destination $Dst -Recurse -Force
    }
}

function Write-GitKeep {
    param([Parameter(Mandatory = $true)][string]$Dir)

    Ensure-Directory $Dir
    $gitkeep = Join-Path $Dir ".gitkeep"
    Set-Content -LiteralPath $gitkeep -Value "" -NoNewline
}

function Install-SkillFamily {
    param(
        [Parameter(Mandatory = $true)][string]$SkillRootSrc,
        [Parameter(Mandatory = $true)][string]$SkillRootDst
    )

    Ensure-Directory $SkillRootDst

    foreach ($agent in $Agents) {
        $src = Join-Path $SkillRootSrc $agent
        $dst = Join-Path $SkillRootDst $agent
        Install-Path -Src $src -Dst $dst
    }
}

function Install-Wrappers {
    param(
        [Parameter(Mandatory = $true)][string]$CodexAgentsDir,
        [Parameter(Mandatory = $true)][string]$ClaudeAgentsDir,
        [Parameter(Mandatory = $true)][string]$OpenCodeAgentsDir,
        [Parameter(Mandatory = $true)][string]$OpenCodeCommandsDir,
        [Parameter(Mandatory = $true)][string]$GeminiAgentsDir,
        [Parameter(Mandatory = $true)][string]$GeminiCommandsDir
    )

    Ensure-Directory $CodexAgentsDir
    Ensure-Directory $ClaudeAgentsDir
    Ensure-Directory $OpenCodeAgentsDir
    Ensure-Directory $OpenCodeCommandsDir
    Ensure-Directory $GeminiAgentsDir
    Ensure-Directory $GeminiCommandsDir

    foreach ($agent in $Agents) {
        if ($agent -eq "project-spec-utils") {
            continue
        }

        $commandName = $Commands[$agent]

        Copy-File `
            -Src (Join-Path $BundleRoot "templates\codex\agents\$agent.toml") `
            -Dst (Join-Path $CodexAgentsDir "$agent.toml")

        Copy-File `
            -Src (Join-Path $BundleRoot "templates\claude\agents\$agent.md") `
            -Dst (Join-Path $ClaudeAgentsDir "$agent.md")

        Copy-File `
            -Src (Join-Path $BundleRoot "templates\opencode\agents\$agent.md") `
            -Dst (Join-Path $OpenCodeAgentsDir "$agent.md")

        Copy-File `
            -Src (Join-Path $BundleRoot "templates\opencode\commands\$commandName.md") `
            -Dst (Join-Path $OpenCodeCommandsDir "$commandName.md")

        Copy-File `
            -Src (Join-Path $BundleRoot "templates\gemini\agents\$agent.md") `
            -Dst (Join-Path $GeminiAgentsDir "$agent.md")

        Copy-File `
            -Src (Join-Path $BundleRoot "templates\gemini\commands\$commandName.toml") `
            -Dst (Join-Path $GeminiCommandsDir "$commandName.toml")
    }
}

function Get-OpenCodeGlobalRoots {
    $roots = New-Object System.Collections.Generic.List[string]

    if ($env:APPDATA) {
        $roots.Add((Join-Path $env:APPDATA "opencode"))
    }

    $roots.Add((Join-Path $HOME ".config\opencode"))

    return $roots | Select-Object -Unique
}

function Install-Project {
    $projectRoot = [System.IO.Path]::GetFullPath($script:Root)

    if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) {
        throw "Project root does not exist or is not a directory: $projectRoot"
    }

    Install-SkillFamily `
        -SkillRootSrc (Join-Path $BundleRoot "shared\.agents\skills") `
        -SkillRootDst (Join-Path $projectRoot ".agents\skills")

    Install-SkillFamily `
        -SkillRootSrc (Join-Path $projectRoot ".agents\skills") `
        -SkillRootDst (Join-Path $projectRoot ".claude\skills")

    Install-SkillFamily `
        -SkillRootSrc (Join-Path $projectRoot ".agents\skills") `
        -SkillRootDst (Join-Path $projectRoot ".gemini\skills")

    Install-Wrappers `
        -CodexAgentsDir (Join-Path $projectRoot ".codex\agents") `
        -ClaudeAgentsDir (Join-Path $projectRoot ".claude\agents") `
        -OpenCodeAgentsDir (Join-Path $projectRoot ".opencode\agents") `
        -OpenCodeCommandsDir (Join-Path $projectRoot ".opencode\commands") `
        -GeminiAgentsDir (Join-Path $projectRoot ".gemini\agents") `
        -GeminiCommandsDir (Join-Path $projectRoot ".gemini\commands")

    $agentSpecsDir = Join-Path $projectRoot ".agent_specs"
    Write-GitKeep $agentSpecsDir

    $configDst = Join-Path $agentSpecsDir "agent_pack_config.example.yaml"
    if (-not (Test-Path -LiteralPath $configDst)) {
        Copy-File `
            -Src (Join-Path $BundleRoot "shared\.agents\agent_pack_config.example.yaml") `
            -Dst $configDst
    }

    Write-Host "Installed project-local coding agent pack into: $projectRoot"
}

function Install-Global {
    $homeDir = [System.IO.Path]::GetFullPath($HOME)

    Install-SkillFamily `
        -SkillRootSrc (Join-Path $BundleRoot "shared\.agents\skills") `
        -SkillRootDst (Join-Path $homeDir ".agents\skills")

    Install-SkillFamily `
        -SkillRootSrc (Join-Path $homeDir ".agents\skills") `
        -SkillRootDst (Join-Path $homeDir ".claude\skills")

    Install-SkillFamily `
        -SkillRootSrc (Join-Path $homeDir ".agents\skills") `
        -SkillRootDst (Join-Path $homeDir ".gemini\skills")

    $openCodeRoots = Get-OpenCodeGlobalRoots
    foreach ($openCodeRoot in $openCodeRoots) {
        Install-Wrappers `
            -CodexAgentsDir (Join-Path $homeDir ".codex\agents") `
            -ClaudeAgentsDir (Join-Path $homeDir ".claude\agents") `
            -OpenCodeAgentsDir (Join-Path $openCodeRoot "agents") `
            -OpenCodeCommandsDir (Join-Path $openCodeRoot "commands") `
            -GeminiAgentsDir (Join-Path $homeDir ".gemini\agents") `
            -GeminiCommandsDir (Join-Path $homeDir ".gemini\commands")
    }

    Write-Host "Installed global coding agent pack into user harness locations."
}

try {
    Parse-Args -ArgsToParse $args

    switch ($Mode) {
        "project" { Install-Project }
        "global"  { Install-Global }
        default {
            throw "Invalid --mode: $Mode"
        }
    }
} catch {
    Write-Error $_.Exception.Message
    Show-Usage
    exit 1
}