/* Claude Transcript Viewer — parsing, rendering and UI.
 *
 * This is the ONLY implementation. Two entry points feed it the same records:
 *   · a .jsonl dropped onto the page (parsed here, in the browser)
 *   · window.__TRANSCRIPT__, inlined by claude_transcript_viewer.py
 * The Python side never renders anything; it slims records, embeds disk-referenced
 * screenshots, and injects the result into this same shell.
 */
(() => {
'use strict';

// Captured before anything renders, so "Export" can rebuild a clean copy of this page.
const SHELL = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];

const TOOL_ICON = {
  Bash: '⚡', Read: '📖', Edit: '✏️', Write: '📝', NotebookEdit: '📝',
  Glob: '🔍', Grep: '🔍', WebSearch: '🌐', WebFetch: '🌐',
  Task: '🤖', Agent: '🤖', Skill: '🧩', TodoWrite: '☑️',
  SendUserFile: '📤', Artifact: '🎨', AskUserQuestion: '❓', ToolSearch: '🔎',
  TaskCreate: '📌', TaskUpdate: '📌', TaskStop: '📌', Monitor: '👁', Workflow: '🔀',
};
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const MAX_INPUT = 900, MAX_RESULT = 1400;

// ───────────────────────── markdown ─────────────────────────

const esc = s => String(s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function inlineMd(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
    // Obsidian wikilinks have no target outside a vault; mark them so they read as
    // references instead of as stray brackets.
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (m, n) => `<span class="wikilink">${n}</span>`);
}

// Filled as headings are rendered, so a document's contents list is built from what the
// page actually produced rather than from a second pass over the source that could disagree.
let HEADINGS = [];

/** A run of non-list lines: a heading if it opens with #, then whatever follows.
 *  One implementation, so the heading path cannot be skipped depending on what comes after. */
function emitProse(lines, out) {
  if (!lines.length) return;
  let rest = lines;
  if (/^#{1,6}\s/.test(lines[0])) {
    const lvl = Math.min(lines[0].match(/^#+/)[0].length + 1, 6);
    const label = lines[0].replace(/^#+\s*/, '');
    const id = 'h' + (HEADINGS.length + 1);
    // `label` has already been through esc(); escaping it again in the contents list
    // would render an ampersand as &amp;.
    HEADINGS.push({ lvl, id, label: label.replace(/[*`_]/g, '') });
    out.push(`<h${lvl} id="${id}">` + inlineMd(label) + `</h${lvl}>`);
    rest = lines.slice(1);
  }
  const body = rest.join('\n').trim();
  if (body) out.push('<p>' + inlineMd(body).replace(/\n/g, '<br>') + '</p>');
}

function mdToHtml(text) {
  const out = [];
  text.split('```').forEach((part, i) => {
    if (i % 2 === 1) {
      const nl = part.indexOf('\n');
      const code = nl === -1 ? part : part.slice(nl + 1);
      out.push('<div class="codewrap"><button class="copy">Copy</button><pre><code>' +
        esc(code.replace(/\s+$/, '')) + '</code></pre></div>');
      return;
    }
    esc(part).split(/\n\s*\n/).forEach(block => {
      if (!block.trim()) return;
      const lines = block.split('\n');
      const isItem = l => /^\s*([-*+]|\d+\.)\s/.test(l);
      const firstItem = lines.findIndex(isItem);
      if (firstItem !== -1 && lines.slice(firstItem).every(isItem)) {
        // A lead-in followed by a list is the most common shape in these documents, and
        // that lead-in is very often a heading with no blank line under it. Handing it
        // straight to the paragraph branch printed "## Concepts" as body text.
        emitProse(lines.slice(0, firstItem), out);
        const items = lines.slice(firstItem);
        const tag = /^\s*\d+\.\s/.test(items[0]) ? 'ol' : 'ul';
        out.push(`<${tag}>` + items.map(l =>
          '<li>' + inlineMd(l.replace(/^\s*([-*+]|\d+\.)\s/, '')) + '</li>').join('') + `</${tag}>`);
      } else if (lines[0].trimStart().startsWith('|') && lines.length > 1) {
        const rows = [];
        lines.forEach((l, j) => {
          const cells = l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
          if (cells.every(c => /^[-: ]*$/.test(c))) return;
          const tag = j === 0 ? 'th' : 'td';
          rows.push('<tr>' + cells.map(c => `<${tag}>${inlineMd(c)}</${tag}>`).join('') + '</tr>');
        });
        out.push('<div class="tablewrap"><table>' + rows.join('') + '</table></div>');
      } else {
        emitProse(lines, out);
      }
    });
  });
  return out.join('\n');
}

const clip = (s, limit) => s.length <= limit ? s
  : s.slice(0, limit) + `\n… (truncated, ${s.length.toLocaleString()} chars total)`;
const preBlock = (s, limit) => '<pre><code>' + esc(clip(s, limit)) + '</code></pre>';

// ───────────────────────── parsing ─────────────────────────

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.filter(c => c && c.type === 'text').map(c => c.text || '').join('\n');
  return '';
}

// A transcript is untrusted input: someone can hand you a .jsonl. Both halves of a data:
// URI are attacker-controlled, and they land in an `src` attribute, so a media_type of
// `png" onerror="…` would execute. Whitelist the type and require real base64 instead of
// escaping after the fact.
const MEDIA_OK = /^image\/(png|jpeg|jpg|gif|webp|avif)$/i;
const B64_OK = /^[A-Za-z0-9+/=\s]+$/;

function imagesOf(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const b of content) {
    if (!b || b.type !== 'image' || !b.source || b.source.type !== 'base64') continue;
    const data = b.source.data;
    if (typeof data !== 'string' || !B64_OK.test(data)) continue;
    const type = MEDIA_OK.test(b.source.media_type || '') ? b.source.media_type : 'image/png';
    out.push(`data:${type};base64,${data.replace(/\s/g, '')}`);
  }
  return out;
}

const shortPath = (p, cwd) => (cwd && p.startsWith(cwd)) ? p.slice(cwd.length).replace(/^\/+/, '') : p;

function toolLabel(name, inp, cwd) {
  const g = k => (inp && typeof inp === 'object' && inp[k] != null) ? String(inp[k]) : '';
  switch (name) {
    case 'Bash': return g('command').split(/\s+/).join(' ').slice(0, 110) || '(empty command)';
    case 'Read': case 'Edit': case 'Write': case 'NotebookEdit':
      return shortPath(g('file_path') || g('notebook_path'), cwd);
    case 'Glob': case 'Grep':
      return (g('pattern') + (g('path') ? '  in ' + shortPath(g('path'), cwd) : '')).slice(0, 110);
    case 'WebSearch': return g('query').slice(0, 110);
    case 'WebFetch': return g('url').slice(0, 110);
    case 'Task': case 'Agent': return g('description').slice(0, 110);
    case 'Skill': return g('skill');
    case 'TodoWrite': {
      const t = (inp && inp.todos) || [];
      return `${t.filter(x => x.status === 'completed').length} / ${t.length} done`;
    }
    default: return JSON.stringify(inp || {}).slice(0, 110);
  }
}

function todoHtml(inp) {
  const rows = ((inp && inp.todos) || []).map(t => {
    const mark = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜️';
    const cls = t.status === 'completed' ? ' class="done"' : '';
    return `<li${cls}>${mark} ${esc(t.content || t.activeForm || '')}</li>`;
  });
  return '<ul class="todo">' + rows.join('') + '</ul>';
}

/** records -> { items, files, tools, tokensOut, cwd, title } */
function parseRecords(records) {
  const results = new Map();
  let cwd = '', tokensOut = 0, title = '', aiTitle = '';
  let branch = '', version = '', durationMs = 0, turns = 0, sidechain = 0;

  for (const r of records) {
    if (r.type === 'ai-title') { aiTitle = r.aiTitle || aiTitle; continue; }
    if (r.type === 'system' && r.subtype === 'turn_duration') {
      durationMs += r.durationMs || 0; turns++; continue;
    }
    if (!cwd && r.cwd) cwd = r.cwd;
    if (!branch && r.gitBranch) branch = r.gitBranch;
    if (!version && r.version) version = r.version;
    if (r.isSidechain) sidechain++;
    const usage = (r.message && r.message.usage) || {};
    tokensOut += usage.output_tokens || 0;
    const c = r.message && r.message.content;
    if (Array.isArray(c))
      for (const b of c)
        if (b && b.type === 'tool_result') {
          const rc = b.content;
          results.set(b.tool_use_id, typeof rc === 'string' ? rc
            : Array.isArray(rc) ? rc.filter(x => x && x.text).map(x => x.text).join('\n') : '');
        }
    if (!title && r.type === 'user' && !r.isMeta) {
      const t = textOf(c).trim().split(/\s+/).join(' ');
      if (t && !t.startsWith('<')) title = t.slice(0, 60);
    }
  }

  const items = [], files = new Map(), tools = new Map();
  const skills = new Set();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

  for (const r of records) {
    if (r.type !== 'user' && r.type !== 'assistant') continue;
    if (r.attributionSkill) skills.add(r.attributionSkill);
    const content = (r.message && r.message.content) || '';
    const ts = r.timestamp || '';

    if (r.type === 'user') {
      const text = textOf(content).trim();
      const pics = imagesOf(content);
      if (!text && !pics.length) continue;
      if (text.startsWith('<') && !pics.length) continue;
      items.push({ kind: r.isMeta ? 'meta' : 'user', text, pics, ts });
      continue;
    }

    const blocks = Array.isArray(content) ? content : [{ type: 'text', text: String(content) }];
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'thinking') {
        // Claude Code persists only a signature here — the reasoning text is not saved.
        // Rendered anyway so it appears automatically if that ever changes.
        const t = (b.thinking || '').trim();
        if (t) items.push({ kind: 'think', text: t, ts });
      } else if (b.type === 'text') {
        const t = (b.text || '').trim();
        if (t) items.push({ kind: 'assistant', text: t, pics: imagesOf([b]), ts });
      } else if (b.type === 'tool_use') {
        const name = b.name || '?', inp = b.input || {};
        bump(tools, name);
        if (WRITE_TOOLS.has(name)) {
          const fp = inp.file_path || inp.notebook_path;
          if (fp) bump(files, shortPath(fp, cwd));
        }
        items.push({
          kind: 'tool', name, input: inp, ts,
          label: toolLabel(name, inp, cwd), result: results.get(b.id) || '',
          extra: r.toolUseResult || null,
        });
      }
    }
  }
  return {
    items, files, tools, tokensOut, cwd, skills,
    branch, version, durationMs, turns, sidechain,
    title: aiTitle || title || '(no preview)',
    subtitle: aiTitle ? title : '',
  };
}

/** A plain markdown file, shaped like a model so it goes through the same renderer.
 *
 *  This is not a second feature: the markdown renderer was already here for message bodies,
 *  and refusing a .md file was an artificial restriction rather than a design. Everything
 *  transcript-specific (speakers, filters, the prompt index) hides, because none of it means
 *  anything for a document.
 */
function markdownModel(raw, name) {
  // Nearly every .md worth reading opens with YAML frontmatter, which is metadata for the
  // tool that wrote it and noise for the person reading it.
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const text = (fm ? raw.slice(fm[0].length) : raw).replace(/^\s+/, '');
  const meta = fm ? fm[1] : '';
  const heading = (text.match(/^#\s+(.+)$/m) || [])[1]
    || (meta.match(/^name:\s*(.+)$/m) || [])[1];
  return {
    items: [{ kind: 'doc', text, ts: '' }],
    frontmatter: meta.trim(),
    files: new Map(), tools: new Map(), skills: new Set(),
    tokensOut: 0, cwd: '', branch: '', version: '',
    durationMs: 0, turns: 0, sidechain: 0,
    title: (heading || name.replace(/\.(md|markdown|txt)$/i, '')).slice(0, 80),
    subtitle: '', isDoc: true,
  };
}

/** Split raw JSONL text into records, skipping unparseable lines. */
function parseJsonl(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* partial write / corrupt line */ }
  }
  return out;
}

// ───────────────────────── rendering ─────────────────────────

const dur = ms => {
  if (!ms) return '';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

const LINKS = [];
const URL_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(?<!\()\b(https?:\/\/[^\s<>"')\]]+)/g;

/** Every address the session cited, in order, each remembering which message it came from.
 *  Same shape as media mode: an index is only useful if it can take you back to the context. */
function collectLinks(text, mid, seq) {
  for (const m of text.matchAll(URL_RE)) {
    const url = m[2] || m[3];
    if (!url) continue;
    const clean = url.replace(/[.,;:]+$/, '');
    const hit = LINKS.find(l => l.url === clean);
    if (hit) { hit.count++; continue; }
    LINKS.push({ url: clean, label: m[1] || '', mid, seq, count: 1 });
  }
}

function render(model, srcName) {
  MSG_TEXT.clear();
  HEADINGS = [];
  LINKS.length = 0;
  const { items, files, tools, tokensOut, title, subtitle,
          branch, durationMs, turns, sidechain, skills } = model;
  const body = [], toc = [], run = [];
  const n = { user: 0, assistant: 0, think: 0, tool: 0, meta: 0, img: 0 };
  let seq = 0;

  const flushRun = () => {
    if (!run.length) return;
    const kinds = new Map();
    run.forEach(([name]) => kinds.set(name, (kinds.get(name) || 0) + 1));
    const head = [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, v]) => (TOOL_ICON[k] || '🔧') + k + (v > 1 ? '×' + v : '')).join(' · ');
    body.push(`<details class="toolrun"><summary>🔧 ${run.length} tool actions · ${head}` +
      `</summary><div class="inner">${run.map(([, h]) => h).join('')}</div></details>`);
    run.length = 0;
  };

  let lastMid = 'm1', lastSeq = 1;
  for (const it of items) {
    if (it.kind === 'tool') {
      n.tool++;
      if (it.name === 'WebFetch' && it.input && it.input.url)
        collectLinks(String(it.input.url), lastMid, lastSeq);
      const x = it.extra || {};
      let detail = it.name === 'TodoWrite' ? todoHtml(it.input)
        : '<h6>Input</h6>' + preBlock(typeof it.input === 'string' ? it.input
          : JSON.stringify(it.input, null, 1), MAX_INPUT);
      // stdout and stderr arrive merged in tool_result; when the structured result kept
      // them apart, show them apart, because an error reads differently from output.
      if (x.stdout) detail += '<h6>Output</h6>' + preBlock(x.stdout, MAX_RESULT);
      if (x.stderr) detail += '<h6 class="err">stderr</h6>' + preBlock(x.stderr, MAX_RESULT);
      if (!x.stdout && !x.stderr && it.result)
        detail += '<h6>Result</h6>' + preBlock(it.result, MAX_RESULT);
      if (x.interrupted) detail += '<p class="warn">Interrupted before it finished.</p>';
      run.push([it.name,
        '<details class="tool"><summary>' +
        `<span class="name">${TOOL_ICON[it.name] || '🔧'} ${esc(it.name)}</span>` +
        `<span class="arg">${esc(it.label)}</span></summary>` +
        `<div class="body">${detail}</div></details>`]);
      continue;
    }
    flushRun();
    const stamp = it.ts ? `<span data-ts="${esc(it.ts)}"></span>` : '';

    if (it.kind === 'meta') {
      n.meta++;
      const head = (it.text.split('\n')[0] || '').replace(/^#+\s*/, '').trim().slice(0, 70)
        || 'Injected content';
      body.push(`<details class="meta-block"><summary>⚙️ ${esc(head)} · ` +
        `${it.text.length.toLocaleString()} chars · injected by a skill or the system, ` +
        `not typed by you</summary><div class="card">${mdToHtml(it.text)}</div></details>`);
      continue;
    }
    if (it.kind === 'doc') {
      body.push(`<div class="msg doc"><div class="card">${mdToHtml(it.text)}</div></div>`);
      continue;
    }
    if (it.kind === 'think') {
      n.think++;
      body.push('<details class="think"><summary>💭 Claude&#39;s reasoning · ' +
        `${it.text.length.toLocaleString()} chars</summary>` +
        `<div class="card">${mdToHtml(it.text)}</div></details>`);
      continue;
    }

    seq++; n[it.kind]++;
    const pics = it.pics || [];
    n.img += pics.length;
    const mid = 'm' + seq;
    const cap = esc(it.text.split(/\s+/).join(' ').slice(0, 38) || '(image only)');
    const shots = pics.length ? '<div class="shots">' + pics.map(u =>
      `<img src="${esc(u)}" loading="lazy" data-msg="${mid}" data-num="#${seq}" data-cap="${cap}">`
    ).join('') + '</div>' : '';
    if (it.kind === 'user') toc.push(`<a href="#${mid}">#${seq} ${cap}</a>`);
    MSG_TEXT.set(mid, it.text);
    lastMid = mid; lastSeq = seq;
    collectLinks(it.text, mid, seq);
    body.push(`<div class="msg ${it.kind}" id="${mid}"><div class="who">` +
      `<b>${it.kind === 'user' ? 'You' : 'Claude'}</b>` +
      `<a class="num" href="#${mid}">#${seq}</a>${stamp}` +
      `<button class="msgcopy" data-m="${mid}" title="Copy this message">⧉</button></div>` +
      `<div class="card">${mdToHtml(it.text)}${shots}</div></div>`);
  }
  flushRun();

  let filebar = '';
  if (files.size) {
    const top = [...files.entries()].sort((a, b) => b[1] - a[1]);
    const lis = top.slice(0, 24).map(([f, c]) => `<li>${esc(f)} <b>×${c}</b></li>`).join('');
    const more = top.length > 24 ? `(+${top.length - 24} more)` : '';
    filebar = `<div class="filebar"><h3>📁 ${files.size} files touched in this session ` +
      `${more}</h3><ul>${lis}</ul></div>`;
  }

  const box = (k, label, c, on) => !c ? '' :
    `<label><input type="checkbox" data-k="${k}"${on ? ' checked' : ''}>` +
    `${label} <span class="n">${c}</span></label>`;

  $('#filters').innerHTML =
    box('user', 'You', n.user, true) +
    box('assistant', 'Claude', n.assistant, true) +
    box('think', '💭 Reasoning', n.think, false) +
    box('tool', '🔧 Tools', n.tool, false) +
    box('meta', '⚙️ Injected', n.meta, false);

  // Four facts earn a place on the strip; the rest sits behind ⓘ. A row of nine
  // dot-separated values reads as one long string and nothing in it stands out.
  const chip = (icon, text, title) => !text ? '' :
    `<span class="chip"${title ? ` title="${esc(title)}"` : ''}>` +
    `<b>${icon}</b>${esc(text)}</span>`;
  const topTools = [...tools.entries()].sort((a, b) => b[1] - a[1]);
  $('#stats').innerHTML =
    chip('⑂', branch, 'git branch') +
    chip('⏱', dur(durationMs) && `${dur(durationMs)} · ${turns} turns`, 'time spent') +
    chip('💬', `${n.user} prompts · ${n.assistant} replies`) +
    chip('🖼', n.img ? String(n.img) : '', 'screenshots') +
    '<button class="chip more" id="statsbtn" title="More about this session">ⓘ</button>';
  $('#statsmore').innerHTML = [
    ['Branch', branch || 'unknown'],
    ['Time', dur(durationMs) ? `${dur(durationMs)} over ${turns} turns` : 'not recorded'],
    ['Messages', `${n.user} prompts · ${n.assistant} replies`],
    ['Images', String(n.img)],
    ['Tokens out', tokensOut.toLocaleString()],
    ['Tools', topTools.map(([k, v]) => `${k}×${v}`).join(' · ') || 'none'],
    ['Skills', skills.size ? [...skills].join(', ') : 'none'],
    ['Subagent records', sidechain || '0'],
    ['Source', srcName],
  ].map(([k, v]) => `<div><span>${esc(k)}</span>${esc(String(v))}</div>`).join('');
  $('#statsbtn').onclick = () => $('#statsmore').classList.toggle('open');

  if (model.isDoc) {
    $('#navtitle').textContent = 'Contents';
    toc.length = 0;
    HEADINGS.forEach(h => toc.push(
      `<a href="#${h.id}" class="lvl${h.lvl}">${h.label}</a>`));
  } else {
    $('#navtitle').textContent = 'Your prompts';
  }

  document.title = title;
  $('h1').textContent = title;
  $('h1').title = subtitle ? `First prompt: ${subtitle}` : title;
  $('#toc').innerHTML = toc.join('\n') || '<a>(none)</a>';
  $('.chat').innerHTML = filebar + body.join('\n');
  $('#mediabtn').textContent = '🖼 ' + n.img;
  $('#mediabtn').hidden = !n.img;
  $('#linkbtn').textContent = '🔗 ' + LINKS.length;
  $('#linkbtn').hidden = !LINKS.length;
  $('#linkhead').textContent = `🔗 ${LINKS.length} links cited in this session`;
  $('#linklist').innerHTML = LINKS.map(l => {
    let host = l.url;
    try { host = new URL(l.url).host.replace(/^www\./, ''); } catch (e) { /* keep raw */ }
    return `<div class="linkrow"><a href="${esc(l.url)}" rel="noreferrer" target="_blank">` +
      `<b>${esc(l.label || host)}</b><span>${esc(l.url)}</span></a>` +
      `<button data-m="${l.mid}" title="Jump to where it was cited">↩ #${l.seq}</button></div>`;
  }).join('');
  $('#mediahead').textContent =
    `🖼 ${n.img} media items · click to enlarge, then jump back to its message`;
  document.body.classList.add('loaded', 'hide-think', 'hide-tool', 'hide-meta');
  document.body.classList.toggle('docmode', !!model.isDoc);
  document.body.classList.remove('picking');
  const showingEmbedded = EMBEDDED && srcName === EMBEDDED.srcName;
  $('#homebtn').innerHTML = SESSIONS.length > 1
    ? '←<span class="lbl"> All</span>'
    : (EMBEDDED && !showingEmbedded
        ? '↩<span class="lbl"> Back</span>'
        : '⌂<span class="lbl"> Home</span>');
  $('#homebtn').title = SESSIONS.length > 1 ? 'Back to the list'
    : (EMBEDDED && !showingEmbedded
        ? 'Back to this file\u2019s own transcript'
        : (EMBEDDED ? 'This file\u2019s own transcript is already shown'
                    : 'Back to the start, to open another transcript'));
  $('#homebtn').disabled = !!(EMBEDDED && showingEmbedded && SESSIONS.length < 2);
  return n;
}

// ───────────────────────── interaction ─────────────────────────

let shots = [], idx = -1;
// Message id -> the markdown the record actually held. Copying textContent would lose the
// code fences, tables and emphasis, and duplicating the text into a data- attribute would
// put every message in the file twice.
const MSG_TEXT = new Map();
const lb = () => $('#lb'), media = () => $('#media');

function wire() {
  // copy buttons on code blocks
  $$('.copy').forEach(b => b.onclick = e => {
    e.stopPropagation();
    navigator.clipboard.writeText(b.parentNode.querySelector('code').textContent);
    b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1200);
  });

  // relative timestamps
  const REL = [[31536e6, 'y'], [2592e6, 'mo'], [864e5, 'd'], [36e5, 'h'], [6e4, 'm']];
  $$('[data-ts]').forEach(el => {
    const d = new Date(el.dataset.ts);
    if (isNaN(d)) return;
    const diff = Date.now() - d;
    let s = 'just now';
    for (const [ms, u] of REL) if (diff >= ms) { s = Math.floor(diff / ms) + u + ' ago'; break; }
    el.textContent = s; el.title = d.toLocaleString();
  });

  $$('.msgcopy').forEach(b => b.onclick = () => {
    navigator.clipboard.writeText(MSG_TEXT.get(b.dataset.m) || '');
    b.textContent = '✓'; b.classList.add('ok');
    setTimeout(() => { b.textContent = '⧉'; b.classList.remove('ok'); }, 1200);
  });

  shots = $$('.shots img');
  shots.forEach((im, i) => im.onclick = () => openLb(i));
  $$('nav a').forEach(a => a.onclick = () => document.body.classList.remove('toc-open'));
  $('#mediagrid').innerHTML = '';
}

function openLb(i) {
  if (!shots.length) return;
  idx = (i + shots.length) % shots.length;
  const s = shots[idx];
  $('#lbimg').src = s.src;
  $('#lbcount').textContent = `${idx + 1} / ${shots.length}` +
    (s.dataset.cap ? '   ·   ' + s.dataset.cap : '');
  const g = $('#lbgoto');
  g.dataset.target = s.dataset.msg || '';
  g.textContent = '↩ Jump to message ' + (s.dataset.num || '');
  lb().classList.add('open'); document.body.style.overflow = 'hidden';
}
function closeLb() {
  lb().classList.remove('open'); $('#lbimg').removeAttribute('src');
  if (media().classList.contains('open')) return;   // fall back to the media grid
  document.body.style.overflow = '';
  if (idx >= 0) shots[idx].scrollIntoView({ block: 'center' });
}
function openMedia() {
  const grid = $('#mediagrid');
  if (!grid.childElementCount)
    shots.forEach((im, i) => {
      const fig = document.createElement('figure');
      const t = document.createElement('img');
      t.src = im.src; t.loading = 'lazy';
      const cap = document.createElement('figcaption');
      cap.textContent = `${im.dataset.num || ''} ${im.dataset.cap || ''}`;
      fig.append(t, cap);
      fig.onclick = () => openLb(i);
      grid.appendChild(fig);
    });
  media().classList.add('open'); document.body.style.overflow = 'hidden';
}
function closeMedia() { media().classList.remove('open'); document.body.style.overflow = ''; }

function dataToBlob(uri) {
  const [head, b64] = uri.split(',');
  const mime = (head.match(/:(.*?);/) || [, 'image/png'])[1];
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
async function toPng(blob) {
  if (blob.type === 'image/png') return blob;
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return new Promise(r => c.toBlob(r, 'image/png'));
}

// ── in-page search ──
let hits = [], cur = -1;
function clearHits() {
  $$('mark').forEach(m => {
    const p = m.parentNode;
    p.replaceChild(document.createTextNode(m.textContent), m);
    p.normalize();
  });
  hits = []; cur = -1;
}
function runSearch(q) {
  clearHits();
  const cnt = $('#cnt');
  if (q.length < 2) { cnt.textContent = ''; return; }
  const walker = document.createTreeWalker($('.layout'), NodeFilter.SHOW_TEXT, {
    acceptNode: nd => (nd.parentNode.closest('nav,script,style,summary') || !nd.nodeValue.trim())
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  const ql = q.toLowerCase(), targets = [];
  let nd;
  while ((nd = walker.nextNode())) if (nd.nodeValue.toLowerCase().includes(ql)) targets.push(nd);
  targets.forEach(node => {
    const frag = document.createDocumentFragment();
    const text = node.nodeValue, lower = text.toLowerCase();
    let i = 0, j;
    while ((j = lower.indexOf(ql, i)) !== -1) {
      frag.appendChild(document.createTextNode(text.slice(i, j)));
      const m = document.createElement('mark');
      m.textContent = text.slice(j, j + q.length);
      frag.appendChild(m); hits.push(m); i = j + q.length;
    }
    frag.appendChild(document.createTextNode(text.slice(i)));
    node.parentNode.replaceChild(frag, node);
  });
  cnt.textContent = hits.length ? '0 / ' + hits.length : 'no results';
  if (hits.length) go(0);
}
function go(k) {
  if (!hits.length) return;
  hits.forEach(h => h.classList.remove('on'));
  cur = (k + hits.length) % hits.length;
  const m = hits[cur];
  for (let d = m.closest('details'); d; d = d.parentElement.closest('details')) d.open = true;
  // a hit can sit inside a category the filter bar has hidden — re-enable it
  const hidden = m.closest('.think,.toolrun,.meta-block');
  if (hidden && getComputedStyle(hidden).display === 'none') {
    const key = hidden.classList.contains('think') ? 'think'
      : hidden.classList.contains('toolrun') ? 'tool' : 'meta';
    const cb = $(`.filters input[data-k=${key}]`);
    if (cb) { cb.checked = true; cb.onchange(); }
  }
  m.classList.add('on');
  m.scrollIntoView({ block: 'center', behavior: 'smooth' });
  $('#cnt').textContent = `${cur + 1} / ${hits.length}`;
}

function updatePill() {
  const msgs = $$('.msg'), pill = $('#pill');
  if (!msgs.length) return;
  const mid = window.innerHeight * 0.35;
  let k = 0;
  for (let i = 0; i < msgs.length; i++) if (msgs[i].getBoundingClientRect().top < mid) k = i + 1;
  pill.textContent = `${k || 1} / ${msgs.length}`;
}

// ───────────────────────── markdown ─────────────────────────

/** The same model the page renders, written as markdown.
 *
 *  Markdown export lives here rather than in the Python side on purpose: one renderer means
 *  the two can never disagree about what a transcript says. Tool runs collapse to a single
 *  line each, since a wall of tool JSON is exactly what the reader came here to avoid, and
 *  images are named rather than embedded because a base64 blob in a note is unreadable in
 *  every editor that would open it.
 */
function toMarkdown(model, srcName) {
  const { items, files, tools, tokensOut, title, branch, durationMs, turns } = model;
  const out = [`# ${title}`, ''];
  const head = [srcName, branch && `branch \`${branch}\``,
    dur(durationMs) && `${dur(durationMs)} over ${turns} turns`,
    `${tokensOut.toLocaleString()} output tokens`].filter(Boolean).join(' · ');
  out.push(`> ${head}`, '');

  if (files.size) {
    out.push(`## Files touched (${files.size})`, '');
    [...files.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([f, c]) => out.push(`- \`${f}\` ×${c}`));
    out.push('');
  }

  let seq = 0, run = [];
  const flush = () => {
    if (!run.length) return;
    const k = new Map();
    run.forEach(n => k.set(n, (k.get(n) || 0) + 1));
    out.push(`> 🔧 ${run.length} tool actions: ` +
      [...k.entries()].sort((a, b) => b[1] - a[1])
        .map(([n, c]) => c > 1 ? `${n}×${c}` : n).join(', '), '');
    run.length = 0;
  };

  for (const it of items) {
    if (it.kind === 'tool') { run.push(it.name); continue; }
    flush();
    if (it.kind === 'meta' || it.kind === 'think') continue;
    seq++;
    const when = it.ts ? new Date(it.ts).toLocaleString() : '';
    out.push(`## ${it.kind === 'user' ? 'You' : 'Claude'} · #${seq}${when ? ' · ' + when : ''}`,
      '', it.text, '');
    const pics = (it.pics || []).length;
    if (pics) out.push(`*(${pics} image${pics > 1 ? 's' : ''} in the HTML version)*`, '');
  }
  flush();
  return out.join('\n');
}

// ───────────────────────── export ─────────────────────────

function exportHtml(records, name) {
  // Same inert-JSON shape the CLI writes, so an exported file and a converted one are
  // byte-identical in structure and pass the same CSP.
  const payload = JSON.stringify({ records, src: name }).replace(/</g, '\\u003c');
  const inject = '<script type="application/json" id="transcript-data">' +
    payload + '<\/script>\n</head>';
  const html = SHELL.replace('</head>', inject);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = name.replace(/\.jsonl$/, '') + '.html';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ───────────────────────── boot ─────────────────────────

let CURRENT = null, SESSIONS = [], EMBEDDED = null;

const relTime = iso => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const REL2 = [[31536e6, 'y'], [2592e6, 'mo'], [864e5, 'd'], [36e5, 'h'], [6e4, 'm']];
  const diff = Date.now() - d;
  for (const [ms, u] of REL2) if (diff >= ms) return Math.floor(diff / ms) + u + ' ago';
  return 'just now';
};

function showPicker() {
  const rows = SESSIONS.map((s, i) => {
    const m = s.model;
    const when = (m.items.find(x => x.ts) || {}).ts || '';
    const bits = [m.branch && '⑂ ' + m.branch,
                  m.items.filter(x => x.kind === 'user').length + ' prompts',
                  m.items.filter(x => x.kind === 'tool').length + ' tools',
                  relTime(when)].filter(Boolean).join(' · ');
    return `<button class="srow" data-i="${i}">
      <span class="t">${esc(m.title)}</span>
      <span class="m">${esc(bits)}</span>
      <span class="f">${esc(s.name)}</span></button>`;
  }).join('');
  $('#picker').innerHTML =
    `<h2>${SESSIONS.length} transcripts loaded</h2><div class="rows">${rows}</div>`;
  $$('#picker .srow').forEach(b => b.onclick = () => {
    const s = SESSIONS[+b.dataset.i];
    document.body.classList.remove('picking');
    load(s.records, s.name);
  });
  // The picker is not a transcript, so nothing from the last one may survive into it.
  // Leaving the old title and chips in place was the whole reason this screen read as broken.
  CURRENT = null;
  $('h1').textContent = 'Claude Transcript Viewer';
  $('h1').removeAttribute('title');
  $('#filters').innerHTML = '';
  $('#stats').innerHTML = '';
  $('#statsmore').innerHTML = '';
  $('#statsmore').classList.remove('open');
  document.title = `${SESSIONS.length} transcripts`;
  $('#homebtn').innerHTML = '⌂<span class="lbl"> Home</span>';
  $('#homebtn').title = 'Back to the start, to open different files';
  document.body.classList.add('picking');
  document.body.classList.remove('loaded');
}

function load(records, srcName) {
  CURRENT = { records, srcName };
  const model = parseRecords(records);
  render(model, srcName);
  wire();
  updatePill();
  jumpToHash();
}

/** The browser resolves #m7 while parsing, when the messages do not exist yet, so a
 *  permalink opened cold lands at the top of the page. Re-run it once there is something
 *  to land on. */
function jumpToHash() {
  if (!location.hash) return;
  const el = document.getElementById(location.hash.slice(1));
  if (!el) return;
  requestAnimationFrame(() => {
    el.scrollIntoView({ block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1800);
  });
}

function bootStatic() {
  const drop = $('#drop'), zone = $('#drop .zone'), file = $('#fileinput'), err = $('#droperr');

  const isDoc = n => /\.(md|markdown|txt)$/i.test(n);
  const readOne = f => new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(isDoc(f.name)
      ? { name: f.name, doc: r.result }
      : { name: f.name, records: parseJsonl(r.result) });
    r.onerror = () => res({ name: f.name, records: [] });
    r.readAsText(f);
  });

  // Bulk import: dropping a folder or a multi-select lands you on a picker instead of an
  // arbitrary one of them. Files are parsed once and kept in memory, so switching between
  // sessions is instant and nothing is re-read.
  const readFiles = async list => {
    err.textContent = '';
    const files = [...list].filter(f =>
      /\.(jsonl?|md|markdown|txt)$/i.test(f.name) || f.type === '');
    if (!files.length) { err.textContent = 'Drop a .jsonl transcript, or a .md file.'; return; }
    if (files.length > 1) err.textContent = `Reading ${files.length} files…`;
    const read = await Promise.all(files.map(readOne));
    const docs = read.filter(x => x.doc && x.doc.trim());
    if (docs.length && !read.some(x => x.records && x.records.length)) {
      const d = docs[0];
      CURRENT = null;
      render(markdownModel(d.doc, d.name), d.name);
      wire(); updatePill();
      if (docs.length > 1) err.textContent = '';
      return;
    }
    const loaded = read.filter(x => x.records && x.records.length);
    err.textContent = '';
    if (!loaded.length) {
      err.textContent = 'No readable JSON lines. Are these Claude Code .jsonl transcripts?';
      return;
    }
    if (loaded.length === 1) { load(loaded[0].records, loaded[0].name); return; }
    SESSIONS = loaded.map(x => ({ ...x, model: parseRecords(x.records) }));
    showPicker();
  };
  const readFile = f => readFiles([f]);

  const cp = $('#copypath');
  if (cp) cp.onclick = () => {
    navigator.clipboard.writeText('~/.claude/projects').then(() => {
      const was = cp.textContent;
      cp.textContent = 'copied — now press ⌘⇧G and paste';
      setTimeout(() => cp.textContent = was, 2400);
    });
  };
  zone.onclick = () => file.click();
  file.onchange = () => file.files.length && readFiles(file.files);
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', e => e.dataTransfer.files.length && readFiles(e.dataTransfer.files));
  // dropping anywhere on the page works too, once one is already loaded
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    if (e.dataTransfer.files.length) readFiles(e.dataTransfer.files);
  });

  // ── static handlers (bound once; they read live state) ──
  const box = $('#q');
  let timer;
  box.oninput = () => { clearTimeout(timer); timer = setTimeout(() => runSearch(box.value), 200); };
  box.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? cur - 1 : cur + 1); }
  };
  $('#prev').onclick = () => go(cur - 1);
  $('#next').onclick = () => go(cur + 1);

  $('#filters').addEventListener('change', e => {
    const cb = e.target.closest('input[data-k]');
    if (cb) document.body.classList.toggle('hide-' + cb.dataset.k, !cb.checked);
  });
  // keep the programmatic path in runSearch working
  $('#filters').addEventListener('click', e => {
    const cb = e.target.closest('input[data-k]');
    if (cb && !cb.onchange) cb.onchange = () =>
      document.body.classList.toggle('hide-' + cb.dataset.k, !cb.checked);
  });

  $('#mediabtn').onclick = openMedia;
  $('#mediaclose').onclick = closeMedia;

  const links = $('#links');
  const closeLinks = () => {
    links.classList.remove('open');
    document.body.style.overflow = '';
  };
  $('#linkbtn').onclick = () => {
    links.classList.add('open');
    document.body.style.overflow = 'hidden';
  };
  $('#linkclose').onclick = closeLinks;
  links.onclick = e => {
    if (e.target === links) { closeLinks(); return; }
    const jump = e.target.closest('#linklist button');
    if (!jump) return;
    closeLinks();
    const el = document.getElementById(jump.dataset.m);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1800);
  };
  media().onclick = e => { if (e.target === media()) closeMedia(); };
  $('#dlall').onclick = () => shots.forEach((im, i) => setTimeout(() => {
    const a = document.createElement('a');
    a.href = im.src;
    a.download = (CURRENT ? CURRENT.srcName.replace(/\.jsonl$/, '') : 'image') +
      '-' + String(i + 1).padStart(2, '0') +
      (im.src.startsWith('data:image/jpeg') ? '.jpg' : '.png');
    a.click();
  }, i * 320));

  $('#lbprev').onclick = e => { e.stopPropagation(); openLb(idx - 1); };
  $('#lbnext').onclick = e => { e.stopPropagation(); openLb(idx + 1); };
  $('#lbclose').onclick = e => { e.stopPropagation(); closeLb(); };
  lb().onclick = closeLb;
  $('#lbimg').onclick = e => e.stopPropagation();
  $('#lbgoto').onclick = e => {
    e.stopPropagation();
    const t = $('#lbgoto').dataset.target;
    lb().classList.remove('open'); $('#lbimg').removeAttribute('src');
    closeMedia();
    const el = t && document.getElementById(t);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1800);
    }
  };
  const copyBtn = $('#lbcopy');
  copyBtn.onclick = async e => {
    e.stopPropagation();
    const label = copyBtn.textContent;
    try {
      const png = await toPng(dataToBlob($('#lbimg').src));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      copyBtn.textContent = '✓ Copied — paste into images.google.com';
    } catch {
      copyBtn.textContent = '✕ Blocked — right-click the image instead';
    }
    setTimeout(() => copyBtn.textContent = label, 2600);
  };

  // One Export button that asks which format, rather than one button per format. It names
  // the shared idea, keeps the header short, and gives the print-to-PDF path somewhere to
  // live: nobody was going to discover Cmd+P from a line in the README.
  const closeExport = () => document.body.classList.remove('export-open');
  $('#exportbtn').onclick = e => {
    e.stopPropagation();
    closeMenu();
    document.body.classList.toggle('export-open');
  };
  $('#exp-html').onclick = () => {
    closeExport();
    if (CURRENT) exportHtml(CURRENT.records, CURRENT.srcName);
  };
  $('#exp-pdf').onclick = () => { closeExport(); setTimeout(() => window.print(), 80); };
  $('#exp-md').onclick = () => {
    closeExport();
    if (!CURRENT) return;
    const md = toMarkdown(parseRecords(CURRENT.records), CURRENT.srcName);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = CURRENT.srcName.replace(/\.jsonl$/, '') + '.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  // One way back, always present once something is loaded: to the picker when several
  // transcripts are in memory, otherwise to the drop zone so another file can be opened.
  // Clicking the title goes back too. It is what a site logo does, and it means the one
  // way out of a transcript is findable without hunting for a button.
  //
  // The button's own disabled state is the single source of truth for whether there is
  // anywhere to go. Reading `loaded` here instead let the title do what the button was
  // disabled to prevent: on a page with an embedded transcript it emptied the view, and
  // since the button stayed disabled there was no way back short of a reload.
  $('h1').onclick = () => { if (!$('#homebtn').disabled) goHome(); };

  const goHome = () => {
    // From a transcript with siblings, back means the list. From the list itself, back
    // means the drop zone, or the button would do nothing.
    if (SESSIONS.length > 1 && !document.body.classList.contains('picking')) {
      showPicker(); return;
    }
    // In a converted file, back means this file's own transcript, which is what a reload
    // gives you. Only a page with nothing embedded returns to an empty drop zone.
    if (EMBEDDED && !(CURRENT && CURRENT.srcName === EMBEDDED.srcName)) {
      SESSIONS = [];
      document.body.classList.remove('picking');
      load(EMBEDDED.records, EMBEDDED.srcName);
      scrollTo({ top: 0 });
      return;
    }
    CURRENT = null; SESSIONS = []; shots = []; idx = -1;
    clearHits();
    $('#q').value = ''; $('#cnt').textContent = '';
    $('.chat').innerHTML = ''; $('#toc').innerHTML = '';
    $('#filters').innerHTML = ''; $('#stats').innerHTML = '';
    $('#statsmore').innerHTML = ''; $('#statsmore').classList.remove('open');
    $('#mediagrid').innerHTML = '';
    document.body.className = '';
    document.title = 'Claude Transcript Viewer';
    $('h1').textContent = 'Claude Transcript Viewer';
    $('#homebtn').innerHTML = '⌂<span class="lbl"> Home</span>';
    // render() is what disables this, and nothing here would re-enable it. Landing on the
    // drop zone with a dead Home button is a state the user cannot leave.
    $('#homebtn').disabled = false;
    $('#homebtn').title = 'Back to the start, to open another transcript';
    $('#droperr').textContent = '';
    scrollTo({ top: 0 });
  };
  $('#homebtn').onclick = goHome;
  const closeToc = () => document.body.classList.remove('toc-open');
  // Priority+: past five controls the row stops fitting, so the secondary ones live in an
  // overflow menu on anything short of a wide window and inline above it.
  const closeMenu = () => document.body.classList.remove('menu-open');
  $('#morebtn').onclick = e => { e.stopPropagation(); document.body.classList.toggle('menu-open'); };
  $('#actionmenu').addEventListener('click', () => setTimeout(closeMenu, 0));
  document.addEventListener('click', e => {
    if (!e.target.closest('.actions')) { closeMenu(); closeExport(); }
  });

  $('#tocbtn').onclick = () => document.body.classList.toggle('toc-open');
  $('#tocclose').onclick = closeToc;
  // Tapping the empty area of the panel closes it too, which is what a full-screen sheet
  // is expected to do on a phone where there is no Esc key.
  $('nav').onclick = e => { if (e.target.closest('a, button')) return; closeToc(); };
  $('#pill').onclick = () => scrollTo({ top: 0, behavior: 'smooth' });

  // swipe between images
  let tx = 0, ty = 0;
  lb().addEventListener('touchstart', e => {
    tx = e.touches[0].clientX; ty = e.touches[0].clientY;
  }, { passive: true });
  lb().addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6) openLb(idx + (dx < 0 ? 1 : -1));
  }, { passive: true });

  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { updatePill(); ticking = false; });
  });

  document.onkeydown = e => {
    if (lb().classList.contains('open')) {
      if (['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); closeLb(); }
      if (e.key === 'ArrowLeft') openLb(idx - 1);
      if (e.key === 'ArrowRight') openLb(idx + 1);
      return;
    }
    if (media().classList.contains('open')) { if (e.key === 'Escape') closeMedia(); return; }
    if (links.classList.contains('open')) {
      if (e.key === 'Escape') closeLinks();
      return;
    }
    if (e.key === '/' && document.activeElement !== box) { e.preventDefault(); box.focus(); }
    if (e.key === 'Escape') {
      box.blur();
      document.body.classList.remove('toc-open', 'menu-open', 'export-open');
    }
  };
}

bootStatic();
// The transcript is injected as an inert <script type="application/json">, never as code.
// A JSON block is not executed by the browser, so a hostile file cannot break out of it,
// and the page keeps exactly one executable script whose CSP hash is fixed at build time.
const DATA = document.getElementById('transcript-data');
if (DATA && DATA.textContent.trim()) {
  try {
    const payload = JSON.parse(DATA.textContent);
    // A converted file has a transcript of its own. Reloading returns to it, so Home has
    // to mean the same thing, or the two ways of starting over disagree.
    EMBEDDED = { records: payload.records, srcName: payload.src || 'transcript' };
    load(EMBEDDED.records, EMBEDDED.srcName);
  } catch (e) {
    document.getElementById('droperr').textContent = 'Embedded transcript is unreadable.';
  }
}
})();
