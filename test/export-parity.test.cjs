// 导出与阅读模式一致性（2026-10-25 用户反馈的回归守卫）
//
// 用户当轮反馈的现象分三类，根因都在「导出帧拿到的样式/内容与阅读模式不是同一份」：
//   ① 导出 PDF / HTML 里公式出现第二份纯文本（a²+b²=c² 后面跟 a2 + b2 = c2）
//      → KaTeX 的 .katex-mathml 副本平时靠 CSS clip-path 隐藏，导出帧一旦缺样式就裸露；
//   ② 导出后代码高亮全丢
//      → hljs 主题 CSS 走裸 fetch，失败即静默为空；
//   ③ 导出 HTML / 长图与阅读模式差异大
//      → HTML 用另写的 _documentExportCSS（与 styles.css 两套平行实现），长图用 html2canvas
//        自带绘制器（不支持 MathML/clip-path/color-mix）。
//
// 本文件守住四条口径：MathML 必摘、样式必从 CSSOM 直读、HTML 必带 .preview-content 根、
// PDF 必走 PrintToPdf 且打印态必须干净。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { withEditor } = require('./helpers/app-env.cjs');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'export.js'), 'utf8');

const sliceFn = (startMarker, endMarker) => {
  const a = SRC.indexOf(startMarker);
  const b = endMarker ? SRC.indexOf(endMarker) : SRC.length;
  assert.ok(a > 0 && b > a, `无法定位方法体：${startMarker} … ${endMarker}`);
  return SRC.slice(a, b);
};

// ---------------------------------------------------------------- MathML 副本

test('MathML 副本：导出前一律从 clone 摘掉，不依赖 CSS clip-path 隐藏', () => {
  const calls = SRC.match(/this\._stripKatexMathml\(/g) || [];
  // exportImage / exportHTML（PDF 已随功能删除）
  assert.ok(calls.length >= 2,
    `_stripKatexMathml 应至少被长图、HTML 两处调用，实得 ${calls.length} 处`);
  for (const fn of ['async exportImage()', 'async exportHTML()']) {
    const body = sliceFn(fn, fn === 'async exportImage()' ? 'getCachedImageURL(dataUri)' : undefined);
    assert.ok(body.includes('this._stripKatexMathml('), `${fn} 未摘除 .katex-mathml 副本`);
  }
});

test('MathML 副本：只动导出副本，live preview 必须原样保留（DOCX 靠它取 OMML 源）', async () => {
  await withEditor({}, async (w, ed) => {
    ed.preview.innerHTML = '<p>前</p><span class="katex"><span class="katex-mathml"><math><mi>a</mi></math></span>'
      + '<span class="katex-html">a</span></span><p>后</p>';
    const clone = ed.preview.cloneNode(true);
    ed._stripKatexMathml(clone);
    assert.strictEqual(clone.querySelectorAll('.katex-mathml').length, 0, '副本里 MathML 未被移除');
    assert.strictEqual(clone.querySelectorAll('.katex-html').length, 1, '副本里可视化层被误删');
    assert.strictEqual(ed.preview.querySelectorAll('.katex-mathml').length, 1,
      'live preview 被改动 —— export-docx.js 正是从 .katex-mathml 取 <math> 转 OMML 的，会直接毁掉 DOCX 公式');
  });
});

// ---------------------------------------------------------------- 样式采集

test('样式采集：CSSOM 直读优先于 fetch（fetch 失败会静默变空串，是高亮/MathML 事故源头）', () => {
  const fnBody = sliceFn('_exportStyleFromLink(matchFn) {', '_absolutizeCssUrls');
  assert.ok(fnBody.includes('link.sheet'), '样式采集未经 <link>.sheet 读 CSSOM');
  assert.ok(fnBody.includes('cssRules'), '样式采集未读 cssRules');
  assert.ok(!/fetch\(/.test(fnBody), '样式采集仍依赖 fetch（失败即静默为空）');

  // exportHTML / exportImage 的 katex / hljs 一律走采集器，不得再裸 fetch
  for (const fn of ['async exportHTML()', 'async exportImage()']) {
    const body = sliceFn(fn, fn === 'async exportHTML()' ? 'async exportWord' : 'getCachedImageURL(dataUri) {');
    assert.ok(body.includes('this._exportStyleFromLink('), `${fn} 未使用样式采集器`);
    assert.ok(!/fetch\('lib\/katex/.test(body), `${fn} 仍在裸 fetch katex.min.css`);
  }
});

test('样式采集：KaTeX 字体 url 绝对化 / 内联（否则导出帧字体 404，公式字形退化）', () => {
  const absBody = sliceFn('_absolutizeCssUrls(css, baseHref) {', '导出帧不需要 KaTeX');
  assert.ok(absBody.includes('new URL(u, baseHref)'), '未按样式表位置解析相对 url');
  assert.match(absBody, /data:\|blob:\|https\?:\|file:/, '未跳过已是绝对的 url（会重复改写）');

  const inlineBody = sliceFn('async _inlineCssFonts(css, baseHref) {', '_waitImagesReady');
  assert.ok(inlineBody.includes('readAsDataURL'), '字体未内联为 data URI（SVG-as-image 不能加载外部资源）');
  assert.match(inlineBody, /woff2/, '未限定字体格式（会把整个字体目录塞进导出物）');
});

// ---------------------------------------------------------------- 导出 HTML

test('导出 HTML：复用阅读模式样式（不再用平行维护的 _documentExportCSS）+ 保留作用域根', () => {
  const body = sliceFn('async exportHTML() {', 'async exportWord');
  assert.ok(!body.includes('_documentExportCSS()'),
    'exportHTML 仍用 _documentExportCSS —— 与 styles.css 是两套平行实现，必然与阅读模式漂移');
  assert.ok(body.includes('this._inlineCssFonts('), '导出 HTML 未内联 KaTeX 字体（换机器打开公式字形退化）');
  assert.match(body, /<div class="\$\{containerClass\}">/,
    '导出 HTML 丢了 .preview-content 作用域根 —— styles.css 的阅读样式几乎全是它的后代选择器');
  assert.match(body, /data-theme="\$\{theme\}"/, '导出 HTML 未带 data-theme（主题变量取不到）');
  assert.ok(body.includes("this.t('exportingHTML')"), '导出 HTML 没有 loading 文案');
  assert.ok(/finally \{[\s\S]{0,160}?this\._hideExportOverlay\(\)/.test(body),
    '导出 HTML 的遮罩未在 finally 收尾（失败/取消会留全屏遮罩）');
});

// ---------------------------------------------------------------- 长图

test('长图：改由浏览器自己渲染（SVG foreignObject），不再用 html2canvas 的自带绘制器', () => {
  const body = sliceFn('async exportImage() {', 'getCachedImageURL(dataUri) {');
  assert.ok(body.includes('XMLSerializer'), '长图未走 XMLSerializer（HTML 序列化不是 well-formed XML，SVG 会解析失败）');
  assert.ok(body.includes('foreignObject'), '长图未走 foreignObject');
  assert.ok(!body.includes('html2canvas('), '长图仍在调用 html2canvas（不支持 MathML/clip-path/color-mix，与阅读模式必然不一致）');
  assert.ok(body.includes('this._inlineCssFonts('), '长图未内联 KaTeX 字体（SVG-as-image 不能加载外部资源）');
});

test('长图：导出必须带 loading 遮罩并在 finally 收尾', () => {
  const body = sliceFn('async exportImage() {', 'getCachedImageURL(dataUri) {');
  assert.ok(body.includes("this.t('generatingImg')"), '长图导出没有 loading 文案');
  assert.ok(/finally \{[\s\S]{0,240}?this\._hideExportOverlay\(\)/.test(body),
    '长图遮罩未在 finally 收尾');
});

// ---------------------------------------------------------------- 2026-10-26 三条反馈回归

test('长图：展开规则必须随 styleEl 进 SVG（SVG-as-image 是独立渲染环境，head 里的 expandStyle 序列化后不存在）', () => {
  const body = sliceFn('async exportImage() {', 'getCachedImageURL(dataUri) {');
  // styleEl.textContent 组装点必须拼上 _exportExpandRules：appCSS 是完整 styles.css，
  // 自带 .code-scroll{max-height:300px;overflow-y} / pre 滚动裁切——不拼等于「度量时展开、
  // 成图时缩回」，长图里代码块重新只剩 300px + 滚动条（用户截图复现）。
  assert.match(body,
    /styleEl\.textContent = customFontCSS \+ appCSS \+ hljsCSS \+ katexCSS \+ expandCSSForSvg/,
    '长图 styleEl 未拼展开规则（成图时代码块会重新折叠 + 滚动条）');
  assert.match(body, /this\._exportExpandRules\(''\)/, '长图未生成 SVG 内展开 CSS');
});

test('导出 HTML：写盘成功后遮罩收尾弹「导出成功」toast（与 DOCX 同口径）', () => {
  // exportHTML 与 exportWord 之间夹着 docx 页面尺寸/回退等方法（各有自己的 finally），
  // 不能 lastIndexOf 整个切片——以 exportHTML 自己的 setStatus(exportedHTML) 为锚、
  // 取其后第一段 finally。
  const body = sliceFn('async exportHTML() {', 'async _fallbackWordHtmlExport');
  assert.ok(body.includes('htmlExported = true'), 'HTML 写盘成功未置成功标记');
  const anchor = body.indexOf("this.t('exportedHTML')");
  assert.ok(anchor > 0, 'HTML 导出成功态缺失');
  const fin = body.slice(anchor).match(/} finally \{[\s\S]*?\n        \}/);
  assert.ok(fin, 'exportHTML finally 块定位失败');
  const finTxt = fin[0];
  assert.match(finTxt, /this\._hideExportOverlay\(\)/, 'HTML 遮罩未在 finally 收尾');
  assert.match(finTxt, /if \(htmlExported\) this\.showToast\(this\.t\('exportSuccess'\), 'success'\)/,
    'HTML 导出成功未弹 toast（用户不知道导出完没完成）');
  // 顺序铁律（DOCX 注释）：先关遮罩再弹 toast，否则 toast 被遮罩盖住
  assert.ok(finTxt.indexOf('this._hideExportOverlay()') < finTxt.indexOf('showToast'),
    'toast 必须在遮罩关闭之后弹（否则被盖住）');
});

test('长图：写盘成功后遮罩收尾弹「导出成功」toast（与 HTML/DOCX 同口径）', () => {
  const body = sliceFn('async exportImage() {', 'getCachedImageURL(dataUri) {');
  assert.ok(body.includes('imgExported = true'), '长图写盘成功未置成功标记');
  const fin = body.slice(body.lastIndexOf('} finally {'));
  assert.match(fin, /this\._hideExportOverlay\(\)/, '长图遮罩未在 finally 收尾');
  assert.match(fin, /if \(imgExported\) this\.showToast\(this\.t\('exportSuccess'\), 'success'\)/,
    '长图导出成功未弹 toast（用户不知道导出完没完成）');
  assert.ok(fin.indexOf('this._hideExportOverlay()') < fin.indexOf('showToast'),
    'toast 必须在遮罩关闭之后弹（否则被盖住）');
});
