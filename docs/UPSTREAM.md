# 上游仓库与同步策略

本仓库（TizuMark-for-Mac）源自上游 **TizuMark** 跨平台 Markdown 编辑器，已完成 macOS 纯化改造，
并于 2026-10-31 断开 GitHub fork 关系，作为**独立仓库**维护。

## 上游地址

| 平台 | 地址 | 说明 |
| --- | --- | --- |
| GitHub | <https://github.com/tizuio/TizuMark-Markdown-Editor> | 上游主仓库 |
| Gitee | <https://gitee.com/tizu/TizuMark-Markdown-Editor> | 上游 Gitee 侧（自动镜像同步） |

## 分叉情况

- **分叉点**：`cfb0c18`（2026-10-27）。此后本仓库进行 macOS 纯化改造，
  规格见 `docs/superpowers/specs/2026-10-30-macos-adaptation-design.md`。
- 本仓库已刻意移除：全部 Windows 兼容代码、Windows 发布链（NSIS/MSI/签名/更新 manifest/CI）、
  **PDF 导出**、**自动更新**。
- 版本号沿用上游 tag 节奏（当前 v1.2.4 与上游一致）。

## 同步策略

1. **不添加上游 remote**。需要对比时手动一次性 fetch：
   ```bash
   git fetch git@github.com:tizuio/TizuMark-Markdown-Editor.git master
   git merge-base HEAD FETCH_HEAD        # 求当前 merge-base
   git log --oneline <merge-base>..FETCH_HEAD
   ```
2. **平台无关的修复**（渲染引擎、编辑器核心、解析器等）按需
   `git cherry-pick -x <commit>`——`-x` 在提交信息中保留上游提交号溯源；
   cherry-pick 后按测试纪律只跑改动相关测试。
3. **永不同步**：Windows 开发/发布链（`*.ps1`、NSIS/MSI、签名、更新 manifest）、
   PDF 导出、自动更新——这些在本仓库已刻意移除，同步等于把清理掉的东西加回来。
4. 上游的 Merge PR 提交无需单独同步，只 cherry-pick 其中的实质提交。

## 已同步记录

| 日期 | 上游提交 | 本仓库提交 | 说明 |
| --- | --- | --- | --- |
| 2026-10-31 | `e6f7166` | `9e821fa` | fix(renderer): 行内 `\(...\)` 默认按公式渲染 |
| — | `46cb525` | 未同步 | setup-dev.ps1 修复，属 Windows 开发链，不适用 |
