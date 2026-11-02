# 550C // MARKET TERMINAL

一个 550C 控制终端风格的加密货币行情监控桌面端。深色磷光面板、扫描线、等宽读数、机器状态栏，以及真正能用的自选、K 线、预警、信号扫描和资讯聚合。

> 当前版本为 **本地 PC 客户端 v0.1.0**。先本地跑通，确认逻辑和视觉后再做服务器部署与多设备同步。

---

## 1. 功能

| 模块 | 说明 |
| --- | --- |
| 自选行情 | USDT 现货交易对，24H 涨跌、高低、成交量、成交额，2 秒级刷新 |
| K 线图表 | 1m / 5m / 15m / 1h / 4h / 1d，自定义 Canvas 绘制，支持缩放、拖动、十字光标 |
| 技术指标 | MA7 / MA25 / MA99、BOLL(20,2)、MACD(12,26,9)、RSI(14) |
| 价格预警 | 价格上穿 / 下穿、24H 涨幅 / 跌幅达到阈值，冷却时间与启停 |
| 信号扫描 | 每 60 秒扫描 15m / 1h：均线交叉、RSI 反转、20 周期突破、放量异动 |
| 资讯聚合 | CoinDesk / Cointelegraph / Decrypt 公共 RSS，按自选币种标记与筛选 |
| 桌面能力 | 系统托盘、关闭到托盘、开机启动、原生通知、提示音 |
| 550C 主题 | 琥珀 / 磷绿 / 冷青 / 白磷 / 纸白，扫描线、暗角、辉光可独立关闭 |
| 本地持久化 | 自选、预警、信号、资讯、设置写入本地 `state.json`，重启不丢 |

---

## 2. 快速启动

### 环境

- Windows 10 / 11
- 首次准备运行环境需要联网
- **不需要预先安装 Node.js / npm**：`start.bat` 会直接下载官方 Electron 运行时到 `.runtime`

### 方式 A：一键启动（推荐）

双击 **`start.bat`**。

- 如果 `.runtime` 里已有 Electron，直接打开 550C 窗口。
- 如果没有，脚本会自动：
  1. 从国内镜像下载 Electron 33.4.11（约 115 MB）；
  2. 解压到 `.runtime\electron`；
  3. 启动客户端。
- 首次通常需要 1～3 分钟；之后双击秒开，不再下载。
- 首次安装成功后会尝试在桌面创建 **550C Market Terminal** 快捷方式；以后直接双击桌面图标即可。
- 如果杀毒软件拦截 `electron.exe`，确认路径位于 `D:\数据库\.runtime\electron` 后再放行。

如果窗口没有出现，双击 **`debug.bat`**。它会保留控制台窗口，把环境信息和 Electron 退出码写入 `debug.log`。

### 方式 B：手动开发启动（已安装 Node）

```bash
npm install
npm start
```

### 方式 C：无界面自检

已安装 Node 的情况下，可先验证本地服务、DEMO 行情、K 线、搜索、预警和信号扫描：

```bash
npm run smoke
```

输出 `SMOKE OK` 表示本地核心链路正常。该命令使用临时数据目录，不会污染正式数据。

`start.bat` 已内置国内镜像；如果 Electron 下载仍然缓慢，可以手动执行：

```bat
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
npm start
```

### 首次打开没有行情？

默认行情源是 Binance 公共现货接口 `https://data-api.binance.vision`。如果你所在网络无法直连：

1. 点击右上角 **设置**（滑杆图标）。
2. 在 `02 / DATA FEED` 把行情源切到 **DEMO / SIMULATED**。
3. DEMO 模式会生成完整的价格、K 线、24H 数据和扫描结果，用于验证界面与预警逻辑。
4. 正式使用时，把「行情地址」改成一个可访问的 Binance 镜像 / 反向代理，再切回 `BINANCE SPOT`。

> 行情地址会拼接 `/api/v3/...`。例如你的代理把 Binance 映射到 `https://your-proxy.example/binance`，就填这个地址。

---

## 3. 使用说明

### 自选列表

- 搜索框输入 `BTC`、`SOL`、`PEPE` 或完整交易对 `BTCUSDT`。
- 点击结果加入监控；鼠标悬停行右侧 `×` 移除。
- `Ctrl + K` 随时聚焦搜索框。
- 最多 50 个 USDT 交易对。

### 图表

- 顶部 `1M / 5M / 15M / 1H / 4H / 1D` 切换周期。
- `MA / BOLL / MACD / RSI` 独立开关；MACD 与 RSI 会各自占用一个副图。
- 滚轮缩放、按住拖动平移、双击或右上角重置按钮恢复视图。
- 图表每 25 秒静默刷新，实时价格会更新最后一根 K 线。

### 预警

右侧 `ALERTS` 标签 → `+ NEW`：

- **价格上穿 / 下穿**：阈值为绝对价格。
- **24H 涨幅达到**：`24H 涨跌幅 >= 阈值`。
- **24H 跌幅达到**：`24H 涨跌幅 <= -阈值`。
- 冷却时间 5 分钟 / 15 分钟 / 1 小时 / 4 小时。

触发后会写入事件日志、弹出终端提示、播放提示音；在 Electron 客户端中同时发送 Windows 原生通知。窗口在后台或托盘时也会触发。

### 信号

- 服务端每 60 秒对自选列表的 `15m` 与 `1h` 周期各扫描一次。
- 只在 **已收盘 K 线** 上判断，避免当前未完成 K 线反复触发。
- 同一交易对、周期、策略、K 线时间只记录一次。
- 点击信号会切换到对应币种与周期。

### 资讯

- 三个公共 RSS 源，每 5 分钟拉取一次。
- 自动按标题/摘要关键词匹配 BTC、ETH、SOL 等币种。
- `ALL / THIS PAIR` 切换全部资讯或当前交易对相关资讯。
- 点击资讯在系统浏览器打开。

### 托盘与开机启动

- 关闭窗口默认隐藏到系统托盘，采集、预警和扫描继续运行。
- 托盘右键：显示/隐藏、暂停预警、开机启动、打开数据目录、退出。
- 设置中可关闭「关闭窗口时最小化到托盘」和「开机自动启动」。
- 退出请使用托盘菜单的「退出」，确保本地数据写入完成。

---

## 4. 技术结构

```text
550c-market-terminal/
├─ electron/
│  ├─ main.cjs          Electron 主进程：窗口、托盘、原生通知、开机启动
│  ├─ preload.cjs       最小化 IPC 桥
│  └─ icon.cjs          运行时生成托盘/应用图标（PNG/ICO）
├─ server/
│  ├─ index.cjs         本地 HTTP API、静态资源、SSE
│  ├─ feed.cjs          Binance 公共行情 + DEMO 模拟行情
│  ├─ store.cjs         state.json 持久化
│  ├─ alerts.cjs        预警条件评估与触发
│  ├─ signals.cjs       策略扫描
│  ├─ indicators.cjs    SMA / EMA / RSI / MACD / BOLL / ATR
│  ├─ news.cjs          RSS 抓取、解析、币种匹配
│  ├─ sse.cjs           Server-Sent Events 推送
│  └─ util.cjs          工具函数
├─ public/
│  ├─ index.html        单页终端界面
│  ├─ css/app.css       550C 视觉系统
│  └─ js/
│     ├─ app.js         状态、交互、API、SSE、设置
│     ├─ chart.js       Canvas K 线与指标
│     └─ format.js      数字/时间格式化
├─ scripts/gen-icon.mjs 生成 build/icon.png 与 build/icon.ico
├─ start.bat            一键安装并启动
└─ package.json
```

- 行情在**主进程的本地服务**中拉取，渲染进程只访问 `127.0.0.1`。
- 服务通过 SSE 把 ticker、预警、信号、资讯推给界面；预警评估在服务端完成，不依赖页面是否打开。
- 所有数据默认保存在 Electron 的用户数据目录，可在「设置 → 打开数据目录」查看。

---

## 5. 打包 Windows 安装包

```bash
npm run icon
npm run dist
```

产物在 `release/`，默认生成 NSIS 安装包。

- `npm run icon` 会生成 `build/icon.png` / `build/icon.ico`。
- 如只想生成免安装目录版：`npm run portable`。
- 首次打包会下载 Electron Builder 所需二进制，国内网络可设置第 2 节的镜像变量。

---

## 6. 数据源说明

### Binance 公共行情

- 默认地址：`https://data-api.binance.vision`
- 不需要 API Key，不涉及交易权限。
- 当前使用 24H ticker 批量接口 + K 线接口；服务端默认 2 秒轮询。
- 仅支持 **USDT 现货**交易对。
- 该域名在部分网络环境不可达，属于网络/区域限制，不是软件故障。可切换 DEMO 或配置代理地址。

### 资讯 RSS

- CoinDesk: `https://www.coindesk.com/arc/outboundfeeds/rss/`
- Cointelegraph: `https://cointelegraph.com/rss`
- Decrypt: `https://decrypt.co/feed`

三个源独立失败，不会阻塞行情。若全部不可达，资讯面板会显示离线状态。

---

## 7. 本地安全边界

当前版本是**单用户本地应用**：

- 服务只监听 `127.0.0.1`，不对局域网开放。
- 没有登录系统，因为它假设运行在你自己的 PC 上。
- 不要把端口通过路由器、内网穿透或反向代理暴露到公网。
- 启动参数带 `--no-sandbox`，用于兼容 Windows LPAC / AppContainer 策略；应用只加载本地界面，不加载远程网页。不要把服务暴露到公网。
- 下一阶段部署到服务器时，需要补充：账号登录、会话鉴权、HTTPS、CSRF 防护、请求限流和多用户数据隔离。

---

## 8. 当前限制

- 只接入 Binance USDT 现货；OKX、合约、资金费率、链上数据尚未接入。
- 预警类型目前是价格与 24H 涨跌幅；未做成交量、波动率、指标条件组合。
- 信号是规则扫描，不构成投资建议，也不做回测。
- 资讯源为英文 RSS；中文资讯源可在 `server/news.cjs` 中追加。
- 历史数据不落库；K 线每次按需拉取，自选/预警/信号/资讯持久化。
- 本地无鉴权，仅适合本机使用。

---

## 9. 下一步

1. 本地跑通后，按你的实际桌面配色微调 550C 主题。
2. 部署到服务器：增加登录、HTTPS、反代和多设备共享。
3. 增加 Telegram / 邮件 / Web Push 预警通道。
4. 接入更多交易所与合约数据。
5. 增加策略回测与参数配置。

---

**550C // MARKET TERMINAL**  
*Personal crypto surveillance console. Not financial advice.*
