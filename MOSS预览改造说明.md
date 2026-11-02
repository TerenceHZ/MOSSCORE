# 550C // MOSS 预览改造说明

## 来源

基于 MIT 许可的 Prompt Spider UI：

- https://github.com/kirito14IT/prompt-spider-ui
- 本地路径：`vendor\prompt-spider-ui-main`
- 保留原 `LICENSE`，仅替换主题、主体、内容与文案。

## 已改

- 黑金白 550C 主题，移除粉色/青色
- 机械蜘蛛主体改为 MOSS 风格：
  - 黑色球形装甲
  - 金色/白色线网
  - 中央红色 T-800 式光学眼
  - 金色/白色机械腿
- 中间画布标题改为 `MOSS // CORE` / `CONTRACT ANOMALY NETWORK`
- 左侧数据流改为合约数据：
  `ANIMEUSDT OI +8.2% VOL 4.1x`
- 三条分支改为：
  - INGEST / 采集
  - VERIFY / 证据
  - BROADCAST / 播报
- 底部统计与文案改为合约异动
- 新增 550C 主题覆盖：`app/theme-550c.css`
- 新增 MOSS 图标：`app/moss.svg`

## 启动

双击项目根目录：

```text
启动MOSS预览.bat
```

它会：

1. 检查 Node 语法
2. 启动本地服务
3. 打开：

```text
http://127.0.0.1:4317
```

不要直接双击 `app/index.html`，ES modules 需要 HTTP 服务。

## 注意

- 这是模板改造预览，不是最终数据接入
- 当前合约数据为演示数据
- 不连接交易所，不执行交易
- 下一步：接真实合约 API、改造右侧/底部窗口、接入 Electron
