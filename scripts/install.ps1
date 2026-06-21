# Install the Grok CLI Copilot extension on Windows.
# Usage:  pwsh scripts\install.ps1 [-VsixPath path\to.vsix]
# Always builds a FRESH .vsix from the current source (pnpm run package clears the
# stale one first) unless an explicit -VsixPath is given — so an install never
# silently ships a leftover build. Tries `code`, then `code-insiders`, then the
# well-known install path, and uses --force so a same-version reinstall overwrites.

param(
    [string]$VsixPath
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Find-CodeCli {
    foreach ($name in @("code", "code-insiders")) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    $fallback = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
    if (Test-Path $fallback) { return $fallback }
    $fallback = "$env:LOCALAPPDATA\Programs\Microsoft VS Code Insiders\bin\code-insiders.cmd"
    if (Test-Path $fallback) { return $fallback }
    throw "Could not find VS Code CLI. Install VS Code or add 'code' to PATH."
}

if (-not $VsixPath) {
    Write-Host "Building a fresh .vsix from current source..."
    Push-Location $repoRoot
    try {
        if (-not (Test-Path "node_modules")) { pnpm install }
        pnpm run package   # clears stale *.vsix first, then builds
        $vsix = Get-ChildItem -Path $repoRoot -Filter "*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    } finally { Pop-Location }
    if (-not $vsix) { throw "Build did not produce a .vsix." }
    $VsixPath = $vsix.FullName
}

$code = Find-CodeCli
Write-Host "Installing $VsixPath via $code"
& $code --install-extension $VsixPath --force
Write-Host ""
Write-Host "Done. Reload VS Code (Ctrl+Shift+P -> 'Developer: Reload Window') and click the Grok CLI Copilot icon."
