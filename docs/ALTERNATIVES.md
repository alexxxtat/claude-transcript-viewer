# Other tools that read Claude Code transcripts

This is a crowded field. Every one of these is worth a look, and several are more featured.

| | What it is |
|---|---|
| [claude-code-log](https://github.com/daaain/claude-code-log) | Python CLI and TUI, token tracking, cross-session index pages |
| [claude-code-transcripts](https://github.com/simonw/claude-code-transcripts) | Paginated, timeline-oriented, publishes to GitHub Gist |
| [claude-code-history-viewer](https://github.com/jhlee0409/claude-code-history-viewer) | Electron desktop app, also reads Codex and OpenCode |
| [claude-history](https://github.com/raine/claude-history) | Rust TUI, fuzzy search |
| [search-sessions](https://github.com/sinzin91/search-sessions) | Sub-second search CLI across all sessions |
| [ccusage](https://github.com/ryoppippi/ccusage) | The token and cost side, which this deliberately does not do |
| [Claude Code Sync](https://community.obsidian.md/plugins/claude-code-sync) | Obsidian plugin, renders transcripts as vault notes |

**None of them runs without being installed.** They are npm packages, pip packages, Electron apps
or plugins, and reading a transcript means trusting a dependency tree with the most private data on
your machine. `claude-code-log` alone pulls 11 direct dependencies including a compiled JavaScript
engine binding. For most people that is a fine trade.

This one is a single HTML file: download, open, drag a transcript on. If you want features, use one
of the tools above. If you want to hand someone a file and have them open it, this is the one.

## Other assistants

The renderer consumes Anthropic Messages API records rather than a Claude Code specific format, so
anything logging in that shape works already. [Codex
CLI](https://github.com/PixelPaw-Labs/codex-trace) and Cursor log something genuinely different,
and supporting either means an adapter in front of `parseRecords()` in `src/viewer.js`.

Not implemented, because there are no such files here to test against, and a parser written from
documentation breaks on first contact. Open an issue with a sample and it becomes a small change.
