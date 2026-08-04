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

// ───────────────────────── language ─────────────────────────
//
// Every string the reader sees lives here, in three tables with identical keys. They are in
// this file rather than in a JSON sidecar because the CSP pins a sha256 of the one inline
// <script>: a second fetched resource would either need its own hash or a looser policy, and
// the page has to keep working from file:// with no server to fetch from anyway.
//
// Traditional and Simplified are written out separately rather than converted from one
// another. The pairs that differ are vocabulary, not characters: 檔案/文件, 搜尋/搜索,
// 網路/网络, 列印/打印, 設定/设置. A character-level conversion gets all five wrong.
//
// A value is either a string or a function of its interpolated parts. Functions keep the
// numbers and the grammar in the same place, so a language that orders them differently
// (or does not pluralise) is not fighting a template syntax.
const STR = {
  en: {
    searchPh: 'Search…  ( / )', more: 'More',
    exportT: 'Save this transcript', export: ' Export',
    homeT: 'Back to the start', home: ' Home',
    tocT: 'Table of contents', langShort: ' EN',
    expHtml: 'one self-contained file', expMd: 'for a notes vault or an issue',
    expPdf: "via your browser's print dialog",
    dropTitle: 'Drop a Claude Code transcript here',
    dropSub: 'A <code>.jsonl</code> file from <code>~/.claude/projects/</code>. ' +
      'You can also click to browse.',
    dropPrivacy: 'Everything is parsed in this page. Nothing is uploaded, and no network ' +
      'request is made.',
    dropReload: 'Reloading starts over: a browser cannot re-read a dropped file on its own. ' +
      'Use <b>Export</b> to keep one.',
    hintWhy: '<b>That folder is hidden, and this page cannot open the picker inside it.</b> ' +
      'The API that could (<code>showDirectoryPicker</code>) rejects on a local file, by ' +
      'spec: a <code>file://</code> page is an opaque origin. Keeping this page openable ' +
      'offline and serverless is worth more than a nicer picker. Two ways around it:',
    hintPaste: 'In the picker, press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>G</kbd> and paste ',
    copyT: 'Click to copy',
    hintFinder: 'Or open a Finder window there once, and drag a file straight onto this ' +
      'page:<br><code>open ~/.claude/projects</code>',
    hintCleanup: 'Transcripts are deleted after 30 days unless you raise ' +
      '<code>cleanupPeriodDays</code> in <code>~/.claude/settings.json</code>.',
    navPrompts: 'Your prompts', navContents: 'Contents',
    closeEsc: 'Close (Esc)', closeBtn: '✕ Close',
    prevT: 'Previous (←)', nextT: 'Next (→)',
    lbGoto: '↩ Jump to message', lbCopy: '⧉ Copy image',
    lbCopyT: 'Copy the image, then paste it into images.google.com',
    lbHint: '← → or swipe to navigate · Esc to close · right-click an image for your ' +
      "browser's reverse-image search",
    dlAll: '⤓ Download all', dlAllT: 'Download every image', topT: 'Back to top',
    // Only the hosted demo page carries these; --demo-page injects the markup that uses them.
    demoLive: 'Live demo',
    demoWhat: 'A fictional session, safe to click around. Drop a <code>.jsonl</code> of your ' +
      'own and it is parsed here in the page, never uploaded &mdash; but for real transcripts ' +
      'prefer the downloaded file, which you can verify by reading it and running it with ' +
      'Wi-Fi off.',
    demoDownload: '↓ Download viewer.html', demoSource: 'Source',
    copy: 'Copy', copied: 'Copied',
    truncated: n => `\n… (truncated, ${n} chars total)`,
    emptyCmd: '(empty command)', inPath: '  in ',
    todoDone: (a, b) => `${a} / ${b} done`,
    justNow: 'just now', ago: s => `${s} ago`,
    unitY: 'y', unitMo: 'mo', unitD: 'd', unitH: 'h', unitM: 'm',
    toolActions: n => `${n} tool actions`,
    inputH: 'Input', outputH: 'Output', resultH: 'Result',
    interrupted: 'Interrupted before it finished.',
    injectedHead: 'Injected content',
    injectedMeta: n => `${n} chars · injected by a skill or the system, not typed by you`,
    reasoning: n => `💭 Claude&#39;s reasoning · ${n} chars`,
    imageOnly: '(image only)', you: 'You', claude: 'Claude',
    copyMsg: 'Copy this message',
    filesTouched: (n, more) => `📁 ${n} files touched in this session ${more}`,
    moreCount: n => `(+${n} more)`,
    fReasoning: '💭 Reasoning', fTools: '🔧 Tools', fInjected: '⚙️ Injected',
    gitBranch: 'git branch', timeSpent: 'time spent', screenshots: 'screenshots',
    moreAbout: 'More about this session',
    promptsReplies: (a, b) => `${a} prompts · ${b} replies`,
    sBranch: 'Branch', sTime: 'Time', sMessages: 'Messages', sImages: 'Images',
    sTokens: 'Tokens out', sTools: 'Tools', sSkills: 'Skills',
    sSub: 'Subagent records', sSource: 'Source',
    unknown: 'unknown', notRecorded: 'not recorded', none: 'none',
    overTurns: (d, t) => `${d} over ${t} turns`,
    turnsShort: n => `${n} turns`,
    noneParen: '(none)',
    linksCited: n => `🔗 ${n} links cited in this session`,
    jumpCited: 'Jump to where it was cited',
    mediaHead: n => `🖼 ${n} media items · click to enlarge, then jump back to its message`,
    hAll: ' All', hBack: ' Back',
    hBackList: 'Back to the list',
    hBackOwn: 'Back to this file’s own transcript',
    hOwnShown: 'This file’s own transcript is already shown',
    hBackStart: 'Back to the start, to open another transcript',
    hBackStartFiles: 'Back to the start, to open different files',
    noPreview: '(no preview)',
    firstPrompt: s => `First prompt: ${s}`,
    mdFiles: n => `Files touched (${n})`,
    mdBranch: b => `branch \`${b}\``,
    mdTokens: n => `${n} output tokens`,
    mdToolActions: n => `🔧 ${n} tool actions: `,
    mdImages: n => `*(${n} image${n > 1 ? 's' : ''} in the HTML version)*`,
    pickerHead: n => `${n} transcripts loaded`,
    pickerTitle: n => `${n} transcripts`,
    pPrompts: n => `${n} prompts`, pTools: n => `${n} tools`,
    errDrop: 'Drop a .jsonl transcript, or a .md file.',
    errReading: n => `Reading ${n} files…`,
    errNoJson: 'No readable JSON lines. Are these Claude Code .jsonl transcripts?',
    errEmbedded: 'Embedded transcript is unreadable.',
    noResults: 'no results',
    copiedPath: 'copied — now press ⌘⇧G and paste',
    lbCopied: '✓ Copied — paste into images.google.com',
    lbBlocked: '✕ Blocked — right-click the image instead',
  },
  hant: {
    searchPh: '搜尋…  ( / )', more: '更多',
    exportT: '儲存這份紀錄', export: ' 匯出',
    homeT: '回到開始畫面', home: ' 首頁',
    tocT: '目錄', langShort: ' 繁',
    expHtml: '單一自足檔案', expMd: '適合筆記庫或 issue',
    expPdf: '透過瀏覽器的列印對話框',
    dropTitle: '把 Claude Code 對話紀錄拖到這裡',
    dropSub: '來自 <code>~/.claude/projects/</code> 的 <code>.jsonl</code> 檔案。' +
      '也可以點一下瀏覽選擇。',
    dropPrivacy: '所有解析都在這個頁面裡完成。不會上傳任何東西，也不會發出任何網路請求。',
    dropReload: '重新整理會從頭開始：瀏覽器沒辦法自己重讀拖進來的檔案。' +
      '想留下來請用 <b>匯出</b>。',
    hintWhy: '<b>那個資料夾是隱藏的，這個頁面也沒辦法直接在裡面開檔案選擇器。</b>' +
      '做得到的那個 API（<code>showDirectoryPicker</code>）依規格會在本機檔案上拒絕：' +
      '<code>file://</code> 頁面屬於不透明來源。讓這個頁面能離線、不需要伺服器就打開，' +
      '比一個漂亮的選擇器更有價值。有兩個繞過的方法：',
    hintPaste: '在選擇器裡按 <kbd>⌘</kbd><kbd>⇧</kbd><kbd>G</kbd>，然後貼上 ',
    copyT: '點一下複製',
    hintFinder: '或是先用 Finder 開啟那個位置一次，再把檔案直接拖到這個頁面上：' +
      '<br><code>open ~/.claude/projects</code>',
    hintCleanup: '除非你調高 <code>~/.claude/settings.json</code> 裡的 ' +
      '<code>cleanupPeriodDays</code>，對話紀錄會在 30 天後刪除。',
    navPrompts: '你的提問', navContents: '目錄',
    closeEsc: '關閉（Esc）', closeBtn: '✕ 關閉',
    prevT: '上一張（←）', nextT: '下一張（→）',
    lbGoto: '↩ 跳到訊息', lbCopy: '⧉ 複製圖片',
    lbCopyT: '複製圖片，然後貼到 images.google.com',
    lbHint: '← → 或滑動切換 · Esc 關閉 · 在圖片上按右鍵可用瀏覽器的以圖搜圖',
    dlAll: '⤓ 全部下載', dlAllT: '下載所有圖片', topT: '回到頂端',
    demoLive: '線上示範',
    demoWhat: '這是一份虛構的 session，可以放心亂點。把你自己的 <code>.jsonl</code> 拖進來，' +
      '一樣是在這個頁面裡解析，不會上傳。不過真正的對話紀錄還是建議用下載下來的檔案，' +
      '你可以先讀過內容，再關掉 Wi-Fi 執行來驗證。',
    demoDownload: '↓ 下載 viewer.html', demoSource: '原始碼',
    copy: '複製', copied: '已複製',
    truncated: n => `\n…（已截斷，全文共 ${n} 字元）`,
    emptyCmd: '（空指令）', inPath: '  於 ',
    todoDone: (a, b) => `${a} / ${b} 已完成`,
    justNow: '剛剛', ago: s => `${s}前`,
    unitY: ' 年', unitMo: ' 個月', unitD: ' 天', unitH: ' 小時', unitM: ' 分鐘',
    toolActions: n => `${n} 個工具動作`,
    inputH: '輸入', outputH: '輸出', resultH: '結果',
    interrupted: '尚未完成就被中斷。',
    injectedHead: '注入的內容',
    injectedMeta: n => `${n} 字元 · 由 skill 或系統注入，不是你打的`,
    reasoning: n => `💭 Claude 的推理過程 · ${n} 字元`,
    imageOnly: '（僅圖片）', you: '你', claude: 'Claude',
    copyMsg: '複製這則訊息',
    filesTouched: (n, more) => `📁 這個 session 動到 ${n} 個檔案 ${more}`,
    moreCount: n => `（另有 ${n} 個）`,
    fReasoning: '💭 推理', fTools: '🔧 工具', fInjected: '⚙️ 注入',
    gitBranch: 'git 分支', timeSpent: '花費時間', screenshots: '截圖',
    moreAbout: '關於這個 session 的更多資訊',
    promptsReplies: (a, b) => `${a} 則提問 · ${b} 則回覆`,
    sBranch: '分支', sTime: '時間', sMessages: '訊息', sImages: '圖片',
    sTokens: '輸出 tokens', sTools: '工具', sSkills: 'Skills',
    sSub: '子代理紀錄', sSource: '來源',
    unknown: '未知', notRecorded: '未紀錄', none: '無',
    overTurns: (d, t) => `${d}，共 ${t} 輪`,
    turnsShort: n => `${n} 輪`,
    noneParen: '（無）',
    linksCited: n => `🔗 這個 session 引用了 ${n} 個連結`,
    jumpCited: '跳到引用的位置',
    mediaHead: n => `🖼 ${n} 個媒體項目 · 點一下放大，再跳回它所在的訊息`,
    hAll: ' 全部', hBack: ' 返回',
    hBackList: '回到清單',
    hBackOwn: '回到這個檔案自己的對話紀錄',
    hOwnShown: '已經顯示這個檔案自己的對話紀錄',
    hBackStart: '回到開始畫面，開啟另一份紀錄',
    hBackStartFiles: '回到開始畫面，開啟其他檔案',
    noPreview: '（無預覽）',
    firstPrompt: s => `第一個提問：${s}`,
    mdFiles: n => `動到的檔案（${n}）`,
    mdBranch: b => `分支 \`${b}\``,
    mdTokens: n => `${n} 輸出 tokens`,
    mdToolActions: n => `🔧 ${n} 個工具動作：`,
    mdImages: n => `*（HTML 版本裡有 ${n} 張圖片）*`,
    pickerHead: n => `已載入 ${n} 份對話紀錄`,
    pickerTitle: n => `${n} 份對話紀錄`,
    pPrompts: n => `${n} 則提問`, pTools: n => `${n} 次工具`,
    errDrop: '請拖入 .jsonl 對話紀錄，或 .md 檔案。',
    errReading: n => `正在讀取 ${n} 個檔案…`,
    errNoJson: '讀不到可解析的 JSON 行。這些是 Claude Code 的 .jsonl 對話紀錄嗎？',
    errEmbedded: '內嵌的對話紀錄無法讀取。',
    noResults: '沒有結果',
    copiedPath: '已複製，現在按 ⌘⇧G 貼上',
    lbCopied: '✓ 已複製，貼到 images.google.com',
    lbBlocked: '✕ 被擋下，請改用右鍵',
  },
  hans: {
    searchPh: '搜索…  ( / )', more: '更多',
    exportT: '保存这份记录', export: ' 导出',
    homeT: '回到开始界面', home: ' 首页',
    tocT: '目录', langShort: ' 简',
    expHtml: '单个自足文件', expMd: '适合笔记库或 issue',
    expPdf: '通过浏览器的打印对话框',
    dropTitle: '把 Claude Code 对话记录拖到这里',
    dropSub: '来自 <code>~/.claude/projects/</code> 的 <code>.jsonl</code> 文件。' +
      '也可以点一下浏览选择。',
    dropPrivacy: '所有解析都在这个页面里完成。不会上传任何东西，也不会发出任何网络请求。',
    dropReload: '刷新会从头开始：浏览器没办法自己重读拖进来的文件。' +
      '想留下来请用 <b>导出</b>。',
    hintWhy: '<b>那个文件夹是隐藏的，这个页面也没办法直接在里面打开文件选择器。</b>' +
      '做得到的那个 API（<code>showDirectoryPicker</code>）按规范会在本地文件上拒绝：' +
      '<code>file://</code> 页面属于不透明来源。让这个页面能离线、不需要服务器就打开，' +
      '比一个漂亮的选择器更有价值。有两个绕过的办法：',
    hintPaste: '在选择器里按 <kbd>⌘</kbd><kbd>⇧</kbd><kbd>G</kbd>，然后粘贴 ',
    copyT: '点一下复制',
    hintFinder: '或者先用访达打开那个位置一次，再把文件直接拖到这个页面上：' +
      '<br><code>open ~/.claude/projects</code>',
    hintCleanup: '除非你调高 <code>~/.claude/settings.json</code> 里的 ' +
      '<code>cleanupPeriodDays</code>，对话记录会在 30 天后删除。',
    navPrompts: '你的提问', navContents: '目录',
    closeEsc: '关闭（Esc）', closeBtn: '✕ 关闭',
    prevT: '上一张（←）', nextT: '下一张（→）',
    lbGoto: '↩ 跳到消息', lbCopy: '⧉ 复制图片',
    lbCopyT: '复制图片，然后粘贴到 images.google.com',
    lbHint: '← → 或滑动切换 · Esc 关闭 · 在图片上点右键可用浏览器的以图搜图',
    dlAll: '⤓ 全部下载', dlAllT: '下载所有图片', topT: '回到顶部',
    demoLive: '在线演示',
    demoWhat: '这是一份虚构的 session，可以放心乱点。把你自己的 <code>.jsonl</code> 拖进来，' +
      '一样是在这个页面里解析，不会上传。不过真正的对话记录还是建议用下载下来的文件，' +
      '你可以先读过内容，再关掉 Wi-Fi 运行来验证。',
    demoDownload: '↓ 下载 viewer.html', demoSource: '源代码',
    copy: '复制', copied: '已复制',
    truncated: n => `\n…（已截断，全文共 ${n} 字符）`,
    emptyCmd: '（空命令）', inPath: '  于 ',
    todoDone: (a, b) => `${a} / ${b} 已完成`,
    justNow: '刚刚', ago: s => `${s}前`,
    unitY: ' 年', unitMo: ' 个月', unitD: ' 天', unitH: ' 小时', unitM: ' 分钟',
    toolActions: n => `${n} 个工具动作`,
    inputH: '输入', outputH: '输出', resultH: '结果',
    interrupted: '尚未完成就被中断。',
    injectedHead: '注入的内容',
    injectedMeta: n => `${n} 字符 · 由 skill 或系统注入，不是你打的`,
    reasoning: n => `💭 Claude 的推理过程 · ${n} 字符`,
    imageOnly: '（仅图片）', you: '你', claude: 'Claude',
    copyMsg: '复制这条消息',
    filesTouched: (n, more) => `📁 这个 session 改动了 ${n} 个文件 ${more}`,
    moreCount: n => `（另有 ${n} 个）`,
    fReasoning: '💭 推理', fTools: '🔧 工具', fInjected: '⚙️ 注入',
    gitBranch: 'git 分支', timeSpent: '花费时间', screenshots: '截图',
    moreAbout: '关于这个 session 的更多信息',
    promptsReplies: (a, b) => `${a} 条提问 · ${b} 条回复`,
    sBranch: '分支', sTime: '时间', sMessages: '消息', sImages: '图片',
    sTokens: '输出 tokens', sTools: '工具', sSkills: 'Skills',
    sSub: '子代理记录', sSource: '来源',
    unknown: '未知', notRecorded: '未记录', none: '无',
    overTurns: (d, t) => `${d}，共 ${t} 轮`,
    turnsShort: n => `${n} 轮`,
    noneParen: '（无）',
    linksCited: n => `🔗 这个 session 引用了 ${n} 个链接`,
    jumpCited: '跳到引用的位置',
    mediaHead: n => `🖼 ${n} 个媒体项 · 点一下放大，再跳回它所在的消息`,
    hAll: ' 全部', hBack: ' 返回',
    hBackList: '回到列表',
    hBackOwn: '回到这个文件自己的对话记录',
    hOwnShown: '已经显示这个文件自己的对话记录',
    hBackStart: '回到开始界面，打开另一份记录',
    hBackStartFiles: '回到开始界面，打开其他文件',
    noPreview: '（无预览）',
    firstPrompt: s => `第一个提问：${s}`,
    mdFiles: n => `改动的文件（${n}）`,
    mdBranch: b => `分支 \`${b}\``,
    mdTokens: n => `${n} 输出 tokens`,
    mdToolActions: n => `🔧 ${n} 个工具动作：`,
    mdImages: n => `*（HTML 版本里有 ${n} 张图片）*`,
    pickerHead: n => `已载入 ${n} 份对话记录`,
    pickerTitle: n => `${n} 份对话记录`,
    pPrompts: n => `${n} 条提问`, pTools: n => `${n} 次工具`,
    errDrop: '请拖入 .jsonl 对话记录，或 .md 文件。',
    errReading: n => `正在读取 ${n} 个文件…`,
    errNoJson: '读不到可解析的 JSON 行。这些是 Claude Code 的 .jsonl 对话记录吗？',
    errEmbedded: '内嵌的对话记录无法读取。',
    noResults: '没有结果',
    copiedPath: '已复制，现在按 ⌘⇧G 粘贴',
    lbCopied: '✓ 已复制，粘贴到 images.google.com',
    lbBlocked: '✕ 被挡下，请改用右键',
  },
};

// `lang` on <html> is not decoration: with no tag a browser picks Han glyphs by font order,
// so Traditional text can render with Simplified forms of the shared codepoints.
const LANG_TAG = { en: 'en', hant: 'zh-Hant', hans: 'zh-Hans' };
const LANG_KEY = 'ctv-lang';

// localStorage throws rather than returns null in a few file:// configurations, and this
// page's whole promise is that it opens from a local file. A dead preference is survivable;
// a page that fails to boot is not.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode, file:// */ } },
};

function detectLang() {
  const saved = store.get(LANG_KEY);
  if (saved && STR[saved]) return saved;
  for (const tag of (navigator.languages || [navigator.language || ''])) {
    const s = String(tag).toLowerCase();
    if (!s.startsWith('zh')) continue;
    // Script subtag wins when present; otherwise region decides. zh-CN and zh-SG are
    // Simplified, and everything else Chinese defaults to Traditional.
    if (s.includes('hans')) return 'hans';
    if (s.includes('hant')) return 'hant';
    return /\b(cn|sg)\b/.test(s.replace(/-/g, ' ')) ? 'hans' : 'hant';
  }
  return 'en';
}

let LANG = detectLang();

/** Look up a string, falling back to English so a missing key degrades to readable text
 *  rather than to `undefined`. tools/lint.py fails the build if a key is ever missing. */
function t(k, ...args) {
  const v = STR[LANG][k] != null ? STR[LANG][k] : STR.en[k];
  if (v == null) return k;
  return typeof v === 'function' ? v(...args) : v;
}

/** Translate the markup that is in the template rather than generated by render().
 *
 *  `data-i18n-html` assigns innerHTML. Every value it can receive is a literal in the STR
 *  table above, never anything read from a transcript, so no untrusted string can reach it.
 *  The distinction matters here: the rest of this file is careful never to build markup from
 *  file content, and this is the one place that would look like an exception.
 */
function applyStatic(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  scope.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  scope.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  scope.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.documentElement.lang = LANG_TAG[LANG];
  $$('#langmenu [data-l]').forEach(b => b.classList.toggle('on', b.dataset.l === LANG));
}

/** Switch language and rebuild whatever is on screen.
 *
 *  render() bakes strings into the HTML it produces, so a language change has to re-run it.
 *  Re-running load() would also re-run jumpToHash() and throw away the reader's position, so
 *  the scroll offset is carried across by hand. */
function setLang(l) {
  if (!STR[l] || l === LANG) return;
  LANG = l;
  store.set(LANG_KEY, l);
  const y = window.scrollY;
  applyStatic();
  if (document.body.classList.contains('picking')) showPicker();
  else if (CURRENT) { const m = parseRecords(CURRENT.records); render(m, CURRENT.srcName); wire(); updatePill(); }
  else if (LAST_DOC) {
    render(markdownModel(LAST_DOC.text, LAST_DOC.name), LAST_DOC.name);
    wire(); updatePill();
  }
  window.scrollTo({ top: y });
}

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
      out.push(`<div class="codewrap"><button class="copy">${t('copy')}</button><pre><code>` +
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
  : s.slice(0, limit) + t('truncated', s.length.toLocaleString());
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
    case 'Bash': return g('command').split(/\s+/).join(' ').slice(0, 110) || t('emptyCmd');
    case 'Read': case 'Edit': case 'Write': case 'NotebookEdit':
      return shortPath(g('file_path') || g('notebook_path'), cwd);
    case 'Glob': case 'Grep':
      return (g('pattern') + (g('path') ? t('inPath') + shortPath(g('path'), cwd) : '')).slice(0, 110);
    case 'WebSearch': return g('query').slice(0, 110);
    case 'WebFetch': return g('url').slice(0, 110);
    case 'Task': case 'Agent': return g('description').slice(0, 110);
    case 'Skill': return g('skill');
    case 'TodoWrite': {
      const todos = (inp && inp.todos) || [];
      return t('todoDone', todos.filter(x => x.status === 'completed').length, todos.length);
    }
    default: return JSON.stringify(inp || {}).slice(0, 110);
  }
}

function todoHtml(inp) {
  const rows = ((inp && inp.todos) || []).map(todo => {
    const mark = todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔄' : '⬜️';
    const cls = todo.status === 'completed' ? ' class="done"' : '';
    return `<li${cls}>${mark} ${esc(todo.content || todo.activeForm || '')}</li>`;
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
      const txt = textOf(c).trim().split(/\s+/).join(' ');
      if (txt && !txt.startsWith('<')) title = txt.slice(0, 60);
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
        const txt = (b.thinking || '').trim();
        if (txt) items.push({ kind: 'think', text: txt, ts });
      } else if (b.type === 'text') {
        const txt = (b.text || '').trim();
        if (txt) items.push({ kind: 'assistant', text: txt, pics: imagesOf([b]), ts });
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
    title: aiTitle || title || t('noPreview'),
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
  return m < 60 ? `${m}${t('unitM')}`
    : `${Math.floor(m / 60)}${t('unitH')} ${m % 60}${t('unitM')}`;
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
    body.push(`<details class="toolrun"><summary>🔧 ${t('toolActions', run.length)} · ${head}` +
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
        : `<h6>${t('inputH')}</h6>` + preBlock(typeof it.input === 'string' ? it.input
          : JSON.stringify(it.input, null, 1), MAX_INPUT);
      // stdout and stderr arrive merged in tool_result; when the structured result kept
      // them apart, show them apart, because an error reads differently from output.
      // `stderr` stays untranslated: it is the stream's name, not a label.
      if (x.stdout) detail += `<h6>${t('outputH')}</h6>` + preBlock(x.stdout, MAX_RESULT);
      if (x.stderr) detail += '<h6 class="err">stderr</h6>' + preBlock(x.stderr, MAX_RESULT);
      if (!x.stdout && !x.stderr && it.result)
        detail += `<h6>${t('resultH')}</h6>` + preBlock(it.result, MAX_RESULT);
      if (x.interrupted) detail += `<p class="warn">${t('interrupted')}</p>`;
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
        || t('injectedHead');
      body.push(`<details class="meta-block"><summary>⚙️ ${esc(head)} · ` +
        `${t('injectedMeta', it.text.length.toLocaleString())}` +
        `</summary><div class="card">${mdToHtml(it.text)}</div></details>`);
      continue;
    }
    if (it.kind === 'doc') {
      body.push(`<div class="msg doc"><div class="card">${mdToHtml(it.text)}</div></div>`);
      continue;
    }
    if (it.kind === 'think') {
      n.think++;
      body.push(`<details class="think"><summary>${t('reasoning', it.text.length.toLocaleString())}` +
        `</summary><div class="card">${mdToHtml(it.text)}</div></details>`);
      continue;
    }

    seq++; n[it.kind]++;
    const pics = it.pics || [];
    n.img += pics.length;
    const mid = 'm' + seq;
    const cap = esc(it.text.split(/\s+/).join(' ').slice(0, 38) || t('imageOnly'));
    const shots = pics.length ? '<div class="shots">' + pics.map(u =>
      `<img src="${esc(u)}" loading="lazy" data-msg="${mid}" data-num="#${seq}" data-cap="${cap}">`
    ).join('') + '</div>' : '';
    if (it.kind === 'user') toc.push(`<a href="#${mid}">#${seq} ${cap}</a>`);
    MSG_TEXT.set(mid, it.text);
    lastMid = mid; lastSeq = seq;
    collectLinks(it.text, mid, seq);
    body.push(`<div class="msg ${it.kind}" id="${mid}"><div class="who">` +
      `<b>${it.kind === 'user' ? t('you') : t('claude')}</b>` +
      `<a class="num" href="#${mid}">#${seq}</a>${stamp}` +
      `<button class="msgcopy" data-m="${mid}" title="${t('copyMsg')}">⧉</button></div>` +
      `<div class="card">${mdToHtml(it.text)}${shots}</div></div>`);
  }
  flushRun();

  let filebar = '';
  if (files.size) {
    const top = [...files.entries()].sort((a, b) => b[1] - a[1]);
    const lis = top.slice(0, 24).map(([f, c]) => `<li>${esc(f)} <b>×${c}</b></li>`).join('');
    const more = top.length > 24 ? t('moreCount', top.length - 24) : '';
    filebar = `<div class="filebar"><h3>${t('filesTouched', files.size, more)}` +
      `</h3><ul>${lis}</ul></div>`;
  }

  const box = (k, label, c, on) => !c ? '' :
    `<label><input type="checkbox" data-k="${k}"${on ? ' checked' : ''}>` +
    `${label} <span class="n">${c}</span></label>`;

  $('#filters').innerHTML =
    box('user', t('you'), n.user, true) +
    box('assistant', t('claude'), n.assistant, true) +
    box('think', t('fReasoning'), n.think, false) +
    box('tool', t('fTools'), n.tool, false) +
    box('meta', t('fInjected'), n.meta, false);

  // Four facts earn a place on the strip; the rest sits behind ⓘ. A row of nine
  // dot-separated values reads as one long string and nothing in it stands out.
  const chip = (icon, text, title) => !text ? '' :
    `<span class="chip"${title ? ` title="${esc(title)}"` : ''}>` +
    `<b>${icon}</b>${esc(text)}</span>`;
  const topTools = [...tools.entries()].sort((a, b) => b[1] - a[1]);
  $('#stats').innerHTML =
    chip('⑂', branch, t('gitBranch')) +
    chip('⏱', dur(durationMs) && `${dur(durationMs)} · ${t('turnsShort', turns)}`, t('timeSpent')) +
    chip('💬', t('promptsReplies', n.user, n.assistant)) +
    chip('🖼', n.img ? String(n.img) : '', t('screenshots')) +
    `<button class="chip more" id="statsbtn" title="${t('moreAbout')}">ⓘ</button>`;
  $('#statsmore').innerHTML = [
    [t('sBranch'), branch || t('unknown')],
    [t('sTime'), dur(durationMs) ? t('overTurns', dur(durationMs), turns) : t('notRecorded')],
    [t('sMessages'), t('promptsReplies', n.user, n.assistant)],
    [t('sImages'), String(n.img)],
    [t('sTokens'), tokensOut.toLocaleString()],
    [t('sTools'), topTools.map(([k, v]) => `${k}×${v}`).join(' · ') || t('none')],
    [t('sSkills'), skills.size ? [...skills].join(', ') : t('none')],
    [t('sSub'), sidechain || '0'],
    [t('sSource'), srcName],
  ].map(([k, v]) => `<div><span>${esc(k)}</span>${esc(String(v))}</div>`).join('');
  $('#statsbtn').onclick = () => $('#statsmore').classList.toggle('open');

  if (model.isDoc) {
    $('#navtitle').textContent = t('navContents');
    toc.length = 0;
    HEADINGS.forEach(h => toc.push(
      `<a href="#${h.id}" class="lvl${h.lvl}">${h.label}</a>`));
  } else {
    $('#navtitle').textContent = t('navPrompts');
  }

  document.title = title;
  $('h1').textContent = title;
  $('h1').title = subtitle ? t('firstPrompt', subtitle) : title;
  $('#toc').innerHTML = toc.join('\n') || `<a>${t('noneParen')}</a>`;
  $('.chat').innerHTML = filebar + body.join('\n');
  $('#mediabtn').textContent = '🖼 ' + n.img;
  $('#mediabtn').hidden = !n.img;
  $('#linkbtn').textContent = '🔗 ' + LINKS.length;
  $('#linkbtn').hidden = !LINKS.length;
  $('#linkhead').textContent = t('linksCited', LINKS.length);
  $('#linklist').innerHTML = LINKS.map(l => {
    let host = l.url;
    try { host = new URL(l.url).host.replace(/^www\./, ''); } catch (e) { /* keep raw */ }
    return `<div class="linkrow"><a href="${esc(l.url)}" rel="noreferrer" target="_blank">` +
      `<b>${esc(l.label || host)}</b><span>${esc(l.url)}</span></a>` +
      `<button data-m="${l.mid}" title="${t('jumpCited')}">↩ #${l.seq}</button></div>`;
  }).join('');
  $('#mediahead').textContent = t('mediaHead', n.img);
  document.body.classList.add('loaded', 'hide-think', 'hide-tool', 'hide-meta');
  document.body.classList.toggle('docmode', !!model.isDoc);
  document.body.classList.remove('picking');
  const showingEmbedded = EMBEDDED && srcName === EMBEDDED.srcName;
  $('#homebtn').innerHTML = SESSIONS.length > 1
    ? `←<span class="lbl">${esc(t('hAll'))}</span>`
    : (EMBEDDED && !showingEmbedded
        ? `↩<span class="lbl">${esc(t('hBack'))}</span>`
        : `⌂<span class="lbl">${esc(t('home'))}</span>`);
  $('#homebtn').title = SESSIONS.length > 1 ? t('hBackList')
    : (EMBEDDED && !showingEmbedded
        ? t('hBackOwn')
        : (EMBEDDED ? t('hOwnShown')
                    : t('hBackStart')));
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
    b.textContent = t('copied'); setTimeout(() => b.textContent = t('copy'), 1200);
  });

  // relative timestamps
  $$('[data-ts]').forEach(el => {
    const d = new Date(el.dataset.ts);
    if (isNaN(d)) return;
    el.textContent = relTime(el.dataset.ts);
    el.title = d.toLocaleString();
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
  g.textContent = t('lbGoto') + ' ' + (s.dataset.num || '');
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
      const thumb = document.createElement('img');
      thumb.src = im.src; thumb.loading = 'lazy';
      const cap = document.createElement('figcaption');
      cap.textContent = `${im.dataset.num || ''} ${im.dataset.cap || ''}`;
      fig.append(thumb, cap);
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
  cnt.textContent = hits.length ? '0 / ' + hits.length : t('noResults');
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
  const head = [srcName, branch && t('mdBranch', branch),
    dur(durationMs) && t('overTurns', dur(durationMs), turns),
    t('mdTokens', tokensOut.toLocaleString())].filter(Boolean).join(' · ');
  out.push(`> ${head}`, '');

  if (files.size) {
    out.push(`## ${t('mdFiles', files.size)}`, '');
    [...files.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([f, c]) => out.push(`- \`${f}\` ×${c}`));
    out.push('');
  }

  let seq = 0, run = [];
  const flush = () => {
    if (!run.length) return;
    const k = new Map();
    run.forEach(n => k.set(n, (k.get(n) || 0) + 1));
    out.push('> ' + t('mdToolActions', run.length) +
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
    out.push(`## ${it.kind === 'user' ? t('you') : t('claude')} · #${seq}${when ? ' · ' + when : ''}`,
      '', it.text, '');
    const pics = (it.pics || []).length;
    if (pics) out.push(t('mdImages', pics), '');
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

let CURRENT = null, SESSIONS = [], EMBEDDED = null, LAST_DOC = null;

// One implementation, used by both the message stamps and the picker rows. They printed the
// same thing from two copies of this table before, which is two places to forget a language.
const REL = [[31536e6, 'unitY'], [2592e6, 'unitMo'], [864e5, 'unitD'],
             [36e5, 'unitH'], [6e4, 'unitM']];
const relTime = iso => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const diff = Date.now() - d;
  for (const [ms, u] of REL) if (diff >= ms) return t('ago', Math.floor(diff / ms) + t(u));
  return t('justNow');
};

function showPicker() {
  const rows = SESSIONS.map((s, i) => {
    const m = s.model;
    const when = (m.items.find(x => x.ts) || {}).ts || '';
    const bits = [m.branch && '⑂ ' + m.branch,
                  t('pPrompts', m.items.filter(x => x.kind === 'user').length),
                  t('pTools', m.items.filter(x => x.kind === 'tool').length),
                  relTime(when)].filter(Boolean).join(' · ');
    return `<button class="srow" data-i="${i}">
      <span class="t">${esc(m.title)}</span>
      <span class="m">${esc(bits)}</span>
      <span class="f">${esc(s.name)}</span></button>`;
  }).join('');
  $('#picker').innerHTML =
    `<h2>${esc(t('pickerHead', SESSIONS.length))}</h2><div class="rows">${rows}</div>`;
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
  document.title = t('pickerTitle', SESSIONS.length);
  $('#homebtn').innerHTML = `⌂<span class="lbl">${esc(t('home'))}</span>`;
  $('#homebtn').title = t('hBackStartFiles');
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
    if (!files.length) { err.textContent = t('errDrop'); return; }
    if (files.length > 1) err.textContent = t('errReading', files.length);
    const read = await Promise.all(files.map(readOne));
    const docs = read.filter(x => x.doc && x.doc.trim());
    if (docs.length && !read.some(x => x.records && x.records.length)) {
      const d = docs[0];
      CURRENT = null;
      // Remembered so a language switch can re-render it: a document has no records to
      // re-parse, and CURRENT is deliberately null here.
      LAST_DOC = { text: d.doc, name: d.name };
      render(markdownModel(d.doc, d.name), d.name);
      wire(); updatePill();
      if (docs.length > 1) err.textContent = '';
      return;
    }
    const loaded = read.filter(x => x.records && x.records.length);
    err.textContent = '';
    if (!loaded.length) {
      err.textContent = t('errNoJson');
      return;
    }
    LAST_DOC = null;
    if (loaded.length === 1) { load(loaded[0].records, loaded[0].name); return; }
    SESSIONS = loaded.map(x => ({ ...x, model: parseRecords(x.records) }));
    showPicker();
  };
  const readFile = f => readFiles([f]);

  // Delegated rather than bound: applyStatic() rewrites the paragraph this button sits in
  // every time the language changes, and a handler bound to the old node would go with it.
  document.addEventListener('click', e => {
    const cp = e.target.closest('#copypath');
    if (!cp) return;
    navigator.clipboard.writeText('~/.claude/projects').then(() => {
      const was = cp.textContent;
      cp.textContent = t('copiedPath');
      setTimeout(() => cp.textContent = was, 2400);
    });
  });
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
    const target = $('#lbgoto').dataset.target;
    lb().classList.remove('open'); $('#lbimg').removeAttribute('src');
    closeMedia();
    const el = target && document.getElementById(target);
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
      copyBtn.textContent = t('lbCopied');
    } catch {
      copyBtn.textContent = t('lbBlocked');
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
    CURRENT = null; SESSIONS = []; LAST_DOC = null; shots = []; idx = -1;
    clearHits();
    $('#q').value = ''; $('#cnt').textContent = '';
    $('.chat').innerHTML = ''; $('#toc').innerHTML = '';
    $('#filters').innerHTML = ''; $('#stats').innerHTML = '';
    $('#statsmore').innerHTML = ''; $('#statsmore').classList.remove('open');
    $('#mediagrid').innerHTML = '';
    document.body.className = '';
    document.title = 'Claude Transcript Viewer';
    $('h1').textContent = 'Claude Transcript Viewer';
    $('#homebtn').innerHTML = `⌂<span class="lbl">${esc(t('home'))}</span>`;
    // render() is what disables this, and nothing here would re-enable it. Landing on the
    // drop zone with a dead Home button is a state the user cannot leave.
    $('#homebtn').disabled = false;
    $('#homebtn').title = t('hBackStart');
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
    if (!e.target.closest('.actions')) { closeMenu(); closeExport(); closeLangMenu(); }
  });

  // ── language ──
  const closeLangMenu = () => document.body.classList.remove('lang-open');
  $('#langbtn').onclick = e => {
    e.stopPropagation();
    closeExport();
    document.body.classList.toggle('lang-open');
  };
  $('#langmenu').addEventListener('click', e => {
    const b = e.target.closest('[data-l]');
    if (!b) return;
    closeLangMenu();
    closeMenu();
    setLang(b.dataset.l);
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
      document.body.classList.remove('toc-open', 'menu-open', 'export-open', 'lang-open');
    }
  };
}

// Runs after SHELL is captured, so an exported page carries the untranslated template and
// re-detects the reader's own language when it opens rather than freezing in this one.
applyStatic();
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
    document.getElementById('droperr').textContent = t('errEmbedded');
  }
}
})();
