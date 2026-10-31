# Mermaid 语法错误可诊断化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Mermaid 图表解析/渲染失败时显示可定位、可理解的错误卡片，并保证一张坏图不影响同批其他图。

**Architecture:** 在共享的 `processMermaid` 阶段捕获错误，用 DOM API 在原容器内重建错误卡片（行号、源码行、修复提示、原始错误、定位按钮）；阅读模式与 WYSIWYG 共用同一张卡片，定位复用编辑器的「跳到行」能力；主题重渲染与导出跳过错误容器。

**Tech Stack:** 原生 JS（IIFE + mixin）、Mermaid 11.15、CodeMirror 5、jsdom + node:test、Tauri WebView。

**Spec:** `docs/superpowers/specs/2026-10-31-mermaid-error-display-design.md`

## Global Constraints

- **禁止 git commit / git push**：项目 CLAUDE.md 规定提交/推送是红线操作，只有用户明确要求后才执行。本计划所有任务以「跑通相关测试」结束，不包含提交步骤。
- **禁止跑全量 `npm test`**：只跑与本次改动相关的测试文件（见各任务验证命令）。
- Mermaid 应用内初始化保持 `securityLevel: 'strict'`，不得改为 `loose`。
- 错误信息与源码必须用 `textContent` 写入 DOM，禁止 `innerHTML` 拼接用户内容。
- 新增文案必须同时提供 zh / en / es 三语言。
- 错误容器保留 `data-code` / `data-source-line`，并标记 `data-mermaid-error="1"`；失败结果不得写入 `mermaidCache`。
- 不新增运行时依赖。

## Review Focus

1. 错误信息或源码行含 `<img onerror=...>` 等 HTML 时，只能作为文本显示，不得产生可执行元素。
2. 解析错误没有行号时（运行期错误 / Mermaid 未提供行号），卡片仍显示、可读，且不显示误导性的定位按钮。
3. 容器缺少 `data-source-line`（切片信息缺失）时，卡片不抛错、不显示定位按钮。
4. 同批「一张坏图 + 多张好图」时，好图仍渲染并写入缓存，坏图只影响自己。
5. 主题切换时错误卡片不消失、不被重跑，且颜色随 CSS 变量适配。

---

### Task 1: 错误信息解析、错误卡片构建（含 i18n 与样式）

**Files:**
- Modify: `src/modules/preview-post.js`（在 `processMermaid` 前新增三个函数，并在两个导出块中暴露）
- Modify: `src/modules/i18n-data.js`（zh/en/es 三处 `mermaidChart` 行后各加 7 个 key）
- Modify: `src/styles.css`（`.mermaid-container svg` 规则后新增错误卡片样式）
- Test: `test/mermaid-error-display.test.cjs`（新建）

**Interfaces:**
- Produces:
  - `parseMermaidErrorInfo(message: string, code: string) -> { line: number|null, sourceLine: string, message: string, isParseError: boolean }`
  - `hasUnquotedSpecialChars(sourceLine: string) -> boolean`
  - `renderMermaidErrorCard(container: HTMLElement, info: ReturnType<parseMermaidErrorInfo>, opts: { t?: Function }) -> void`
  - 卡片 DOM 契约：容器属性 `data-mermaid-error="1"`、`data-error-abs-line="<0-based line>"`（仅行号可计算时）；子元素类名 `.mermaid-error-card`、`.mermaid-error-title`、`.mermaid-error-line`、`.mermaid-error-source`、`.mermaid-error-hint`、`.mermaid-error-raw`、`.mermaid-error-locate`（按钮，`data-line` 为 0-based 行号）。
- Consumes: 无（纯函数 + DOM 构建）。

- [ ] **Step 1: 写失败测试（纯 jsdom，覆盖解析、提示判定、卡片结构与安全边界）**

新建 `test/mermaid-error-display.test.cjs`：

```js
const test = require('node:test');
const assert = require('node:assert');
const { createPreviewDom, installGlobals } = require('./helpers/dom.js');
const PP = require('../src/modules/preview-post.js');

const { preview: _g } = createPreviewDom();
installGlobals(_g.ownerDocument.defaultView);

const tStub = (k, p) => (p ? k + ':' + Object.values(p).join('/') : k);

test('parseMermaidErrorInfo：提取行号、源码行与原始消息', () => {
  const info = PP.parseMermaidErrorInfo(
    'Parse error on line 2:\n...B[foo()]\n-----^\nExpecting ...',
    'flowchart TD\n  A --> B[foo()]'
  );
  assert.strictEqual(info.line, 2);
  assert.strictEqual(info.sourceLine, '  A --> B[foo()]');
  assert.strictEqual(info.isParseError, true);
  assert.match(info.message, /Parse error on line 2/);
});

test('parseMermaidErrorInfo：无行号时 line=null、isParseError=false', () => {
  const info = PP.parseMermaidErrorInfo('Diagram render failed', 'flowchart TD\nA-->B');
  assert.strictEqual(info.line, null);
  assert.strictEqual(info.sourceLine, '');
  assert.strictEqual(info.isParseError, false);
});

test('hasUnquotedSpecialChars：识别未加引号的括号/花括号/引号/竖线', () => {
  assert.strictEqual(PP.hasUnquotedSpecialChars('  A --> B[foo()]'), true);
  assert.strictEqual(PP.hasUnquotedSpecialChars('  A --> B[foo{bar}]'), true);
  assert.strictEqual(PP.hasUnquotedSpecialChars('  A --> B[foo|bar]'), true);
  assert.strictEqual(PP.hasUnquotedSpecialChars('  A[查询(销售)]'), true);
  assert.strictEqual(PP.hasUnquotedSpecialChars('  A --> B["foo()"]'), false);
  assert.strictEqual(PP.hasUnquotedSpecialChars('  A --> B[End]'), false);
  assert.strictEqual(PP.hasUnquotedSpecialChars(''), false);
});

test('renderMermaidErrorCard：行号、文档行号、源码行、提示与定位按钮', () => {
  const { document } = createPreviewDom();
  const container = document.createElement('div');
  container.className = 'mermaid-container';
  container.setAttribute('data-source-line', '10');
  const info = PP.parseMermaidErrorInfo(
    'Parse error on line 2:\n...B[foo()]\n-----^',
    'flowchart TD\n  A --> B[foo()]'
  );
  PP.renderMermaidErrorCard(container, info, { t: tStub });

  assert.strictEqual(container.getAttribute('data-mermaid-error'), '1');
  assert.strictEqual(container.getAttribute('data-error-abs-line'), '11');
  assert.match(container.querySelector('.mermaid-error-title').textContent, /mermaidErrorTitle/);
  assert.match(container.querySelector('.mermaid-error-line').textContent, /mermaidErrorLine:2\/12/);
  assert.strictEqual(container.querySelector('.mermaid-error-source').textContent, '  A --> B[foo()]');
  assert.ok(container.querySelector('.mermaid-error-hint'), '括号标签应显示修复提示');
  assert.match(container.querySelector('.mermaid-error-raw').textContent, /Parse error on line 2/);
  assert.strictEqual(container.querySelector('.mermaid-error-locate').getAttribute('data-line'), '11');
});

test('renderMermaidErrorCard：无行号/无 source-line 时不显示定位按钮', () => {
  const { document } = createPreviewDom();
  const container = document.createElement('div');
  container.className = 'mermaid-container';
  container.setAttribute('data-source-line', '10');
  PP.renderMermaidErrorCard(container, PP.parseMermaidErrorInfo('render failed', 'A-->B'), { t: tStub });
  assert.strictEqual(container.getAttribute('data-error-abs-line'), null);
  assert.strictEqual(container.querySelector('.mermaid-error-locate'), null);
  assert.match(container.querySelector('.mermaid-error-title').textContent, /mermaidErrorRenderFailed/);

  const noLine = document.createElement('div');
  noLine.className = 'mermaid-container';
  const info = PP.parseMermaidErrorInfo('Parse error on line 3:', 'A-->B\nC-->D\nE-->F');
  PP.renderMermaidErrorCard(noLine, info, { t: tStub });
  assert.strictEqual(noLine.getAttribute('data-error-abs-line'), null, '缺 data-source-line 不得猜行号');
  assert.strictEqual(noLine.querySelector('.mermaid-error-locate'), null);
});

test('renderMermaidErrorCard：错误消息中的 HTML 只作为文本', () => {
  const { document } = createPreviewDom();
  const container = document.createElement('div');
  container.className = 'mermaid-container';
  container.setAttribute('data-source-line', '1');
  PP.renderMermaidErrorCard(
    container,
    PP.parseMermaidErrorInfo('<img src=x onerror=alert(1)>', 'A-->B'),
    { t: tStub }
  );
  assert.strictEqual(container.querySelector('img'), null, '不得创建 img');
  assert.match(container.textContent, /<img src=x onerror=alert\(1\)>/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/mermaid-error-display.test.cjs`
Expected: FAIL，`PP.parseMermaidErrorInfo is not a function`。

- [ ] **Step 3: 在 `src/modules/preview-post.js` 实现三个函数**

放在 `processMermaid` 之前（约 `preview-post.js:299` 的 `mermaidIdSeq` 附近）：

```js
// Mermaid 错误信息解析：Mermaid 的 parse 错误形如
// "Parse error on line 11:\n...\n-----^\nExpecting ... got 'PS'"。
// 行号是图表内 1-based；code 是原始图表源码（容器 textContent 已被错误 SVG 覆盖，必须由调用方传入）。
function parseMermaidErrorInfo(message, code) {
  const text = String(message || '');
  const m = /Parse error on line (\d+)/i.exec(text);
  const line = m ? parseInt(m[1], 10) : null;
  const lines = String(code || '').split('\n');
  const sourceLine = (line && line >= 1 && line <= lines.length) ? lines[line - 1] : '';
  return { line, sourceLine, message: text, isParseError: line != null };
}

// 常见成因提示：节点标签 [...] 内出现未加引号的 () {} [] " |。
// 只做启发式判断，用于给出「加引号」提示，不影响错误本身是否展示。
function hasUnquotedSpecialChars(sourceLine) {
  const m = /\[([^\]]*)\]/.exec(String(sourceLine || ''));
  if (!m) return false;
  const inner = m[1].trim();
  if (!inner) return false;
  if (inner.startsWith('"') && inner.endsWith('"')) return false;
  return /[()[\]{}"|]/.test(inner);
}

// 用 DOM API 重建容器内容为错误卡片（源码/错误信息一律 textContent，禁止 innerHTML）。
function renderMermaidErrorCard(container, info, opts) {
  const t = (opts && typeof opts.t === 'function') ? opts.t : (k) => k;
  const doc = container.ownerDocument || document;
  const sourceLineNo = parseInt(container.getAttribute('data-source-line'), 10);
  const hasSource = Number.isFinite(sourceLineNo);
  const docLine = (info && info.line != null && hasSource) ? sourceLineNo + info.line : null;
  const absLine = docLine != null ? docLine - 1 : null;

  container.innerHTML = '';
  container.setAttribute('data-mermaid-error', '1');
  if (absLine != null) container.setAttribute('data-error-abs-line', String(absLine));

  const card = doc.createElement('div');
  card.className = 'mermaid-error-card';

  const title = doc.createElement('div');
  title.className = 'mermaid-error-title';
  title.textContent = (info && info.isParseError) ? t('mermaidErrorTitle') : t('mermaidErrorRenderFailed');
  card.appendChild(title);

  const line = doc.createElement('div');
  line.className = 'mermaid-error-line';
  line.textContent = (info && info.line != null && docLine != null)
    ? t('mermaidErrorLine', { line: info.line, docLine })
    : t('mermaidErrorNoLine');
  card.appendChild(line);

  if (info && info.sourceLine) {
    const src = doc.createElement('code');
    src.className = 'mermaid-error-source';
    src.textContent = info.sourceLine;
    card.appendChild(src);
  }

  if (info && info.sourceLine && hasUnquotedSpecialChars(info.sourceLine)) {
    const hint = doc.createElement('div');
    hint.className = 'mermaid-error-hint';
    hint.textContent = t('mermaidErrorHint');
    card.appendChild(hint);
  }

  if (info && info.message) {
    const details = doc.createElement('details');
    details.className = 'mermaid-error-raw';
    const summary = doc.createElement('summary');
    summary.textContent = t('mermaidErrorRaw');
    const pre = doc.createElement('pre');
    pre.textContent = info.message;
    details.appendChild(summary);
    details.appendChild(pre);
    card.appendChild(details);
  }

  if (absLine != null) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'mermaid-error-locate';
    btn.textContent = t('mermaidErrorLocate');
    btn.setAttribute('data-line', String(absLine));
    card.appendChild(btn);
  }

  container.appendChild(card);
}
```

同时在文件底部两个导出块中补上：

```js
parseMermaidErrorInfo, hasUnquotedSpecialChars, renderMermaidErrorCard,
```

- [ ] **Step 4: 在 `src/modules/i18n-data.js` 三语言各加 7 个 key**

在 zh 的 `mermaidChart: 'Mermaid 图表',`（约 57 行）后：

```js
mermaidErrorTitle: '图表语法错误',
mermaidErrorRenderFailed: '图表渲染失败',
mermaidErrorLine: '图表内第 {line} 行（文档第 {docLine} 行）',
mermaidErrorNoLine: '无法定位具体行，请查看原始错误信息',
mermaidErrorHint: '节点标签里的 ( ) { } [ ] " | 需要整段用双引号包起来，例如 B["foo()"]',
mermaidErrorRaw: '原始错误信息',
mermaidErrorLocate: '定位到源码',
```

在 en 的 `mermaidChart: 'Mermaid Chart',`（约 549 行）后：

```js
mermaidErrorTitle: 'Diagram syntax error',
mermaidErrorRenderFailed: 'Diagram failed to render',
mermaidErrorLine: 'Line {line} in diagram (document line {docLine})',
mermaidErrorNoLine: 'Could not locate the exact line; see the raw error below',
mermaidErrorHint: 'Characters such as ( ) { } [ ] " | inside a node label must be wrapped in double quotes, e.g. B["foo()"]',
mermaidErrorRaw: 'Raw error',
mermaidErrorLocate: 'Go to source',
```

在 es 的 `mermaidChart: 'Diagrama Mermaid',`（约 1012 行）后：

```js
mermaidErrorTitle: 'Error de sintaxis del diagrama',
mermaidErrorRenderFailed: 'No se pudo renderizar el diagrama',
mermaidErrorLine: 'Línea {line} del diagrama (línea {docLine} del documento)',
mermaidErrorNoLine: 'No se pudo localizar la línea exacta; consulta el error original',
mermaidErrorHint: 'Los caracteres ( ) { } [ ] " | dentro de una etiqueta deben ir entre comillas dobles, p. ej. B["foo()"]',
mermaidErrorRaw: 'Error original',
mermaidErrorLocate: 'Ir al código fuente',
```

- [ ] **Step 5: 在 `src/styles.css` 加错误卡片样式**

在 `.mermaid-container svg { ... }`（约 2685 行）后追加：

```css
/* Mermaid 语法错误卡片（错误容器仍保留 .mermaid-container 的间距与边框） */
.mermaid-container[data-mermaid-error] {
  text-align: left;
  border-color: var(--color-danger);
}

.mermaid-error-card {
  font-size: 0.9em;
  line-height: 1.55;
}

.mermaid-error-title {
  font-weight: 600;
  color: var(--color-danger);
  margin-bottom: 4px;
}

.mermaid-error-line {
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.mermaid-error-source {
  display: block;
  background: var(--bg-code);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
  overflow-x: auto;
  white-space: pre;
  font-family: var(--font-mono, monospace);
  font-size: 0.92em;
}

.mermaid-error-hint {
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.mermaid-error-raw {
  margin-bottom: 8px;
}

.mermaid-error-raw summary {
  cursor: pointer;
  color: var(--text-secondary);
}

.mermaid-error-raw pre {
  margin: 6px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono, monospace);
  font-size: 0.86em;
}

.mermaid-error-locate {
  padding: 4px 12px;
  background-color: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: calc(var(--ui-font-size) * 0.8462);
  cursor: pointer;
}

.mermaid-error-locate:hover {
  background-color: var(--accent-color);
  color: var(--accent-text);
  border-color: var(--accent-color);
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `node test/mermaid-error-display.test.cjs`
Expected: PASS（6 个用例）。

- [ ] **Step 7: 三语言 key 接线断言**

在同一测试文件追加：

```js
test('i18n：错误卡片 7 个 key 在 zh/en/es 均存在', () => {
  global.window = global.window || globalThis;
  const { I18N } = require('../src/modules/i18n-data.js');
  for (const lang of ['zh', 'en', 'es']) {
    for (const key of ['mermaidErrorTitle', 'mermaidErrorRenderFailed', 'mermaidErrorLine',
      'mermaidErrorNoLine', 'mermaidErrorHint', 'mermaidErrorRaw', 'mermaidErrorLocate']) {
      assert.ok(I18N[lang][key], `${lang} 缺少 ${key}`);
    }
  }
});
```

Run: `node test/mermaid-error-display.test.cjs`
Expected: PASS。

---

### Task 2: `processMermaid` 集成（坏图不连累好图 + 错误不入缓存）

**Files:**
- Modify: `src/modules/preview-post.js:306-366`（`processMermaid` 的 `toRender` 与 `runStep`）
- Test: `test/mermaid-error-display.test.cjs`（追加集成用例）

**Interfaces:**
- Consumes: Task 1 的 `parseMermaidErrorInfo` / `renderMermaidErrorCard`；调用方新增可选 `opts.sourceLineBase: number`（WYSIWYG 所在块起始 0-based 行；阅读模式不传 = 0）。
- Produces: 错误容器带 `data-mermaid-error="1"` / `data-error-abs-line`；容器的 `data-source-line` 统一为**绝对 1-based 围栏行**；成功容器仍写入 `mermaidCache`（键 `light::<code>` 或 `dark::<code>`）。

- [ ] **Step 1: 写失败测试（一张坏图 + 一张好图同批）**

追加到 `test/mermaid-error-display.test.cjs`：

```js
function makeFakeMermaid({ withParse = true } = {}) {
  return {
    initialize() {},
    async parse(text) {
      if (text.includes('foo()')) {
        throw new Error('Parse error on line 2:\n...B[foo()]\n-----^\nExpecting ... got \'PS\'');
      }
      return true;
    },
    async run({ nodes }) {
      nodes.forEach((n) => {
        const code = n.textContent;
        if (code.includes('foo()')) {
          n.innerHTML = '<svg aria-roledescription="error"></svg>';
        } else {
          n.innerHTML = '<svg class="ok-svg"></svg>';
        }
      });
      if (nodes.some((n) => n.textContent.includes('foo()'))) {
        throw new Error('Parse error on line 2: ...');
      }
    },
    _withParse: withParse,
  };
}

function buildPreviewWithTwoDiagrams() {
  const { preview, document } = createPreviewDom();
  preview.innerHTML =
    '<pre><code class="language-mermaid" data-source-line="10">flowchart TD\n  A --> B[foo()]</code></pre>' +
    '<pre><code class="language-mermaid" data-source-line="20">flowchart TD\n  A --> B[End]</code></pre>';
  return { preview, document };
}

test('processMermaid：同批一坏一好，好图渲染并缓存，坏图显示卡片且不入缓存', async () => {
  const { preview } = buildPreviewWithTwoDiagrams();
  global.mermaid = makeFakeMermaid();
  const cache = new Map();
  await PP.processMermaid(preview, { t: tStub, isDark: false, mermaidCache: cache });

  const containers = preview.querySelectorAll('.mermaid-container');
  assert.strictEqual(containers.length, 2);
  const bad = containers[0];
  const good = containers[1];
  assert.strictEqual(bad.getAttribute('data-mermaid-error'), '1');
  assert.ok(bad.querySelector('.mermaid-error-card'));
  assert.strictEqual(bad.querySelector('svg'), null, '错误 SVG 必须被卡片替换');
  assert.ok(good.querySelector('svg.ok-svg'), '好图仍应渲染');
  assert.strictEqual(cache.size, 1, '只缓存好图');
  assert.ok(cache.has('light::flowchart TD\n  A --> B[End]'));
});

test('processMermaid：Mermaid 无 parse 方法时仍显示通用错误卡片', async () => {
  const { preview } = createPreviewDom();
  preview.innerHTML = '<pre><code class="language-mermaid" data-source-line="5">flowchart TD\n  A --> B[foo()]</code></pre>';
  const m = makeFakeMermaid();
  delete m.parse;
  global.mermaid = m;
  await PP.processMermaid(preview, { t: tStub, isDark: false, mermaidCache: new Map() });
  const bad = preview.querySelector('.mermaid-container');
  assert.strictEqual(bad.getAttribute('data-mermaid-error'), '1');
  assert.ok(bad.querySelector('.mermaid-error-card'));
  assert.strictEqual(bad.querySelector('.mermaid-error-locate'), null, '无行号不显示定位按钮');
});

test('processMermaid：sourceLineBase 把 WYSIWYG 块内相对行号还原为绝对行号', async () => {
  const { preview } = createPreviewDom();
  // WYSIWYG 遮罩渲染的是块切片：data-source-line=1 表示「本块第 1 行」，
  // 传 sourceLineBase=2（块起始 0-based 行）后，围栏绝对行应为 1-based 第 3 行。
  preview.innerHTML = '<pre><code class="language-mermaid" data-source-line="1">flowchart TD\n  A --> B[foo()]</code></pre>';
  global.mermaid = makeFakeMermaid();
  await PP.processMermaid(preview, { t: tStub, isDark: false, mermaidCache: new Map(), sourceLineBase: 2 });
  const bad = preview.querySelector('.mermaid-container');
  assert.strictEqual(bad.getAttribute('data-source-line'), '3', '容器应写入绝对 1-based 围栏行');
  assert.strictEqual(bad.getAttribute('data-error-abs-line'), '3', '图表第 2 行 → 文档 0-based 第 3 行');
  assert.strictEqual(bad.getAttribute('data-code'), 'flowchart TD\n  A --> B[foo()]', 'data-code 必须保留');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/mermaid-error-display.test.cjs`
Expected: 新用例 FAIL：坏图仍是 `svg[aria-roledescription="error"]`，缓存被 `catch` 提前 return 跳过（或坏图没有卡片）。

- [ ] **Step 3: 修改 `processMermaid`**

1. `const { isDark, mermaidCache, t } = opts;`
2. 在函数开头加 `const sourceLineBase = (opts && Number.isFinite(opts.sourceLineBase)) ? opts.sourceLineBase : 0;`
3. 替换原来的 `sourceLine` 读写：建容器时把块内相对行号还原为绝对围栏行（阅读模式 `sourceLineBase=0`，值不变）：

```js
    const rawSourceLine = parseInt(block.dataset.sourceLine, 10);
    const absoluteSourceLine = isFinite(rawSourceLine) ? sourceLineBase + rawSourceLine : null;
    ...
    if (absoluteSourceLine != null) container.setAttribute('data-source-line', String(absoluteSourceLine));
```

4. `toRender.push({ container, cacheKey, code });`
5. 将 `runStep` 改为：

```js
  const runStep = async () => {
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'strict',
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-preview').trim() || '-apple-system, sans-serif',
    });
    let runError = null;
    try {
      await mermaid.run({ nodes: toRender.map(x => x.container) });
    } catch (e) {
      runError = e;
      if (typeof console !== 'undefined') console.error('Mermaid rendering error:', e);
    }
    for (const { container, cacheKey, code } of toRender) {
      const errorSvg = container.querySelector && container.querySelector('svg[aria-roledescription="error"]');
      const okSvg = container.querySelector && container.querySelector('svg');
      if (errorSvg || (!okSvg && runError)) {
        let message = '';
        if (mermaid && typeof mermaid.parse === 'function') {
          try { await mermaid.parse(code); } catch (e) { message = String((e && e.message) || e); }
        }
        if (!message && runError) message = String((runError && runError.message) || runError);
        renderMermaidErrorCard(container, parseMermaidErrorInfo(message, code), { t });
        continue;
      }
      if (mermaidCache && okSvg) mermaidCache.set(cacheKey, container.innerHTML);
    }
  };
```

保留原有 `mermaidRunQueue` 串行化写法不变。

- [ ] **Step 4: 跑测试确认通过**

Run: `node test/mermaid-error-display.test.cjs`
Expected: PASS。

- [ ] **Step 5: 跑既有 Mermaid 回归，确认没有破坏旧行为**

Run:
```bash
node test/preview-post.test.cjs
node test/mermaid-batch-rerender.test.cjs
node test/mermaid-elk.test.cjs
node test/mermaid-lightbox-click.test.cjs
```
Expected: 全部 PASS。

---

### Task 3: 「定位到源码」交互（阅读模式 + WYSIWYG）

**Files:**
- Modify: `src/modules/layout.js:538-553`（抽出 `_jumpToLine`）
- Modify: `src/modules/misc-ui.js:32-43`（阅读模式点击分支）
- Modify: `src/modules/wysiwyg.js:1000-1050`（WYSIWYG mousedown 分支）
- Test: `test/mermaid-error-locate.test.cjs`（新建）

**Interfaces:**
- Consumes: 容器属性 `data-mermaid-error="1"`、`data-error-abs-line`（0-based）；按钮 `.mermaid-error-locate`。
- Produces: `_jumpToLine(line: number) -> void`（编辑器 mixin 方法；WYSIWYG 下先解罩再落光标）。

- [ ] **Step 1: 写失败测试（阅读模式）**

新建 `test/mermaid-error-locate.test.cjs`：

```js
const test = require('node:test');
const assert = require('node:assert');
const { withEditor, delay } = require('./helpers/app-env.cjs');

function makeErrorCard(w, absLine) {
  const c = w.document.createElement('div');
  c.className = 'mermaid-container';
  c.setAttribute('data-mermaid-error', '1');
  c.setAttribute('data-error-abs-line', String(absLine));
  c.innerHTML = '<div class="mermaid-error-card"><button type="button" class="mermaid-error-locate" data-line="' + absLine + '">定位到源码</button></div>';
  return c;
}

function click(w, el) {
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function mousedown(w, el) {
  el.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
}

test('阅读模式：点击「定位到源码」按钮跳到出错行', async () => {
  await withEditor({}, async (w, ed) => {
    ed.cm.setValue(Array.from({ length: 40 }, (_, i) => 'line ' + i).join('\n'));
    const card = makeErrorCard(w, 11);
    ed.preview.appendChild(card);
    click(w, card.querySelector('.mermaid-error-locate'));
    await delay(10);
    assert.strictEqual(ed.cm.getCursor().line, 11);
  });
});

test('阅读模式：点击卡片空白区同样跳到出错行（不打开灯箱）', async () => {
  await withEditor({}, async (w, ed) => {
    ed.cm.setValue(Array.from({ length: 40 }, (_, i) => 'line ' + i).join('\n'));
    let lightbox = 0;
    ed.showLightbox = () => { lightbox++; };
    const card = makeErrorCard(w, 7);
    ed.preview.appendChild(card);
    click(w, card);
    await delay(10);
    assert.strictEqual(ed.cm.getCursor().line, 7);
    assert.strictEqual(lightbox, 0, '错误卡片不得触发图表灯箱');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/mermaid-error-locate.test.cjs`
Expected: FAIL：光标不动（错误卡片当前无定位处理）。

- [ ] **Step 3: 抽出 `_jumpToLine` 并接入阅读模式**

`src/modules/layout.js` 把 `_jumpToHeadingLine(line)` 的方法体抽成 `_jumpToLine(line)`，`_jumpToHeadingLine` 只调它：

```js
_jumpToLine(line) {
  if (!this.cm || !isFinite(line)) return;
  // 所见即所得：目标行在遮罩块内时先解罩（CM5 会 clamp 到遮罩边界）
  if (this.viewMode === 'wysiwyg' && typeof this.wysiwygBlockIndexAt === 'function') {
    const idx = this.wysiwygBlockIndexAt(line);
    if (idx >= 0 && this._wysiwygMarks && this._wysiwygMarks.has(idx)) {
      this.setWysiwygActiveBlock(idx);
    }
  }
  this.cm.setCursor({ line, ch: 0 });
  this.cm.focus();
  const y = this.cm.heightAtLine(line, 'local');
  this.cm.scrollTo(0, Math.max(0, y - 80));
},
_jumpToHeadingLine(line) {
  this._jumpToLine(line);
},
```

`src/modules/misc-ui.js` 的 `.mermaid-container` 分支，在取 svg 前加错误卡片处理：

```js
if (mermaidContainer) {
  e.preventDefault();
  e.stopPropagation();
  if (mermaidContainer.hasAttribute('data-mermaid-error')) {
    const line = parseInt(mermaidContainer.getAttribute('data-error-abs-line'), 10);
    if (isFinite(line) && typeof this._jumpToLine === 'function') this._jumpToLine(line);
    return;
  }
  const svg = mermaidContainer.querySelector('svg');
  if (svg) this.showLightbox(svg, 'svg');
  return;
}
```

- [ ] **Step 4: 跑阅读模式测试确认通过**

Run: `node test/mermaid-error-locate.test.cjs`
Expected: 阅读模式 2 个用例 PASS。

- [ ] **Step 5: 写失败测试（WYSIWYG）**

追加到 `test/mermaid-error-locate.test.cjs`：

```js
test('WYSIWYG：点击错误卡片跳到出错行并解除该块遮罩', async () => {
  await withEditor({}, async (w, ed) => {
    const md = ['# T', '', '```mermaid', 'flowchart TD', '  A --> B', '```', '', '结束。'].join('\n');
    await ed.addTab('m.md', md, 'C:/tmp/mermaid-error/m.md', 'markdown');
    const tab = ed.tabs.find((t) => t.name === 'm.md');
    if (tab) tab._loaded = true;
    ed.setViewMode('wysiwyg');
    await delay(500);

    const target = 3; // 图表内第 1 行 = 文档 0-based 第 3 行
    const block = ed._wysiwygBlocks.find((b) => target >= b.start && target < b.end);
    assert.ok(block, '应找到覆盖目标行的块');
    const mask = w.document.querySelector('.wysiwyg-block-mask[data-block-index="' + ed._wysiwygBlocks.indexOf(block) + '"]');
    assert.ok(mask, '应找到对应遮罩');
    const card = makeErrorCard(w, target);
    mask.appendChild(card);

    mousedown(w, card);
    await delay(20);
    assert.strictEqual(ed.cm.getCursor().line, target);
  });
});

test('WYSIWYG：错误卡片行号按块偏移还原为绝对行号', async () => {
  await withEditor({}, async (w, ed) => {
    const md = ['# T', '', '```mermaid', 'flowchart TD', '  A --> B[foo()]', '```', '', '结束。'].join('\n');
    // 局部失败版 mermaid：foo() 触发错误 SVG + 抛错，模拟真实 Mermaid 行为
    w.mermaid = {
      initialize() {},
      async parse(text) {
        if (text.includes('foo()')) throw new Error('Parse error on line 2:\n...B[foo()]\n-----^');
        return true;
      },
      async run({ nodes }) {
        nodes.forEach((n) => {
          n.innerHTML = n.textContent.includes('foo()')
            ? '<svg aria-roledescription="error"></svg>'
            : '<svg class="ok-svg"></svg>';
        });
        if (nodes.some((n) => n.textContent.includes('foo()'))) throw new Error('Parse error on line 2: ...');
      },
    };
    await ed.addTab('m2.md', md, 'C:/tmp/mermaid-error/m2.md', 'markdown');
    const tab = ed.tabs.find((t) => t.name === 'm2.md');
    if (tab) tab._loaded = true;
    ed.setViewMode('wysiwyg');
    await delay(500);
    if (ed.flushWysiwygAsyncPasses) ed.flushWysiwygAsyncPasses();
    await delay(50);

    const card = ed.cm.getWrapperElement().querySelector('.mermaid-container[data-mermaid-error]');
    assert.ok(card, '遮罩内应生成错误卡片（限定 CM wrapper，避免误取 #preview 的副本）');
    // 围栏在 0-based 第 2 行；图表第 2 行（foo()）= 文档 0-based 第 4 行
    assert.strictEqual(card.getAttribute('data-source-line'), '3', '围栏绝对 1-based 行 = 3');
    assert.strictEqual(card.getAttribute('data-error-abs-line'), '4');
  });
});
```

- [ ] **Step 6: 跑测试确认失败**

Run: `node test/mermaid-error-locate.test.cjs`
Expected: WYSIWYG 用例 FAIL（光标未落到目标行）。

- [ ] **Step 7: 接入 WYSIWYG mousedown 分支**

`src/modules/wysiwyg.js` 在 `button.copy-btn` 放行检查之后、块编辑按钮分支之前加入：

```js
        // Mermaid 错误卡片：整卡/按钮均可跳到出错行（先于通用 mermaid 分支，
        // 避免错误卡片没有 svg 时被静默吞掉）。
        const mermaidErrHit = ev.target && ev.target.closest
          ? ev.target.closest('.mermaid-container[data-mermaid-error]') : null;
        if (mermaidErrHit) {
          ev.preventDefault();
          const line = parseInt(mermaidErrHit.getAttribute('data-error-abs-line'), 10);
          if (isFinite(line) && typeof self._jumpToLine === 'function') self._jumpToLine(line);
          return;
        }
```

同时修改同文件 `_wysiwygPostProcessAsync` 的 Mermaid 调用，把块偏移传给 `processMermaid`（遮罩内的 `data-source-line` 是块切片内相对行号）：

```js
        const maskIdx = parseInt(node.getAttribute && node.getAttribute('data-block-index'), 10);
        const blockStart = (this._wysiwygBlocks && isFinite(maskIdx))
          ? this._wysiwygBlocks[maskIdx].start : null;
        RenderPost.runMermaid(node, {
          t: (k) => (this.t ? this.t(k) : k),
          isDark: !!this.isDark,
          escapeHtml: (s) => (this.escapeHtml ? this.escapeHtml(s) : String(s == null ? '' : s)),
          escapeAttr: (s) => (this.escapeAttr ? this.escapeAttr(s) : String(s == null ? '' : s)),
          headingToId: (s) => (this.headingToId ? this.headingToId(s) : String(s == null ? '' : s)),
          mermaidCache: this._mermaidCache,
          sourceLineBase: blockStart,
        });
```

- [ ] **Step 8: 跑测试确认通过**

Run: `node test/mermaid-error-locate.test.cjs`
Expected: 3 个用例全部 PASS。

- [ ] **Step 9: 跑既有点击/视图回归**

Run:
```bash
node test/mermaid-lightbox-click.test.cjs
node test/view-mode-wysiwyg.test.cjs
```
Expected: PASS。

---

### Task 4: 主题重渲染与导出护栏

**Files:**
- Modify: `src/modules/theme.js:101-160`（`rerenderMermaid` 容器选择）与 `theme.js:190-210`（`_rerenderWysiwygMermaid` 收集循环）
- Modify: `src/modules/export.js:654`（DOCX Mermaid 重渲染条件）
- Test: `test/mermaid-batch-rerender.test.cjs`（追加用例）与 `test/mermaid-error-display.test.cjs`（静态接线断言）

**Interfaces:**
- Consumes: `[data-mermaid-error]` 标记。
- Produces: 主题切换与导出都不触碰错误容器。

- [ ] **Step 1: 写失败测试（主题重渲染跳过错误容器）**

追加到 `test/mermaid-batch-rerender.test.cjs`：

```js
test('主题重渲染：跳过 data-mermaid-error 容器（不重跑、不丢失卡片）', async () => {
  const { w } = await buildEnv();
  const ed = await waitForEditor(w);
  try {
    const mermaid = fakeMermaidWithSvg();
    w.mermaid = mermaid;
    ed.viewMode = 'wysiwyg';

    const err = w.document.createElement('div');
    err.className = 'mermaid-container';
    err.setAttribute('data-code', 'flowchart TD; A --> B[foo()]');
    err.setAttribute('data-mermaid-error', '1');
    err.innerHTML = '<div class="mermaid-error-card"></div>';
    ed.cm.getWrapperElement().appendChild(err);

    const ok = makeMaskMermaid(w, ed.cm, 'graph LR; A-->B');

    await ed.rerenderMermaid();

    assert.ok(err.querySelector('.mermaid-error-card'), '错误卡片必须仍在');
    assert.strictEqual(err.getAttribute('data-mermaid-error'), '1');
    assert.deepStrictEqual(mermaid.runs.flat(), ['graph LR; A-->B'], '错误容器不得被重跑');
    assert.ok(ok.querySelector('svg.fake-theme-svg'));
  } finally { cleanup(w); }
});

test('主题重渲染：#preview 同样跳过 data-mermaid-error 容器', async () => {
  const { w } = await buildEnv();
  const ed = await waitForEditor(w);
  try {
    const mermaid = fakeMermaidWithSvg();
    w.mermaid = mermaid;
    ed.viewMode = 'preview';
    const err = w.document.createElement('div');
    err.className = 'mermaid-container';
    err.setAttribute('data-code', 'flowchart TD; A --> B[foo()]');
    err.setAttribute('data-mermaid-error', '1');
    err.innerHTML = '<div class="mermaid-error-card"></div>';
    ed.preview.appendChild(err);

    const ok = w.document.createElement('div');
    ok.className = 'mermaid-container';
    ok.setAttribute('data-code', 'graph TD; A-->B');
    ok.textContent = 'graph TD; A-->B';
    ed.preview.appendChild(ok);

    await ed.rerenderMermaid();

    assert.ok(ed.preview.contains(err), '错误容器必须仍在 #preview');
    assert.ok(err.querySelector('.mermaid-error-card'), '错误卡片不得被清掉');
    assert.deepStrictEqual(mermaid.runs.flat(), ['graph TD; A-->B'], '错误容器不得被重跑');
  } finally { cleanup(w); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/mermaid-batch-rerender.test.cjs`
Expected: 新用例 FAIL：`mermaid.runs` 包含错误容器的源码，错误卡片被清空重建。

- [ ] **Step 3: 修改主题重渲染**

`theme.js`：

- `_rerenderWysiwygMermaid` 的收集循环加守卫：

```js
        for (const c of containers) {
          if (c.hasAttribute('data-mermaid-error')) continue; // 卡片用 CSS 变量自适应，无需重跑
          const code = c.getAttribute('data-code');
          ...
        }
```

- `rerenderMermaid` 的 `#preview` 容器选择改为：

```js
        const containers = this.preview.querySelectorAll('.mermaid-container:not([data-mermaid-error])');
```

以及后续 `const nodes = Array.from(this.preview.querySelectorAll('.mermaid-container:not([data-mermaid-error])'));`

- [ ] **Step 4: 跑测试确认通过**

Run: `node test/mermaid-batch-rerender.test.cjs`
Expected: PASS。

- [ ] **Step 5: 修改导出并加静态接线断言**

`export.js` 的 DOCX 重渲染条件：

```js
          if (typeof mermaid !== 'undefined' && container.getAttribute('data-code')
              && !container.hasAttribute('data-mermaid-error')) {
```

追加到 `test/mermaid-error-display.test.cjs`：

```js
test('导出：错误卡片不参与 DOCX 的 mermaid.render 重渲染', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'export.js'), 'utf8');
  assert.match(src, /!container\.hasAttribute\('data-mermaid-error'\)/,
    'export.js 必须在 data-mermaid-error 容器上跳过重渲染');
});
```

- [ ] **Step 6: 跑测试确认通过**

Run:
```bash
node test/mermaid-error-display.test.cjs
node test/mermaid-batch-rerender.test.cjs
```
Expected: PASS。

- [ ] **Step 7: 跑最终相关回归（不跑全量）**

Run:
```bash
node test/mermaid-error-display.test.cjs
node test/mermaid-error-locate.test.cjs
node test/mermaid-batch-rerender.test.cjs
node test/mermaid-elk.test.cjs
node test/mermaid-lightbox-click.test.cjs
node test/preview-post.test.cjs
node test/view-mode-wysiwyg.test.cjs
node scripts/wysiwyg-browser-check.mjs
```
Expected: 全部 PASS。

- [ ] **Step 8: 人工验证问题文档**

在应用里打开用户提供的文档，确认：

1. 图表位置显示错误卡片，文案为「图表内第 11 行（文档第 185 行）」。
2. 点击卡片/「定位到源码」，编辑器跳到第 185 行（1-based）。
3. 给 H 标签加双引号后，重新渲染为正常流程图。
4. 切换明暗主题，错误卡片仍显示且配色跟随主题。

（不提交；如需提交，等用户明确说「提交/commit」。）
