# Mermaid 语法错误可诊断化 设计文档（Phase A）

- 日期：2026-10-31
- 状态：待批准（未实现）
- 范围：只做「渲染失败时给出可诊断的错误卡片」，不更换渲染器
- 后续：Phase B（是否引入 pele）另行立项，见文末

## 背景

2026-10-31 用户反馈含 Mermaid 的文档「无法正常显示」。截图中的流程图在预览区只显示 Mermaid 自带的炸弹图标 `Syntax error in text`，编辑器侧看不到具体哪一行出错。

定位结果（用项目内置 mermaid 11.15 在真实 Chromium + jsdom 双环境复现）：

- 出错行是该图第 11 行 `F --> H[union all 汇总: sum(nnum)/sum(...)...]`。Mermaid 节点标签里的 `(` `)` `{` `}` `[` `]` `"` `|` 都是语法字符，必须把整个标签用双引号包住；加引号后整图正常渲染。
- `mermaid.parse(text)` 抛出的错误信息本身带有行号、错误片段与 caret，但当前 `processMermaid` 只 `console.error`，界面仅剩 Mermaid 默认错误 SVG。
- `mermaid.run` 在一批节点中遇到解析错误时，**会继续渲染同批其他节点**，错误节点被插入 `svg[aria-roledescription="error"]`，随后整体 reject。当前代码在 `catch` 里直接 `return`，导致同批本来渲染成功的图也不写缓存。
- pele 对同一份代码同样报错（语法规则与 Mermaid 一致），所以「换渲染器」不能解决这类图表不显示的问题；它的优势是同步渲染、体积、主题与结构化错误（`PeleError.line/column/snippet`）。

## 目标

1. Mermaid 解析/渲染失败时，在原图表位置显示可诊断的错误卡片：图表内行号、文档行号、出错源码行、常见成因提示、原始错误信息。
2. 「定位到源码」：点击卡片或按钮，编辑器光标跳到出错行；WYSIWYG 下同步解除该块遮罩。
3. 一张坏图不影响同批其他图的渲染与缓存；成功结果继续进 `mermaidCache`，失败结果不入缓存。
4. 阅读模式与 WYSIWYG 行为一致；主题切换不重跑错误卡片；导出路径不回归。
5. 文案覆盖 zh / en / es。

## 非目标

- 不更换 Mermaid、不引入 pele（Phase B 单独评估）。
- 不自动修改用户源码（不做「一键加引号」；只提示写法）。
- 不覆盖所有 Mermaid 错误类型，只做通用展示 + 一类高价值提示（标签内未加引号的特殊字符）。
- 不改动 Mermaid 的 `securityLevel: 'strict'`。

## 方案

### 1. 错误捕获与卡片渲染（`src/modules/preview-post.js`）

`processMermaid` 调整：

1. 仍按现有逻辑建容器、命中缓存、收集 `toRender`。
2. `mermaid.run({ nodes })` 用 `try/catch` 包住，**catch 后不再 return**，继续处理每个容器。
3. 逐容器判定失败：`container.querySelector('svg[aria-roledescription="error"]')` 存在，或没有 `svg` 且本次 `run` 抛过错。
4. 失败容器调用 `mermaid.parse(code)` 取详细错误（仅失败块，成功块不重复解析）：
   - 从 `/Parse error on line (\d+)/` 提取图表内 1-based 行号；
   - 从 `data-code` 按行取出出错源码行；
   - 解析失败（如运行期错误）时退回通用文案。
5. 用 DOM API（`createElement` + `textContent`）重建容器内容为错误卡片；**禁止 innerHTML 拼接源码/错误信息**（源码是用户内容）。
6. 容器保留 `data-code` / `data-source-line`，追加 `data-mermaid-error="1"`。
7. 成功容器照常写入 `mermaidCache`；失败容器跳过。

卡片结构：

```
.mermaid-error-card
  .mermaid-error-title      图表语法错误
  .mermaid-error-line       图表内第 11 行（文档第 185 行）
  code.mermaid-error-source 出错源码行
  .mermaid-error-hint       标签含 ( ) { } [ ] " | 时，请整段用双引号包住，例如 B["foo()"]
  details.mermaid-error-raw 原始错误信息（折叠，pre 内显示 mermaid 原文）
  button.mermaid-error-locate[data-line="184"] 定位到源码
```

- 行号换算：`data-source-line` 是围栏行（1-based，已在滑动窗口模式下还原为绝对行号）。**注意 WYSIWYG 遮罩内的 `data-source-line` 是块切片内的相对行号**（`_wysiwygRenderSource` 不偏移），因此 `processMermaid` 增加 `opts.sourceLineBase`（所在块起始 0-based 行），统一换算为绝对围栏行后再写入容器。图表内第 N 行对应编辑器 0-based 行 `sourceLine + N - 1`；文档 1-based 行为 `sourceLine + N`。
- Mermaid 报告的 `Parse/Lexical error on line N` 是**剥离 frontmatter、`%%{...}%%` 指令与 `%%` 注释后**的行号；实现按 Mermaid `preprocessDiagram` 同一规则把 N 映射回原始源码行（`mapMermaidLineToSource`），映射失败时只显示图表内行号、不显示文档行与定位按钮。
- 提示判定启发式：出错源码行中第一个 `[...]` 标签内容未被双引号整体包裹，且含 `()` `{}` `[]` `"` `|` 之一。
- `opts.t` 用于文案插值（`{line}` / `{docLine}`）。

### 2. 定位交互

- 抽出通用 `_jumpToLine(line)`（`src/modules/layout.js`），`_jumpToHeadingLine` 改为调用它；复用现有 WYSIWYG 解罩逻辑（`wysiwygBlockIndexAt` + `setWysiwygActiveBlock`）、`setCursor`、`heightAtLine` 滚动公式。
- 阅读模式：`src/modules/misc-ui.js` 的 `.mermaid-container` 分支——有 SVG 仍开灯箱；`data-mermaid-error` 时定位到 `data-line`，并避免触发链接/灯箱逻辑。
- WYSIWYG：`src/modules/wysiwyg.js` 的 mousedown 分支——`button.copy-btn` 旁增加 `button.mermaid-error-locate` 与 `data-mermaid-error` 容器处理，先于通用 mermaid 分支。
- 无 `data-source-line` 时不显示定位按钮（例如切片信息缺失），卡片仍可诊断。

### 3. 主题切换

- `src/modules/theme.js` 两条重渲染路径的选择器都排除 `[data-mermaid-error]`：
  - 阅读模式 `rerenderMermaid` 的容器收集与后续 `nodes`；
  - `_rerenderWysiwygMermaid` 的 `prepared` 收集。
- 错误卡片颜色全部走 CSS 变量，切主题自动适配，无需重跑 Mermaid。

### 4. 导出

- `src/modules/export.js` 对 `data-mermaid-error` 容器跳过 `mermaid.render` 重渲染，保留卡片；HTML/图片/DOCX 导出的是错误提示本身（透明展示失败原因），不阻断导出。
- `export-docx.js` 的 `.mermaid-container` 无 img 时现有逻辑返回空数组，无需改动。

### 5. 样式与文案

- `src/styles.css`：错误卡片边框/底色用 `--color-danger`、`--bg-secondary`、`--border-color`；源码行用 `--bg-code` + 等宽字体 + `overflow-x:auto`；按钮沿用现有小按钮风格。
- `src/modules/i18n-data.js` 新增 key（zh/en/es）：
  - `mermaidErrorTitle`
  - `mermaidErrorLine`（`图表内第 {line} 行（文档第 {docLine} 行）`）
  - `mermaidErrorLineOnly`（`图表内第 {line} 行（无法映射到文档行）`）
  - `mermaidErrorHint`
  - `mermaidErrorRaw`
  - `mermaidErrorLocate`
  - `mermaidErrorNoLine`
  - `mermaidErrorRenderFailed`

## 关键决定（可推翻）

| 决定 | 理由 |
|---|---|
| 只对失败块调用 `mermaid.parse` 取详情 | 避免所有图重复解析；`suppressErrors` 会吞掉消息，无法复用 |
| 用 `aria-roledescription="error"` 识别错误 SVG | Mermaid 11 错误渲染的稳定标记，实测存在 |
| 整张卡片可点击定位，按钮只是显式入口 | 降低「知道哪行却还要找按钮」的摩擦 |
| 不做自动加引号 | 改源码不可逆、易误伤；先让用户看见问题 |
| 错误卡片不参与主题重渲染 | 卡片无主题相关 SVG，CSS 变量已自适应 |
| 卡片保留 `data-code` | 后续若用户编辑/重新渲染，现有管线可复用源码 |

## 测试计划

新增 `test/mermaid-error-display.test.cjs`（jsdom + fake mermaid）：

1. 同批「1 坏 + 1 好」：好图有 SVG 且写入缓存；坏图有 `.mermaid-error-card` 且不入缓存。
2. 卡片包含图表内行号、文档行号、出错源码行、提示、`data-line`。
3. 点击定位按钮：阅读模式下光标落到 `sourceLine + errLine - 1`。
4. WYSIWYG 下点击卡片/按钮：目标块解除遮罩、光标落到目标行。
5. 主题重渲染跳过 `[data-mermaid-error]`（fake mermaid 的 `run` 调用次数不增加，卡片仍在）。
6. XSS 守卫：错误信息/源码含 `<img onerror=...>` 时只以文本呈现，不产生元素。

改动相关性测试（按 CLAUDE.md 只跑相关项）：

- `node test/mermaid-error-display.test.cjs`
- `node test/mermaid-batch-rerender.test.cjs`
- `node test/mermaid-elk.test.cjs`
- `node test/mermaid-lightbox-click.test.cjs`
- `node test/preview-post.test.cjs`
- WYSIWYG 相关：`node test/view-mode-wysiwyg.test.cjs` + `node scripts/wysiwyg-browser-check.mjs`

人工验证：打开用户提供的问题文档，确认卡片显示「图表内第 11 行」、定位跳到文档第 185 行；给 H 标签加引号后图表正常渲染。

## Phase B 备忘（不在本次范围）

是否引入 `obsidianmd/pele` 需单独设计，核心权衡：

- 收益：同步渲染（0.05–0.3 ms）、包体 716 KB vs 现在 8.1 MB、CSS 变量主题、内置缩放/响应式、`PeleError` 带行列号。
- 代价：自有布局/视觉与 Mermaid 不一致；`theme` / `themeVariables` 基本无效；任意 HTML label 不支持；`flowchart-elk` 只是语法识别、非真实 ELK；ZenUML 等第三方图型不支持；导出 Word 需改造。
- 结论：先完成 Phase A 的「失败可诊断」；若之后主要痛点是速度/体积/主题统一，再评估 Phase B。
