# Changelog

Notable changes to Grok CLI Copilot.

This file starts at 3.1.35. Earlier releases shipped without itemised notes and
are not reconstructed here rather than guessed at.

## [3.1.35]

### Changed

- **The thinking line is a single step, not a panel.** Reasoning used to render
  as an expanded bordered block on every turn, pushing the answer down the view.
  It is now one dim row — a dot, a rotating status verb, and a token count —
  with the full trace one click away.
- **Steps sit on a vertical rail.** Thinking and tool activity read as
  consecutive entries on one line, each marked with a dot, instead of a stack of
  separate cards.

### Fixed

- **Tool blocks no longer strand themselves under a finished answer.** When a
  turn interleaved text, tool calls, and more text, the final reply stayed in
  the first bubble — which sits above the tool group — so "Ran N commands"
  appeared *after* the response. A new bubble now starts below the tool group.
- Cancelling a turn, or a plan reset, left tool groups spinning and the thinking
  header animating forever. Both now settle.
- Token counts under 1,000 displayed as "0K".

### Added

- Live token count on the thinking line: an estimate while the model works
  (marked with `~`), replaced by the exact figure the moment the CLI reports
  usage.

### Internal

- Packaging no longer sweeps local tool directories into the `.vsix`.
- Packaging runs with `--no-dependencies`; the extension declares no runtime
  dependencies, and the default dependency walk produced an empty file list.
- 117 tests, including DOM coverage for the message-ordering and thinking-line
  behaviour above.
