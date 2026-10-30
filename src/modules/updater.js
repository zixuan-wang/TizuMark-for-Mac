// 关于弹窗与外部链接打开
// 从 src/app.js 拆分而来：方法体原样搬运，经 mixin 挂到 MarkdownEditor.prototype，
// 因此方法内的 this 仍指向编辑器实例，模块之间可继续用 this.xxx() 互调。
(function () {
  'use strict';

  const mixin = {
      async showAbout() {
        const dialog = document.getElementById('about-dialog');
        // 每次打开重置为默认居中尺寸（拖动/缩放状态不记忆，符合预期）
        const ap = dialog ? dialog.querySelector('.dialog') : null;
        if (ap && typeof window.resetDialog === 'function') window.resetDialog(ap);
        // 每次打开重置折叠状态：所有分类默认展开
        dialog.querySelectorAll('.dependency-details').forEach((sec) => sec.setAttribute('data-collapsed', 'false'));
        dialog.classList.remove('hidden');
        // 折叠块展开/收起由全局委托 bindCollapseToggle 统一处理，
        // 各块默认状态（展开/收起）由 HTML data-collapsed 初始值决定，此处不再干预。
        if (!dialog._devSetup) {
          dialog._devSetup = true;
          let cnt = 0;
          let timer = null;
          const verEl = document.getElementById('about-version');
          if (verEl) {
            verEl.addEventListener('click', async () => {
              cnt++;
              if (timer) clearTimeout(timer);
              timer = setTimeout(() => { cnt = 0; }, 400);
              if (cnt >= 5) {
                cnt = 0;
                clearTimeout(timer);
                timer = null;
                try {
                  await TauriApi.openDevtools();
                  this.showToast(this.t('devtoolsOpened'), 'success');
                } catch (e) {
                  this.showToast(this.t('devtoolsOpenFailed', { err: e }), 'danger');
                }
              }
            });
          }
        }
        try {
          const ver = await TauriApi.getVersion();
          const el = document.getElementById('about-version');
          if (el) el.textContent = 'v' + ver;
        } catch (_) {}
      },
      hideAbout() {
        document.getElementById('about-dialog').classList.add('hidden');
      },
      openExternal(url) {
        TauriApi.shellOpen(url).then((opened) => {
          if (!opened) window.open(url, '_blank', 'noopener,noreferrer');
        });
      },
      async minimizeWindow() {
        try {
          const appWindow = TauriApi.currentWindow();
          await appWindow.minimize();
        } catch (e) {
          console.warn('minimize failed:', e);
        }
      },
      async toggleMaximize() {
        try {
          const appWindow = TauriApi.currentWindow();
          const isMaximized = await appWindow.isMaximized();
          if (isMaximized) {
            await appWindow.unmaximize();
          } else {
            await appWindow.maximize();
          }
          this.updateMaximizeIcon();
        } catch (e) {
          console.warn('maximize failed:', e);
        }
      },
      async updateMaximizeIcon() {
        try {
          const appWindow = TauriApi.currentWindow();
          const isMaximized = await appWindow.isMaximized();
          const btn = document.getElementById('btn-maximize');
          if (isMaximized) {
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
          } else {
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>';
          }
        } catch (e) {
          console.warn('updateMaximizeIcon failed:', e);
        }
      },
      async closeWindow() {
        await this.handleAppClose();
      },
    // 窗口三钮与标题栏拖拽
    initWindowControls() {
      document.getElementById('btn-minimize').addEventListener('click', () => this.minimizeWindow());
      document.getElementById('btn-maximize').addEventListener('click', () => this.toggleMaximize());
      document.getElementById('btn-close').addEventListener('click', () => this.closeWindow());

      const header = document.querySelector('.header');
      if (header) {
        header.addEventListener('mousedown', async (e) => {
          if (e.target.closest('button, input, select, textarea, .dropdown-menu, .app-icon, .view-mode-tab, .window-controls')) {
            return;
          }
          if (e.button === 0) {
            // 阻止冒泡到 document，避免 Tauri 注入的 drag.js（data-tauri-drag-region）
            // 与这里调用同一个 start_dragging IPC 造成重复触发
            e.stopPropagation();
            if (e.detail === 2) {
              this.toggleMaximize();
              return;
            }
            try {
              const appWindow = TauriApi.currentWindow();
              if (appWindow && typeof appWindow.startDragging === 'function') {
                await appWindow.startDragging();
              }
            } catch (err) {
              console.warn('startDragging failed:', err);
            }
          }
        });
      }
    },
  };

  const api = { mixin };
  window.TMUpdater = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
