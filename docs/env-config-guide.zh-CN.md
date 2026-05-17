# `.env` 配置说明

本文档解释项目中常用 `.env` 配置项，重点覆盖实盘跟单 `npm run bot` / Docker `live-bot`。

## 基本原则

`.env.example` 是模板，实际运行前需要复制成 `.env`：

```bash
cp .env.example .env
```

然后编辑 `.env`。不要把 `.env`、私钥、API secret 提交到 git。

本地直接运行需要 Node.js 20.18+。如果用 Docker，镜像已经使用 Node 22，不需要在 VPS 上单独升级 Node。

## 地址分析配置

地址筛选评分使用本地 Postgres 保存历史交易、已关闭仓位和评分结果。先启动数据库：

```bash
npm run db:up
```

然后对单个地址回填并评分：

```bash
npm run wallet-score -- 0x目标钱包地址
```

查看已评分地址：

```bash
npm run wallet-score -- --top 20
```

这个命令只读 Polymarket 公开数据并写本地数据库，不读取私钥，不会真实下单。

可选配置：

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
WALLET_ANALYTICS_ENABLE_CLV=true
WALLET_ANALYTICS_CLV_LIMIT=80
WALLET_ANALYTICS_CLV_WINDOW_MINUTES=30
WALLET_ANALYTICS_PRICE_HISTORY_FIDELITY=5
WALLET_ANALYTICS_ORDERBOOK_LIMIT=40
```

注意：当前评分是 `stage1b`。CLV 使用 CLOB 历史价格估算，滑点使用当前 orderbook 估算，因此仍然只是候选筛选，不等于实盘跟单结论。输出里的 `eligible=true` 只表示可以进入 4-8 周 paper follow，不表示可以直接实盘跟单。

## 实盘跟单最小配置

如果你要实盘跟单，例如总资金约 20U，每单跟 2U，可以这样配置：

```env
DRY_RUN=false

PRIVATE_KEY=你的EOA私钥
PROXY_WALLET_ADDRESS=你的Polymarket proxy wallet地址
TRADER_ADDRESS=你要跟单的目标钱包地址
# 多钱包实盘跟单时，用 TRADER_ADDRESSES
# TRADER_ADDRESSES=0x钱包1,0x钱包2
# TRADER_WALLET_LABELS=0x钱包1=W1,0x钱包2=体育钱包

SIZE_MODE=percentage
SIZE_PERCENT=100
MAX_POSITION_SIZE=2
MIN_TRADE_SIZE=1

AUTO_SELL_ENABLED=false
SELL_MODE=market

WEB_HOST=0.0.0.0
WEB_PORT=8787
```

Docker 实盘 `live-bot` 会把 dashboard 端口覆盖成 `8788`，所以 Docker 实盘 dashboard 默认是：

```text
http://你的VPS_IP:8788
```

## 钱包配置

| 配置项 | 含义 | 注意事项 |
| --- | --- | --- |
| `PRIVATE_KEY` | EOA 私钥，用来签名 Polymarket 订单。 | 高敏感信息，不要泄露。这个 EOA 通常不需要放资金。 |
| `PROXY_WALLET_ADDRESS` | 你的 Polymarket proxy wallet / deposit wallet 地址，资金从这里扣。 | CLOB V2 交易余额是 pUSD，不再是旧版 USDC.e。 |
| `TRADER_ADDRESS` | 单个目标钱包地址。 | 如果 `TRADER_ADDRESSES` 为空，实盘 bot 会使用这个地址。 |
| `TRADER_ADDRESSES` | 多个目标钱包地址列表，用逗号分隔。 | 实盘 `npm run bot` / Docker `live-bot` 和 `multi-watch` 都会使用。 |
| `TRADER_WALLET_LABELS` | 目标钱包备注，用于日志和仓位显示。 | 格式：`0x钱包1=W1,0x钱包2=体育钱包`；不填时自动显示 `W1/W2/W3`。 |
| `CLOB_SIGNATURE_TYPE` | CLOB V2 签名类型。 | `0=EOA`，`1=POLY_PROXY`，`2=POLY_GNOSIS_SAFE`，`3=POLY_1271`。浏览器钱包生成的 proxy wallet 通常先用 `2`；新 deposit wallet flow 可能需要 `3`。 |

## CLOB V2 与 pUSD

当前代码的实盘 `npm run bot` 已迁移到 Polymarket CLOB V2。V2 的交易抵押资产是 pUSD，dashboard 和日志里的 `pUSD Balance` 才是可用于 CLOB V2 下单的余额。

如果你只有旧版 USDC.e 余额，但 pUSD 余额是 0，程序会在买入前提示余额不足。此时需要先在 Polymarket 官方界面或官方支持的流程中完成资金迁移/wrap，再运行实盘 bot。

程序启动时还会尝试刷新 CLOB V2 的 collateral allowance。正常日志里应该能看到：

```text
CLOB signature type: 2 (POLY_GNOSIS_SAFE)
CLOB client initialized (V2)
CLOB collateral allowance refreshed
pUSD Balance: $...
```

如果你的钱包是新版 deposit wallet flow，`CLOB_SIGNATURE_TYPE=2` 仍然下单失败时，可以再试 `CLOB_SIGNATURE_TYPE=3`。不要同时改私钥和 proxy wallet；一次只改一个变量，方便判断问题。

## DRY_RUN

```env
DRY_RUN=true
```

表示模拟运行，不会真实下单。

```env
DRY_RUN=false
```

表示实盘运行，程序可能真实提交买入、卖出、取消订单等请求。

建议流程：

1. 先用 `DRY_RUN=true` 跑通监听和日志。
2. 确认目标钱包、金额、策略都没问题。
3. 再改成 `DRY_RUN=false` 实盘运行。

## 跟单金额配置

实盘跟单的买入金额由以下三个配置共同决定：

```env
SIZE_MODE=percentage
SIZE_PERCENT=100
MAX_POSITION_SIZE=2
```

当前代码中，`SIZE_MODE=percentage` 时：

```text
每次买入金额 = MAX_POSITION_SIZE × SIZE_PERCENT%
```

所以：

```text
2 × 100% = 2U
```

这就是“每单跟 2U”的配置方式。

### SIZE_MODE=percentage

```env
SIZE_MODE=percentage
SIZE_PERCENT=100
MAX_POSITION_SIZE=2
```

含义：

- 每次目标钱包买入时，程序尝试跟 2U。
- 同一个目标钱包 + 同一个具体选项/token 最多跟到 2U。
- 如果目标钱包在同一个具体选项连续加仓，你最多跟到 2U，不会无限追加。
- 如果同一个主题下面还有其他选项，它们会各自独立计算 2U 上限。

适合想固定每个具体选项投入金额的方式。

### SIZE_MODE=balance

```env
SIZE_MODE=balance
SIZE_PERCENT=10
MAX_POSITION_SIZE=2
```

含义：

- 每次买入金额先按当前真实 pUSD 余额的 10% 计算。
- 但最终仍受 `MAX_POSITION_SIZE` 限制。
- 如果余额是 20U，10% 是 2U，所以每次会尝试跟 2U。
- 如果余额变成 10U，10% 是 1U，则每次会尝试跟 1U。

如果你想“每单固定 2U”，优先用 `percentage` 模式更直接。

## MIN_TRADE_SIZE

```env
MIN_TRADE_SIZE=1
```

表示计算出来的跟单金额低于 1U 时跳过。

Polymarket CLOB 本身也有最小订单限制，配置太低可能导致订单被拒绝。通常保持 `1` 更稳。

## MAX_POSITION_SIZE

```env
MAX_POSITION_SIZE=2
```

表示每个目标钱包在每个具体选项/token 上最多投入多少 pUSD。

注意：这不是整个钱包的总开仓上限，也不是整个主题的总上限，而是“同一个目标钱包 + 同一个具体选项/token”的上限。

如果配置为：

```env
MAX_POSITION_SIZE=2
```

含义就是：

```text
同一个目标钱包 + 同一个具体选项/token 最多跟 2U。
```

所以如果一个主题下面有多个选项，比如 A、B、C：

- 买 A 最多 2U。
- 买 B 最多 2U。
- 买 C 最多 2U。
- 不会因为 A 已经买满 2U，就阻止 B/C 继续跟单。
- 但如果 A 已经买满 2U，后续目标钱包继续买 A，就会被上限拦住。

例如：

- 主题 A 的选项 Yes 最多 2U。
- 同一个主题 A 的另一个选项 No 也可以再开 2U。
- 如果同时跟了 10 个不同选项，总开仓成本可能达到 20U。

## 自动卖出配置

### AUTO_SELL_ENABLED=false

```env
AUTO_SELL_ENABLED=false
SELL_MODE=market
```

这是纯跟单模式推荐配置。

含义：

- 目标钱包 BUY，你跟着 BUY。
- 目标钱包 SELL，你跟着 SELL。
- 程序不会在你买入后自己提前挂止盈单。

这样最接近“复制目标钱包行为”。

### AUTO_SELL_ENABLED=true

```env
AUTO_SELL_ENABLED=true
AUTO_SELL_PROFIT_PERCENT=10
```

意思是：你买入后，程序会自动挂一个止盈卖单。

例如：

```env
AUTO_SELL_ENABLED=true
AUTO_SELL_PROFIT_PERCENT=10
```

如果你跟单买入价格是 `0.20`，程序会尝试挂一个约 `0.22` 的限价卖单，也就是高 10%。

这会带来一个重要变化：

- 目标钱包还没卖，你可能已经因为自动止盈成交而卖掉。
- 后面目标钱包真正 SELL 时，你本地可能已经没有仓位。
- 策略会变成“跟买 + 自己止盈”，不是纯粹复制目标钱包。

因此，刚开始实盘跟单建议：

```env
AUTO_SELL_ENABLED=false
```

只有当你明确想做“跟买后达到利润就提前卖”时，再打开：

```env
AUTO_SELL_ENABLED=true
AUTO_SELL_PROFIT_PERCENT=10
```

## SELL_MODE

```env
SELL_MODE=market
```

当目标钱包卖出时，你用市价方式卖出，尽量快速退出。

```env
SELL_MODE=limit
```

当目标钱包卖出时，你按目标钱包卖出价格挂限价单。

区别：

- `market` 更容易成交，但价格可能有滑点。
- `limit` 价格更可控，但可能挂单不成交。

纯跟单刚开始建议：

```env
SELL_MODE=market
```

## 时间和重试配置

### MIN_MARKET_TIME_LEFT

```env
MIN_MARKET_TIME_LEFT=300
```

表示如果市场距离结束少于 300 秒，程序跳过买入。

这样可以避免刚跟进去市场就结束，导致无法及时卖出或流动性很差。

### REDEEM_INTERVAL

```env
REDEEM_INTERVAL=60
```

表示每 60 秒检查一次是否有可以赎回的已结算仓位。

### GTC_FALLBACK_TIMEOUT

```env
GTC_FALLBACK_TIMEOUT=60
```

当市价 FAK 订单没有流动性时，程序会尝试挂 GTC 限价买单并等待成交。这个值表示最多等待多少秒。

## Web dashboard 配置

```env
WEB_HOST=0.0.0.0
WEB_PORT=8787
```

含义：

- `WEB_HOST=0.0.0.0`：允许外部浏览器访问 dashboard。
- `WEB_PORT=8787`：dashboard 端口。

如果直接运行：

```bash
npm run bot
```

默认 dashboard 地址是：

```text
http://你的VPS_IP:8787
```

如果用 Docker 实盘：

```bash
docker compose --profile live up -d --build live-bot
```

dashboard 地址是：

```text
http://你的VPS_IP:8788
```

因为 compose 里为了避免和 `multi-watch` 冲突，把 `live-bot` 的端口覆盖成了 `8788`。

## Postgres 配置

```env
DATABASE_URL=postgres://polymarket:polymarket_dev_password@127.0.0.1:15432/polymarket_terminal
```

这个主要给 `npm run multi-watch` 的模拟盈亏记录使用。

Docker 运行 `multi-watch` 时，compose 会自动覆盖为容器内地址：

```text
postgres://polymarket:polymarket_dev_password@postgres:5432/polymarket_terminal
```

实盘 `npm run bot` 当前主要显示实时状态和日志，不依赖 Postgres 记录历史盈亏。

## 推荐配置模板

### 纯模拟多钱包 dashboard

```env
DRY_RUN=true
TRADER_ADDRESSES=0x钱包1,0x钱包2
SIM_START_BALANCE=500
SIZE_MODE=percentage
SIZE_PERCENT=100
MAX_POSITION_SIZE=10
MIN_TRADE_SIZE=1
WEB_HOST=0.0.0.0
WEB_PORT=8787
```

运行：

```bash
docker compose --profile simulation up -d --build
```

### 实盘单钱包跟单，每单 2U

```env
DRY_RUN=false
PRIVATE_KEY=你的EOA私钥
PROXY_WALLET_ADDRESS=你的Polymarket proxy wallet地址
TRADER_ADDRESS=目标钱包地址
SIZE_MODE=percentage
SIZE_PERCENT=100
MAX_POSITION_SIZE=2
MIN_TRADE_SIZE=1
AUTO_SELL_ENABLED=false
SELL_MODE=market
WEB_HOST=0.0.0.0
```

运行：

```bash
docker compose --profile live up -d --build live-bot
```

dashboard：

```text
http://你的VPS_IP:8788
```
