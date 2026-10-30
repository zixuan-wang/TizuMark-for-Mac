# TizuMark (macOS, uso personal)

<p align="center">
  <img src="https://img.shields.io/badge/Version-1.2.4-blue" alt="Version">
  <img src="https://img.shields.io/badge/macOS-11%2B-brightgreen" alt="macOS">
  <img src="https://img.shields.io/badge/Tauri-2.x-orange" alt="Tauri">
  <img src="https://img.shields.io/badge/License-GPL--3.0-blue" alt="License">
</p>

🌐 [简体中文](README.md) | [English](README.en.md) | **Español**

TizuMark es un editor de Markdown ligero (CodeMirror 5 + Tauri 2, renderizado con WKWebView de macOS).
Este repositorio es una **versión exclusiva para macOS de uso personal**: se recortó de la versión
original para Windows, se eliminó todo el código de compatibilidad con Windows y se quitaron la
**exportación a PDF** y la **actualización automática**. No se publica.

## Funciones

- Modos edición / lectura / vista previa en vivo (beta), esquema de navegación, fórmulas KaTeX y diagramas Mermaid
- Abrir `.md` / `.markdown` con doble clic en Finder (asociación de archivos registrada)
- Varias pestañas, árbol de archivos del espacio de trabajo, búsqueda entre archivos, fuentes y temas
- Bandeja: cerrar a la bandeja, mostrar la ventana principal o salir desde su menú
- Atajo global para recuperar la ventana (concede permiso de Accesibilidad en Ajustes del Sistema →
  Privacidad y seguridad → Accesibilidad la primera vez)
- Exportar HTML, imagen larga y DOCX (exportación a PDF eliminada)

## Requisitos

- macOS 11 o superior
- Para desarrollar: Xcode Command Line Tools (`xcode-select --install`), Rust (rustup), Node.js ≥ 18

## Desarrollo

```bash
npm ci
npm run dev
```

## Compilación

```bash
npm run build
```

Resultado: `src-tauri/target/release/bundle/macos/TizuMark.app` (solo `.app`; sin dmg ni instalador).

## Atajos

Los atajos se muestran con símbolos de macOS (⌘ / ⌥ / ⇧). El esquema predeterminado sigue a VS Code:
⌘N nuevo, ⌘O abrir, ⌘S guardar, ⌘F buscar, ⌘B negrita, ⌘K insertar enlace, etc.; se personalizan en
Ajustes de atajos.
