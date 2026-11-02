# MOSS × NOVA 可呈现内容映射 v1.0

目的：把 NOVA LAB 的判断结果，整理成 MOSS CORE 现有视觉能承载的内容  
原则：不照搬 NOVA 页面；保留 550C 星环；只接入能解释、能决策的结果  
状态：映射方案，未改代码

---

## 一、结论

NOVA 的内容很多，但 MOSS 首屏不需要全部接。

适合放进 MOSS 的只有 6 块：

| 优先级 | NOVA 结果 | MOSS 位置 |
|---|---|---|
| P0 | 大盘势头 | 顶部结论条 |
| P0 | 三级信号队列 | 左侧 7 行 |
| P0 | 单币证据 | 左下弹窗 |
| P0 | 当前阶段/分数 | 中央红眼与标题 |
| P1 | 异动事件流 | 右侧日志 |
| P1 | 选中币参数 | 底部六格 |

不适合进首屏：

- 纸面账户
- 逐笔交易
- 历史回测大表
- 低市值十币完整表
- 500 合约全表

这些放“研究 / 历史”二级页。

---

## 二、逐块映射

### 1. 顶部：大盘势头

**现在 MOSS 顶部：**

```text
LAST SIGNAL · 最近一次脉冲
INGEST · 接单 · T-049 ...
```

**改成：**

```text
MARKET REGIME · 大盘势头
弱势  49.3   BTC 24h +0.24%   流动性 18.6/20   完整度 90%   置信度 高
```

展开/第二行：

```text
市场广度 2.9/30 · BTC与趋势 14/25 · 流动性 18.6/20 · 信号强度 8.9/15
```

数据字段：

```text
market_regime.regime
market_regime.regime_code
market_regime.score
market_regime.confidence
market_regime.data_completeness_pct
market_regime.btc_change_24h_pct
market_regime.factors[]
market_regime.recommendation
market_regime.btc_liquidity_guard.status
```

视觉：

- 档位用金/暗金/红/灰
- 分数大字
- 因子用短横条，不铺表格
- 数据过期时整条变灰并显示“数据过期”

---

### 2. 左侧：三级信号队列

**现在 MOSS 左侧：**

```text
MOSS / INGEST / OI / PRICE / VOLUME / PROOF / RISK
```

**改成：**

```text
ENTRY   BLESS   97.0   5m +1.81%
WATCH   SOPH    77.2   5m +0.17%
LOW     OGN     74.9   5m -1.56%
MM      EVAA    61.0   5m -0.93%
OI      全网 OI 快增  +6.2%
LOWCAP  3 个低市值进入初筛
RISK    数据完整度 90%
```

每行固定 5 个信息：

```text
阶段 / 币种 / 策略分 / 5m 动量 / 数据年龄
```

数据字段：

```text
candidates[].signal_level
candidates[].strategy_action
candidates[].symbol
candidates[].fast_score
candidates[].change_5m_pct
candidates[].detected_at
candidate_counts.entry/watch/low
focus_watchlist.items[]
low_market_cap_futures.items[]
oi.exchange_count_ok
```

视觉：

- 开仓信号：亮金左边条 + 较强背景
- 重点候选：金色边
- 初筛观察：暗金边
- MM / OI / 低市值：标签区分，不混入主信号颜色
- 分数右侧对齐，便于扫读

交互：

- 点击一行 → 中央和左下切换到该币
- 点击阶段标题 → 只看该阶段

---

### 3. 中央：星环与当前币

MOSS 的星环不改成 NOVA 的卡片列表，而是保留“反应堆”视觉。

星环承担三件事：

```text
1. 当前选中币的“核心位置”
2. 当前阶段的视觉状态
3. 红眼锁定最高优先级
```

映射：

| 星环元素 | NOVA 含义 |
|---|---|
| 中心红眼 | 当前最高优先级信号 |
| 内环 | 当前选中币 |
| 中环 | 三级信号阶段 |
| 外环刻度 | 数据新鲜度 / 交易所覆盖 |
| 旋转节点 | 候选币队列 |
| 环上高亮 | 开仓信号 / 升级事件 |

中央文字：

```text
BLESS
开仓信号 · 97.0
3分钟动量 +1.73% · 回撤 0.00%
```

无信号时：

```text
当前无开仓信号
只观察，不追涨
```

---

### 4. 左下：单币证据卡

**现在 MOSS 左下：**

```text
ORDER SUGGESTION · 下单建议
ANIMEUSDT
LONG · 回踩分批做多
```

**改成：**

```text
SIGNAL EVIDENCE · 信号证据
BLESS
开仓信号 · 97.0

为什么选中
✓ 达到开仓信号条件
✓ 3分钟动量 +1.73%
✓ 24h 成交额 15.96M
✓ 距短线高点 0.00%

入场参考 0.010339
10x 保证金止损 18% · 利润峰值回撤 10%
20x 保证金止损 30% · 利润峰值回撤 10%
```

数据字段：

```text
candidate.strategy_reasons[]
candidate.score_breakdown[]
candidate.price
candidate.entry_signal_price
candidate.entry_return_pct
candidate.classification_rule
candidate.research_reference.steady/high_return
candidate.research_reference.peak_profit_retrace_pct
```

设计原则：

- 不写“必涨”
- 不写“稳赚”
- 只写“满足什么条件”
- 没有信号时明确写“只观察”

---

### 5. 底部：六格参数

**现在 MOSS 底部：**

```text
OI / PRICE / VOLUME / FUNDING / DEPTH / RISK
```

**改成：**

```text
24H       5M        1M QV      全网OI     回撤       策略分
+7.94%    +1.81%    70.5K      待核验     0.00%      97.0
```

或者：

```text
24H / 5M / 1M成交 / OI / 距高点回撤 / 阶段
```

数据字段：

```text
change_24h_pct
change_5m_pct
qv_1m_usdt
oi.total_oi_usd / oi_change_15m_pct
pullback_from_fast_high_pct
fast_score / signal_level
```

每格显示：

```text
当前值
进入阶段时值
差值
```

这样用户能看到“异动前 → 异动后”。

---

### 6. 右侧：事件流

**现在 MOSS 右侧：**

```text
ANOMALY FEED · 异动日志
```

**改成：**

```text
SIGNAL EVENTS · 信号事件
```

事件类型：

```text
15:41:47  BLESS  进入开仓信号  97.0
15:41:47  SOPH   进入重点候选  77.2
15:41:47  OGN    进入初筛观察  74.9
15:42:30  EVAA   OI 5m +6.2%   观察
15:42:30  MARKET 大盘弱势 49.3
15:42:31  DATA   交易所覆盖 5/6
```

字段：

```text
event.at
event.symbol
event.type
event.from_stage
event.to_stage
event.score
event.reason
```

视觉：

- 升级：金
- 降级：暗金/灰
- 风险：红
- 数据异常：灰白
- 最新事件在最上方
- 点击事件 → 选中对应币

---

### 7. 右侧热力格

保留现有热力格，但内容改成：

```text
横轴：时间
纵轴：候选币 / 阶段
颜色：策略分强度
```

或：

```text
横轴：时间
纵轴：ENTRY / WATCH / LOW / MM / OI / LOWCAP
颜色：事件密度
```

第一版可以继续用现有“单元活跃度”，第二版再接真实阶段热力。

---

## 三、设置与自定义在 MOSS 里的位置

### 设置页

```text
系统
  数据源
  API Key
  刷新频率
  数据保留

策略
  三级分数门槛
  动量/成交额/回撤权重
  OI 快增快退阈值
  10x / 20x 风控

提醒
  开仓信号
  重点候选
  初筛
  OI
  低市值
  大盘转弱
  声音/通知/Webhook

显示
  左侧显示哪些阶段
  底部六格显示哪些指标
  是否显示 MM/低市值
  主题/窗口
```

### 自定义入口

建议放在右上角“视角”旁边，增加一个“设置”入口；  
但不要恢复“主题 / 全屏”按钮。

---

## 四、MOSS 首屏最终结构

```text
┌──────────────────────────────────────────────────────────────┐
│ MARKET REGIME  弱势 49.3  BTC +0.24%  流动性 18.6  完整度90% │
├────────────────────┬──────────────────────────┬──────────────┤
│ SIGNAL QUEUE       │      NEURAL RING         │ SIGNAL EVENTS│
│ ENTRY BLESS 97.0   │      红眼 = 最高优先级    │ 15:41 BLESS  │
│ WATCH SOPH  77.2   │      BLESS / 开仓信号     │ 15:41 SOPH   │
│ LOW   OGN   74.9   │      97.0                │ 15:42 EVAA   │
│ MM    EVAA  61.0   │                          │ 15:42 MARKET │
├────────────────────┤                          ├──────────────┤
│ SIGNAL EVIDENCE    │                          │ STAGE HEAT   │
│ 理由/评分/风控      │                          │              │
├────────────────────┴──────────────────────────┴──────────────┤
│ 24H / 5M / 1M QV / OI / PULLBACK / SCORE                    │
└──────────────────────────────────────────────────────────────┘
```

---

## 五、第一版只改这些

为了不破坏现有稳定版本，建议第一版只做：

1. 顶部大盘势头
2. 左侧 7 行信号队列
3. 左下信号证据卡
4. 底部六格
5. 右侧事件流
6. 红眼跟随最高优先级

暂不改：

- 星环几何
- 主题系统
- 窗口系统
- 纸面/回测
- 实时 API 接入

第一版先用 **NOVA 静态快照** 做视觉验证，确认内容布局后再接实时接口。

---

## 六、需要确认

1. 第一版是否按“NOVA 静态快照 → 视觉验证 → 接实时”的顺序？
2. 左侧队列是否只显示 7 行，还是可滚动？
3. 底部六格是否按“24H / 5M / 1M QV / OI / 回撤 / 策略分”？
4. 红眼是锁最高分，还是锁最高阶段（ENTRY 优先）？

确认后我再改前端。
