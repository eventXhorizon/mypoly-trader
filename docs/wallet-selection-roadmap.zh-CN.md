# Polymarket 跟单地址筛选与纸面验证路线图

本文档记录“先筛选地址，再纸面跟单验证，最后再考虑实盘”的分阶段方案。目标不是找到看起来胜率高的钱包，而是找到在真实可成交价格下仍然具备可复制正期望的钱包。

## 总原则

优先寻找同时满足以下特征的地址：

- 长期 CLV 为正。
- 已结算 ROI 为正。
- 最大回撤可控。
- 利润来源不集中在少数市场或少数大单。
- 交易频率适中，既不是极低样本，也不是难以复制的高频抢单。
- 成交后价格不会立刻恶化，真实跟单价格仍然接近目标地址成交价格。

不把单一指标作为准入条件。胜率、总 PnL、leaderboard 排名、open PnL 都只能作为辅助信息，不能单独决定是否跟单。

## 阶段 1：候选地址筛选

阶段目标：从历史数据中筛出值得进入 paper follow 的候选地址。

### 数据来源

优先使用现有项目已经接入或可直接扩展的数据源：

- Data API：目标地址 activity、trades、positions、closed positions。
- Gamma API：市场元数据、问题、分类、结束时间、结算状态。
- CLOB API：orderbook、midpoint、spread、price snapshots。
- Postgres：保存本地采集的交易、盘口快照、评分结果和纸面跟单结果。

### 基础过滤

先过滤掉明显不适合跟单的地址：

| 条件 | 建议规则 | 目的 |
| --- | --- | --- |
| 样本量 | 已结算市场不少于 30 个，交易不少于 50 笔 | 避免偶然盈利 |
| 时间跨度 | 覆盖至少 4-8 周，越长越好 | 避免只适配某一短周期 |
| 交易规模 | 单笔规模不能长期小到无法复制，也不能大到明显影响盘口 | 保证可跟单性 |
| 地址活跃度 | 最近 7-14 天仍有交易 | 避免筛到失效地址 |
| 市场类型 | 按政治、体育、宏观、crypto、其他分类统计 | 防止跨领域误判 |
| 利润集中度 | 单一市场贡献利润不超过总利润的 30%-40% | 降低一次性好运影响 |

### 核心评分指标

#### 1. CLV

CLV 是优先级最高的指标。它衡量目标地址买入后，市场后续价格是否朝有利方向移动。

示例：

```text
目标地址买 YES @ 0.42
买入后 30 分钟 midpoint = 0.48
市场关闭前 midpoint = 0.55
这笔交易即使最后输了，也说明入场价格可能有 edge
```

建议同时计算多个窗口：

| 指标 | 含义 |
| --- | --- |
| `clv_5m` | 成交后 5 分钟的 midpoint 变化 |
| `clv_30m` | 成交后 30 分钟的 midpoint 变化 |
| `clv_close` | 市场关闭前或流动性消失前的价格变化 |
| `clv_weighted` | 按交易金额加权后的综合 CLV |

BUY 的 CLV：

```text
future_price - entry_price
```

SELL 的 CLV：

```text
exit_price - future_price
```

如果一个地址长期 CLV 为正，说明它常常能在市场共识变化前拿到较好的价格；这比短期胜率更值得重视。

#### 2. 已结算 ROI

只对已结算或已完全平仓的交易计算 realized ROI。

```text
realized_roi = realized_pnl / total_cost
```

open positions 要单独 mark-to-market，不和 realized PnL 混在一起。筛选时优先看已结算 ROI，open PnL 只作为风险提示。

#### 3. Profit Factor

```text
profit_factor = gross_profit / abs(gross_loss)
```

建议要求 profit factor > 1.2，再结合样本量和回撤判断。profit factor 很高但样本很小的地址要降权。

#### 4. 最大回撤

用时间序列资金曲线计算 max drawdown。

重点看：

- 回撤是否长期无法修复。
- 是否一次大亏吃掉长期小赚。
- 回撤发生时是否集中在某类市场。

#### 5. 利润集中度

需要统计利润来源是否集中：

- Top 1 市场利润占比。
- Top 5 市场利润占比。
- Top 1 分类利润占比。
- 最大单笔盈利占总盈利比例。

利润高度集中时，即使总 PnL 和 ROI 很好，也不能直接认定为稳定地址。

#### 6. 交易频率

交易频率要适中：

- 太低：样本不够，验证周期过长。
- 太高：可能依赖速度、挂单、盘口微结构，跟单很难复制。

建议优先选择每天数笔到数十笔的地址。对于秒级高频地址，必须额外提高可跟单性门槛。

#### 7. 成交后价格恶化

筛选时必须模拟跟单滑点，不能假设能拿到目标地址原成交价。

建议记录：

- 目标地址成交价。
- 成交后 5 秒、30 秒、60 秒可成交价格。
- 当时 spread。
- orderbook depth。
- 跟单金额在盘口中可否一次成交。

如果成交后价格立刻恶化，说明目标地址可能靠速度、早期信息或流动性缺口赚钱，普通跟单未必能复制。

## 阶段 1 评分模型

初版可以用加权评分，不追求复杂机器学习。

```text
score =
  0.35 * clv_score
+ 0.25 * realized_roi_score
+ 0.15 * profit_factor_score
+ 0.10 * sample_size_score
- 0.10 * drawdown_penalty
- 0.10 * concentration_penalty
- 0.10 * slippage_penalty
```

评分输出不只给总分，还要输出解释字段：

| 字段 | 含义 |
| --- | --- |
| `score` | 综合分 |
| `eligible` | 是否进入纸面跟单候选 |
| `reason_codes` | 入选或拒绝原因 |
| `sample_size` | 样本规模 |
| `realized_roi` | 已结算 ROI |
| `weighted_clv` | 金额加权 CLV |
| `max_drawdown` | 最大回撤 |
| `profit_concentration` | 利润集中度 |
| `copy_slippage_estimate` | 模拟跟单滑点 |

## 阶段 1 准入规则

初版建议采用保守门槛：

```text
eligible = true only if:
  settled_market_count >= 30
  trade_count >= 50
  realized_roi > 0
  weighted_clv > 0
  profit_factor > 1.2
  max_drawdown <= 30%
  top_1_market_profit_share <= 40%
  copy_slippage_estimate <= expected_edge * 50%
```

如果某项暂时无法计算，要标记为 `unknown`，不要默认为通过。

## 阶段 2：纸面跟单验证

阶段目标：把候选地址放入现有 `multi-watch`，连续纸面跟单 4-8 周，验证真实可成交价格下是否仍然盈利。

### 验证原则

纸面跟单必须尽量接近真实执行：

- 使用目标地址成交后可观察到的盘口价，而不是目标地址原始成交价。
- 扣除 spread 和预估 slippage。
- 受最小订单金额、最大单市场投入、现金余额约束。
- 记录跳过原因，不把跳过交易从统计里消失。
- 分离 realized PnL、unrealized PnL 和 mark-to-market equity。

### 运行周期

建议每个候选地址至少观察 4-8 周。

| 周期 | 判断 |
| --- | --- |
| 第 1-2 周 | 检查数据质量、交易识别、价格快照和滑点估算是否可靠 |
| 第 3-4 周 | 初步判断是否仍有正 CLV 和正 realized ROI |
| 第 5-8 周 | 检查回撤、利润集中度、市场分类稳定性 |

少于 4 周只作为观察，不进入实盘候选。

### 纸面跟单通过条件

建议同时满足：

```text
paper_realized_roi > 0
paper_weighted_clv > 0
paper_max_drawdown <= 25%-30%
paper_profit_factor > 1.1
paper_top_1_market_profit_share <= 40%
paper_trade_count >= 30
skipped_trade_rate is explainable
```

如果 paper 结果显著弱于历史评分，要优先相信 paper 结果。

## 阶段 3：小资金实盘灰度

阶段目标：只对通过纸面验证的地址做极小仓位实盘，不追求收益，主要验证真实成交和退出质量。

建议规则：

- 只允许白名单地址。
- 单笔固定小额，例如 1-2U。
- 每个 outcome 设置硬上限。
- 每日亏损达到阈值自动停止。
- 每日最大交易数限制。
- 禁止自动扩大仓位。
- 保留人工确认机制或至少保留 dashboard 开关。

进入阶段 3 前，必须有阶段 2 的完整记录。

## 阶段 4：Rust 分析 Worker

初期不重写现有 Node 程序。Rust 只在以下需求出现后再引入：

- 要批量扫描数百或数千个地址。
- 历史回填和 CLV 计算明显拖慢 Node 服务。
- 需要稳定长期运行的独立评分 worker。
- 需要高并发抓取盘口快照并写入 Postgres。

推荐架构：

```text
Node 程序
  - multi-watch
  - dashboard
  - paper follow
  - live copy gate

Rust worker
  - historical backfill
  - CLV/orderbook snapshot calculation
  - wallet scoring
  - write results to Postgres
```

Rust worker 只负责分析和写库，不直接下单。

## 推荐实现顺序

1. 新增候选地址评分表和数据采集表。
2. 为历史 trades、market metadata、price snapshots 建模。
3. 实现单地址历史回填。
4. 实现 CLV、ROI、profit factor、drawdown、concentration、slippage 指标。
5. 输出 `wallet_scores`。
6. Dashboard 增加候选地址排行榜和拒绝原因。
7. 通过 dashboard 把候选地址加入 paper follow。
8. 连续记录 4-8 周 paper 结果。
9. 根据 paper 结果决定是否进入小资金实盘灰度。

## 当前实现状态：Stage 1A

Stage 1A 已提供一个最小可运行的地址评分入口：

```bash
npm run db:up
npm run wallet-score -- 0x目标钱包地址
```

查看已评分地址排行榜：

```bash
npm run wallet-score -- --top 20
```

该命令会：

- 从 Polymarket Data API 读取目标钱包公开历史 trades。
- 从 Polymarket Data API 读取目标钱包 closed positions。
- 写入本地 Postgres 分析表。
- 计算第一版 `stage1a` 分数。
- 输出 JSON 结果。
- 不读取私钥。
- 不初始化 CLOB 下单 client。
- 不提交真实订单。

Stage 1A 已计算：

- `tradeCount`
- `tradedMarketCount`
- `settledMarketCount`
- `closedPositionCount`
- `realizedPnl`
- `buyVolume`
- `realizedRoi`
- `grossProfit`
- `grossLoss`
- `profitFactor`
- `maxDrawdownRatio`
- `topMarketProfitShare`
- `tradesPerDay`

Stage 1A 暂时不计算：

- `weightedClv`
- `copySlippageEstimate`
- 成交后 5 秒、30 秒、60 秒真实可成交价格。
- orderbook depth。

因此 Stage 1A 输出中：

```text
eligible = false
```

即使其他指标通过，也只会标记：

```text
provisionalEligible = true
```

这表示“值得进入下一步 CLV/滑点验证”，不是“可以实盘跟单”。

### Stage 1A 表结构

当前新增的 Postgres 表：

| 表 | 用途 |
| --- | --- |
| `wallet_candidates` | 候选钱包、状态、来源、回填和评分时间 |
| `wallet_historical_trades` | 标准化后的历史交易 |
| `wallet_closed_positions` | 标准化后的已关闭仓位 |
| `market_price_snapshots` | 预留给后续 CLOB midpoint/spread/depth 快照 |
| `wallet_scores` | 地址评分结果、指标和原因码 |

### Stage 1A 配置项

可以通过 `.env` 调整：

```env
WALLET_ANALYTICS_TRADES_PATH=/trades
WALLET_ANALYTICS_CLOSED_POSITIONS_PATH=/v1/closed-positions
WALLET_ANALYTICS_TRADE_LIMIT=500
WALLET_ANALYTICS_CLOSED_POSITION_LIMIT=500
WALLET_ANALYTICS_PAGE_LIMIT=100
WALLET_ANALYTICS_MIN_TRADES=50
WALLET_ANALYTICS_MIN_SETTLED_MARKETS=30
WALLET_ANALYTICS_MIN_PROFIT_FACTOR=1.2
WALLET_ANALYTICS_MAX_DRAWDOWN=0.30
WALLET_ANALYTICS_MAX_TOP_MARKET_PROFIT_SHARE=0.40
```

## 当前不做的事

- 不直接按胜率筛选。
- 不直接复制 leaderboard 地址。
- 不把 open PnL 当成稳定盈利证据。
- 不自动从筛选进入实盘。
- 不在第一阶段重写 Rust 版本。
- 不承诺“稳定盈利”，只验证是否存在可复制的正期望。
