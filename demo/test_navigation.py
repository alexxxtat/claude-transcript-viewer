#!/usr/bin/env python3
"""Regression check: a page with an embedded transcript must not be emptiable into a dead end.

Two ways back exist and they disagreed. `#homebtn` is disabled on a page whose own transcript
is already shown, because there is nowhere to go. Clicking the title ran the same goHome() with
only a `loaded` check, so it emptied the view anyway, and goHome() never re-enabled the button
it had just made the only way back. The result was a drop zone you could not leave without
reloading, which is what a visitor to the published demo page hit first.

Both paths must now agree, and any state showing the drop zone must offer a live Home button.

    python3 demo/test_navigation.py
"""
import base64
import hashlib
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import browser  # noqa: E402  (sibling module, not an installed package)

ROOT = Path(__file__).resolve().parent.parent

CHROME = browser.find()


def inject(page, js):
    """Run js in the page, admitting its hash to the CSP so it is not silently blocked."""
    setup = f"addEventListener('load',()=>setTimeout(()=>{{{js}}},250));"
    digest = base64.b64encode(hashlib.sha256(setup.encode()).digest()).decode()
    page = re.sub(r"(script-src )([^;]+)(;)",
                  lambda m: f"{m.group(1)}{m.group(2)} 'sha256-{digest}'{m.group(3)}",
                  page, count=1)
    return page.replace("</body>", f"<script>{setup}</script>\n</body>")


def dom_after(js, src="docs/index.html"):
    """One Chrome per case, each in its own throwaway profile.

    Reusing a --user-data-dir across sequential runs deadlocks: the first instance holds the
    profile lock past its own exit and the next one waits forever. test_hardening.py takes a
    fresh directory per probe for the same reason.
    """
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "probe.html"
        page.write_text(inject((ROOT / src).read_text(), js))
        return subprocess.run(
            browser.argv(CHROME, page.as_uri()),
            capture_output=True, text=True, timeout=90).stdout


def state(dom):
    body = re.search(r"<body[^>]*class=\"([^\"]*)\"", dom)
    home = re.search(r'id="homebtn"[^>]*', dom) or [""]
    return {"loaded": "loaded" in (body.group(1) if body else ""),
            "home_disabled": "disabled" in (home[0] if isinstance(home, list) else home.group(0))}


def main():
    if CHROME is None:
        print("SKIP: no Chrome or Chromium on this machine")
        return 0
    if not (ROOT / "docs" / "index.html").exists():
        print("FAIL: docs/index.html is missing; run --demo-page")
        return 1

    failures = 0
    cases = [
        ("the demo page opens on its transcript, not the drop zone",
         "docs/index.html", "", lambda s: s["loaded"]),
        ("clicking the title cannot empty a page whose Home is disabled",
         "docs/index.html", "document.querySelector('h1').click()", lambda s: s["loaded"]),
        ("no dead end: any view showing the drop zone has a live Home button",
         "docs/index.html", "document.querySelector('h1').click()",
         lambda s: s["loaded"] or not s["home_disabled"]),
        # viewer.html is the file people actually download, and it is the only artifact that
        # opens on the drop zone: docs/index.html always has a transcript embedded, so every
        # case above enters through a screen this one never sees. The reproducible-build check
        # proves the two carry identical code, not that both entry states work.
        ("the downloaded viewer opens on the drop zone, with a live Home button",
         "viewer.html", "", lambda s: not s["loaded"] and not s["home_disabled"]),
    ]
    for name, src, js, ok in cases:
        s = state(dom_after(js, src))
        if ok(s):
            print(f"✅ {name}")
        else:
            print(f"❌ {name}  (loaded={s['loaded']}, "
                  f"home_disabled={s['home_disabled']})")
            failures += 1

    print("\n" + ("FAILED" if failures else "No dead ends."))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
