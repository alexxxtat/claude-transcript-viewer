#!/usr/bin/env python3
"""Pre-publish checks. Run before committing, and in CI.

Three things this catches that review does not:

  1. A stale `viewer.html`. It is a build artifact that is also the product, so editing
     `src/` and forgetting `--build` ships a page that silently lags the source. Nothing
     else in the repo would notice.
  2. Anything from the author's machine reaching a public repo. Transcripts contain
     whatever was pasted while working, and the demo is the only session that may be
     committed.
  3. Sentences held together by punctuation instead of structure. An em-dash is almost
     always a clause bolted on after the fact, and the fix is a rewrite rather than a
     different character. That much is mechanical; the rest of editing stays human.

    python3 tools/lint.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
fails, notes = [], []


def would_publish(path):
    """True when git would actually carry this file. Matching on filename alone would
    flag the generated demo, which .gitignore already excludes."""
    if not (ROOT / ".git").exists():
        return not path.name.startswith("claude-")
    r = subprocess.run(["git", "check-ignore", "-q", str(path)], cwd=ROOT)
    return r.returncode != 0


def fail(check, detail):
    fails.append(f"{check}: {detail}")


def tracked(*globs):
    for g in globs:
        for p in ROOT.glob(g):
            if any(part in {".git", "__pycache__", ".claude"} for part in p.parts):
                continue
            yield p


# ── 1. the built shell must match its source ─────────────────────────────────
shell_path = ROOT / "viewer.html"
if not shell_path.exists():
    fail("build", "viewer.html is missing; run --build")
else:
    shell = shell_path.read_text()
    for name in ("viewer.css", "viewer.js"):
        src = (ROOT / "src" / name).read_text()
        if src not in shell:
            fail("build", f"viewer.html does not contain the current src/{name}. "
                          "Run: python3 claude_transcript_viewer.py --build")
    if "Content-Security-Policy" not in shell:
        fail("build", "viewer.html has no CSP meta tag")

# ── 1b. every control in the template must actually be wired ────────────────
# Three separate bugs shipped past review this way: the markup was right, the element
# rendered, and the click did nothing because a string replacement had quietly missed its
# anchor. A control with no handler looks identical to one that works.
tpl_path, js_path = ROOT / "src" / "viewer.template.html", ROOT / "src" / "viewer.js"
if tpl_path.exists() and js_path.exists():
    tpl, js = tpl_path.read_text(), js_path.read_text()
    aliases = dict(re.findall(r"(\w+)\s*=\s*\$\('#([\w-]+)'\)", js))
    wired = set(re.findall(r"\$\('#([\w-]+)'\)\.on(?:click|change|input|keydown)", js))
    for var, eid in aliases.items():
        if re.search(rf"\b{re.escape(var)}\.on(?:click|change|input|keydown)\s*=", js):
            wired.add(eid)
    for tag, eid in re.findall(r'<(button|input)[^>]*id="([\w-]+)"', tpl):
        if eid in wired:
            continue
        if re.search(rf"#{re.escape(eid)}\b", js):
            continue          # reached through a delegated handler
        fail("wiring", f"<{tag} id=\"{eid}\"> has no handler in src/viewer.js")

# ── 2. nothing personal, and no real transcripts ─────────────────────────────
HOME_RE = re.compile(r"/Users/(?!dev/)[a-z0-9._-]+", re.I)
for p in tracked("*.md", "*.py", "*.html", "*.css", "*.js", "**/*.md", "**/*.py",
                 "**/*.yml", "src/*", "demo/*.py", "tools/*"):
    if not p.is_file() or p.name.startswith("claude-"):
        continue
    text = p.read_text(errors="ignore")
    for m in set(HOME_RE.findall(text)):
        if m.lower() != "/users/dev":
            fail("privacy", f"{p.relative_to(ROOT)} contains a real home path: {m}")

for p in tracked("**/*.jsonl"):
    if p.name != "sample-session.jsonl" and would_publish(p):
        fail("privacy", f"{p.relative_to(ROOT)} is a transcript. Only the fictional demo "
                        "may be committed.")

for p in tracked("**/claude-*.html"):
    if would_publish(p):
        fail("privacy", f"{p.relative_to(ROOT)} is a generated transcript and is not covered "
                        "by .gitignore")

sample = ROOT / "demo" / "sample-session.jsonl"
if sample.exists():
    for line in sample.read_text().splitlines():
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        cwd = rec.get("cwd", "")
        if cwd and not cwd.startswith("/Users/dev/"):
            fail("privacy", f"the demo transcript references a real path: {cwd}")
            break

# ── 3. punctuation standing in for sentence structure ───────────────────────
EM_DASH = "—"
SEMI = re.compile(r"[a-z]; [a-z]")
for p in sorted(set(tracked("*.md", "**/*.md"))):
    text = p.read_text(errors="ignore")
    rel = p.relative_to(ROOT)
    if EM_DASH in text:
        n = text.count(EM_DASH)
        first = next(i for i, l in enumerate(text.splitlines(), 1) if EM_DASH in l)
        fail("voice", f"{rel} has {n} em-dash{'es' if n > 1 else ''} (first at line {first}). "
                      "Rewrite the sentence, do not swap the character: a colon for a list, "
                      "a full stop where a justification was bolted on.")
    if (n := len(SEMI.findall(text))):
        notes.append(f"voice: {rel} has {n} prose semicolon{'s' if n > 1 else ''}; "
                     "a period usually reads better")

# ── 3b. a button named in the docs must exist in the source ─────────────────
# The README described a button called "Open" for a while after it was renamed to "Home".
# Nothing catches that: the docs are prose, the button is markup, and neither knows about
# the other. Any backticked label starting with a UI glyph has to appear in src/.
GLYPHS = "\u2913\u2302\u21a9\u2190\U0001f517\U0001f5bc\u2630\u22ef"
ui_source = "".join((ROOT / "src" / n).read_text()
                    for n in ("viewer.template.html", "viewer.js")
                    if (ROOT / "src" / n).exists())
for p_doc in sorted(set(tracked("*.md", "**/*.md"))):
    for label in re.findall(rf"`([{GLYPHS}][^`]{{0,24}})`", p_doc.read_text(errors="ignore")):
        text = label.strip()
        # Digits in a label are almost always a stand-in for a number the code interpolates
        # (`↩ #12` is `↩ #${seq}` in the source), so compare with them removed.
        glyph, rest = text[0], re.sub(r"\d+", "", text[1:]).strip()
        if glyph in ui_source and (not rest or rest in ui_source):
            continue
        fail("docs", f"{p_doc.relative_to(ROOT)} names a control `{text}` "
                     "that does not appear in src/")

# ── 4. the docs must point at files that exist ───────────────────────────────
LINK = re.compile(r"\[[^\]]+\]\((?!https?:)([^)#]+)")
for p in sorted(set(tracked("*.md", "**/*.md"))):
    for target in LINK.findall(p.read_text(errors="ignore")):
        if not (p.parent / target).exists() and not (ROOT / target).exists():
            fail("links", f"{p.relative_to(ROOT)} links to missing {target}")

IMG = re.compile(r"!\[[^\]]*\]\((?!https?:)([^)]+)")
for p in tracked("*.md"):
    for target in IMG.findall(p.read_text(errors="ignore")):
        if not (ROOT / target).exists():
            fail("links", f"{p.relative_to(ROOT)} shows missing image {target}")

# ── report ───────────────────────────────────────────────────────────────────
for n in notes:
    print(f"note  {n}")
if fails:
    print()
    for f in fails:
        print(f"FAIL  {f}")
    print(f"\n{len(fails)} problem{'s' if len(fails) > 1 else ''}. Not ready to publish.")
    sys.exit(1)
print("\nAll pre-publish checks pass.")
