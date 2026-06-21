#!/usr/bin/env bash
# Install the Grok CLI Copilot extension on macOS / Linux / WSL.
# Usage:  ./scripts/install.sh [path/to/file.vsix]
# Picks the first .vsix in the repo root, or builds one if none exists.

set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"

find_code_cli() {
    for name in code code-insiders; do
        if command -v "$name" >/dev/null 2>&1; then
            echo "$name"; return 0
        fi
    done
    # macOS install paths
    for path in \
        "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
        "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders" \
    ; do
        [ -x "$path" ] && { echo "$path"; return 0; }
    done
    echo "Could not find VS Code CLI. Install VS Code or add 'code' to PATH." >&2
    return 1
}

vsix="${1-}"
if [ -z "$vsix" ]; then
    # Always rebuild so the installed extension is never stale
    cd "$repo_root"
    [ -d node_modules ] || pnpm install
    pnpm run package
    vsix=$(ls -t "$repo_root"/*.vsix | head -n1)
fi
[ -f "$vsix" ] || { echo "vsix not found: $vsix" >&2; exit 1; }

code=$(find_code_cli)
echo "Installing $vsix via $code"
# --force so a same-version reinstall actually overwrites the installed files
"$code" --install-extension "$vsix" --force
echo
echo "Done. Reload VS Code (Ctrl+Shift+P -> 'Developer: Reload Window') and click the Grok CLI Copilot icon."
