// ⌘Q 退出应用：
// 1. 固定注册在全局派发表（不随方案/自定义变动）
// 2. 编辑器有焦点 / 无焦点都派发，且 preventDefault
// 3. handleAppClose('quit') 跳过「关闭窗口时」询问
// 4. 重入保护：并发触发只弹一次保存框；取消后可再次触发
const test = require('node:test');
const assert = require('node:assert');
const { buildEnv, cleanup, waitForEditor } = require('./helpers/app-env.cjs');

function pressCmdQ(w, target) {
  const evt = new w.KeyboardEvent('keydown', {
    key: 'q', code: 'KeyQ', keyCode: 81, which: 81,
    metaKey: true, bubbles: true, cancelable: true,
  });
  target.dispatchEvent(evt);
  return evt;
}

async function ready() {
  const { w } = await buildEnv({ captureInitErr: true });
  const ed = await waitForEditor(w);
  for (const t of ed.tabs) t.savedContent = t.content;
  return { w, ed };
}

test('⌘Q：固定注册在全局派发表，编辑器聚焦时派发一次', async () => {
  const { w, ed } = await ready();
  try {
    assert.strictEqual(typeof ed.globalShortcutLookup['Ctrl+Q'], 'function');
    let calls = 0; let arg = null;
    ed.handleAppClose = (a) => { calls++; arg = a; };
    ed.cm.focus();
    const inner = ed.cm.getWrapperElement().querySelector('.CodeMirror-code') || ed.cm.getWrapperElement();
    const evt = pressCmdQ(w, inner);
    assert.strictEqual(calls, 1, '应派发一次 handleAppClose');
    assert.strictEqual(arg, 'quit', '应传入 quit');
    assert.ok(evt.defaultPrevented, '⌘Q 应被 preventDefault');
  } finally { cleanup(w); }
});

test('⌘Q：焦点不在编辑器时同样派发', async () => {
  const { w, ed } = await ready();
  try {
    let calls = 0;
    ed.handleAppClose = () => { calls++; };
    const evt = pressCmdQ(w, w.document.body);
    assert.strictEqual(calls, 1);
    assert.ok(evt.defaultPrevented);
  } finally { cleanup(w); }
});

test('handleAppClose("quit")：跳过关闭行为询问，无修改时直接 quitApp', async () => {
  const { w, ed } = await ready();
  try {
    let asked = 0;
    ed._resolveCloseAction = async () => { asked++; return 'minimize'; };
    let quitCalls = 0;
    w.TauriApi.quitApp = async () => { quitCalls++; };
    ed.saveSession = () => {};
    await ed.handleAppClose('quit');
    assert.strictEqual(asked, 0, '不应弹「关闭窗口时」询问');
    assert.strictEqual(quitCalls, 1, '应调用 quitApp');
  } finally { cleanup(w); }
});

test('重入保护：并发触发只弹一次保存框，取消后可再次触发', async () => {
  const { w, ed } = await ready();
  try {
    ed.tabs[0].content = 'changed';
    let dialogCalls = 0; let resolveDialog;
    ed.showSaveDialog = () => {
      dialogCalls++;
      return new Promise((r) => { resolveDialog = r; });
    };
    let quitCalls = 0;
    w.TauriApi.quitApp = async () => { quitCalls++; };
    const p1 = ed.handleAppClose('quit');
    const p2 = ed.handleAppClose('quit');
    assert.strictEqual(dialogCalls, 1, '并发触发只弹一次');
    resolveDialog('cancel');
    await Promise.all([p1, p2]);
    assert.strictEqual(quitCalls, 0, '取消不应退出');
    for (const t of ed.tabs) t.savedContent = t.content;
    ed.showSaveDialog = () => { dialogCalls++; return Promise.resolve('discard'); };
    ed.saveSession = () => {};
    await ed.handleAppClose('quit');
    assert.strictEqual(quitCalls, 1, '重入标记复位后可再次退出');
  } finally { cleanup(w); }
});

test('⌘Q 是内置固定键位：展示、冲突拦截、方案切换后仍在', async () => {
  const { w, ed } = await ready();
  try {
    const builtin = ed.getBuiltinFixedShortcuts().find((b) => b.combo === 'Cmd+Q');
    assert.ok(builtin, '内置表应含 Cmd+Q');
    assert.strictEqual(builtin.group, 'app');
    assert.ok(builtin.name && builtin.desc, '应有名称与说明');
    assert.ok(ed.findBuiltinShortcut('Ctrl+Q'), '录制 Ctrl+Q 应被判为内置占用');
    assert.strictEqual(ed.findBuiltinShortcut('Ctrl+Alt+Q'), null, '其他组合不受影响');

    // 设置面板渲染出「应用」分组与退出行
    ed.renderShortcutsList();
    const titles = [...w.document.querySelectorAll('#shortcuts-list .shortcut-group-title')]
      .map((el) => el.textContent.trim());
    assert.ok(titles.includes('应用'), '内置区应有「应用」分组');
    const rows = [...w.document.querySelectorAll('#shortcuts-list .shortcut-builtin-row')];
    assert.ok(rows.some((r) => r.textContent.includes('退出应用')), '应展示「退出应用」行');

    // 录制其他动作到 ⌘Q 被拒绝
    ed.recordingAction = 'bold';
    const before = ed.shortcuts.bold.key;
    let toast = '';
    ed.showToast = (msg) => { toast = msg; };
    ed.handleShortcutRecording({
      key: 'q', code: 'KeyQ', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false,
      preventDefault() {}, stopPropagation() {},
    });
    assert.strictEqual(ed.shortcuts.bold.key, before, 'bold 键位不应被改写');
    assert.ok(toast.includes('内置快捷键'), '应提示内置键不可占用');

    // 方案切换后固定注册仍在
    ed.previewShortcutScheme('vscode');
    ed.applyShortcuts();
    assert.strictEqual(typeof ed.globalShortcutLookup['Ctrl+Q'], 'function', '切换方案后 ⌘Q 仍应可用');
    assert.strictEqual(ed.shortcuts.quitApp, undefined, '退出不应变成可配置动作');
  } finally { cleanup(w); }
});

test('旧配置把「关闭到托盘」绑到 ⌘Q：不注册 OS 级全局热键', async () => {
  const { w, ed } = await ready();
  try {
    const calls = [];
    w.TauriApi.setCloseToTrayShortcut = async ({ key }) => { calls.push(key); };
    await ed._syncGlobalCloseToTrayShortcut('Ctrl+Q');
    assert.deepStrictEqual(calls, [''], '⌘Q 冲突时应只下发空 key 注销旧热键');

    calls.length = 0;
    ed.shortcuts.closeToTray = { key: 'Ctrl+Q', label: '关闭到托盘' };
    ed.applyShortcuts();
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(!calls.includes('Cmd+Q'), 'applyShortcuts 不应注册 Cmd+Q 全局热键');
  } finally { cleanup(w); }
});
