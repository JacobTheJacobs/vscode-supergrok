#!/usr/bin/env bash
# Uninstall the Grok CLI Copilot extension on macOS / Linux / WSL.
# Usage:  ./scripts/uninstall.sh

set -euo pipefail

find_code_cli() {
    for name in code code-insiders; do
        if command -v "$name" >/dev/null 2>&1; then
            echo "$name"; return 0
        fi
    done
    for path in \
        "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
        "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders" \
    ; do
        [ -x "$path" ] && { echo "$path"; return 0; }
    done
    echo "Could not find VS Code CLI." >&2
    return 1
}

code=$(find_code_cli)
echo "Uninstalling JacobTheJacobs.grok-cli-copilot via $code"
"$code" --uninstall-extension JacobTheJacobs.grok-cli-copilot
echo
echo "Done. Reload VS Code to drop the sidebar."
