#!/usr/bin/env python3
"""Package a Claude Code session transcript into a standalone HTML file.

  python3 claude_transcript_viewer.py              # list the 20 most recent sessions
  python3 claude_transcript_viewer.py 3            # convert #3, write to ~/Desktop
  python3 claude_transcript_viewer.py 3 <out_dir>  # choose the output directory
  python3 claude_transcript_viewer.py <path.jsonl> # convert a specific file
  python3 claude_transcript_viewer.py --build      # rebuild viewer.html from src/

This script does NOT render anything. All parsing and rendering lives in `src/viewer.js`,
which is also what powers the drag-and-drop `viewer.html`. Here we only do the three jobs a
browser cannot do for itself:

  1. find your sessions under ~/.claude/projects/
  2. inline screenshots that the transcript references by path instead of embedding
  3. drop the records that only add weight, and trim oversized tool payloads

…then inject the result into the same viewer shell. One renderer, two entry points.
"""
import base64
import hashlib
import json
import shutil
import subprocess
import mimetypes
import re
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "src"
SHELL = HERE / "viewer.html"

PROJECTS = Path.home() / ".claude" / "projects"
IMG_RE = re.compile(r"(/Users/[^\s'\"<>]+\.(?:png|jpg|jpeg|gif|webp))", re.I)
MAX_INPUT = 900
MAX_RESULT = 1400
MAX_EMBED_BYTES = 8_000_000


# ---------- build the shell ----------

def sha256_csp(text):
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode()).digest()).decode() + "'"


def build_shell():
    """Inline src/viewer.css + src/viewer.js into a self-contained viewer.html.

    The CSP is written here because it carries the hashes of those two blocks. It is what
    turns "makes no network requests" from a promise into something the browser enforces:
    default-src 'none' means nothing can be fetched at all, and only the one script whose
    hash is listed may run. A transcript is injected as inert JSON, so it is never covered
    by script-src in the first place.
    """
    css, js = (SRC / "viewer.css").read_text(), (SRC / "viewer.js").read_text()
    csp = ("default-src 'none'; "
           f"script-src {sha256_csp(js)}; "
           f"style-src {sha256_csp(css)}; "
           "img-src data:; "
           "connect-src 'none'; "
           "base-uri 'none'; "
           "form-action 'none'")
    page = (SRC / "viewer.template.html").read_text()
    page = page.replace("<!--{{CSP}}-->",
                        f'<meta http-equiv="Content-Security-Policy" content="{csp}">')
    page = page.replace("/*{{CSS}}*/", css).replace("/*{{JS}}*/", js)
    SHELL.write_text(page)
    print(f"✅ viewer.html rebuilt ({SHELL.stat().st_size/1024:.0f} KB, self-contained)")


# ---------- session discovery ----------

def all_sessions(include_agents=False):
    files = [p for p in PROJECTS.glob("*/*.jsonl") if p.parent.name != "memory"]
    if include_agents:
        # Subagent runs are logged separately, one level down, in the identical format.
        files += list(PROJECTS.glob("*/*/subagents/**/*.jsonl"))
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return files


def count_agents():
    return sum(1 for _ in PROJECTS.glob("*/*/subagents/**/*.jsonl"))


def project_of(path):
    """Project name, whether this is a session or a subagent run nested under one."""
    p = Path(path).resolve()
    for parent in p.parents:
        if parent.parent == PROJECTS:
            name = parent.name.split("-")[-1] or "unknown"
            return name + ("·sub" if "subagents" in p.parts else "")
    return p.parent.name or "session"      # a file from outside ~/.claude/projects


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(c.get("text", "") for c in content
                         if isinstance(c, dict) and c.get("type") == "text")
    return ""


def first_user_line(path):
    """The first prompt you actually typed. Injected payloads carry isMeta and don't count."""
    try:
        with open(path) as f:
            for line in f:
                d = json.loads(line)
                if d.get("type") == "user" and not d.get("isMeta"):
                    t = " ".join(text_of(d.get("message", {}).get("content", "")).split())
                    if t and not t.startswith("<"):
                        return t[:60]
    except Exception:
        pass
    return "(no preview)"


def list_sessions(limit=20, include_agents=False):
    for i, p in enumerate(all_sessions(include_agents)[:limit], 1):
        when = datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
        print(f"{i:2}. [{when}] {project_of(p):<14} "
              f"{p.stat().st_size/1_048_576:5.1f}MB  {first_user_line(p)}")
    if not include_agents and (n := count_agents()):
        print(f"\n({n} subagent transcripts hidden — add --agents to list them too)")


# ---------- prepare records ----------

def embed_disk_images(text):
    """Screenshots referenced by path: read them now, while the file still exists.

    A browser cannot reach outside its sandbox, so this is the one enrichment the
    drag-and-drop path can't do for itself.
    """
    blocks = []
    for path in IMG_RE.findall(text):
        p = Path(path)
        if p.is_file() and p.stat().st_size < MAX_EMBED_BYTES:
            mime = mimetypes.guess_type(p.name)[0] or "image/png"
            blocks.append({"type": "image", "source": {
                "type": "base64", "media_type": mime,
                "data": base64.b64encode(p.read_bytes()).decode()}})
    return blocks


def trim(value, limit):
    if isinstance(value, str) and len(value) > limit:
        return value[:limit] + f"\n… (truncated, {len(value):,} chars total)"
    return value


def prepare(path):
    """Read the transcript and keep only what the viewer needs, image-enriched."""
    out, stats = [], {"images": 0, "dropped": 0}
    with open(path) as f:
        for line in f:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            typ = rec.get("type")
            if typ == "ai-title" and rec.get("aiTitle"):
                out.append({"type": "ai-title", "aiTitle": rec["aiTitle"]})
                continue
            if typ == "system" and rec.get("subtype") == "turn_duration":
                out.append({"type": "system", "subtype": "turn_duration",
                            "durationMs": rec.get("durationMs", 0),
                            "messageCount": rec.get("messageCount", 0)})
                continue
            if typ not in ("user", "assistant"):
                stats["dropped"] += 1
                continue

            msg = rec.get("message") or {}
            content = msg.get("content")
            slim = {"type": rec["type"], "timestamp": rec.get("timestamp", ""),
                    "message": {"content": content, "usage": msg.get("usage") or {}}}
            for k in ("isMeta", "cwd", "gitBranch", "version", "attributionSkill"):
                if rec.get(k):
                    slim[k] = rec[k]
            if rec.get("isSidechain"):
                slim["isSidechain"] = True
            tur = rec.get("toolUseResult")
            if isinstance(tur, dict):
                # stdout/stderr/interrupted are flattened away in tool_result; keep the parts
                # that change how a result should be read.
                keep = {k: trim(v, MAX_RESULT) if isinstance(v, str) else v
                        for k, v in tur.items()
                        if k in ("stdout", "stderr", "interrupted") and v not in (None, "", False)}
                if keep:
                    slim["toolUseResult"] = keep

            if isinstance(content, list):
                blocks = []
                for b in content:
                    if not isinstance(b, dict):
                        continue
                    t = b.get("type")
                    if t == "tool_result":
                        rc = b.get("content")
                        if isinstance(rc, list):
                            rc = "\n".join(x.get("text", "") for x in rc if isinstance(x, dict))
                        blocks.append({"type": "tool_result", "tool_use_id": b.get("tool_use_id"),
                                       "content": trim(rc or "", MAX_RESULT)})
                    elif t == "tool_use":
                        inp = b.get("input")
                        if isinstance(inp, dict):
                            inp = {k: trim(v, MAX_INPUT) for k, v in inp.items()}
                        blocks.append({"type": "tool_use", "id": b.get("id"),
                                       "name": b.get("name"), "input": inp})
                    elif t == "thinking":
                        # signature only — Claude Code does not persist the reasoning text
                        blocks.append({"type": "thinking", "thinking": b.get("thinking", "")})
                    else:
                        blocks.append(b)
                        if t == "image":
                            stats["images"] += 1
                # a text-only record may still name screenshots sitting on disk
                if not any(b.get("type") == "image" for b in blocks):
                    extra = embed_disk_images(text_of(blocks))
                    blocks += extra
                    stats["images"] += len(extra)
                slim["message"]["content"] = blocks
            elif isinstance(content, str) and content.strip():
                extra = embed_disk_images(content)
                if extra:
                    slim["message"]["content"] = [{"type": "text", "text": content}] + extra
                    stats["images"] += len(extra)

            out.append(slim)
    return out, stats


def find(query, include_agents=False):
    """Search every transcript and hand the hits back as a numbered list.

    Uses ripgrep when a real binary is on PATH, and falls back to a byte scan otherwise.
    The fallback is not a compromise: 1.4 GB of transcripts takes about two seconds, which
    is fine for something you type once, and it keeps the promise that this runs anywhere
    Python does. A browser-side index would be slower than either and would have to be
    built first.
    """
    needle = query.lower().encode()
    hits = {}

    rg = shutil.which("rg")
    if rg:
        out = subprocess.run(
            [rg, "--count-matches", "--no-heading", "-i", "--glob", "*.jsonl", "--",
             query, str(PROJECTS)], capture_output=True, text=True).stdout
        for line in out.splitlines():
            path, _, count = line.rpartition(":")
            if path:
                hits[Path(path)] = int(count)
    else:
        pattern = "*/*/subagents/**/*.jsonl" if include_agents else None
        paths = list(PROJECTS.glob("*/*.jsonl"))
        if include_agents:
            paths += list(PROJECTS.glob(pattern))
        for p in paths:
            try:
                n = p.read_bytes().lower().count(needle)
            except OSError:
                continue
            if n:
                hits[p] = n

    if not include_agents:
        hits = {p: c for p, c in hits.items() if "subagents" not in p.parts}
    if not hits:
        print(f"No transcript mentions {query!r}.")
        return []

    order = sorted(hits, key=lambda p: (-hits[p], -p.stat().st_mtime))
    print(f"{len(order)} transcripts mention {query!r}:\n")
    for i, p in enumerate(order[:20], 1):
        when = datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
        print(f"{i:2}. [{when}] {project_of(p):<14} {hits[p]:>4}x  {first_user_line(p)}")
    if len(order) > 20:
        print(f"\n… and {len(order) - 20} more. Narrow the query to see them.")
    print(f'\nOpen one with:  python3 claude_transcript_viewer.py --find "{query}" <number>')
    return order


def convert(path, out_dir):
    path = Path(path)
    if not SHELL.exists():
        build_shell()

    records, stats = prepare(path)
    when = datetime.fromtimestamp(path.stat().st_mtime)
    stem = f"claude-{project_of(path)}-{when:%Y-%m-%d}-{path.stem[:8]}"

    # Inert JSON, not code: a hostile transcript has no script context to break out of.
    payload = json.dumps({"records": records, "src": stem},
                         ensure_ascii=False).replace("<", "\\u003c")
    inject = (f'<script type="application/json" id="transcript-data">{payload}</script>'
              "\n</head>")
    page = SHELL.read_text().replace("</head>", inject, 1)

    out = Path(out_dir) / f"{stem}.html"
    out.write_text(page)
    print(f"✅ {out.name}  ({out.stat().st_size/1_048_576:.1f}MB · "
          f"{len(records)} records · {stats['images']} images embedded · "
          f"{stats['dropped']} non-message records dropped)")
    return out


REPO_URL = "https://github.com/alexxxtat/claude-transcript-viewer"
DEMO_BAR = (
    '<div class="demobar">'
    '<b>Live demo</b>'
    '<span>A fictional session, safe to click around. Drop a <code>.jsonl</code> of your own and '
    'it is parsed here in the page, never uploaded &mdash; but for real transcripts prefer the '
    'downloaded file, which you can verify by reading it and running it with Wi-Fi off.</span>'
    f'<a href="{REPO_URL}/raw/main/viewer.html" download>&#8595; Download viewer.html</a>'
    f'<a href="{REPO_URL}">Source</a>'
    '</div>\n'
)


def demo_page():
    """Rebuild docs/index.html: the shell, the fictional session, and a banner.

    This is a third artifact generated from src/, which is a third place that can silently
    fall behind it. tools/lint.py fails when it does; without that check the published page
    would keep demonstrating whatever the code looked like the last time someone remembered.
    """
    build_shell()
    records, _ = prepare(HERE / "demo" / "sample-session.jsonl")
    payload = json.dumps({"records": records, "src": "sample-session"},
                         ensure_ascii=False).replace("<", "\\u003c")
    page = SHELL.read_text().replace(
        "</head>",
        f'<script type="application/json" id="transcript-data">{payload}</script>\n</head>', 1)
    page = page.replace("<body>", f"<body>\n{DEMO_BAR}", 1)

    out = HERE / "docs" / "index.html"
    out.write_text(page)
    print(f"✅ docs/index.html rebuilt ({out.stat().st_size/1_048_576:.1f}MB · "
          f"{len(records)} records) — GitHub Pages serves this from /docs")


if __name__ == "__main__":
    args = sys.argv[1:]
    agents = "--agents" in args
    args = [a for a in args if a != "--agents"]

    if args and args[0] in ("--build", "-b"):
        build_shell()
    elif args and args[0] == "--demo-page":
        demo_page()
    elif args and args[0] in ("--find", "-f"):
        if len(args) < 2:
            sys.exit('Usage: --find "<query>" [number] [out_dir]')
        found = find(args[1], agents)
        if len(args) > 2 and found:
            out = Path(args[3]) if len(args) > 3 else Path.home() / "Desktop"
            page = convert(found[int(args[2]) - 1], out)
            if sys.platform == "darwin":
                subprocess.run(["open", str(page)])
    elif not args:
        list_sessions(include_agents=agents)
        print("\nRun again with a number to convert, e.g. "
              "python3 claude_transcript_viewer.py 1")
        print("Or just open viewer.html and drag a .jsonl onto it — no Python needed.")
    else:
        out_dir = Path(args[1]) if len(args) > 1 else Path.home() / "Desktop"
        target = all_sessions(agents)[int(args[0]) - 1] if args[0].isdigit() else args[0]
        convert(target, out_dir)
