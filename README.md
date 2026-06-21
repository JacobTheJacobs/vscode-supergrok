# Grok CLI Copilot

[![Microsoft VS Code Marketplace](https://img.shields.io/badge/Microsoft-VS%20Code%20Marketplace-0078D4?style=for-the-badge&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMyAyMyI%2BPHBhdGggZmlsbD0iI0YyNTAyMiIgZD0iTTEgMWgxMHYxMEgxeiIvPjxwYXRoIGZpbGw9IiM3RkJBMDAiIGQ9Ik0xMiAxaDEwdjEwSDEyeiIvPjxwYXRoIGZpbGw9IiMwMEE0RUYiIGQ9Ik0xIDEyaDEwdjEwSDF6Ii8%2BPHBhdGggZmlsbD0iI0ZGQjkwMCIgZD0iTTEyIDEyaDEwdjEwSDEyeiIvPjwvc3ZnPg%3D%3D)](https://marketplace.visualstudio.com/items?itemName=jacobthejacobs.grok-cli-copilot)
[![VS Code](https://img.shields.io/badge/VS%20Code-Install-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=jacobthejacobs.grok-cli-copilot)
[![GitHub](https://img.shields.io/badge/GitHub-vscode--supergrok-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/JacobTheJacobs/vscode-supergrok)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-3DA639?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)

> **Not an official xAI product.** Independent, community-built, and held together by
> TypeScript and reasonable intentions. It drives your **local Grok CLI** over stdio.
> Not affiliated with, endorsed by, or published by xAI — there is no official Grok
> extension from xAI for VS Code, which is roughly why this one exists. "Grok" is a
> trademark of xAI, borrowed here only to describe what this talks to.

A focused VS Code sidebar that puts the local Grok CLI where you already live —
next to your code, instead of in yet another browser tab.

[![Grok CLI Copilot screenshot](image.png)](https://marketplace.visualstudio.com/items?itemName=jacobthejacobs.grok-cli-copilot)

[![Grok CLI Copilot — connected and ready](image-2.png)](https://marketplace.visualstudio.com/items?itemName=jacobthejacobs.grok-cli-copilot)

## Requirements

- The **Grok CLI**, installed and signed in (it does the actual thinking)

## Setup — log in to the Grok CLI first

This extension is a friendly face for the Grok CLI. No CLI, no face. Install and
sign in **before** opening the sidebar, otherwise it sits there loading models
with the patience of a saint and the results of a brick.

1. Install the Grok CLI:
   - Windows (PowerShell): `irm https://x.ai/cli/install.ps1 | iex`
   - macOS / Linux: `curl -fsSL https://x.ai/cli/install.sh | bash`
2. Log in (opens a browser):

   ```bash
   grok login
   ```
3. Open VS Code → the **Super Grok** sidebar and start grokking. (If the CLI isn't
   on your `PATH`, point `grok.cliPath` at it in Settings.)

## Install

- Marketplace: [open the listing](https://marketplace.visualstudio.com/items?itemName=jacobthejacobs.grok-cli-copilot)
- VSIX, for the impatient:

  ```bash
  npm run package
  code --install-extension grok-cli-copilot-*.vsix
  ```

## Features

- chat with the local Grok CLI without leaving your editor
- session history and quick switching, because you will lose track
- slash commands (with search) and effort control — dial the reasoning up or down
- file/folder context, `@` mentions, and image paste
- inline generated media, thinking blocks, and permission cards (it asks before it touches anything)

## Settings

- `grok.cliPath` — where the CLI lives, for when auto-detect gives up
- `grok.defaultModel`
- `grok.defaultEffort`
- `grok.includeActiveFileByDefault`
- `grok.useCtrlEnterToSend`

## License

MIT
