#!/usr/bin/env python3
"""Generate demo/sample-session.jsonl and the screenshots in docs/

Needs Pillow (`pip install pillow`) to draw the mock app screens. That is the one place
in this repo with a dependency, and it is a maintainer's tool: the converter, the page it
produces, and the tests have none. The generated .jsonl is committed, so nobody needs to
run this to use or test the project. — a fictional transcript for screenshots and testing.

Nothing here comes from a real session. The project, the files and the conversation are
invented; the record SHAPE is copied exactly from the real format so the viewer exercises
every rendering path: prompts, replies, markdown, tables, code fences, tool runs, tool
results, a TodoWrite checklist, an injected (isMeta) payload, and embedded screenshots.
"""
import base64
import io
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path("demo")
CWD = "/Users/dev/projects/recipe-api"
T0 = datetime(2026, 5, 14, 10, 12, tzinfo=timezone.utc)

BG, CARD, TEXT, MUTED, ACCENT, OK, BAD = (
    (18, 18, 21), (30, 30, 35), (233, 233, 238), (150, 150, 160),
    (91, 141, 246), (74, 190, 130), (229, 72, 77))


def font(size, mono=False, bold=False):
    path = "/System/Library/Fonts/Menlo.ttc" if mono else "/System/Library/Fonts/HelveticaNeue.ttc"
    try:
        return ImageFont.truetype(path, size, index=2 if (bold and not mono) else 0)
    except Exception:
        return ImageFont.load_default()


def shot_terminal():
    """A mock test run."""
    im = Image.new("RGB", (900, 460), BG)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((16, 16, 884, 444), 12, fill=(12, 12, 14), outline=(45, 45, 52))
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse((38 + i * 20, 36, 50 + i * 20, 48), fill=c)
    d.text((110, 35), "pytest — recipe-api", font=font(13), fill=MUTED)
    rows = [
        ("$ pytest -q", TEXT), ("", TEXT),
        ("tests/test_parser.py ..........", MUTED),
        ("tests/test_units.py .......F..", MUTED),
        ("", TEXT),
        ("FAILED test_units.py::test_scale_fraction", BAD),
        ("  assert scale('1/2 cup', 3) == '1 1/2 cups'", MUTED),
        ("  AssertionError: got '1.5 cup'", BAD),
        ("", TEXT),
        ("19 passed, 1 failed in 0.42s", TEXT),
    ]
    y = 78
    for line, col in rows:
        d.text((44, y), line, font=font(15, mono=True), fill=col)
        y += 26
    return im


def shot_app(title, items, highlight=None):
    """A mock phone screen."""
    im = Image.new("RGB", (460, 900), BG)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((14, 14, 446, 886), 34, fill=(24, 24, 28), outline=(48, 48, 56))
    d.rounded_rectangle((170, 30, 290, 56), 13, fill=(8, 8, 10))
    d.text((44, 90), title, font=font(30, bold=True), fill=TEXT)
    d.text((44, 132), "12 recipes · 3 pantry items low", font=font(15), fill=MUTED)
    y = 190
    for i, (name, meta) in enumerate(items):
        fill = (34, 44, 66) if highlight == i else CARD
        d.rounded_rectangle((36, y, 424, y + 92), 16, fill=fill,
                            outline=ACCENT if highlight == i else (44, 44, 52))
        d.text((60, y + 22), name, font=font(19, bold=True), fill=TEXT)
        d.text((60, y + 52), meta, font=font(14), fill=MUTED)
        d.ellipse((376, y + 34, 400, y + 58), outline=OK if i % 2 else MUTED, width=2)
        y += 108
    return im


def b64(im, fmt="PNG"):
    buf = io.BytesIO()
    im.save(buf, fmt)
    return base64.b64encode(buf.getvalue()).decode()


def img_block(im):
    return {"type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": b64(im)}}


# ---------- transcript assembly ----------

records = []
_clock = [0]


def ts():
    _clock[0] += 3
    return (T0 + timedelta(minutes=_clock[0])).isoformat().replace("+00:00", "Z")


BRANCH = "fix/fraction-scaling"


def user(text, images=()):
    content = [{"type": "text", "text": text}] + [img_block(i) for i in images]
    records.append({"type": "user", "timestamp": ts(), "cwd": CWD, "gitBranch": BRANCH,
                    "message": {"content": content}})


def meta(text):
    records.append({"type": "user", "isMeta": True, "timestamp": ts(), "cwd": CWD,
                    "message": {"content": [{"type": "text", "text": text}]}})


def assistant(text=None, tools=(), out_tokens=520):
    content = []
    if text:
        content.append({"type": "text", "text": text})
    for name, inp, _ in tools:
        content.append({"type": "tool_use", "id": f"tu_{len(records)}_{name}",
                        "name": name, "input": inp})
    records.append({"type": "assistant", "timestamp": ts(), "cwd": CWD, "gitBranch": BRANCH,
                    "message": {"content": content, "usage": {"output_tokens": out_tokens}}})
    records.append({"type": "system", "subtype": "turn_duration",
                    "durationMs": 190_000 + 40_000 * len(tools), "messageCount": len(records),
                    "timestamp": ts()})
    results = [{"type": "tool_result", "tool_use_id": f"tu_{len(records)-1}_{name}",
                "content": res} for name, _, res in tools if res is not None]
    if results:
        records.append({"type": "user", "timestamp": ts(), "cwd": CWD,
                        "message": {"content": results}})


records.append({"type": "ai-title",
                "aiTitle": "Keep fractional amounts exact through the unit scaler"})

user("the unit scaler is wrong for fractions. `scale('1/2 cup', 3)` gives me `1.5 cup` "
     "instead of `1 1/2 cups`. also the plural is off.")

assistant("Two separate bugs sharing one function. Let me look at the scaler and its tests "
          "before changing anything.",
          tools=[("Read", {"file_path": f"{CWD}/recipe/units.py"},
                  "  1\timport re\n  2\t\n  3\tFRACTIONS = {'1/2': 0.5, '1/3': 0.333, "
                  "'1/4': 0.25}\n  4\t\n  5\tdef scale(amount, factor):\n"
                  "  6\t    qty, unit = amount.split(' ', 1)\n"
                  "  7\t    return f'{FRACTIONS.get(qty, float(qty)) * factor} {unit}'\n"),
                 ("Read", {"file_path": f"{CWD}/tests/test_units.py"},
                  "  1\tdef test_scale_whole():\n  2\t    assert scale('2 cups', 2) == '4 cups'\n"
                  "  3\t\n  4\tdef test_scale_fraction():\n"
                  "  5\t    assert scale('1/2 cup', 3) == '1 1/2 cups'\n"),
                 ("Grep", {"pattern": "scale\\(", "path": CWD},
                  "recipe/views.py:44:    scaled = scale(ing.amount, servings)\n"
                  "recipe/export.py:12:    line = scale(row.amount, mult)\n"
                  "tests/test_units.py:2,5\n")])

assistant("""Confirmed, and the cause is upstream of the formatting.

`FRACTIONS` maps to **floats**, so `1/2` becomes `0.5` the moment it is parsed and the
fraction is gone before anything tries to print it. No amount of output formatting can
recover it. The pluralisation bug is the same shape: `unit` is echoed back verbatim, so
it can never change with the quantity.

| Input | Now | Expected |
|---|---|---|
| `scale('1/2 cup', 3)` | `1.5 cup` | `1 1/2 cups` |
| `scale('2 cups', 2)` | `4 cups` | `4 cups` |
| `scale('1/4 tsp', 2)` | `0.5 tsp` | `1/2 tsp` |

The fix is to keep the value exact all the way through, which
[the fractions module](https://docs.python.org/3/library/fractions.html) already does:

```python
from fractions import Fraction

def scale(amount, factor):
    qty, unit = amount.split(" ", 1)
    value = Fraction(qty) * factor
    return f"{_render(value)} {_plural(unit, value)}"
```

`Fraction('1/2') * 3` is `Fraction(3, 2)`, so the exact value survives and `_render` can
decide how to show it. Nothing else in the module needs to change.""")

assistant(tools=[
    ("TodoWrite", {"todos": [
        {"content": "Parse amounts with Fraction instead of float", "status": "completed"},
        {"content": "Render improper fractions as mixed numbers", "status": "completed"},
        {"content": "Pluralise the unit from the scaled value", "status": "in_progress"},
        {"content": "Add cases for tsp/tbsp and 1/3", "status": "pending"}]}, None),
    ("Edit", {"file_path": f"{CWD}/recipe/units.py",
              "old_string": "FRACTIONS = {'1/2': 0.5",
              "new_string": "from fractions import Fraction"}, "Edit applied to units.py"),
    ("Edit", {"file_path": f"{CWD}/recipe/units.py",
              "old_string": "def scale(amount, factor):",
              "new_string": "def scale(amount, factor):"}, "Edit applied to units.py"),
    ("Write", {"file_path": f"{CWD}/recipe/format.py", "content": "def _render(value): ..."},
     "Created format.py"),
    ("Bash", {"command": "pytest -q tests/test_units.py"},
     "....F.....\nFAILED test_units.py::test_plural_half\n"
     "  assert scale('1/2 cup', 1) == '1/2 cup'\n  AssertionError: got '1/2 cups'\n"
     "9 passed, 1 failed in 0.11s")])

assistant("Before I touch the pluralisation, let me check that a half really is singular "
          "in recipe writing rather than something I remember wrong.",
          tools=[("WebSearch", {"query": "recipe style guide fraction singular half cup"},
                  "1. Serious Eats style notes on measurements\n"
                  "2. The Chicago Manual of Style 9.19 on quantities"),
                 ("WebFetch", {"url": "https://www.seriouseats.com/how-to-write-a-recipe"},
                  "Amounts of one or less take the singular unit: 1/2 cup, 1 cup. "
                  "Anything above one is plural.")])

assistant("""One case left, and it is a real edge rather than a typo: **a half is singular in
recipe English.** `1/2 cup`, not `1/2 cups`. The rule is not "anything other than 1 is
plural" but "less than or equal to 1 stays singular".

```python
def _plural(unit, value):
    return unit if value <= 1 else unit + "s"
```""",
          tools=[("Edit", {"file_path": f"{CWD}/recipe/format.py",
                           "old_string": "value != 1", "new_string": "value <= 1"},
                  "Edit applied to format.py"),
                 ("Bash", {"command": "pytest -q"},
                  "....................\n20 passed in 0.44s")])

user("nice. here's the screen it feeds", images=[shot_app(
    "Tonight", [("Miso butter noodles", "serves 2 · 18 min"),
                ("Lentil soup", "serves 4 · 40 min"),
                ("Sheet-pan chicken", "serves 3 · 35 min")])])

assistant("""The scaled amounts now render as fractions in the ingredient list. Test run
below, and the screen with servings set to 3.""",
          tools=[("Bash", {"command": "pytest -q && open -a Simulator"},
                  "20 passed in 0.44s")])

user("can you show the before/after so I can put it in the changelog? we follow "
     "https://keepachangelog.com/en/1.1.0/ if that matters",
     images=[shot_terminal()])

meta("""# Changelog conventions

Loaded because the prompt mentioned a changelog. Entries are grouped under Added / Fixed /
Changed, newest release first, and every Fixed line names the user-visible symptom rather
than the internal cause. Dates are ISO. Do not reference issue numbers that are not public.

(This block is a skill payload injected by the system. It is not something the user typed,
which is why the viewer renders it collapsed and greyed rather than as a prompt.)""")

assistant("""Two lines, symptom-first:

```markdown
### Fixed
- Scaling a fractional amount no longer turns it into a decimal
  (`1/2 cup` × 3 now reads `1 1/2 cups`, not `1.5 cup`).
- Units stay singular at or below one (`1/2 cup`, not `1/2 cups`).
```""",
          tools=[("Bash", {"command": "git commit -am 'fix(units): keep fractions exact'"},
                  "[main 4a91c2e] fix(units): keep fractions exact\n"
                  " 3 files changed, 41 insertions(+), 12 deletions(-)")])

user("perfect, and here's the pantry screen after the same change",
     images=[shot_app("Pantry", [("Flour", "1 1/2 cups left"),
                                 ("Miso", "2/3 cup left"),
                                 ("Butter", "half a stick")], highlight=1)])

assistant("""All twenty tests pass and both screens read the way a recipe would be written.

The thing worth remembering from this one: the display bug was never in the display. Once
`1/2` had been turned into `0.5` at parse time, no formatting layer could have recovered
it. Fixing it in `_render` would have produced code that looks right, passes a narrow test,
and stays wrong for every value the lookup table does not contain.""", out_tokens=340)

OUT.mkdir(exist_ok=True)
path = OUT / "sample-session.jsonl"
with path.open("w") as f:
    for r in records:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(f"✅ {path}  ({path.stat().st_size/1024:.0f} KB · {len(records)} records)")
