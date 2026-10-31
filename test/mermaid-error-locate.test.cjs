const test = require('node:test');
const assert = require('node:assert');
const { withEditor, delay } = require('./helpers/app-env.cjs');
const { loadUnifiedRenderer } = require('./helpers/load-bundle.cjs');

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

test('WYSIWYG：点击错误卡片跳到出错行并解除该块遮罩', async () => {
  await withEditor({}, async (w, ed) => {
    loadUnifiedRenderer(w);
    const md = ['# T', '', '```mermaid', 'flowchart TD', '  A --> B', '```', '', '结束。'].join('\n');
    await ed.addTab('m.md', md, 'C:/tmp/mermaid-error/m.md', 'markdown');
    const tab = ed.tabs.find((t) => t.name === 'm.md');
    if (tab) tab._loaded = true;
    ed.setViewMode('wysiwyg');
    await delay(500);

    const target = 3; // 图表内第 1 行 = 文档 0-based 第 3 行
    const blockIdx = ed._wysiwygBlocks.findIndex((b) => target >= b.start && target < b.end);
    assert.ok(blockIdx >= 0, '应找到覆盖目标行的块');
    // jsdom 里 CM5 不把 replacedWith widget 连进文档，直接取 mark 的节点并挂到 wrapper 下
    const mask = ed._wysiwygMarks.get(blockIdx) && ed._wysiwygMarks.get(blockIdx).replacedWith;
    assert.ok(mask, '应找到对应遮罩节点');
    ed.cm.getWrapperElement().appendChild(mask);
    const card = makeErrorCard(w, target);
    mask.appendChild(card);

    mousedown(w, card);
    await delay(20);
    assert.strictEqual(ed.cm.getCursor().line, target);
  });
});

test('WYSIWYG：错误卡片行号按块偏移还原为绝对行号', async () => {
  await withEditor({}, async (w, ed) => {
    loadUnifiedRenderer(w);
    const md = ['# T', '', '```mermaid', 'flowchart TD', '  A --> B[foo()]', '```', '', '结束。'].join('\n');
    // 局部失败版 mermaid：foo() 触发错误 SVG + 抛错，模拟真实 Mermaid 行为
    w.mermaid = {
      initialize() {},
      async parse(text) {
        if (text.includes('foo()')) throw new Error('Parse error on line 2:\n...B[foo()]\n-----^');
        return true;
      },
      async run({ nodes }) {
        const codes = nodes.map((n) => n.textContent);
        nodes.forEach((n, i) => {
          n.innerHTML = codes[i].includes('foo()')
            ? '<svg aria-roledescription="error"></svg>'
            : '<svg aria-roledescription="flowchart-v2"></svg>';
        });
        if (codes.some((c) => c.includes('foo()'))) throw new Error('Parse error on line 2: ...');
      },
    };
    await ed.addTab('m2.md', md, 'C:/tmp/mermaid-error/m2.md', 'markdown');
    const tab = ed.tabs.find((t) => t.name === 'm2.md');
    if (tab) tab._loaded = true;
    ed.setViewMode('wysiwyg');
    await delay(500);
    // jsdom 里 CM5 不把 replacedWith widget 连进文档：直接取 mark 节点，挂到 wrapper
    // 下使其 connected，再手动跑该节点的异步 pass（等价于真实环境的 flush）。
    const blockIdx = ed._wysiwygBlocks.findIndex((b) => 3 >= b.start && 3 < b.end);
    assert.ok(blockIdx >= 0, '应找到 Mermaid 块');
    const mask = ed._wysiwygMarks.get(blockIdx) && ed._wysiwygMarks.get(blockIdx).replacedWith;
    assert.ok(mask, '应找到对应遮罩节点');
    ed.cm.getWrapperElement().appendChild(mask);
    await ed._wysiwygPostProcessAsync(mask, blockIdx);
    await delay(150);

    const card = mask.querySelector('.mermaid-container[data-mermaid-error]');
    assert.ok(card, '遮罩内应生成错误卡片');
    // 围栏在 0-based 第 2 行；图表第 2 行（foo()）= 文档 0-based 第 4 行
    assert.strictEqual(card.getAttribute('data-source-line'), '3', '围栏绝对 1-based 行 = 3');
    assert.strictEqual(card.getAttribute('data-error-abs-line'), '4');
    const lineText = card.querySelector('.mermaid-error-line').textContent;
    assert.doesNotMatch(lineText, /\{line\}|\{docLine\}/, 'WYSIWYG 包装器不得丢弃 i18n 参数');
    assert.match(lineText, /5/, '文档 1-based 行号 5 应出现在文案中');
  });
});

test('预览链路：错误卡片行号文案使用真实 t 插值（无 {line} 占位符）', async () => {
  await withEditor({}, async (w, ed) => {
    loadUnifiedRenderer(w);
    w.mermaid = {
      initialize() {},
      async parse(text) {
        if (text.includes('foo()')) throw new Error('Parse error on line 2:\n...B[foo()]\n-----^');
        return true;
      },
      async run({ nodes }) {
        const codes = nodes.map((n) => n.textContent);
        nodes.forEach((n, i) => {
          n.innerHTML = codes[i].includes('foo()')
            ? '<svg aria-roledescription="error"></svg>'
            : '<svg aria-roledescription="flowchart-v2"></svg>';
        });
      },
    };
    ed.cm.setValue(['```mermaid', 'flowchart TD', '  A --> B[foo()]', '```'].join('\n'));
    await ed.updatePreview();
    await delay(150);
    const card = ed.preview.querySelector('.mermaid-container[data-mermaid-error]');
    assert.ok(card, '预览应生成错误卡片');
    const lineText = card.querySelector('.mermaid-error-line').textContent;
    assert.doesNotMatch(lineText, /\{line\}|\{docLine\}/, 'i18n 参数不得丢失');
    assert.match(lineText, /2/, '应含图表内行号 2');
    assert.match(lineText, /3/, '应含文档行号 3');
  });
});

test('阅读模式：点击「原始错误信息」summary 不被拦截，可展开', async () => {
  await withEditor({}, async (w, ed) => {
    ed.cm.setValue(Array.from({ length: 10 }, (_, i) => 'line ' + i).join('\n'));
    const card = makeErrorCard(w, 5);
    card.querySelector('.mermaid-error-card').insertAdjacentHTML('beforeend',
      '<details class="mermaid-error-raw"><summary>原始错误信息</summary><pre>err</pre></details>');
    ed.preview.appendChild(card);
    const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true });
    card.querySelector('summary').dispatchEvent(ev);
    await delay(10);
    assert.strictEqual(ev.defaultPrevented, false, 'summary 点击不得被 preventDefault');
    assert.strictEqual(ed.cm.getCursor().line, 0, '点 summary 不应跳转');
  });
});

test('阅读模式：定位时切到源码视图（纯阅读模式编辑器隐藏，跳转需可见反馈）', async () => {
  await withEditor({}, async (w, ed) => {
    ed.cm.setValue(Array.from({ length: 40 }, (_, i) => 'line ' + i).join('\n'));
    ed.setViewMode('preview');
    const card = makeErrorCard(w, 9);
    ed.preview.appendChild(card);
    click(w, card.querySelector('.mermaid-error-locate'));
    await delay(20);
    assert.strictEqual(ed.viewMode, 'edit', '纯阅读模式定位后应切到源码视图');
    assert.strictEqual(ed.cm.getCursor().line, 9);
  });
});

test('WYSIWYG：callout 分段遮罩里的错误卡片行号与点击定位正确', async () => {
  await withEditor({}, async (w, ed) => {
    loadUnifiedRenderer(w);
    w.mermaid = {
      initialize() {},
      async parse(text) {
        if (text.includes('foo()')) throw new Error('Parse error on line 2:\n...B[foo()]\n-----^');
        return true;
      },
      async run({ nodes }) {
        const codes = nodes.map((n) => n.textContent);
        nodes.forEach((n, i) => {
          n.innerHTML = codes[i].includes('foo()')
            ? '<svg aria-roledescription="error"></svg>'
            : '<svg aria-roledescription="flowchart-v2"></svg>';
        });
      },
    };
    const md = [
      '> [!note]',
      '> 简介',
      '> ```mermaid',
      '> flowchart TD',
      '>   A --> B[foo()]',
      '> ```',
    ].join('\n');
    await ed.addTab('c.md', md, 'C:/tmp/mermaid-error/c.md', 'markdown');
    const tab = ed.tabs.find((t) => t.name === 'c.md');
    if (tab) tab._loaded = true;
    ed.setViewMode('wysiwyg');
    await delay(300);
    ed.cm.setCursor({ line: 1, ch: 0 });
    ed.syncWysiwygActiveBlock();
    await delay(250);
    const segs = ed._wysiwygSegMarks || [];
    assert.ok(segs.length >= 1, '应生成引用分段遮罩');

    let card = null;
    for (const m of segs) {
      const node = m && m.replacedWith;
      if (!node) continue;
      ed.cm.getWrapperElement().appendChild(node);
      await ed._wysiwygPostProcessAsync(node, ed._wysiwygActiveIdx);
      await delay(120);
      card = node.querySelector('.mermaid-container[data-mermaid-error]');
      if (card) break;
    }
    assert.ok(card, '分段内应生成错误卡片');
    // 围栏原文 0-based 第 2 行（1-based 3）；图表第 2 行 → 文档 1-based 5 → 0-based 4
    assert.strictEqual(card.getAttribute('data-source-line'), '3');
    assert.strictEqual(card.getAttribute('data-error-abs-line'), '4');

    card.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await delay(30);
    assert.strictEqual(ed.cm.getCursor().line, 4, '分段内点击错误卡片应定位到出错行');
  });
});

test('WYSIWYG：错误卡片 summary 的 mousedown 不被拦截（可展开）', async () => {
  await withEditor({}, async (w, ed) => {
    loadUnifiedRenderer(w);
    const md = ['# T', '', '```mermaid', 'flowchart TD', '  A --> B', '```', '', '结束。'].join('\n');
    await ed.addTab('s.md', md, 'C:/tmp/mermaid-error/s.md', 'markdown');
    const tab = ed.tabs.find((t) => t.name === 's.md');
    if (tab) tab._loaded = true;
    ed.setViewMode('wysiwyg');
    await delay(300);
    const blockIdx = ed._wysiwygBlocks.findIndex((b) => 3 >= b.start && 3 < b.end);
    const mask = ed._wysiwygMarks.get(blockIdx) && ed._wysiwygMarks.get(blockIdx).replacedWith;
    assert.ok(mask, '应找到遮罩节点');
    ed.cm.getWrapperElement().appendChild(mask);
    const card = makeErrorCard(w, 3);
    card.querySelector('.mermaid-error-card').insertAdjacentHTML('beforeend',
      '<details class="mermaid-error-raw"><summary>原始错误信息</summary><pre>err</pre></details>');
    mask.appendChild(card);
    const ev = new w.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    card.querySelector('summary').dispatchEvent(ev);
    await delay(10);
    assert.strictEqual(ev.defaultPrevented, false, 'summary mousedown 不得被 preventDefault');
    assert.strictEqual(ed.cm.getCursor().line, 0, '点 summary 不应跳转');
  });
});
