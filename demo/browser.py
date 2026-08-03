"""Locating a browser, once, for the tests that need a real one.

Both probe suites render pages in Chrome and inspect the DOM afterwards, because a static
scan cannot decide what a page does when it runs. They each grew their own copy of "where is
Chrome", and the copies had already started to differ: one knew about Linux, the other did
not, and only one passed the flag a CI runner needs. Two implementations of the same lookup
is the drift this repo avoids everywhere else.

Not part of the product. `viewer.html` and the converter have no dependencies at all; this is
a maintainer's tool that never ships.
"""
import shutil
import sys
from pathlib import Path

CANDIDATES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
)

# Linux CI runners have no user namespaces for Chrome's own sandbox, and it refuses to start
# without this. macOS needs no such flag.
FLAGS = ["--headless=new", "--disable-gpu"] + ([] if sys.platform == "darwin" else ["--no-sandbox"])


def find():
    """The browser to drive, or None when there is none to drive."""
    for c in CANDIDATES:
        hit = c if Path(c).exists() else shutil.which(c)
        if hit:
            return Path(hit)
    return None


def argv(chrome, page_uri, budget_ms=4000):
    """The full command for one throwaway render of a page."""
    return [str(chrome), *FLAGS, f"--virtual-time-budget={budget_ms}", "--dump-dom", page_uri]
