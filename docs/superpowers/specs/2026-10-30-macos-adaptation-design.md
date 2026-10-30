# macOS 自用版适配设计(纯 macOS 化改造)

- 日期:2026-10-30
- 状态:已批准(三决策经用户逐项确认,本文档为落地规格)
- 目标形态:**仓库改造为 macOS-only 应用,删除而非禁用 Windows 兼容代码**
- 验证策略:小步删除,每步 `npm run check` + `cargo check`,全程 git 可回退

## 0. 背景与已确认决策

前提(用户明确):

1. **macOS 版不发布,仅自用**,本机(macOS)直接编译
2. **可进行破坏性适配**,优先主体功能可用
3. **舍弃 PDF 导出功能**(连同其 Windows 实现一并删除)
4. **精简掉 Windows 兼容代码,改造为纯 macOS 应用**

经逐项确认的三个设计决策:

| 决策点 | 结论 |
|--------|------|
| Finder 双击 .md 打开 | **保留**(实现 `RunEvent::Opened` 接收) |
| 窗口控制钮 | **红绿灯叠层**(`titleBarStyle: Overlay + hiddenTitle`,隐藏自绘三钮) |
| 「导出 PDF」「检查更新」入口 | 直接隐藏 → 纯 macOS 化后升级为**整体删除** |

## 1. 范围

**做**:编译跑通 → Rust 侧裁剪与改造 → 前端裁剪与改造 → 护栏同步 → 测试与真机验收。

**明确不做**:

- PDF 导出的 macOS 替代实现(功能直接移除)
- 发布链路重建(签名/公证/CI macOS job/darwin update manifest/release 上传脚本)
- `docs/DEV_SETUP.md` 完整重写(README 改写为 macOS 说明即可)
- WKWebView 渲染差异的系统性修复(真机人工验收为主,实时预览 beta 为重点观察项)

## 2. 已完成:brotli patch 删除(2026-10-30)

`src-tauri/Cargo.toml` 的 `[patch.crates-io] brotli = { git = "dropbox/rust-brotli", rev = 9cbed81 }` **已删除**。

- **存在原因**(git 历史因 ref 损坏重建无记录,经考古确认):该 rev 的 commit "Allow newer alloc-no-stdlib which enforce no-unsafe in their lib.rs" 放宽了 brotli 对 `alloc-no-stdlib` 的依赖范围(`"2.0"` → `">=2.0.4, <4"`),作用仅是**把 alloc-no-stdlib 统一到单一 3.0.0**,避免双版本重复编译——属编译卫生,不是构建失败修复
- **删除验证**:`cargo tree` 重新解析成功;crates.io brotli 解析到 8.0.4(正式版,registry 校验和)
- **版本统一(消除重复编译)**:删除 patch 后 brotli 家族出现 `alloc-no-stdlib` 双版本(2.0.4 + 3.0.0)共存——非错误,但属无谓重复。已通过 **lock 层 pin** 消除:`cargo update -p alloc-stdlib --precise 0.2.2`(brotli 8.0.4 声明的 `~0.2` 范围内),alloc-stdlib 0.2.2 对 alloc-no-stdlib 的依赖回落到 2.x,全家统一单一 2.0.4。Cargo.toml 保持无 patch、无 git fork,纯 registry 构建
- ⚠️ **注意**:该统一是 Cargo.lock 层的 pin;裸跑 `cargo update -p alloc-stdlib` 会回到 0.2.3、双版本复现,届时重新执行同一 `--precise 0.2.2` 降级即可
- **附带收益**:去除 git fork 依赖,回归纯 registry 构建
- Cargo.lock 已更新;完整 `cargo check` 在实施第一步统一验证

## 3. 删除清单(Windows-only)

### 3.1 Rust 侧

- **Cargo.toml** 依赖:`webview2-com`、`windows`、`winreg`、`tauri-plugin-updater`、`tauri-plugin-single-instance`、`minisign-verify`;整个 `[target.'cfg(target_os = "windows")'.dependencies]` 段
- **lib.rs**:
  - `print_to_pdf` 整链(WebView2 实现段 + 非 Windows stub)
  - `get_cli_args` 命令与 argv 模型(Windows 文件打开惯例)
  - 更新缓存三命令(`installer_{version}.exe` / NSIS /UPDATE / ShellExecute 语义,约 L857-1091)
  - single-instance 插件初始化与其回调(macOS 本就不支持该插件)
  - `safe_write_target` 的 Windows 黑名单(替换为 darwin 黑名单,见 §4)
  - 命令数 20 → 约 16,`generate_handler!` 同步缩减
- **tauri.conf.json**:updater 插件段 + 双 endpoints、`bundle.windows.nsis` 段、`fileAssociations` 保留(Info.plist 注册仍需要)
- **根目录**:`update-windows-x86_64.json`

### 3.2 前端

- **updater.js**:更新检查/安装逻辑整块;启动 5 秒自动检查(`app.js:122` 附近);帮助菜单「检查更新」(`#btn-check-update`)
- **export.js**:PDF 导出分支(`_supportsPrintToPdf` UA 判定、PrintToPdf 调用链、错误分支)与菜单项 `#btn-export-pdf`
- **窗口控制三钮**:`index.html` `.window-controls`(L249-257)、对应 CSS、`updater.js` 中 minimize/toggleMaximize/updateMaximizeIcon/startDragging 逻辑(红绿灯替代;拖拽区 `data-tauri-drag-region` 保留)

### 3.3 脚本与配置

- 删除:`scripts/setup-dev.ps1`、`scripts/fix-moved-toolchain.ps1`、`scripts/sign.ps1`、`scripts/release.js`、`scripts/github-release.js`、`scripts/release-notes.js`、`scripts/check-updater.cjs`、`scripts/gen-update-json.cjs`
- 删除:package.json `postbuild`(绿色版拷贝)
- **保留**:`generate-icons.js`(icns 生成仍需要);`ensure-vendor.mjs`、`build-renderer.mjs`、`dev-server.mjs`、`run-tests.cjs`、`check-*.cjs` 护栏脚本等跨平台开发工具全部保留(darwin 路径适配见 §4.5)

### 3.4 文档

- README.md / README.en.md / README.es.md:Windows 说明改写为 macOS(自用定位,简短)
- CLAUDE.md:删除 Windows 发布流程章节(签名路径、Gitee/GitHub Release 步骤、update JSON 生成),保留测试纪律、提交规范等通用规范;开发环境初始化章节改为 macOS 版

## 4. 直接改写(无兼容分支)

### 4.1 窗口样式(Rust/配置)

`tauri.conf.json` 主窗口配置改为:

```json
"decorations": true,
"titleBarStyle": "Overlay",
"hiddenTitle": true
```

若配置字段在该 tauri 版本不生效(编译期验证),退为 Rust setup 中三行等效调用。前端:布局**直接固定为 macOS 形态**(纯 macOS 化,不留平台分支)→ 删除 `.window-controls`,`toolbar-left` 左侧预留 ~78px 红绿灯区。红绿灯的 close 同样走 close 事件拦截,「关闭到托盘」逻辑不受影响。

### 4.2 快捷键

- `src/modules/shortcuts.js` 默认表:Ctrl → Cmd;keydown 匹配改 `e.metaKey`
- CodeMirror keymap:CM5 在 mac 上自动把 `Ctrl-` 前缀映射为 Cmd,核对自定义 keymap 后按需调整
- 全局热键(关闭到托盘)注册字符串改 Cmd 写法
- 显示层:快捷键设置界面 + i18n 文案(`i18n-data.js`)Ctrl → ⌘

### 4.3 安全与文案

- `safe_write_target`(lib.rs:121):黑名单判定抽为纯函数,只留 darwin 表(`/System`、`/Library`、`/Applications`、`/usr`、`/private/etc` 等),附 Rust `#[cfg(test)]` 单测
- `validateFileName`(files.js:555):macOS 放行 `:`
- settings/i18n 的 `D:/images` 类示例路径(settings.js:493、i18n-data.js 三处)改平台无关写法
- read_file 错误码映射(Windows ERROR_SHARING_VIOLATION=32):随删除清单清理

### 4.4 Finder 打开文件

- Rust:`tauri::Builder.run` 事件循环处理 `RunEvent::Opened`,路径 emit `'opened-file'` 事件到前端
- 前端:tauri-api.js 已有 event 封装(P1-5 收敛),listen 后复用现有打开文件流程(files.js)
- 非 md 文件走现有错误提示路径

### 4.5 开发工具链残留(现在必须修,否则 mac 跑不了回归)

- `scripts/run-tests.cjs:138`:puppeteer 兜底路径 `C:/Users/admin/node_modules` 改 darwin/NODE_PATH 逻辑
- `scripts/wysiwyg-browser-check.mjs:35-38`、`scripts/slash-browser-check.mjs:34-37`:playwright 缓存路径 `~/AppData/Local/ms-playwright` + `chrome-win64/chrome.exe` 改 darwin 缓存布局

## 5. 护栏同步(删东西的联动代价)

| 护栏 | 需要的同步 |
|------|-----------|
| `tauri-api.js` COMMANDS | 与 `generate_handler!` 同步删命令(契约测试反解析两侧,自动校验一致) |
| `check-version.mjs` | 校验清单去掉 update json / release-notes.js 相关条目 |
| `capabilities/default.json` | 删 updater 权限;global-shortcut 权限保留 |
| `test/error-handling.test.cjs` 等 | 随删除的命令/错误路径同步调整 |
| `check-globals` / `entry-scripts` | 无新模块则不动;若删模块则同步清单 |

## 6. 保留不动

托盘 + 关闭到托盘 + 全局热键(真机验证权限)、window-state、dialog/fs/shell 插件、notify、fontdb、`brotli`(patch 已删,依赖本身是 tauri-codegen 固有的)、`windows_subsystem` attr(标准模板写法,macOS 无效无害)。

## 7. 测试与验收

1. **基线**:本机 `npm ci`(prepare 自动 build renderer + vendor)→ `npm test` 全量通过;`npm run check` 全绿
2. **新增测试**:safe_write_target darwin 黑名单单测、opened-file 事件前端处理测试、快捷键 metaKey 断言
3. **编译验证**:`cargo check` + `npm run build` 全链路通过(含 brotli patch 删除后的首次完整编译)
4. **真机验收清单**:
   - .app 启动,红绿灯正常,标题栏拖拽正常,toolbar-left 无遮挡
   - Finder 双击 .md 打开正常;应用内打开/保存/另存为正常
   - 托盘关闭/唤回、全局热键(如触发辅助功能授权,记录操作步骤)
   - 导出 HTML / 长图 / DOCX 正常;菜单中不存在「导出 PDF」「检查更新」;启动无更新检查网络请求
   - 快捷键 ⌘N/⌘S/⌘F 等生效;快捷键设置界面显示 ⌘
   - 实时预览(beta)与阅读/源码模式人工过一遍 WYSIWYG 基本场景

## 8. 风险

| 风险 | 缓解 |
|------|------|
| 删除面大,可能连带破坏 | 小步删除 + 每步双 check;git 全程可回退 |
| `titleBarStyle` 配置不生效 | 退为 Rust setup 调用,约 3 行 |
| WKWebView(WebKit)与 WebView2 渲染差异 | 真机人工验收,不系统性修复;发现问题记录为后续项 |
| 全局热键需要辅助功能授权 | 真机验证,写入 README 使用说明 |
| `cargo check` 暴露未预见的平台差异 | Phase 1 第一时间验证,问题收敛后再动大刀 |

## 9. 实施顺序

1. `cargo check` + `npm ci && npm test` 基线(含 brotli patch 删除后的编译验证)
2. Rust 侧:删 updater/single-instance/argv/print_to_pdf 链 → RunEvent::Opened → safe_write_target darwin 化 → 窗口样式
3. 前端:删窗口三钮 → 红绿灯布局 → 快捷键 Cmd 化 → 删更新逻辑与 PDF 分支 → 文案
4. 护栏与脚本:tauri-api/check-version/capabilities 同步 → 开发脚本 darwin 化 → 文档
5. 全量测试 + 真机验收
