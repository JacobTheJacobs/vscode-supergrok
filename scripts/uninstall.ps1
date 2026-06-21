# Uninstall the Grok CLI Copilot extension on Windows.
# Usage:  pwsh scripts\uninstall.ps1

$ErrorActionPreference = "Stop"

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

$code = Find-CodeCli
Write-Host "Uninstalling JacobTheJacobs.grok-cli-copilot via $code"
& $code --uninstall-extension JacobTheJacobs.grok-cli-copilot
Write-Host ""
Write-Host "Done. Reload VS Code to drop the sidebar."
