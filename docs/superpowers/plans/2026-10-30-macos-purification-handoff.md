# 交接文档:执行 macOS 纯化改造实现计划

> 本文档供**新会话**接手执行。写于 2026-10-30,交接自前一会话(已完成方案设计与冗余清除)。

## 使命(一句话)

按 `docs/superpowers/plans/2026-10-30-macos-purification.md` 逐任务执行 16 个任务,把本仓库改造为 macOS-only 自用应用,过程不跑偏。

## 权威文件(按此执行,勿重读全库)

| 文件 | 作用 |
|------|------|
| `docs/superpowers/plans/2026-10-30-macos-purification.md` | **执行主体**:16 任务、每步代码/命令/预期输出。逐任务勾选 checkbox 跟踪进度 |
| `docs/superpowers/specs/2026-10-30-macos-adaptation-design.md` | 设计规格(为什么这么改);与计划冲突时以计划操作步骤为准、以规格意图仲裁 |
| commit `31fedb9` / `f3d6a67` | 已完成:方案落地 + 冗余文件清除(43 删 4 改)。先 `git log --oneline -3` + `git show --stat` 了解现状 |
| `CLAUDE.md` | 项目规范:提交规范、测试纪律(只跑相关测试) |

## 已拍板决策——不得重开讨论

1. **不发布、仅自用**,本机 macOS 编译(工具链已装:cargo 1.95 / rustc / node / npm / 全局 playwright)
2. **可破坏性裁剪,纯 macOS 化**:删而非禁用,不留 Windows 兼容分支、不留 `__IS_MAC__` 双平台判断
3. **舍弃 PDF 导出**(连同 Rust 实现一起删,HTML/长图/DOCX 保留)
4. 窗口 = **红绿灯叠层**(titleBarStyle Overlay),Finder 双击打开**保留**(复用前端既有 `file-open` 事件,`src/app.js:517` 已有监听,**前端零改动**)
5. 快捷键内部 token 保持 `Ctrl`(派发 `ctrl||meta` 已兼容 Cmd),只改显示层 ⌘ 与 OS 全局热键注册串 `Cmd`

## 防跑偏红线

- **按计划顺序执行**,每任务的 commit 步骤是计划组成部分,用户已授权执行计划即含逐任务提交;**push 未授权,永远不执行**
- **测试纪律**:每任务只跑计划指定的相关测试;全量 `npm test` 仅任务 1(基线)与任务 16(终验)
- **计划与现实冲突时**(行号漂移、API 名不符、文件内容与锚点不一致):做**最小必要调整**完成该任务意图,在该任务 commit message 末尾注明偏差;**语义级冲突**(需要改设计才能继续)→ 停下问用户,不许自行改设计
- **不新增计划外功能/重构**;不删规格 §6 保留项(demo.md、testdemo.md、screenshots/01-main.png、`_slash_check.html`、`_wysiwyg_compare.html`、托盘/全局热键链路)
- **构建红线**:`npm run build` 只出现在任务 16;其他任务一律 `cargo check` / `cargo test` / `npm run check` / 相关 node 测试
- 每任务完成标准:checkbox 全勾 + 相关测试绿 + commit 落库。完成前跑验证命令,禁止无证据宣称完成

## 环境事实(省时间)

- 仓库:`/Users/ice/develop/opensource/TizuMark-Markdown-Editor/TizuMark-Markdown-Editor`(本目录即 git 根,分支 master)
- `node_modules` 已由 `npm ci` 装好;若缺失重跑 `npm ci`(prepare 会自动 build:renderer + vendor)
- Cargo.lock 已含 **alloc-stdlib 0.2.2 pin**(消除 alloc-no-stdlib 双版本);裸跑 `cargo update -p alloc-stdlib` 会弹回 0.2.3、重复编译复现——届时重新 `--precise 0.2.2` 即可,不要动 Cargo.toml(已无 brotli patch,保持纯 registry)
- `src-tauri` 里 `dirs` crate 已确认无调用(任务 2 一并删);`FilePath` 若无 Display,用 `f.clone().into_path().to_string_lossy().to_string()`(任务 6 已注明)
- `index.html:101-102` 的 `.header`/`.toolbar` 已带 `data-tauri-drag-region`,删自绘拖拽 JS 后原生拖拽直接生效(任务 11)
- `e2e-human-check.mjs`、`bench-render.js`、`test-render.js`、`audit-split.cjs`、`introspect-split.cjs` 为保留的开发工具,勿删

## 建议流程

1. 读计划头部 + 任务 1,跑基线(基线红了先停下修复/上报,不带病开改)
2. 逐任务:执行步骤 → 勾 checkbox(直接编辑计划文件)→ 相关测试绿 → commit
3. 任务 11 是首个 GUI 冒烟点(`npm run dev` 人工验证红绿灯,需用户配合目测);任务 16 是全量终验 + 真机验收清单(逐项请用户确认)
4. 全部完成后向用户汇报验收清单结果,**不主动 push**

## Suggested Skills(新会话按需调用 Skill 工具)

- `superpowers:executing-plans`(或 scoped `TizuMark-Markdown-Editor:executing-plans`)— 执行本计划的主流程技能
- `superpowers:subagent-driven-development` — 若新会话选择子代理驱动模式(计划头部二选一)
- `superpowers:verification-before-completion` — 每任务宣称完成前,先跑验证拿证据
- `superpowers:systematic-debugging` — 基线或任务测试失败时,先系统定位再改
- `superpowers:test-driven-development` — 任务 5(safe_write_target darwin 化)是显式 TDD 任务
- `TizuMark-Markdown-Editor:using-git-worktrees` — **本任务不要用**(用户工作流是 master 直接执行,前两个 commit 已在 master)
