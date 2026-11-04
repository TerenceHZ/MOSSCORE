MOSS CORE · 网页版
=================

运行环境：
- macOS / Windows / Linux
- Python 3（macOS 自带 python3，或安装 python.org 版本）
- 推荐 Chrome / Edge

启动：
macOS：
  1. 打开终端，进入本目录
  2. chmod +x start.command
  3. 双击 start.command
  4. 浏览器打开 http://127.0.0.1:8787

Windows：
  1. 双击 start-windows.bat
  2. 浏览器打开 http://127.0.0.1:8787

命令行（通用）：
  python3 server.py
  然后打开 http://127.0.0.1:8787

修改端口：
  MOSS_PORT=9000 python3 server.py
  Windows:
  set MOSS_PORT=9000 && py -3 server.py

说明：
- 页面由 server.py 提供。
- server.py 同时代理 Binance 公共行情和 alternative.me 的恐慌贪婪指数，解决浏览器 CORS 问题。
- 不需要 API Key。
- 数据 60 秒刷新一次。
- 网页版依赖浏览器 WebGL、WebAudio 和语音合成；建议用 Chrome。
- 服务只监听 127.0.0.1，不对外网开放。
