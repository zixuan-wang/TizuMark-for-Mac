# ⌘Q 退出应用 + 系统菜单退出收口 设计

- 日期：2026-10-31
- 状态：待用户批准
- 规模：小改动（前端 3 个文件 + Rust 菜单 + 测试）

## 1. 意图与为什么

macOS 用户习惯用 ⌘Q 退出应用。现状：按下 ⌘Q **完全无反应**，且点系统菜单的「Quit TizuMark」会直接 terminate 进程，绕过未保存提示、会话保存和托盘图标清理。

根因（已定位）：

1. 全局快捷键派发 `_dispatchGlobalShortcut()`（`src/modules/shortcuts.js:929` 起）对任何 Cmd/Ctrl 组合先 `preventDefault()`，再查 `globalShortcutLookup`。⌘Q 不在表里 → 默认行为被阻止、也无处理函数。
2. wry 0.55 对单 WebView 不再覆盖 `performKeyEquivalent`，Cmd 组合先进页面 JS；页面 `preventDefault` 后系统菜单项收不到（⌘W 关标签页能正常工作即同一机制的反证）。
3. Tauri 默认菜单的 Quit 是 `PredefinedMenuItem::quit`（`terminate:` 选择器），走原生终止，无法弹前端保存框。

## 2. 目标 / 非目标 / 反目标

**目标**

- ⌘Q 可退出应用，行为与「窗口关闭 → 退出」一致：有未保存文档先弹「保存/放弃/取消」，确认后按「退出时关闭所有标签」设置处理会话，走 `quit_app` 顺带清理托盘图标。
- 系统菜单「Quit TizuMark」同样走上述流程（点菜单和按 ⌘Q 行为一致）。
- 设置面板「内置快捷键」中展示 ⌘Q 退出（不可改），且录制其他快捷键时 ⌘Q 视为已被占用。

**非目标**

- 不把退出做成可配置快捷键（用户已选固定内置方案）。
- 不处理 Dock 右键「退出」、系统注销/重启、`osascript quit` 等终止路径（它们绕过 `RunEvent::ExitRequested`，需 swizzle `applicationShouldTerminate:`，本次不做）。
- 不改变其他菜单项与快捷键行为。

**反目标**

- ⌘Q 直接退出、丢失未保存内容。
- 用 OS 级全局热键注册 ⌘Q（会抢走其他应用的 ⌘Q）。

## 3. 方案与取舍

### 3.1 快捷键形态：固定内置（A） vs 可配置（B）

- **A 固定内置（已选）**：在全局派发中固定注册 ⌘Q，内置表展示、不可改。符合 macOS 惯例，切换快捷键方案/清空自定义键位不会丢；改动小。
- B 可配置：新增 `quitApp` 动作、三语言标签、四个方案同步补默认值；灵活但误清空后 ⌘Q 又失效，改动面大一倍。**未选**。

### 3.2 系统菜单退出：自定义菜单（已选） vs 拦截运行事件 vs 替换默认菜单项

- **自定义菜单（已选）**：用 Tauri 菜单 API 复刻默认菜单结构，只把 Quit 换成普通菜单项（id `quit-app`，accelerator `Cmd+Q`），`on_menu_event` 向前端 emit `quit-requested`。显式、可测、不依赖内部顺序。
- 拦截 `RunEvent::ExitRequested`：**排除**。macOS 上 Cmd+Q/Dock 退出不触发 `ExitRequested`，只走 `RunEvent::Exit`（不可阻止）。
- 运行时替换默认菜单里的 Quit 项：**排除**。默认菜单不暴露子项引用，只能按位置/文本猜，脆弱。

## 4. 已确认的决策（用户）

| 决策点 | 结论 |
|--------|------|
| 快捷键形态 | 固定内置，不可配置 |
| 退出语义 | 有未保存文档先询问保存；之后强制按「退出」执行（不弹「关闭窗口时」询问框） |
| 系统菜单 Quit | 一起改，走同一前端退出流程 |

## 5. 实现要点

### 前端

1. `src/modules/shortcuts.js`
   - `applyShortcuts()` 末尾固定注册 `this.globalShortcutLookup['Ctrl+Q'] = () => this.handleAppClose('quit')`。固定注册覆盖任何旧配置里占用 ⌘Q 的绑定（内置键优先）。
   - `getBuiltinFixedShortcuts()` 三语言各加一条 `{ combo: 'Cmd+Q', group: 'app', name: '退出应用', desc: ... }`，供设置面板展示与 `findBuiltinShortcut` 冲突拦截复用。
   - `renderShortcutsList()` 增加 `builtinTable('app', t('builtinAppGroup'))`。
2. `src/modules/lifecycle.js`
   - `handleAppClose(forceAction)`：`const action = forceAction || await this._resolveCloseAction();`。
   - 增加重入保护 `_closeInProgress`，避免菜单事件与 JS keydown 同时触发时弹两次保存框。
3. `src/app.js`
   - 新增 `TauriApi.onEvent('quit-requested', () => window.editor.handleAppClose('quit'))`。
4. `src/modules/i18n-data.js`
   - 三语言新增 `builtinAppGroup`（应用 / Application / Aplicación）。

### Rust（`src-tauri/src/lib.rs`）

- 新增 `build_app_menu(app)`：用 Tauri 菜单 API 复刻默认菜单（App 菜单：About/Services/Hide/Hide Others；File：Close Window；Edit：Undo/Redo/Cut/Copy/Paste/Select All；View：Fullscreen；Window 用 `WINDOW_SUBMENU_ID`；Help 用 `HELP_SUBMENU_ID`），**仅 Quit 换成普通 `MenuItem`**：id `quit-app`、文本 `Quit TizuMark`、accelerator `Cmd+Q`。
- Builder 增加 `.menu(|app| build_app_menu(app))` 替换默认菜单，并 `.on_menu_event`：命中 `quit-app` 时先 `show_window`（窗口可能在托盘隐藏），再向 main 窗口 emit `quit-requested`。托盘菜单事件不变。

## 6. 测试与验证

- 新增 `test/shortcut-quit-app.test.cjs`：
  - `globalShortcutLookup['Ctrl+Q']` 在初始化后存在，派发 ⌘Q 时 `handleAppClose('quit')` 被调用一次且事件被 `preventDefault`（编辑器有焦点/无焦点两态）。
  - 内置表中存在 `Cmd+Q` 条目；录制其他动作到 ⌘Q 被拒绝。
  - `handleAppClose('quit')` 跳过 `_resolveCloseAction`，无未保存文档时直接 `quitApp`；有未保存文档时先出保存框，取消则不退出。
- 相关测试（按 CLAUDE.md 只跑相关，不跑全量）：`shortcut-global-dispatch`、`shortcut-settings-ui`、`shortcut-default-registration`、`shortcut-scheme`、`editor-clear-tabs-on-quit`、`i18n`、新增文件。
- Rust：`cargo check`。
- 真机验收（用户执行 `npm run dev` 或自打包后）：⌘Q 弹保存提示/直接退出；菜单「Quit TizuMark」同样流程；托盘隐藏时点菜单退出会先显示窗口。

## 7. 留给实现者

- 菜单复刻是否逐项对齐 Tauri 默认（以本文件第 5 节列表为准）。
- 重入保护期间用户再次触发 ⌘Q 时静默忽略（不叠加弹框）。
- 若真机上 JS 路径与菜单 accelerator 同时触发，由 `_closeInProgress` 保证只执行一次。
