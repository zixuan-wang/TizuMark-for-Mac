# TizuMark (macOS, personal use)

<p align="center">
  <img src="https://img.shields.io/badge/Version-1.2.4-blue" alt="Version">
  <img src="https://img.shields.io/badge/macOS-11%2B-brightgreen" alt="macOS">
  <img src="https://img.shields.io/badge/Tauri-2.x-orange" alt="Tauri">
  <img src="https://img.shields.io/badge/License-GPL--3.0-blue" alt="License">
</p>

🌐 [简体中文](README.md) | **English** | [Español](README.es.md)

TizuMark is a lightweight Markdown editor (CodeMirror 5 + Tauri 2, rendered by macOS WKWebView).
This repository is a **macOS-only build kept for personal use**: it was trimmed from the upstream
Windows version, all Windows compatibility code was removed, and **PDF export** and **auto-update**
were dropped. It is not published.

## Features

- Edit / read / live preview (beta) modes, outline navigation, KaTeX math and Mermaid diagrams
- Open `.md` / `.markdown` by double-clicking in Finder (file association registered)
- Multiple tabs, workspace file tree, cross-file search, fonts and themes
- Tray: close to tray, show main window or quit from the tray menu
- Global hotkey to bring the window back (grant Accessibility permission on first use in
  System Settings → Privacy & Security → Accessibility)
- Export HTML, long image, DOCX (PDF export removed)

## Requirements

- macOS 11 or later
- For development: Xcode Command Line Tools (`xcode-select --install`), Rust (rustup), Node.js ≥ 18

## Development

```bash
npm ci
npm run dev
```

## Build

```bash
npm run build
```

Output: `src-tauri/target/release/bundle/app/TizuMark.app` (`.app` only; no dmg or installer).

## Shortcuts

Shortcuts are displayed with macOS symbols (⌘ / ⌥ / ⇧). The default scheme follows VS Code:
⌘N new, ⌘O open, ⌘S save, ⌘F find, ⌘B bold, ⌘K insert link, and so on; customize them in
Shortcut Settings.
