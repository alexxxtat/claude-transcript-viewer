# What must never be published

This repo is public. Your transcripts are not.

## The one rule

**Only `demo/sample-session.jsonl` may be committed.** It is fictional: an invented project,
invented files, an invented conversation, and screenshots drawn by `demo/make_demo.py`. Every
other `.jsonl` on your machine is a record of real work and contains whatever you pasted while
doing it, which routinely includes credentials, private code, unreleased screens, and business
detail you would not put on the internet.

The same goes for anything the converter produces. A generated `claude-*.html` embeds the whole
conversation and every image in it. `.gitignore` excludes those, and `tools/lint.py` fails if one
slips past.

## Run this before you push

```bash
python3 tools/lint.py
```

It checks three things review will not:

1. **`viewer.html` matches `src/`.** It is a build artifact that is also the product, so editing
   `src/` without running `--build` ships a page that silently lags its source.
2. **Nothing from a real machine.** Home directory paths, stray transcripts, generated HTML that
   `.gitignore` does not cover.
3. **Sentences leaning on punctuation instead of structure.** Em-dashes fail, prose semicolons
   draw a warning. The rest of that judgement stays human, because a linter cannot tell a
   rhetorical rule-of-three from a list of three facts.

CI runs the same script, plus the untrusted-input probes and a reproducible-build check.

## Screenshots

Never photograph a real session, yours or anyone else's. `demo/shoot.py` drives headless Chrome
over the fictional demo and writes `docs/screenshot-*.png`, so there is never a reason to.

## If something private lands in a commit

Removing it in a later commit does not remove it from history, and GitHub keeps unreachable
objects reachable through the API for a while. Rewrite the history before pushing, or if it is
already public, treat whatever leaked as compromised and rotate it.
