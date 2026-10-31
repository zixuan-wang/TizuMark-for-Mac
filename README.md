# TizuMark（macOS 自用版）

<p align="center">
  <img src="https://img.shields.io/badge/Version-1.2.4-blue" alt="Version">
  <img src="https://img.shields.io/badge/macOS-11%2B-brightgreen" alt="macOS">
  <img src="https://img.shields.io/badge/Tauri-2.x-orange" alt="Tauri">
  <img src="https://img.shields.io/badge/License-GPL--3.0-blue" alt="License">
</p>

🌐 **简体中文** | [English](README.en.md) | [Español](README.es.md)

TizuMark 是一个轻量的 Markdown 编辑器（CodeMirror 5 + Tauri 2，渲染引擎为 macOS 自带的 WKWebView）。
本仓库是**仅供本机自用的 macOS 专用版**：由上游 [TizuMark-Markdown-Editor](https://github.com/tizuio/TizuMark-Markdown-Editor)
（Windows 版）裁剪而来，删除了全部 Windows 兼容代码，并移除了 **PDF 导出**与**自动更新**两项功能。不对外发布。
本仓库**已断开 GitHub fork 关系，作为独立仓库维护**；上游地址与同步策略见 [docs/UPSTREAM.md](docs/UPSTREAM.md)。

## 功能

- 编辑 / 阅读 / 实时预览（beta）三种模式，大纲导航，KaTeX 公式与 Mermaid 图表
- Finder 双击 `.md` / `.markdown` 直接打开（应用内已注册文件关联）
- 多标签页、文件树工作区、跨文件搜索、字体与主题切换
- 托盘常驻：关闭到托盘，托盘菜单可显示主窗口或退出
- 全局热键唤回窗口（首次使用需在「系统设置 → 隐私与安全性 → 辅助功能」中授权）
- 导出 HTML、长图、DOCX（PDF 导出已移除）

## 系统要求

- macOS 11 及以上
- 开发需：Xcode Command Line Tools（`xcode-select --install`）、Rust（rustup）、Node.js ≥ 18

## 本地开发

```bash
npm ci
npm run dev
```

## 打包

```bash
npm run build
```

产物：`src-tauri/target/release/bundle/macos/TizuMark.app`（仅 `.app`，不生成 dmg/安装器）。

## 快捷键

界面内键位统一按 macOS 约定显示（⌘ / ⌥ / ⇧）。默认方案沿用 VS Code 风格：
⌘N 新建、⌘O 打开、⌘S 保存、⌘F 查找、⌘B 加粗、⌘K 插入链接等，可在「快捷键设置」中自定义。
