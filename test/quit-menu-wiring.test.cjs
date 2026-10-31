// 系统菜单「Quit TizuMark」必须走前端退出流程，不得用 PredefinedMenuItem::quit
// （其 terminate: 直接杀进程，绕过保存提示/会话保存/托盘清理）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const libRs = fs.readFileSync(path.join(ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');

test('自定义应用菜单：Quit 为普通菜单项 quit-app + Cmd+Q', () => {
  const m = libRs.match(/fn build_app_menu\(app: &tauri::AppHandle\) -> tauri::Result<Menu<tauri::Wry>> \{[\s\S]*?\n\}/);
  assert.ok(m, '应定义 build_app_menu');
  const body = m[0];
  assert.ok(/MenuItem::with_id\(\s*app,\s*"quit-app"/.test(body), 'Quit 应为普通菜单项 quit-app');
  assert.ok(/Some\("Cmd\+Q"\)/.test(body), 'Quit 加速键应为 Cmd+Q');
  assert.ok(!/PredefinedMenuItem::quit\(/.test(libRs), '不得调用 PredefinedMenuItem::quit（注释提及不算）');
});

test('Builder 使用自定义菜单，点击 Quit 先显示窗口再 emit quit-requested', () => {
  assert.ok(/\.menu\(\|app\| build_app_menu\(app\)\)/.test(libRs), 'Builder 应设置自定义菜单');
  const handler = libRs.match(
    /\.on_menu_event\(\|app, event\| \{\s*if event\.id\(\)\.as_ref\(\) == "quit-app" \{[\s\S]*?\n        \}\)/
  );
  assert.ok(handler, '应有 app 菜单 on_menu_event 处理 quit-app');
  const body = handler[0];
  const showIdx = body.indexOf('show_window(');
  const emitIdx = body.indexOf('emit("quit-requested"');
  assert.ok(showIdx !== -1 && emitIdx !== -1, '应先显示窗口并 emit quit-requested');
  assert.ok(showIdx < emitIdx, '窗口显示必须先于事件派发');
});

test('前端监听 quit-requested 并走强制退出流程', () => {
  assert.ok(/onEvent\('quit-requested'/.test(appJs), 'app.js 应监听 quit-requested');
  assert.ok(/handleAppClose\('quit'\)/.test(appJs), '监听应调用 handleAppClose("quit")');
});
