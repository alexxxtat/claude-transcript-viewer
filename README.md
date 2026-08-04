# Claude Transcript Viewer

Turn a Claude Code session into a single HTML file you can actually read.

**English** · [繁體中文](README.zh-TW.md) · [简体中文](README.zh-CN.md)

![license MIT](https://img.shields.io/badge/license-MIT-blue)
![python 3.8+](https://img.shields.io/badge/python-3.8%2B-blue)
![dependencies none](https://img.shields.io/badge/dependencies-none-brightgreen)
![network none](https://img.shields.io/badge/network-none-brightgreen)

### [▶ Open the live demo](https://alexxxtat.github.io/claude-transcript-viewer/)

[![The viewer showing a converted session](docs/screenshot-main.png)](https://alexxxtat.github.io/claude-transcript-viewer/)

A fictional session, already loaded, nothing to install. That page is the same file as the
download below, so your own transcripts would still be parsed in the browser and never uploaded.
For real ones prefer the download anyway: it is the copy you can read, keep, and run with Wi-Fi
off, which is a stronger guarantee than trusting a page that could change tomorrow.

Claude Code keeps every session on disk as JSONL under `~/.claude/projects/`. It is a complete
record: every prompt, every reply, every tool call, every screenshot you pasted. It is also
unreadable. A 14 MB session is one JSON object per line, and the parts you care about sit buried
under hundreds of tool results.

## Try it without installing anything

Download **`viewer.html`**, open it, drag a `.jsonl` onto it. That's it.

Drop several at once, or a whole folder, and you get a list to pick from instead of an
arbitrary one of them. `⌂ Home` in the header goes back at any point, and inside a converted file
it reads `↩ Back` and returns to that file's own transcript, which is what reloading does too.

Markdown files work too. Drop a `.md` and it renders as a document with a contents list built from
its headings, which is useful for the files that live outside a notes vault.

![The drop zone](docs/screenshot-drop.png)

No transcripts of your own yet, or not willing to open one? `demo/sample-session.jsonl` is a
fictional session built for exactly that. Drop it in and every feature below is live: tool runs,
an injected payload, a checklist, three screenshots, media mode. Nothing in it came from a real
conversation, which is also why the screenshots on this page are safe to publish.

Everything is parsed in the page. There is no build step, no server, no upload, and no network
request of any kind. It works with Wi-Fi off. **Export** writes the transcript you're looking at
back out as its own standalone HTML file.

## Or use the CLI, for the things a browser can't do

```bash
python3 claude_transcript_viewer.py            # list your 20 most recent sessions
python3 claude_transcript_viewer.py 3          # convert #3 → ~/Desktop
python3 claude_transcript_viewer.py 3 ~/out    # choose the output directory
python3 claude_transcript_viewer.py --find "rate limit"    # search every transcript
python3 claude_transcript_viewer.py --find "rate limit" 3  # open the 3rd hit
python3 claude_transcript_viewer.py --agents   # include subagent transcripts in the listing
python3 claude_transcript_viewer.py --build    # rebuild viewer.html from src/
python3 claude_transcript_viewer.py --demo-page  # rebuild the published demo page
```

The CLI adds what the browser sandbox forbids. It finds your sessions across every project, and it
embeds the screenshots a transcript only references by path. Those are read off disk at convert
time, so the output survives the original being deleted.

It also surfaces **subagent transcripts**, which are easy to miss. Every `Task` run and every
workflow agent is logged separately under `<session>/subagents/`, sometimes two directories deeper
under `subagents/workflows/<id>/`. On the machine this was built on there were 581 of those against
783 main sessions. That is roughly as much history again, in the same format, that no listing
shows you.

Python 3.8+, standard library only.

---

## What you get

**Reading**
- Clean conversation by default: your prompts and Claude's replies, nothing else
- The header carries the session's own generated title, its git branch, how long it ran and
  over how many turns. Secondary counts sit behind `ⓘ` rather than in a row of nine values
- Sidebar table of contents built from your prompts (they're the natural chapter markers)
- Message numbers (`#12`) that double as permalinks, floating position indicator, back-to-top
- Relative timestamps ("3d ago"), hover for the exact time
- A copy button on every message, which copies the markdown the record held rather than the
  rendered text, so tables and code fences survive being pasted somewhere else
- Light and dark, following the system setting
- English, 繁體中文 and 简体中文. The language is read from your browser on first open and
  changed from `文` in the header, and the choice is remembered. Traditional and Simplified
  are written out separately rather than converted from one another, because the pairs that
  differ are vocabulary and not characters: 檔案/文件, 搜尋/搜索, 網路/网络

**Search**
- In-page search with live highlight, hit count, and next/previous
- Press `/` to focus, `Enter` / `Shift+Enter` to step through hits
- A hit inside a collapsed or filtered-out section un-hides that section automatically

**Filtering**
- A filter bar with live counts: `You 17 · Claude 166 · 🔧 Tools 577 · ⚙️ Injected 25`
- Tools and injected payloads are **off by default**. Turn them on when you want the detail
- Every category toggles, including your own turns, so you can read just the answers or just
  the questions

**Tool calls**
- Consecutive calls collapse into one run: `🔧 12 tool actions · ⚡Bash×7 · 📖Read×3 · ✏️Edit×2`
- Expand a run to see individual calls, then expand a call for its input and result
- Inputs and results are truncated (900 / 1400 chars) so a build log can't bloat the page
- `stdout` and `stderr` are shown apart where the record kept them apart, and an interrupted
  command says so, because an error reads differently from output
- `TodoWrite` renders as an actual checklist

![Tool calls expanded](docs/screenshot-tools.png)

**File changes**
- A panel at the top: *"41 files touched in this session"*, with per-file edit counts
- This is usually the first thing you want from an old session

**Media**
- Screenshots restored as thumbnails, both base64-embedded ones and path references
- **Media mode**: every image in a grid, captioned with the message it came from
- Lightbox with `←` `→` (or swipe) navigation, `Esc`/`Enter`/backdrop to close
- **Jump to message** from any image. The source message scrolls into view and flashes
- **Copy image** to the clipboard, for pasting into a reverse-image search
- **Download all** to pull every screenshot out of a session at once

**Links**
- Every address the session cited, gathered into one panel behind `🔗`: markdown links, bare URLs,
  and the pages `WebFetch` actually retrieved, which otherwise sit buried in a collapsed tool run
- Each row carries `↩ #12` back to the message that cited it, the same return path media mode has

![The links panel](docs/screenshot-links.png)

**Getting it back out.** `⤓ Export` offers three formats
- **HTML**, a standalone file structurally identical to what the CLI produces
- **Markdown**, for a notes vault or an issue: prompts and replies in full, tool runs collapsed to
  one line each, injected payloads dropped
- **PDF**, through the browser's own print dialog. There is no PDF generator here, just a print
  stylesheet that drops the chrome and stops printing dark backgrounds

![Media mode](docs/screenshot-media.png)

---

## How it fits together

```
viewer.html                     the zero-install entry point (built, committed)
claude_transcript_viewer.py     finds sessions, embeds disk images, injects data
src/
  viewer.template.html          shell markup
  viewer.css                    styles
  viewer.js                     ← parsing and rendering live here, once
docs/index.html                 the live demo (built, committed, served by Pages)
```

`viewer.js` is the only implementation. Both entry points hand it the same records: the drop target
parses a `.jsonl` in the browser, and the CLI injects `window.__TRANSCRIPT__` into the same shell.
The Python script renders nothing, so the two paths cannot drift apart.

`viewer.html` is generated from `src/` by `--build` and committed, so that downloading one file is
enough to use it.

The records it reads are Anthropic Messages API shaped rather than Claude Code specific, which is
why subagent and workflow-agent transcripts render with no extra code, and why an adapter for
another assistant would slot in front of `parseRecords()`.

Other tools that read the same files, and how this one differs:
[docs/ALTERNATIVES.md](docs/ALTERNATIVES.md).

---

## Security

A transcript is untrusted input: someone can hand you one. An embedded image's `data:` URI comes
straight from the file, and before it was fixed a crafted `media_type` broke out of the `src`
attribute and executed inside the page showing your conversation. `demo/test_hardening.py` renders
four probes in a real browser and inspects the DOM afterwards, because a static scan cannot decide
what a page does when it runs. Details in [SECURITY.md](SECURITY.md).

## Limitations

- Minimal markdown: headings, lists, tables, code fences, inline styles. No syntax highlighting,
  which would mean a dependency.
- Screenshots are embedded so the output stays self-contained, so a 9-image session is around 3 MB.
- The browser build cannot list your sessions or point its file picker at `~/.claude/projects`.
  `showDirectoryPicker()` rejects on any `file://` page, since a local file is an opaque origin.
  Serving over HTTPS would unlock it and cost the property that makes this worth using, so the CLI
  covers that job instead.
- No one-click reverse-image search, for the same reason: a `data:` URI is not something Google can
  fetch. The lightbox offers **Copy image**, and your browser's own right-click search works on the
  thumbnails.
- Tested on macOS and Chrome. Paths assume `~/.claude/projects/`.

## Privacy

Everything runs locally. The output has no external references: no CDN, no remote fonts, no
analytics. It works offline and keeps working.

The generated file contains the full conversation, including screenshots. `.gitignore` excludes
`claude-*.html` for that reason. Don't put one anywhere that syncs or commits automatically without
deciding that's what you want.

## Before publishing

`tools/lint.py` runs the checks review keeps missing: that `viewer.html` still matches `src/`,
that nothing from a real machine is about to be committed, that every control has a handler and
every control named in the docs exists, and that sentences are not leaning on punctuation in place
of structure. CI runs the same script plus the untrusted-input probes and a
reproducible-build check. The conventions it enforces are listed in
[CONTRIBUTING.md](CONTRIBUTING.md), and what may and may not be committed is in
[PUBLISHING.md](PUBLISHING.md).

```bash
python3 tools/lint.py
```

## License

MIT
