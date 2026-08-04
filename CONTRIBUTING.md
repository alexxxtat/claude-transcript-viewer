# Contributing

Small project, one maintainer. Issues and pull requests are welcome, and the fastest way to get
one merged is to know the two constraints that are not negotiable.

## The two hard constraints

**No dependencies.** Not one, in either half. The Python side is standard library only, and the
page loads nothing: no CDN, no remote font, no analytics, no build tool. This is the entire reason
the project exists, so a change that adds a package will be declined no matter how good it is.

**No network access, ever.** The page must work with Wi-Fi off, and it must stay that way after
your change. If a feature seems to need a fetch, it belongs in the CLI or nowhere.

## Where code goes

`src/viewer.js` is the only renderer. Both entry points feed it the same records, so a rendering
change belongs there and nowhere else. `claude_transcript_viewer.py` finds sessions, embeds
screenshots that live on disk, and injects data into the shell. It must not grow a rendering path.

After editing anything in `src/`, rebuild the committed shell:

```bash
python3 claude_transcript_viewer.py --build
python3 claude_transcript_viewer.py --demo-page
```

## What `tools/lint.py` enforces

CI runs it, so it is worth knowing before it turns your pull request red. Three of its checks
are ordinary hygiene and three are project conventions you would not guess:

- **`viewer.html` must match `src/`.** It is a build artifact that is also the product, so run
  `--build` and `--demo-page` after editing `src/`, or the page people download and the page
  they arrive at both lag the source. CI fails on either.
- **Nothing from a real machine.** Home directory paths, stray transcripts, generated HTML.
- **Links and images in the docs must resolve.**
- **Every control in the template needs a handler in `viewer.js`.** Markup that renders and does
  nothing has shipped here more than once, and nothing else notices it.
- **A control named in the docs must exist in the source.** Prose and markup cannot see each
  other, so a renamed button leaves the README quietly wrong.
- **No em-dashes in prose, and prose semicolons draw a warning.** A house style rather than a
  defect. An em-dash is nearly always a clause bolted on after the sentence was already finished,
  so the fix is to rewrite it: a colon where a list follows, a full stop where a justification was
  tacked on. Code comments, en-dash ranges like `40–60`, and the bare no-data placeholder are fine.
- **The three language tables must have identical keys**, and every `t('key')` the code calls
  must exist. See below.

## Adding or changing a user-facing string

Every string lives in the `STR` table at the top of `src/viewer.js`, in three blocks: `en`,
`hant`, `hans`. Adding one means adding it to all three. The lint fails otherwise, and it has
to: `t()` falls back to English on a missing key, so the page keeps working and a Chinese
reader gets one English sentence in the middle of a translated screen.

Two things that are easy to get wrong:

- **Do not machine-convert Traditional into Simplified.** The pairs that actually differ are
  vocabulary, not characters: 檔案/文件, 搜尋/搜索, 網路/网络, 列印/打印, 設定/设置. A
  character-level conversion gets every one of them wrong.
- **Markup in the template gets a `data-i18n` attribute, not a literal.** `data-i18n` sets
  textContent, `data-i18n-html` sets innerHTML, `data-i18n-title` and `data-i18n-ph` set the
  attributes. Only literals from `STR` reach `innerHTML`, never anything out of a transcript,
  and it must stay that way.

`demo/test_i18n.py` drives a real browser because the lint cannot tell whether the page reads
the table it validates. A label written once at boot keeps its English after a switch and looks
completely normal until someone switches.

## Before opening a pull request

```bash
python3 tools/lint.py               # build sync, privacy, voice, wiring, string tables
python3 demo/test_hardening.py      # untrusted-input probes, needs Chrome
python3 demo/test_navigation.py     # no navigable dead ends, needs Chrome
python3 demo/test_i18n.py           # every language reaches every path, needs Chrome
python3 demo/make_demo.py           # rebuild the demo transcript, needs Pillow
python3 claude_transcript_viewer.py demo/sample-session.jsonl demo
python3 demo/shoot.py               # refresh docs/screenshot-*.png if the UI moved
```

Never attach a screenshot of a real session, yours or anyone's. `demo/sample-session.jsonl` is
fictional and exists so that no one has to.

## Adapters for other assistants

The renderer consumes Anthropic Messages API records. Codex CLI, Cursor and the rest log something
different, and an adapter is welcome, but **only with a real sample file to test against**. A
parser written from documentation is a parser that breaks on first contact. See the issue template.
