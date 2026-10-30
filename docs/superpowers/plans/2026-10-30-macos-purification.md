# macOS 纯化改造实现计划

> **面向 AI 代理的工作者:** 必需子技能:使用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框(`- [ ]`)语法来跟踪进度。

**目标:** 把 TizuMark 从 Windows-only 改造为 macOS-only 自用应用——删净 Windows 兼容代码,核心功能(编辑/预览/Finder 打开/托盘/快捷键)在 macOS 完全可用,舍弃 PDF 导出与自动更新。

**架构:** Tauri v2 桌面壳不变;Rust 侧删 updater/single-instance/argv/PDF 四条 Windows 链,新增 `RunEvent::Opened` 接收 Finder 文件打开(复用前端既有 `file-open` 事件,前端零改动)、`safe_write_target` 换 darwin 黑名单;窗口改 `titleBarStyle: Overlay` 红绿灯叠层,删自绘三钮;快捷键内部 token 保持 `Ctrl`(派发已兼容 `metaKey`),改显示层 ⌘ 与全局热键注册字符串 `Cmd`。

**技术栈:** Rust + tauri 2.x(本机 cargo 1.95)、原生 JS(经典 `<script>` 全局模式)、Node 内置 test runner。规格见 `docs/superpowers/specs/2026-10-30-macos-adaptation-design.md`。

**测试纪律(CLAUDE.md):** 每任务只跑与改动相关的测试,不跑全量 `npm test`(全量仅在任务 16 终验跑)。每任务结束 `npm run check` 必须 0 退出(Rust 任务用 `cargo check`/`cargo test`)。

---

## 文件结构(改动全景)

| 文件 | 操作 | 职责变化 |
|------|------|---------|
| `src-tauri/Cargo.toml` | 修改 | 删 updater/single-instance/minisign-verify/futures-util/dirs 依赖 + 整个 windows target 段 |
| `src-tauri/src/lib.rs` | 修改 | 删 4 条 Windows 链;safe_write_target darwin 化;run() 改 RunEvent::Opened |
| `src-tauri/capabilities/default.json` | 修改 | 删 updater 权限与失效窗口权限 |
| `src-tauri/tauri.conf.json` | 修改 | 删 plugins.updater/nsis;窗口 Overlay 红绿灯;targets: app |
| `src/modules/tauri-api.js` | 修改 | COMMANDS 32→27;删 api.updater |
| `src/modules/updater.js` | 修改 | 删更新逻辑与窗口三钮逻辑,保留 About/openExternal |
| `src/modules/export.js` | 修改 | 删 exportPDF 整链(保留 HTML/长图/DOCX) |
| `src/modules/shortcuts.js` | 修改 | 删 exportPDF 键位;显示层 ⌘;normalize 合并 ctrl/meta;全局热键 Cmd 注册 |
| `src/modules/i18n.js` | 修改 | 删 check-update/窗口三钮的文案绑定行 |
| `src/modules/i18n-data.js` | 修改 | 删 update*/pdf* 键(3 语言);D:/ 文案改通用 |
| `src/modules/settings.js` | 修改 | D:/images 默认值改通用 |
| `src/modules/files.js` | 修改 | validateFileName 放行 `:` |
| `src/app.js` | 修改 | 删启动检查更新、updateMaximizeIcon、两个菜单绑定 |
| `src/index.html` | 修改 | 删窗口三钮/更新弹框/两个菜单项;title 提示 ⌘ 化 |
| `src/styles.css` | 修改 | 删 .window-controls/.update-* 规则;toolbar-left 留红绿灯位 |
| `scripts/run-tests.cjs` | 修改 | puppeteer 路径去 Windows 硬编码 |
| `scripts/wysiwyg-browser-check.mjs` / `slash-browser-check.mjs` | 修改 | findChromium 改 darwin 缓存布局 |
| `test/updater-cache.test.cjs` `test/updater-skip.test.cjs` `test/export-pdf-font.test.cjs` `test/export-pdf-save-wait.test.cjs` | 删除 | 随功能删除 |
| `test/export-codeblock-wrap.test.cjs` | 修改 | 只删 exportPDF 两个用例,保留 DOCX/长图用例 |
| `test/e2e-human-check.mjs`(在 scripts/ 同级? 实际 `scripts/e2e-human-check.mjs`) | 修改 | 删 update 相关 mock 段 |
| `README.md` / `README.en.md` / `README.es.md` | 重写 | macOS 自用定位;**保留 Version badge 行**(check-version 校验) |

---

### 任务 1:基线验证(无代码变更)

**文件:** 无改动。

- [x] **步骤 1:Rust 编译基线**(首次全量编译,约 3-10 分钟)

运行:`cd src-tauri && cargo check 2>&1 | tail -5`
预期:编译通过(brotli patch 已删,crates.io brotli 8.0.4)。警告可有(Windows-only 函数在 mac 不编译),**错误为零**。

- [x] **步骤 2:Rust 测试基线**

运行:`cd src-tauri && cargo test 2>&1 | tail -5`
预期:全部 pass(现有测试均跨平台;`#[cfg(windows)]` 的 safe_write_target 测试在 mac 自动跳过)。

- [x] **步骤 3:前端基线**

运行:`npm test 2>&1 | tail -5 && npm run check`
预期:全 pass + check 0 退出。若基线已红,先停下修复或上报,不许带病开改。

---

### 任务 2:Rust 删自动更新链

**文件:**
- 修改:`src-tauri/src/lib.rs:857-1091`(更新缓存整块)、`lib.rs:1436`(插件注册)、`lib.rs:1509-1512`(generate_handler)
- 修改:`src-tauri/Cargo.toml:25`(tauri-plugin-updater)、`Cargo.toml:33-34`(minisign-verify、futures-util)、`Cargo.toml:30`(dirs,已确认全仓库无 `dirs::` 调用)
- 修改:`src-tauri/capabilities/default.json:30`(updater:default)
- 修改:`src-tauri/tauri.conf.json:32-40`(plugins.updater 段)

- [x] **步骤 1:删 lib.rs 更新缓存整块**

删除 L857 注释块起至 `install_cached_update` 函数结束(L1091)的全部内容,即这些项:`updates_cache_dir`、`updater_pubkey`、`verify_update_signature`、`sanitize_version_for_filename`、`download_update_to_file`、`find_cached_update`、`install_cached_update`。删除后 L855 `app_data_dir` 函数直接衔接 L1093 的「系统字体枚举」注释块。

- [x] **步骤 2:删插件注册与命令注册**

`run()` 中删除:
```rust
        .plugin(tauri_plugin_updater::Builder::new().build())
```
`generate_handler!` 中删除以下三行及其上方注释行 `// 更新安装包磁盘缓存(下载落盘 / 查缓存 / 从缓存安装)`:
```rust
            download_update_to_file,
            find_cached_update,
            install_cached_update,
```

- [x] **步骤 3:删 Cargo.toml 依赖**

删除这四行:
```toml
tauri-plugin-updater = "2"
dirs = "6"
minisign-verify = "0.2"
futures-util = { version = "0.3", default-features = false, features = ["std"] }
```
注:`reqwest` 保留(`fetch_image_as_base64` 使用)。

- [x] **步骤 4:删 capabilities 与 tauri.conf.json 的 updater 配置**

`capabilities/default.json` permissions 数组删除 `"updater:default"` 行(注意处理 JSON 逗号:删除后 `"global-shortcut:default"` 成为末项,前一行 `shell:allow-open` 对象的 `}` 后**不再有逗号**)。

`tauri.conf.json` 删除整个 `"plugins": { ... }` 段(L32-40,含 updater endpoints 与 pubkey)。

- [x] **步骤 5:编译 + 契约检查**

运行:`cd src-tauri && cargo check 2>&1 | tail -3`
预期:通过。若报 `pubkey`/`updates_cache_dir` 未定义,说明有遗漏引用(搜 `verify_update_signature\|updates_cache_dir` 清干净)。

- [x] **步骤 6:Commit**

```bash
git add -A src-tauri/
git commit -m "refactor(rust): 删自动更新链——updater 插件/磁盘缓存三命令/minisign 验签及依赖

macOS 纯化:应用仅自用不发布,更新系统整链移除(规格 §3.1)。tauri.conf.json 的 updater
plugins 段与 capabilities 的 updater:default 一并删除;Cargo.toml 减 updater/minisign-verify/
futures-util/dirs 四依赖。reqwest 保留(fetch_image_as_base64 仍用)。"
```

---

### 任务 3:Rust 删 single-instance 与 argv 文件打开

**文件:**
- 修改:`src-tauri/src/lib.rs:35-44`(get_cli_args、files_from_args)、`lib.rs:1437-1444`(single-instance 插件)、`lib.rs:1482`(generate_handler)、`lib.rs:1678-1686`+`1701-1705`(两个 files_from_args 测试)
- 修改:`src-tauri/Cargo.toml:21`(tauri-plugin-single-instance)

- [x] **步骤 1:先删测试(TDD 反向:此处是纯删除,先删被测代码的测试)**

`#[cfg(test)] mod tests` 中删除 `test_files_from_args_skips_exe` 与 `test_files_from_args_empty_when_only_exe` 两个测试函数。

- [x] **步骤 2:删命令与函数**

删除 `get_cli_args`(L35-38)与 `files_from_args` 及其上方注释(L40-44)。`generate_handler!` 删除 `get_cli_args,` 行。

- [x] **步骤 3:删插件注册**

`run()` 中删除整段:
```rust
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                show_window(&window);
                // files_from_args 滤掉 argv[0](第二实例 exe 自身路径),
                // 避免前端误把 exe 当文件打开;与 get_cli_args 的 skip(1) 对齐
                let _ = app.emit("file-open", files_from_args(argv));
            }
        }))
```
Finder 打开的接收由任务 6 的 `RunEvent::Opened` 承担(事件名同为 `file-open`,前端 `app.js:517` 监听不变)。

- [x] **步骤 4:Cargo.toml 删 `tauri-plugin-single-instance = "2"` 行。**

- [x] **步骤 5:编译 + 测试**

运行:`cd src-tauri && cargo check 2>&1 | tail -3 && cargo test 2>&1 | grep -E "test result"`
预期:通过,测试数比基线少 2。

- [x] **步骤 6:Commit**

```bash
git add -A src-tauri/
git commit -m "refactor(rust): 删 single-instance 插件与 argv 文件打开链

macOS 无此插件(官方不支持),文件打开改由 RunEvent::Opened 承接(下个任务);
get_cli_args/files_from_args 及其 2 个测试一并删除。"
```

---

### 任务 4:Rust 删 PDF 导出链与全部 Windows-only 代码

**文件:**
- 修改:`src-tauri/src/lib.rs:1513-1514`(print_to_pdf 注册)、`lib.rs:1520-1672`(PdfPrintOptions + 两个 print_to_pdf 变体)、`lib.rs:1101-1104`(字体枚举 cfg 分支)、`lib.rs:1126-1236`(三个 windows-only 函数)、`lib.rs:1470-1472`(repair 线程)
- 修改:`src-tauri/Cargo.toml:43-50`(整个 `[target.'cfg(target_os = "windows")'.dependencies]` 段)
- 修改:`src-tauri/src/lib.rs:143-152`(read_file 的 Locked 错误码)

- [x] **步骤 1:删 generate_handler 中的 PDF 命令**

删除这两行:
```rust
            // PDF 导出:WebView2 PrintToPdf 直接落盘(无打印对话框 / 无下载气泡)
            print_to_pdf
```
注意 `move_path,` 行尾的逗号相应处理(move_path 成为末项时逗号可留,Rust 允许尾逗号,保留即可)。

- [x] **步骤 2:删 PdfPrintOptions 与两个 print_to_pdf 变体**

删除 L1520 注释起至 L1672(非 Windows stub 结束)的全部内容:`PdfPrintOptions` 结构体、`#[cfg(target_os = "windows")] async fn print_to_pdf`、`#[cfg(not(target_os = "windows"))] async fn print_to_pdf`。

- [x] **步骤 3:删 Windows-only 函数与调用点**

- `list_system_fonts` 内删除:
```rust
        // Windows 补充:注册表可能指向任意绝对路径的字体文件(企业部署场景),
        // fontdb 的目录扫描覆盖不到;尽力而为,失败仅跳过。
        #[cfg(target_os = "windows")]
        load_windows_registry_fonts(&mut db);
```
- 删除 `load_windows_registry_fonts`(L1126-1156)、`repair_file_association`(L1158-1213)、`reg_value_string`(L1215-1236)三个 `#[cfg(target_os = "windows")]` 函数及其注释。
- `setup` 闭包中删除:
```rust
            // Windows 启动时自愈 .md/.markdown 文件关联「打开方式」,后台异步、失败静默
            #[cfg(target_os = "windows")]
            std::thread::spawn(repair_file_association);
```

- [x] **步骤 4:read_file 错误码去 Windows 化**

L147-152 的映射改为(删 raw_os_error==32 的 Windows ERROR_SHARING_VIOLATION 特判):
```rust
        } else if e.kind() == std::io::ErrorKind::PermissionDenied {
            "PermissionDenied"
        } else {
```
即整个 `match e.raw_os_error() { Some(32) => "Locked", _ => ... }` 块删除。同步检查前端 `_mapReadFileError`(src/app.js 或模块)——`E_LOCKED` 分支保留不动(死分支无害,前端契约测试若断言 32 则该断言随任务 8 说明处理;先跑 `node test/error-handling.test.cjs` 确认不红)。

- [x] **步骤 5:Cargo.toml 删整段**

```toml
[target.'cfg(target_os = "windows")'.dependencies]
# 补充扫描注册表指向的字体文件(企业批量安装到任意路径的字体),仅 Windows
winreg = "0.52"
# ...(webview2-com 注释块)
webview2-com = "0.38"
windows = { version = "0.61", features = ["Win32_Foundation"] }
```

- [x] **步骤 6:编译 + 测试**

运行:`cd src-tauri && cargo check 2>&1 | tail -3 && cargo test 2>&1 | grep -E "test result|warning"`;再 `grep -rn "cfg(target_os\|cfg(windows\|cfg_attr(not(debug" src-tauri/src/` —— 预期仅剩 main.rs 的 `windows_subsystem`(保留,标准模板)。
预期:0 error;main.rs 之外无 Windows cfg 残留。

- [x] **步骤 7:Commit**

```bash
git add -A src-tauri/
git commit -m "refactor(rust): 删 PDF 导出链与全部 Windows-only 代码

print_to_pdf(WebView2 PrintToPdf)两平台变体与 PdfPrintOptions 整体移除(纯 macOS
自用舍弃 PDF 导出,规格 §3.1);load_windows_registry_fonts/repair_file_association/
reg_value_string 三个 Windows 函数与 winreg/webview2-com/windows 依赖段删除;
read_file 的 ERROR_SHARING_VIOLATION=32→Locked 映射随平台移除。main.rs 的
windows_subsystem 属性保留(Tauri 标准模板,macOS 无效无害)。"
```

---

### 任务 5:safe_write_target darwin 化(TDD)

**文件:**
- 修改:`src-tauri/src/lib.rs:83-139`(safe_write_target)
- 测试:`lib.rs` `#[cfg(test)] mod tests` 内(`#[cfg(windows)] test_safe_write_target_rejects_protected_path` 替换为 darwin 版 + 新增纯函数测试)

- [x] **步骤 1:写失败测试**

在 `mod tests` 中,把 `#[cfg(windows)] test_safe_write_target_rejects_protected_path` 整体替换为:

```rust
    #[test]
    fn test_blocked_path_rule_darwin() {
        // 系统关键目录(含子路径)命中
        assert!(blocked_path_rule("/system/library/fontmodels").is_some());
        assert!(blocked_path_rule("/library/startupitems/evil").is_some());
        assert!(blocked_path_rule("/applications/evil.app/contents/macos/evil").is_some());
        assert!(blocked_path_rule("/usr/local/bin/evil").is_some());
        assert!(blocked_path_rule("/private/etc/evil.conf").is_some());
        assert!(blocked_path_rule("/etc/evil.conf").is_some());
        // 目录本身(无尾斜杠)也命中
        assert!(blocked_path_rule("/system").is_some());
        // 前缀相似但不同的路径不得误伤
        assert_eq!(blocked_path_rule("/systemfoo/ok.txt"), None);
        assert_eq!(blocked_path_rule("/users/ice/docs/note.md"), None);
        assert_eq!(blocked_path_rule("/volumes/usb/note.md"), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_safe_write_target_rejects_protected_path() {
        // 拒绝写入系统关键目录
        let res = safe_write_target("/System/Library/evil.txt");
        assert!(res.is_err(), "写入系统目录应被拒绝");
        assert!(res.unwrap_err().contains("protected"), "错误应说明是受保护路径");
        // 用户目录正常放行(canonicalize 会解析 /tmp→/private/tmp 等)
        let res2 = safe_write_target("/tmp/tizumark_test_ok.md");
        assert!(res2.is_ok(), "临时目录应放行,实际 {:?}", res2.err());
    }
```

- [x] **步骤 2:运行测试验证失败**

运行:`cd src-tauri && cargo test blocked_path 2>&1 | tail -5`
预期:FAIL,`blocked_path_rule` 未定义。

- [x] **步骤 3:实现——抽纯函数 + 换 darwin 黑名单**

`safe_write_target` 中,L121-137 的规范化字符串与 BLOCKED 检查替换为:

```rust
    // 系统关键目录前缀黑名单(macOS):canonicalize 已解析符号链接
    // (/etc→/private/etc 等),故 /etc 与 /private/etc 都要拦。
    let canonical_str = canonical.to_string_lossy().to_lowercase();
    if let Some(rule) = blocked_path_rule(&canonical_str) {
        let _ = rule;
        return Err(format!("Refusing to write to protected path: {}", path));
    }
    Ok(canonical)
}

/// 黑名单判定纯函数:输入 canonicalize 后的全路径小写字符串,返回命中的规则。
/// 独立成函数便于跨平台单测(不依赖真实文件系统)。精确到「目录本身或其子路径」,
/// 不做 contains 子串匹配,避免 /systemfoo 之类误伤。
fn blocked_path_rule(canonical_lower: &str) -> Option<&'static str> {
    const BLOCKED: &[&str] = &[
        "/system", "/library", "/applications", "/usr", "/private/etc", "/etc",
    ];
    for b in BLOCKED {
        if canonical_lower == *b || canonical_lower.starts_with(&format!("{}/", b)) {
            return Some(b);
        }
    }
    None
}
```
即:原 `replace('/', "\\")` 的 Windows 归一化删除;原 BLOCKED 表(\\windows\\ 等 8 项)删除;函数在 `Ok(canonical)` 前结束并在其后新增 `blocked_path_rule`。原 `for b in BLOCKED { if canonical_str.contains(b) ... }` 整段删除。

- [x] **步骤 4:运行测试验证通过**

运行:`cd src-tauri && cargo test 2>&1 | grep -E "test result|blocked"`
预期:全部 pass,含 2 个新测试(macOS 上 cfg 都编译)。

- [x] **步骤 5:Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "refactor(rust): safe_write_target 黑名单 darwin 化并抽纯函数

Windows 路径表(\\windows\\ 等)换为 macOS 系统目录表(/System /Library
/Applications /usr /private/etc /etc);判定抽为 blocked_path_rule 纯函数
(前缀精确匹配,不误伤 /systemfoo),配跨平台单测;原 #[cfg(windows)] 集成
测试换 mac 版。原 replace('/','\\\\') 归一化随平台删除。"
```

---

### 任务 6:RunEvent::Opened 接收 Finder 文件打开

**文件:**
- 修改:`src-tauri/src/lib.rs:1516-1517`(`.run(tauri::generate_context!())` 调用)

- [x] **步骤 1:builder 改 build + run 事件循环**

`run()` 末尾的:
```rust
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
```
替换为:
```rust
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Finder 双击 .md / 「打开方式」:macOS 走 Apple Event(不产生新进程 argv),
            // tauri 以 RunEvent::Opened 送达。复用前端既有的 file-open 监听
            // (src/app.js 初始化时 TauriApi.onEvent('file-open', ...)),前端零改动。
            if let tauri::RunEvent::Opened { files } = event {
                let paths: Vec<String> = files.iter().map(|f| f.to_string()).collect();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.emit("file-open", paths);
                }
            }
        });
```
注:若 `f.to_string()` 编译报错(FilePath 未实现 Display),改用 `f.clone().into_path().to_string_lossy().to_string()`。

- [x] **步骤 2:编译**

运行:`cd src-tauri && cargo check 2>&1 | tail -3`
预期:通过。

- [x] **步骤 3:运行时冒烟(本任务与任务 7、11 合并在任务 11 后统一真机验证,此处先过编译)**

- [x] **步骤 4:Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(rust): RunEvent::Opened 接收 Finder 打开的文件

macOS 文件打开走 Apple Event 而非 argv;build().run() 事件循环中把路径经
file-open 事件送达前端(复用既有监听,前端零改动)。"
```

---

### 任务 7:tauri.conf.json 窗口红绿灯 + bundle 收敛

**文件:**
- 修改:`src-tauri/tauri.conf.json:14-27`(windows)、`tauri.conf.json:41-43`(targets)、`tauri.conf.json:55-62`(bundle.windows.nsis)

- [x] **步骤 1:窗口配置改 Overlay**

`app.windows[0]` 改为:
```json
    "windows": [
      {
        "title": "TizuMark",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "center": true,
        "decorations": true,
        "titleBarStyle": "Overlay",
        "hiddenTitle": true,
        "devtools": false,
        "visible": false,
        "backgroundColor": "#f5f5f5"
      }
    ],
```
若编译报 `titleBarStyle`/`hiddenTitle` 为未知字段(理论上 tauri 2.5 支持),回退方案:decorations 保持 true、去这两个字段,改在 `lib.rs` setup 中 `window.show()` 前调用 macOS 专用运行时 API,并在任务 11 真机验证时确认效果。

- [x] **步骤 2:bundle 收敛**

`"targets": "all"` → `"targets": "app"`(自用只需 .app,不产 dmg);删除整个 `"windows": { "nsis": { ... } }` 段(L55-62);`fileAssociations` 与 `icon` 数组、`resources` **保留**(Info.plist 文件关联注册与 icns 图标仍需要)。

- [x] **步骤 3:编译验证**

运行:`cd src-tauri && cargo check 2>&1 | tail -3`
预期:通过(配置合法性在编译期由 tauri-build 校验)。

- [x] **步骤 4:Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "build: 窗口改 macOS 红绿灯叠层,bundle 收敛为仅 .app

decorations:true + titleBarStyle:Overlay + hiddenTitle:true——原生红绿灯叠加在
自绘工具栏左上角;删 nsis 安装器配置,targets 收敛为 app;fileAssociations/icon
/resources 保留(Finder 关联注册与打包资源仍需要)。"
```

---

### 任务 8:tauri-api.js 命令清单同步

**文件:**
- 修改:`src/modules/tauri-api.js:18-33`(COMMANDS)、`tauri-api.js:67-71`(api.updater)、头部注释

- [x] **步骤 1:COMMANDS 删 5 项**

删除这些行:
```js
    'get_cli_args', 'quit_app', 'open_devtools', 'set_window_behavior',
```
中的 `'get_cli_args', ` 一个 token(其余三个保留),以及:
```js
    // 更新安装包磁盘缓存:下载落盘(验签转正)/ 查缓存 / 从缓存安装
    'download_update_to_file', 'find_cached_update', 'install_cached_update',
    // PDF 导出:WebView2 PrintToPdf 直接落盘(绕开打印对话框与浏览器下载气泡)
    'print_to_pdf',
```
头部注释 `COMMANDS 是 31 个自定义命令` 改为 `COMMANDS 是 27 个自定义命令的【唯一真源】`。

- [x] **步骤 2:删 api.updater 块**

删除:
```js
  api.updater = {
    check() { return invokeCmd('plugin:updater|check'); },
    download(payload) { return invokeCmd('plugin:updater|download', payload || {}); },
    install(payload) { return invokeCmd('plugin:updater|install', payload || {}); },
  };
```

- [x] **步骤 3:契约测试验证**

运行:`node test/tauri-api.test.cjs 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check`
预期:契约测试 pass(反解析 lib.rs generate_handler 与 COMMANDS 一致,两侧同步删后仍相等);check 0 退出。

- [x] **步骤 4:Commit**

```bash
git add src/modules/tauri-api.js
git commit -m "refactor(ipc): COMMANDS 与 Rust 侧同步删 5 命令,移除 api.updater

get_cli_args/download_update_to_file/find_cached_update/install_cached_update/
print_to_pdf 随 Rust 侧删除;契约测试(反解析 generate_handler)自动校验一致。"
```

---

### 任务 9:前端删自动更新功能

**文件:**
- 修改:`src/modules/updater.js`(删更新逻辑,保留 showAbout/hideAbout/openExternal)
- 修改:`src/app.js:122`(启动检查)、`app.js:243`(菜单绑定)
- 修改:`src/modules/i18n.js:64`(updateMenuText 行)
- 修改:`src/index.html:717-763`(update-dialog 弹框)、`index.html:199-202`(帮助菜单「检查更新」项)
- 修改:`src/styles.css:7933-7946` 附近的 `.update-*` 规则块
- 修改:`src/modules/i18n-data.js`(3 语言的 update* 键)
- 删除:`test/updater-cache.test.cjs`、`test/updater-skip.test.cjs`
- 修改:`scripts/e2e-human-check.mjs`(删 update mock 段)

- [x] **步骤 1:updater.js 收敛**

删除以下方法(整段):`showUpdateDialog`、`hideUpdateDialog`、`skipUpdateVersion`、`_updateUrlSignature`、`_findUpdateCache`、`_fillDownloadedState`、`showUpdateState`、`_fillLatestVersion`、`checkUpdate`、`setUpdateAction`、`handleUpdateAction`、`downloadUpdate`、`installUpdate`。保留:`showAbout`、`hideAbout`、`openExternal`。文件头部注释改为 `// 关于弹窗与外部链接打开`。

- [x] **步骤 2:app.js 删两处**

删除 L122 `setTimeout(() => this.checkUpdate(false), 5000);` 与 L243 `this._bindMenuAction('btn-check-update', () => this.checkUpdate(true), H);`。全局 grep `checkUpdate` 确认 src/ 无残留引用(settings.js 若有「检查更新」入口设置项一并删)。

- [x] **步骤 3:i18n.js / index.html / styles.css / i18n-data.js 删更新 UI**

- `i18n.js` 删 `updateMenuText('btn-check-update', t('checkUpdate'));` 行。
- `index.html` 删 L717-763 整个 `<div id="update-dialog" ...>` 块(结束于 L763 `</div>`,L765 是 save-dialog 开始)与 L199-202 的 `btn-check-update` 菜单项(`<div class="dropdown-item" id="btn-check-update">` 至其 `</div>`)。
- `styles.css` 删 L7933 起的 `.update-dialog`、`.update-version-highlight`、`.update-current`、`.update-notes`(含子规则)、`.update-progress`、`#update-progress-*` 等规则(grep `update-` 定位,约 7933-7950 区段)。
- `i18n-data.js` 3 个语言字典中删除键:`checkUpdate`、`updateChecking`、`updateAvailable`、`updateLatest`、`updateDownloadedTitle`、`updateDownloadedInfo`、`updateInstallNow`、`updateConfirm`、`updateDownloadLabel`、`updateDownloading`、`updateFailed`、`updateVersionSkipped`、`noUpdateNotes`(grep `update` 逐个确认无其他引用后删)。

- [x] **步骤 4:删两个更新测试 + 清 e2e harness**

```bash
git rm test/updater-cache.test.cjs test/updater-skip.test.cjs
grep -n "update\|Update" scripts/e2e-human-check.mjs   # 依输出删除 update 相关 mock/断言段
```

- [x] **步骤 5:相关测试**

运行:`npm run check && node test/entry-scripts.test.cjs 2>&1 | grep -E "^ℹ (pass|fail)"`;再全局 `grep -rn "checkUpdate\|update-dialog\|TauriApi.updater" src/ | grep -v node_modules`,预期零输出。
预期:pass + 无残留引用。

- [x] **步骤 6:Commit**

```bash
git add -A
git commit -m "refactor(ui): 删自动更新前端(弹框/入口/文案/启动检查/测试)

macOS 自用版无更新渠道;updater.js 收敛为 About+openExternal,update-dialog
HTML/CSS/i18n 三语言键、帮助菜单入口、启动 5s 检查、两个 updater 测试与
e2e harness 的 update mock 一并移除。"
```

---

### 任务 10:前端删 PDF 导出

**文件:**
- 修改:`src/modules/export.js`(exportPDF 整链)
- 修改:`src/app.js:237`(btn-export-pdf 绑定)
- 修改:`src/index.html:168-172`(导出 PDF 菜单项)
- 修改:`src/modules/shortcuts.js:21`(exportPDF 默认键位)+ presets + 派发 + 迁移逻辑
- 修改:`src/modules/i18n-data.js`(pdf*/exportedPDF 键,3 语言)
- 删除:`test/export-pdf-font.test.cjs`、`test/export-pdf-save-wait.test.cjs`
- 修改:`test/export-codeblock-wrap.test.cjs:132-176`(只删 exportPDF 两个用例)

- [x] **步骤 1:export.js 删 PDF 链**

删除方法:`_supportsPrintToPdf`(L1477-1483)、`exportPDF`(L1496-起,含其全部注释)、`_preparePdfClone`、`_buildPdfPrintFrameHtml`、`_exportViaSystemPrint`(L1786 起)。删除前先 `grep -n "_preparePdfClone\|_buildPdfPrintFrameHtml\|_exportViaSystemPrint" src/` 确认仅 export.js 内部使用(已验证:无外部调用者)。保留:exportHTML、exportImage、exportWord、`_exportExpandRules`、`_showExportOverlay`/`_hideExportOverlay`、`_waitImagesReady`(后三者与长图/DOCX 共用,exportImage/exportWord 还在调用)。

- [x] **步骤 2:菜单与键位**

- `app.js` 删 `this._bindMenuAction('btn-export-pdf', () => this.exportPDF(), F);`
- `index.html` 删 `btn-export-pdf` 菜单项(L168-172)。
- `shortcuts.js` 默认表删 `exportPDF: { key: 'Ctrl+Shift+P', label: '导出 PDF' },`;`getShortcutPresets` 各方案删 exportPDF 条目;全局 grep `exportPDF` 于 `shortcuts.js`/`app.js` 删除派发 case 与 `loadShortcuts` 里「Ctrl+P→Ctrl+Shift+P 迁移」涉及 exportPDF 的分支(迁移注释 L55-56 一并修正)。

- [x] **步骤 3:i18n 键与测试清理**

- `i18n-data.js` 3 语言删 `exportPDF`、`pdfTip1`、`pdfTip2`、`pdfBigFileWarn`、`pdfPrintFallbackWarn`、`preparingPrint`、`exportedPDF`(grep `pdf` 大小写不敏感确认无遗漏、无其他引用)。
- `git rm test/export-pdf-font.test.cjs test/export-pdf-save-wait.test.cjs`;`test/export-codeblock-wrap.test.cjs` 只删 L132-176 两个 exportPDF 用例(`exportPDF: 主路径打印态...` 与 `exportPDF: 打印帧组帧...`),DOCX/长图用例保留。

- [x] **步骤 4:相关测试**

运行:`npm run check && node test/export-codeblock-wrap.test.cjs 2>&1 | grep -E "^ℹ (pass|fail)"`
预期:pass + 0 退出。

- [x] **步骤 5:Commit**

```bash
git add -A
git commit -m "refactor(export): 删 PDF 导出前端链(WKWebView 无 PrintToPdf 等价能力)

exportPDF/_supportsPrintToPdf/_preparePdfClone/_buildPdfPrintFrameHtml/
_exportViaSystemPrint 与菜单项、Ctrl+Shift+P 键位、i18n pdf* 键移除;
HTML/长图/DOCX 导出不受影响。规格 §3.1(用户明确舍弃 PDF 导出)。"
```

---

### 任务 11:删窗口三钮,红绿灯布局落位

**文件:**
- 修改:`src/modules/updater.js:341-411`(窗口钮逻辑)
- 修改:`src/app.js:121`(updateMaximizeIcon 调用)
- 修改:`src/index.html:249-259`(.window-controls)
- 修改:`src/styles.css:742-780`(.window-controls/.window-btn)、`styles.css:520` 附近(.toolbar-left)
- 修改:`src/modules/i18n.js:76-78`(三钮 setTitle)

- [x] **步骤 1:updater.js 删窗口钮逻辑**

删除方法:`minimizeWindow`、`toggleMaximize`、`updateMaximizeIcon`、`closeWindow`、`initWindowControls`(L341-411 整段,含「窗口三钮与标题栏拖拽」注释)。原生拖拽由 `index.html:101-102` 的 `data-tauri-drag-region`(.header 与 .toolbar)承担,双击缩放由系统管理红绿灯行为承担。

- [x] **步骤 2:调用点清理**

- `app.js` 删 `this.updateMaximizeIcon();`(init 内,L121)。
- 全局 `grep -rn "initWindowControls\|updateMaximizeIcon\|btn-minimize\|btn-maximize\|btn-close\|minimizeWindow\|toggleMaximize" src/ | grep -v node_modules` 清理全部残留(若有其他调用点逐一删除)。

- [x] **步骤 3:HTML/CSS/i18n 删三钮**

- `index.html` 删 `<div class="window-controls">` 至其 `</div>`(L249-259)。
- `styles.css` 删 `.window-controls`、`.window-btn`、`.window-btn svg`、`.window-btn:hover`、`.window-btn-close:hover` 规则(L742-780 区段);`.toolbar-left` 规则(L520 附近)追加红绿灯避让:
```css
.toolbar-left {
  /* 原有属性保留;新增:macOS 红绿灯(Overlay 模式下叠在窗口左上角)避让 */
  padding-left: 78px;
}
```
(以该规则原文为基础加一行 padding-left,不要新建重复规则。)
- `i18n.js` 删 L76-78 三行 `setTitle('btn-minimize'/'btn-maximize'/'btn-close', ...)`。i18n 键 `minimize`/`maximize`/`close`:grep 确认无其他引用才删键,有引用则保留键。
- `src-tauri/capabilities/default.json`:三钮删除后前端不再调用窗口最大化类 API——删除 `core:window:allow-minimize`、`allow-maximize`、`allow-unmaximize`、`allow-is-maximized`、`allow-start-dragging` 五项;**保留** `allow-close`/`allow-destroy`/`allow-set-focus`/`allow-hide`/`allow-show`/`allow-unminimize`(lifecycle.js 关闭到托盘流程与 file-open 唤起仍在用)。改后 `cd src-tauri && cargo check` 验证 capabilities 合法性。

- [x] **步骤 4:护栏 + 相关测试**

运行:`npm run check && node test/entry-scripts.test.cjs 2>&1 | grep -E "^ℹ (pass|fail)"`
预期:pass(模块清单未变,updater.js 仍存在)。

- [ ] **步骤 5:真机冒烟(首次 GUI 验证点)**

运行:`npm run dev`,人工确认:红绿灯显示在工具栏左上方、无遮挡文件菜单;拖拽 toolbar 空白区可移动窗口;红绿灯关闭触发关闭到托盘弹框(与旧行为一致);红绿灯黄色钮最小化正常。异常则回任务 7 检查 titleBarStyle 配置。

- [x] **步骤 6:Commit**

```bash
git add -A
git commit -m "refactor(ui): 删自绘窗口三钮,红绿灯叠层落位

Overlay 模式下原生红绿灯承担关闭/最小化/缩放,.window-controls HTML/JS/CSS
与 i18n 绑定移除;toolbar-left 预留 78px 红绿灯区;拖拽走既有
data-tauri-drag-region(.header/.toolbar),双击缩放交系统管理。"
```

---

### 任务 12:快捷键显示 ⌘ 化与全局热键 Cmd 注册

**文件:**
- 修改:`src/modules/shortcuts.js`(formatShortcutDisplay L247、_normalizeShortcutKey L322、getBuiltinFixedShortcuts 内 combo、全局热键注册调用点)
- 修改:`src/modules/settings.js`(若含全局热键注册调用)
- 测试:`test/shortcut-*.test.cjs` 相关断言

- [x] **步骤 1:显示层 SYM 表加修饰键符号**

`formatShortcutDisplay` 的 SYM 表改为:
```js
        const SYM = {
          Ctrl: '⌘', Alt: '⌥', Shift: '⇧',
          ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
          Home: 'Home', End: 'End', Backspace: '⌫', Delete: '⌦',
          Enter: '↵', Space: 'Space', Escape: 'Esc', Tab: 'Tab',
        };
```
内部 token 仍是 `Ctrl`(派发 `const ctrl = e.ctrlKey || e.metaKey` 已兼容 Cmd,**不改派发**);仅显示为 ⌘。

- [x] **步骤 2:_normalizeShortcutKey 合并 ctrl/meta**

冲突检测把两族修饰键视为同一修饰(否则用户重录 Cmd+X 撞不上已存的 Ctrl+X):
```js
          if (up === 'ctrl' || up === 'control' || up === 'meta' || up === 'cmd') mods.push('meta');
          else if (up === 'shift') mods.push('shift');
          else if (up === 'alt') mods.push('alt');
          else main = up;
```

- [x] **步骤 3:getBuiltinFixedShortcuts 内 combo 从 Ctrl 系改 Cmd 系**

该函数返回的内置固定键位 combo(如 `'Ctrl+Z'`)在 mac 语义即 ⌘,把其中的 `Ctrl+` 前缀替换为 `Cmd+`(仅此函数内;显示层已统一 ⌘,规范化已合并)。同时 grep `getBuiltinFixedShortcuts` 的消费方确认比对都走 `_normalizeShortcutKey`(合并后两种写法等价,稳妥起见统一改写)。

- [x] **步骤 4:全局热键注册字符串 Ctrl→Cmd**

找到 `set_close_to_tray_shortcut` 的前端调用点(`grep -rn "setCloseToTrayShortcut\|set_close_to_tray_shortcut" src/`),在传参处转换(OS 全局热键走 global-hotkey 解析,`Ctrl` 在 macOS 是真 Control 键而非 ⌘):
```js
      // macOS 全局热键:内部 token 'Ctrl' 语义即 ⌘,注册 OS 级热键时必须换 'Cmd',
      // 否则注册成真 Control 组合键(与用户按下的 ⌘ 不符)。
      const osKey = (shortcutKey || '').replace(/^Ctrl(?=\+|$)/, 'Cmd');
```
用 `osKey` 传参。同步更新 `test/shortcut-closetotray.test.cjs` 中断言注册字符串的用例(断言改为 `Cmd+` 前缀)。

- [x] **步骤 5:相关测试**

运行:`for f in test/shortcut-*.test.cjs test/doc-nav-shortcuts.test.cjs test/word-nav-shortcuts.test.cjs; do node "$f" 2>&1 | grep -E "^ℹ (pass|fail)" | head -2; done`
预期:全 pass。红的用例逐个核对语义后修正断言(禁止删断言糊弄)。

- [x] **步骤 6:Commit**

```bash
git add -A
git commit -m "refactor(shortcuts): 显示层 ⌘ 化,全局热键注册 Ctrl→Cmd

内部键位 token 与派发逻辑不变(ctrl||meta 已兼容 Cmd);formatShortcutDisplay
SYM 表加 ⌘/⌥/⇧,settings 表格自动生效;_normalizeShortcutKey 合并 ctrl/meta
两族修饰键修冲突检测;closeToTray 注册给 OS 热键的字符串 Ctrl 前缀换 Cmd
(global-hotkey 在 macOS 解析 Ctrl 为真 Control 键)。"
```

---

### 任务 13:杂项纯化(validateFileName / D:/ 文案 / index.html 提示)

**文件:**
- 修改:`src/modules/files.js:556`(validateFileName)
- 修改:`src/modules/settings.js:493`(D:/images)
- 修改:`src/modules/i18n-data.js`(D:/ 文案,3 语言)
- 修改:`src/index.html`(title 属性 Ctrl→⌘)

- [x] **步骤 1:validateFileName 放行 `:`**

```js
      validateFileName(name) {
        if (!name || !name.trim()) return this.t('nameEmpty');
        if (/[/\\*?"<>|]/.test(name)) return this.t('nameInvalid');
        return null;
      },
```
(macOS 文件名合法集不含 `:` 的 Windows 限制;`\ /` 仍拦。)

- [x] **步骤 2:D:/ 文案改通用**

- `settings.js` L493:`'D:/images'` → `'~/Pictures/images'`。
- `i18n-data.js` 全文件 `grep -n "D:/"` 命中的文案(约 458/970/1536 三处)同步改为 `~/Pictures/images` 写法。

- [x] **步骤 3:index.html title 提示 ⌘ 化**

`grep -c "Ctrl+" src/index.html`(约 24 处,title 属性与快捷键展示文案):把面向用户的 `Ctrl+X` 显示统一替换为 `⌘X` 写法(如 `title="加粗 (Ctrl+B)"` → `title="加粗 (⌘B)"`)。纯展示属性,逐处 `sed -i ''` 或手工改。

- [x] **步骤 3b:i18n-data 残留 Ctrl 展示文案清理**

`grep -n "Ctrl+" src/modules/i18n-data.js`:快捷键说明/帮助文案里硬编码的 `Ctrl+X` 展示字样同步 ⌘ 化(仅展示文案;若有键位格式说明文字,改为描述 ⌘ 对应关系)。逐处人工确认语境后改。

- [x] **步骤 4:相关测试**

运行:`npm run check && node test/error-handling.test.cjs 2>&1 | grep -E "^ℹ (pass|fail)"`
预期:pass。

- [x] **步骤 5:Commit**

```bash
git add -A
git commit -m "chore(ui): 杂项 macOS 化——validateFileName 放行冒号,D:/ 文案与 title 提示改 ⌘"
```

---

### 任务 14:开发脚本 darwin 化

**文件:**
- 修改:`scripts/run-tests.cjs:138`(puppeteer 路径)
- 修改:`scripts/wysiwyg-browser-check.mjs:34-40`(findChromium)
- 修改:`scripts/slash-browser-check.mjs:34-40`(findChromium)

- [x] **步骤 1:run-tests.cjs 去 Windows 硬编码**

```js
function resolvePuppeteerModules() {
  // 优先级:显式 env > 当前 NODE_PATH(macOS 无本机固定路径兜底)
  return process.env.PUPPETEER_MODULES || process.env.NODE_PATH || '';
}
```

- [x] **步骤 2:两个 browser-check 的 findChromium 改 darwin 缓存布局**

两文件同改(函数体替换,签名与返回值不变):
```js
function findChromium() {
  // playwright 浏览器缓存(macOS):~/Library/Caches/ms-playwright/chromium-*/chrome-mac/...
  const cacheRoot = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  if (fs.existsSync(cacheRoot)) {
    for (const dir of fs.readdirSync(cacheRoot).filter(d => d.startsWith('chromium-')).sort().reverse()) {
      for (const candidate of [
        path.join(cacheRoot, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(cacheRoot, dir, 'chrome-mac', 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      ]) {
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}
```
wysiwyg 脚本中「必须用系统 Edge(WebView2 同引擎)」的启动段:macOS 真机是 WKWebView,Edge 校准依据不成立——把 `channel: 'msedge'` 相关逻辑改为直接 `pw.chromium.launch({ headless: true, executablePath: findChromium() })`,并把 `isEdgeDriver` 初始化为 `false` 的注释改为说明(macOS 无 WebView2 校准前提)。脚本内硬编码 `AppData` 的其他引用 grep 清理。

- [x] **步骤 3:真机跑通(需要 playwright 浏览器)**

运行:`node scripts/slash-browser-check.mjs 2>&1 | tail -5 && node scripts/wysiwyg-browser-check.mjs 2>&1 | tail -5`
预期:两脚本 0 退出、场景全过。若报缺浏览器:`npx playwright install chromium`(本机 playwright 为全局安装,版本不匹配时按脚本提示回退缓存可执行文件)。

- [x] **步骤 4:Commit**

```bash
git add scripts/run-tests.cjs scripts/wysiwyg-browser-check.mjs scripts/slash-browser-check.mjs
git commit -m "fix(scripts): 测试与回归脚本路径 darwin 化

run-tests.cjs 去 C:/Users/admin 兜底;两个 browser-check 的 chromium 缓存
扫描改 ~/Library/Caches/ms-playwright 布局;wysiwyg 弃 msedge 通道校准
(macOS 真机是 WKWebView,Edge 同引擎前提不成立)。"
```

---

### 任务 15:README×3 重写为 macOS 自用版

**文件:**
- 重写:`README.md`、`README.en.md`、`README.es.md`

- [x] **步骤 1:重写三个 README(每份 60 行内)**

要点(中文版为例,en/es 同构翻译):
- **必须保留**版本 badge 行,格式不变(check-version 校验):`[![Version](https://img.shields.io/badge/Version-1.2.4-blue)](...)`。
- 定位:macOS 自用版 Markdown 编辑器(CodeMirror 5 + Tauri 2,WKWebView);由上游 Windows 版裁剪而来,PDF 导出与自动更新已移除。
- 功能清单:编辑/阅读/实时预览(beta)、Finder 双击 .md 打开(文件关联已注册)、托盘与关闭到托盘、全局热键(首次使用需在 系统设置→隐私与安全性→辅助功能 授权)、导出 HTML/长图/DOCX、字体/主题/多标签。
- 本地开发:`npm ci && npm run dev`;打包:`npm run build`(产物 `src-tauri/target/release/bundle/app/TizuMark.app`)。
- 依赖要求:Xcode CLT(`xcode-select --install`)、Rust(rustup)、Node ≥ 18。

- [x] **步骤 2:版本一致性验证**

运行:`npm run check`
预期:0 退出(check-version 的 README badge 校验仍过)。

- [x] **步骤 3:Commit**

```bash
git add README.md README.en.md README.es.md
git commit -m "docs: README×3 重写为 macOS 自用版定位

保留 Version badge(check-version 校验);说明裁剪范围(PDF/自动更新已移除)、
Finder 打开、全局热键辅助功能授权、本地开发与打包命令。"
```

---

### 任务 16:终验(全量 + 真机验收)

**文件:** 无预期改动(发现问题则回对应任务修)。

- [x] **步骤 1:全量测试**

运行:`npm test 2>&1 | tail -3 && npm run check && cd src-tauri && cargo test 2>&1 | grep "test result"`
预期:全 pass + 0 退出。

- [ ] **步骤 2:打包**

运行:`npm run build 2>&1 | tail -5`
预期:产出 `src-tauri/target/release/bundle/app/TizuMark.app`(postbuild 已删,无绿色版产物)。

- [ ] **步骤 3:真机验收清单(逐项人工确认)**

1. .app 双击启动,红绿灯正常、不遮挡工具栏,拖拽/双击行为正常
2. Finder 双击 .md → 应用唤起并打开 tab;应用内打开/保存/另存为正常
3. 托盘:关闭到托盘、托盘菜单「显示主窗口/退出」;全局热键唤回(首次触发辅助功能授权,记录操作到 README)
4. 导出 HTML / 长图 / DOCX 成功;菜单中无「导出 PDF」「检查更新」;启动无更新网络请求
5. ⌘N/⌘S/⌘F/⌘B 生效;快捷键设置界面显示 ⌘;重录一个键位并验证冲突检测
6. 阅读/源码/实时预览(beta)三模式人工过一遍基础场景(重点观察 WKWebView 渲染差异,问题记录为后续项)
7. 工作区文件树增删监听(外部 Finder 改动刷新)、跨文件搜索、字体枚举(系统字体列表非空)

- [ ] **步骤 4:验收问题修复后 Commit**

```bash
git add -A
git commit -m "fix: macOS 真机验收问题修复(逐项见验收清单)"
```
(若无问题则跳过。)
