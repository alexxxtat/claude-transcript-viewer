#!/usr/bin/env python3
"""Probe: switching language actually re-renders, in a real browser.

tools/lint.py proves the three string tables agree. It cannot prove the page uses them. The
failure this catches is the quiet one: a control that keeps its English label after a switch
because its text was written once at boot and never routed through t(). Reading the source
does not settle it either, since render() rebuilds most of the page and the template supplies
the rest, and only one of those two paths re-runs on a switch.

Each case renders docs/index.html, drives it, and reads the DOM back.

    python3 demo/test_i18n.py
"""
import base64
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import browser  # noqa: E402  (sibling module, not an installed package)

ROOT = Path(__file__).resolve().parent.parent
CHROME = browser.find()

# Read the elements, never the dumped page. --dump-dom includes the inlined <script>, and that
# script holds all three string tables, so `"你的提問" in dom` is true for a page that never
# translated anything. The first version of this file did exactly that and passed against a
# build with the label hardcoded back to English.
READ = """
document.body.dataset.probe = encodeURIComponent(JSON.stringify({
  lang: document.documentElement.lang,
  nav: document.querySelector('#navtitle').textContent,
  filters: document.querySelector('#filters').textContent,
  header: document.querySelector('header').textContent,
  drop: document.querySelector('#drop').textContent,
  demobar: (document.querySelector('.demobar') || {}).textContent || ''
}));
"""

# Each probe proves a different path carries the switch:
#   nav      -> a template node translated by applyStatic(), and the only one of the three
#               whose wording differs between the two scripts, so it also proves the right
#               table was chosen rather than merely some Chinese one
#   filters  -> markup render() builds from scratch on every language change
#   lang     -> the hook the CSS font and glyph rules key off
#
# The filter probe is 工具 and not 推理: the sample session has no thinking blocks, so box()
# correctly omits that checkbox and asserting on it would fail against working code.
PROBE = {
    "hant": {"lang": "zh-Hant", "nav": "你的提問", "filters": "工具"},
    "hans": {"lang": "zh-Hans", "nav": "你的提问", "filters": "工具"},
}


def inject(page, js):
    """Run js in the page, admitting its hash to the CSP so it is not silently blocked."""
    setup = f"addEventListener('load',()=>setTimeout(()=>{{{js}}},250));"
    digest = base64.b64encode(hashlib.sha256(setup.encode()).digest()).decode()
    page = re.sub(r"(script-src )([^;]+)(;)",
                  lambda m: f"{m.group(1)}{m.group(2)} 'sha256-{digest}'{m.group(3)}",
                  page, count=1)
    return page.replace("</body>", f"<script>{setup}</script>\n</body>")


def probe_after(js):
    """Drive the page, then read the values back out of a body data attribute.

    One Chrome per case, each in its own throwaway profile (see test_navigation.py).
    """
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "probe.html"
        page.write_text(inject((ROOT / "docs" / "index.html").read_text(), js + ";" + READ))
        dom = subprocess.run(
            browser.argv(CHROME, page.as_uri()),
            capture_output=True, text=True, timeout=90).stdout
    m = re.search(r'data-probe="([^"]*)"', dom)
    if not m:
        return None
    return json.loads(urllib.parse.unquote(m.group(1)))


def pick(lang):
    """Click the menu entry rather than calling setLang(), so the wiring is covered too."""
    return f"document.querySelector('#langmenu [data-l=\"{lang}\"]').click()"


def check(name, ok, detail=""):
    print(f"{'✅' if ok else '❌'} {name}{'' if ok else '  ' + detail}")
    return 0 if ok else 1


def main():
    if CHROME is None:
        print("SKIP: no Chrome or Chromium on this machine")
        return 0
    if not (ROOT / "docs" / "index.html").exists():
        print("FAIL: docs/index.html is missing; run --demo-page")
        return 1

    failures = 0

    # 1. The page ships in English and stays there until asked.
    p = probe_after("")
    if p is None:
        print("❌ the probe never ran; nothing below can be trusted")
        return 1
    failures += check("opens in English by default",
                      p["lang"] == "en" and "Your prompts" in p["nav"],
                      f"lang={p['lang']!r} nav={p['nav']!r}")

    # 2. Each language reaches the template, the generated markup and the lang attribute.
    for lang, want in PROBE.items():
        p = probe_after(pick(lang))
        bad = {k: p[k] for k, v in want.items() if v not in p[k]}
        failures += check(f"{lang}: template, rendered markup and lang attribute all switch",
                          not bad, f"still {bad}")

    # 3. No English label survives anywhere on screen after a switch. This is the regression
    #    the file exists for: one un-routed label is invisible unless something looks.
    p = probe_after(pick("hant"))
    seen = p["header"] + p["nav"] + p["drop"]
    leftovers = [w for w in ("Your prompts", "Export", "Home", "Reasoning", "Tools",
                             "Injected", "Contents", "Drop a Claude Code transcript")
                 if w in seen]
    failures += check("no English label left on screen after switching",
                      not leftovers, f"found {leftovers}")

    # 4. The banner is injected by --demo-page rather than written in the template, so it is
    #    the one piece of markup that can miss a rename on the Python side and nowhere else.
    #    It is also the first thing a visitor to the published page reads.
    failures += check("the demo banner switches too",
                      "線上示範" in p["demobar"],
                      f"still {p['demobar'][:40]!r}")

    # 5. Switching back is not a one-way door.
    p = probe_after(pick("hant") + ";" + pick("en"))
    failures += check("switching back to English restores it",
                      p["lang"] == "en" and "Your prompts" in p["nav"],
                      f"lang={p['lang']!r} nav={p['nav']!r}")

    print("\n" + ("FAILED" if failures else "Every path carries the language."))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
