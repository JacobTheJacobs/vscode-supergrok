# Security Policy

This is an independent, community-built VS Code extension that drives the **local
Grok CLI** over stdio. It has no backend service and no runtime dependencies.

## Reporting a vulnerability

Please report security issues **privately** — don't open a public issue with
exploit details.

- Preferred: GitHub → the repo's **Security** tab → **Report a vulnerability**
  (private advisory). Requires "Private vulnerability reporting" to be enabled in
  the repo settings.
- Alternatively, open a minimal report at
  <https://github.com/JacobTheJacobs/vscode-supergrok/issues> noting it is a
  security issue, and we'll move it to a private advisory.

Please allow a reasonable window for a fix before any public disclosure.

## Scope

**In scope:** the extension code in this repository — the VS Code webview and the
ACP client that talks to the Grok CLI over stdio.

**Out of scope:** the Grok CLI itself and xAI's services. Report those to xAI.
