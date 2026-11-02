# MOSS CORE 文档索引

最后整理：2026-11-02  
状态：需求阶段，未进入最终开发

## 当前主线

- 产品：MOSS CORE · 550C 神经星环监控桌面端
- 当前界面源：`vendor/agent-neural/index.html`
- 桌面壳：`desktop-webview/`（C# WinForms + WebView2）
- 安装位置：`C:\Users\ROG\MOSS CORE\`
- 桌面快捷方式：`MOSS CORE 异动监测`
- 当前安装包：`release/MOSS-CORE-Desktop-win64.zip`

## 需求文档

1. [MOSS CORE 需求文档 v1.0](requirements/01-MOSS-CORE-需求文档-v1.0.md)  
   三模块、布局、动效、音效、多签、抽屉、待确认事项。

2. [MOSS × NOVA 可呈现内容映射 v1.0](requirements/02-MOSS-NOVA-可呈现内容映射-v1.0.md)  
   NOVA 结果到 MOSS 组件的逐块映射。

3. [NOVA LAB 学习与结果呈现规划 v1.0](requirements/03-NOVA-LAB-学习与结果呈现规划-v1.0.md)  
   NOVA 页面、结果结构、数据接入和分期建议。

4. [NOVA 四层分析：视觉 / 逻辑 / 设置 / 自定义 v1.0](requirements/04-NOVA-四层分析-视觉-逻辑-设置-自定义-v1.0.md)  
   NOVA 的四层拆解。

## 状态快照

- [2026-10-28 状态快照](status/2026-10-28-状态快照.md)

## 本地参考数据

`reference/` 下是 NOVA LAB 的抓取快照和接口样本，仅用于本地分析，不进入代码仓库。

## 重要边界

- 当前软件为演示数据，不连接交易所。
- 多签数据、真实行情、历史存储尚未接入。
- NOVA API 的归属和授权需要确认。
- 自动下单不在当前范围内。
- 多签只做额度累计与历史证明，不做流入流出判断。
- “市值团队介入”只能作为代理判断，不能写成确定结论。

## 下一个节点

等待第二个参考网站，完成：

```text
两站对比
→ 字段合并
→ 去重 / 冲突检查
→ 需原创数据清单
→ P0 / P1 / P2 优先级
→ 最终需求 v2.0
```

确认最终需求后再开始真实数据开发。
