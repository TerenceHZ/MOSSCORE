'use strict';

const { ipcRenderer } = require('electron');

// 兼容 WebView2 的 chrome.webview 接口
(function () {
  if (typeof window === 'undefined') return;

  const listeners = [];

  window.chrome = window.chrome || {};
  window.chrome.webview = window.chrome.webview || {};

  // 发送消息到主进程
  window.chrome.webview.postMessage = function (payload) {
    try {
      let data = payload;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch {}
      }
      ipcRenderer.send('moss-message', data);
    } catch (e) {}
  };

  // 接收主进程消息（前端会调用 addEventListener）
  window.chrome.webview.addEventListener = function (type, handler) {
    if (type === 'message' && typeof handler === 'function') {
      listeners.push(handler);
    }
  };

  window.chrome.webview.removeEventListener = function (type, handler) {
    const i = listeners.indexOf(handler);
    if (i >= 0) listeners.splice(i, 1);
  };

  // 内部派发
  window.chrome.webview.__dispatch = function (obj) {
    let msg = obj;
    if (typeof msg === 'string') {
      try { msg = JSON.parse(msg); } catch { return; }
    }
    if (!msg) return;
    listeners.forEach(function (fn) {
      try { fn({ data: msg }); } catch (e) {}
    });
  };

  // 主进程通过 dispatch 发消息
  ipcRenderer.on('moss-to-page', (_event, payload) => {
    try { window.chrome.webview.__dispatch(payload); } catch (e) {}
  });
})();
