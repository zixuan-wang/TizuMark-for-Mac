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
  assert.strictEqual(info.originalLine, 2);
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

test('i18n：错误卡片 8 个 key 在 zh/en/es 均存在', () => {
  global.window = global.window || globalThis;
  const { I18N } = require('../src/modules/i18n-data.js');
  for (const lang of ['zh', 'en', 'es']) {
    for (const key of ['mermaidErrorTitle', 'mermaidErrorRenderFailed', 'mermaidErrorLine',
      'mermaidErrorLineOnly', 'mermaidErrorNoLine', 'mermaidErrorHint', 'mermaidErrorRaw', 'mermaidErrorLocate']) {
      assert.ok(I18N[lang][key], `${lang} 缺少 ${key}`);
    }
  }
});

function makeFakeMermaid() {
  return {
    initialize() {},
    async parse(text) {
      if (text.includes('foo()')) {
        throw new Error('Parse error on line 2:\n...B[foo()]\n-----^\nExpecting ... got \'PS\'');
      }
      return true;
    },
    async run({ nodes }) {
      // 先快照源码：下面会把 innerHTML 改成 SVG，改完再读 textContent 就找不到错误标记了
      const codes = nodes.map((n) => n.textContent);
      nodes.forEach((n, i) => {
        n.innerHTML = codes[i].includes('foo()')
          ? '<svg aria-roledescription="error"></svg>'
          : '<svg class="ok-svg" aria-roledescription="flowchart-v2"></svg>';
      });
      if (codes.some((c) => c.includes('foo()'))) {
        throw new Error('Parse error on line 2: ...');
      }
    },
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
  // 无 parse 方法时只能用 run 抛出的消息；这里模拟一条不带行号的运行期错误
  m.run = async ({ nodes }) => {
    nodes.forEach((n) => { n.innerHTML = '<svg aria-roledescription="error"></svg>'; });
    throw new Error('Diagram render failed');
  };
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
  assert.strictEqual(bad.getAttribute('data-error-abs-line'), '4', '图表第 2 行 → 文档 0-based 第 4 行');
  assert.strictEqual(bad.getAttribute('data-code'), 'flowchart TD\n  A --> B[foo()]', 'data-code 必须保留');
});

test('processMermaid：draw 期错误（普通 SVG + 抛错）也出卡片且不写缓存', async () => {
  const { preview } = createPreviewDom();
  preview.innerHTML = '<pre><code class="language-mermaid" data-source-line="5">flowchart TD\n  A --> B[End]</code></pre>';
  global.mermaid = {
    initialize() {},
    async parse() { return true; }, // 解析成功，draw 期失败
    async run({ nodes }) {
      // Mermaid draw 期异常：先画错误炸弹（无 aria-roledescription="error"），再 throw
      nodes.forEach((n) => { n.innerHTML = '<svg class="ok-svg"></svg>'; });
      throw new Error('Diagram render failed');
    },
  };
  const cache = new Map();
  await PP.processMermaid(preview, { t: tStub, isDark: false, mermaidCache: cache });
  const c = preview.querySelector('.mermaid-container');
  assert.strictEqual(c.getAttribute('data-mermaid-error'), '1');
  assert.ok(c.querySelector('.mermaid-error-card'), 'draw 期错误也必须显示卡片');
  assert.strictEqual(cache.size, 0, 'draw 期失败不得写入缓存');
});

test('parseMermaidErrorInfo：Lexical error 也提取行号', () => {
  const info = PP.parseMermaidErrorInfo('Lexical error on line 2. Unrecognized text.', 'flowchart TD\n  A --> B');
  assert.strictEqual(info.line, 2);
  assert.strictEqual(info.isParseError, true);
  assert.strictEqual(info.originalLine, 2);
});

test('parseMermaidErrorInfo：frontmatter 剥离后的行号映射回原文', () => {
  const code = ['---', 'config:', '  layout: elk', '---', 'flowchart TD', '  A --> B[foo()]'].join('\n');
  const info = PP.parseMermaidErrorInfo('Parse error on line 2:', code);
  assert.strictEqual(info.line, 2, 'Mermaid 报告的是剥离 frontmatter 后的行号');
  assert.strictEqual(info.originalLine, 6, '原文中出错行是第 6 行');
  assert.strictEqual(info.sourceLine, '  A --> B[foo()]');
});

test('parseMermaidErrorInfo：%% 注释行剥离后的行号映射回原文', () => {
  const code = ['flowchart TD', '%% comment', '  A --> B[foo()]'].join('\n');
  const info = PP.parseMermaidErrorInfo('Parse error on line 2:', code);
  assert.strictEqual(info.originalLine, 3);
  assert.strictEqual(info.sourceLine, '  A --> B[foo()]');
});

test('parseMermaidErrorInfo：%%{init}%% 指令剥离后的行号映射回原文', () => {
  const code = ['%%{init: {"theme":"dark"}}%%', 'flowchart TD', '  A --> B[foo()]'].join('\n');
  const info = PP.parseMermaidErrorInfo('Parse error on line 2:', code);
  assert.strictEqual(info.originalLine, 3);
  assert.strictEqual(info.sourceLine, '  A --> B[foo()]');
});

test('导出：错误卡片不参与 DOCX 的 mermaid.render 重渲染', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'export.js'), 'utf8');
  assert.match(src, /!container\.hasAttribute\('data-mermaid-error'\)/,
    'export.js 必须在 data-mermaid-error 容器上跳过重渲染');
});
