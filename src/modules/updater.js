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
  };

  const api = { mixin };
  window.TMUpdater = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
