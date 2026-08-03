#!/usr/bin/env python3
"""Regression check: a crafted transcript must not be able to inject markup.

A `.jsonl` is untrusted input. Someone can hand you one, and both halves of an embedded
image's `data:` URI come straight from the file. Before the fix, a `media_type` of
`png" onerror="…` broke out of the `src` attribute and ran, which headless Chrome confirmed
by reporting `<title>XSS-FIRED</title>`.

Rendering happens in the browser, so a static scan of the generated HTML cannot decide this.
The test loads the page and inspects the resulting DOM.

    python3 demo/test_hardening.py
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import browser  # noqa: E402  (sibling module, not an installed package)

ROOT = Path(__file__).resolve().parent.parent
CHROME = browser.find()
MARKER = "XSS-FIRED"

PROBES = [
    ("attribute break-out via media_type",
     f"png\" onerror=\"document.title='{MARKER}'", "AAAA"),
    ("script tag via media_type",
     f"png<script>document.title='{MARKER}'</script>", "AAAA"),
    ("markup smuggled through the base64 field",
     "image/png", f"\"><img src=x onerror=document.title='{MARKER}'>"),
    ("javascript: scheme in place of a data URI",
     f"javascript:document.title='{MARKER}'", "AAAA"),
]


def render(media_type, data, out_dir):
    src = Path(out_dir) / "probe.jsonl"
    src.write_text(json.dumps({
        "type": "user", "timestamp": "2026-01-01T00:00:00Z", "cwd": "/tmp",
        "message": {"content": [
            {"type": "text", "text": "benign prompt"},
            {"type": "image", "source": {
                "type": "base64", "media_type": media_type, "data": data}}]}}) + "\n")
    subprocess.run([sys.executable, "claude_transcript_viewer.py", str(src), out_dir],
                   cwd=ROOT, capture_output=True, check=True)
    page = next(iter(Path(out_dir).glob("claude-*.html")))
    dom = subprocess.run(
        browser.argv(CHROME, page.as_uri(), 3000), capture_output=True, text=True).stdout
    return dom


def main():
    if CHROME is None:
        print("SKIP: no Chrome or Chromium on this machine")
        return 0
    failures = 0
    for name, media_type, data in PROBES:
        with tempfile.TemporaryDirectory() as tmp:
            dom = render(media_type, data, tmp)
        title = (re.search(r"<title>(.*?)</title>", dom, re.S) or [None, ""])[1]
        imgs = re.findall(r"<img[^>]*>", dom)
        bad = [t for t in imgs if "onerror" in t.lower() or "javascript:" in t.lower()]
        if MARKER in title:
            print(f"❌ {name}: script executed (title became {title!r})")
            failures += 1
        elif bad:
            print(f"❌ {name}: hostile attribute survived into the DOM: {bad[0][:90]}")
            failures += 1
        else:
            print(f"✅ {name}")
    print("\n" + ("FAILED" if failures else "All probes contained."))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
