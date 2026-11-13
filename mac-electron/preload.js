'use strict';

const { ipcRenderer } = require('electron');

// 兼容 WebView2 的 chrome.webview.postMessage 接口
if (typeof window !== 'undefined') {
  window.chrome = window.chrome || {};
  window.chrome.webview = window.chrome.webview || {};
  window.chrome.webview.postMessage = function (payload) {
    try {
      ipcRenderer.send('moss-message', payload);
    } catch (e) {}
  };
}
