#!/usr/bin/env python3
"""Rebuild docs/screenshot-*.png from the demo transcript, using headless Chrome.

Every image in the READMEs comes from `demo/sample-session.jsonl`, which is fictional. No
real conversation is ever photographed. Run after a UI change:

    python3 demo/make_demo.py
    python3 claude_transcript_viewer.py demo/sample-session.jsonl demo
    python3 demo/shoot.py

Shots that need interaction (the media grid, an expanded tool run) are produced by injecting
a click into a throwaway copy of the page, so the result is identical on every run.
"""
import base64
import hashlib
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Scripts run 200 ms after load, inside a copy of the page. They click real controls rather
# than calling internals, because the viewer's functions live inside a closure.
SHOTS = {
    "drop":  (None, "viewer.html", (1440, 940)),
    # The hero has to leave room for the first instruction. At 1100px tall it rendered
    # around 690px wide-on-GitHub, which pushed "download, open, drag" below the fold.
    "main":  (None, None, (1440, 680)),
    # The hero for each translated README. Showing an English page there would advertise
    # 繁體中文 support with a picture of the feature switched off. The menu entries are
    # display:none until the popover opens, which does not stop a programmatic click.
    "main-hant": ('document.querySelector(\'#langmenu [data-l="hant"]\').click()',
                  None, (1440, 680)),
    "main-hans": ('document.querySelector(\'#langmenu [data-l="hans"]\').click()',
                  None, (1440, 680)),
    # Toggling the class directly rather than dispatching a click: a screenshot should not
    # depend on event timing, and a missed click silently produces a shot of the wrong screen.
    "media": ("document.getElementById('mediabtn').click()", None, (1440, 940)),
    "links": ("document.getElementById('links').classList.add('open')", None, (1440, 620)),
    "tools": ("document.querySelector('.filters input[data-k=tool]').click();"
              "document.querySelectorAll('.toolrun').forEach((r,i)=>{if(i===0)r.open=true});"
              "document.querySelectorAll('.toolrun details.tool')"
              ".forEach((d,i)=>{if(i<2)d.open=true});"
              "document.querySelectorAll('.msg,.filebar')"
              ".forEach((e,i)=>{if(i<3)e.style.display='none'});", None, (1440, 1000)),
}


def inject(page, js):
    """Add a setup script to a copy of the page, and admit its hash to the CSP.

    The page ships a Content-Security-Policy that allows exactly one script by hash. That
    is the point of it, and it silently blocks anything injected here: the screenshot still
    renders a perfectly valid page, just not the screen that was asked for. Two of the
    README images were wrong for a while before anyone noticed.
    """
    setup = f"addEventListener('load',()=>setTimeout(()=>{{{js}}},250));"
    digest = base64.b64encode(hashlib.sha256(setup.encode()).digest()).decode()
    page = re.sub(r"(script-src )([^;]+)(;)",
                  lambda m: f"{m.group(1)}{m.group(2)} 'sha256-{digest}'{m.group(3)}",
                  page, count=1)
    return page.replace("</body>", f"<script>{setup}</script>\n</body>")


def demo_html():
    hits = sorted((ROOT / "demo").glob("claude-*.html"))
    if not hits:
        sys.exit("No converted demo found. Run:\n"
                 "  python3 claude_transcript_viewer.py demo/sample-session.jsonl demo")
    return hits[-1]


def main():
    if not Path(CHROME).exists():
        sys.exit(f"Chrome not found at {CHROME}")
    DOCS.mkdir(exist_ok=True)
    base = demo_html().read_text()

    with tempfile.TemporaryDirectory() as tmp:
        for name, (js, page, size) in SHOTS.items():
            if page:
                target = ROOT / page
            elif js:
                target = Path(tmp) / f"{name}.html"
                target.write_text(inject(base, js))
            else:
                target = demo_html()
            out = DOCS / f"screenshot-{name}.png"
            subprocess.run([
                CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                "--force-color-profile=srgb", f"--window-size={size[0]},{size[1]}",
                "--virtual-time-budget=5000", f"--screenshot={out}", target.as_uri(),
            ], capture_output=True)
            print(f"{'✅' if out.exists() else '❌'} {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
