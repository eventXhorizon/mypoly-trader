# 当前版本运行模式说明

本文档说明当前代码版本是否具备真实开仓跟单能力，以及 VPS 上应该运行哪个入口。

## 结论

当前新增的多钱包版本 `npm run multi-watch` 是纯模拟模式：

- 可以同时追踪多个目标钱包。
- 可以用虚拟初始资金模拟开仓、平仓和盈亏。
- 可以通过 Web dashboard 查看日志、仓位、总权益、总盈亏。
- 可以把模拟交易和盈亏快照写入 Postgres。
- 不读取真实链上余额。
- 不需要私钥。
- 不需要自己的 Polymarket proxy wallet。
- 不会提交真实订单。

也就是说，`npm run multi-watch` 目前不具备真实开仓跟单能力。

## 命令区别

| 命令 | 模式 | 是否真实下单 | 说明 |
| --- | --- | --- | --- |
| `npm run multi-watch` | 多钱包模拟 | 否 | 推荐当前使用。多钱包追踪、dashboard、Postgres 记录。 |
| `npm run bot-sim` | 单钱包模拟 | 否 | 老版本单钱包模拟入口。 |
| `npm start` | 单钱包 TUI | 可能会 | 老版本单钱包入口。如果 `.env` 填了私钥、proxy wallet 且 `DRY_RUN` 不是 `true`，可能真实下单。 |
| `npm run bot` | 单钱包命令行 | 可能会 | 老版本单钱包入口，适合 PM2/VPS。如果非 dry-run，可能真实下单。 |

## 为什么 multi-watch 不会真实下单

`src/multi-watch.js` 的交易处理逻辑只调用模拟账户和数据库记录：

```js
const result = applyPaperTrade(trade);
await recordPnlTrade(trade, result, logger);
```

它不会调用真实下单函数：

```js
executeBuy(trade)
executeSell(trade)
```

启动日志也会显示：

```text
No private key, no proxy wallet, no real orders.
```

这说明当前多钱包入口被设计成只做 paper trading。

## 哪些代码仍然有真实交易能力

项目里老的单钱包入口仍然保留真实交易能力。

`src/index.js` 和 `src/bot.js` 会在监听到目标钱包交易时调用：

```js
executeBuy(trade)
executeSell(trade)
```

真实买入逻辑在 `src/services/executor.js`，非 dry-run 时会调用 Polymarket CLOB：

```js
client.createAndPostMarketOrder(...)
```

因此，只要运行的是 `npm start` 或 `npm run bot`，并且 `.env` 中配置了真实私钥、proxy wallet，且 `DRY_RUN` 不是 `true`，就需要按真实交易程序对待。

## VPS 推荐运行方式

当前建议在 VPS 上运行多钱包模拟版本：

```bash
npm run db:up
npm run multi-watch
```

如果不想用 `tmux`，推荐直接用 Docker Compose 跑：

```bash
docker compose --profile simulation up -d --build
```

这会启动：

- `postgres`：保存模拟交易和盈亏快照。
- `multi-watch`：多钱包模拟 watcher + Web dashboard。

查看日志：

```bash
docker compose logs -f multi-watch
```

停止：

```bash
docker compose down
```

dashboard 默认地址：

```text
http://你的VPS_IP:8787
```

容器会挂载本地目录：

```text
./data:/app/data
./logs:/app/logs
```

所以 dashboard 保存的配置、模拟仓位、日志会留在 VPS 项目目录里，不会因为容器重建而丢失。

如果用 `tmux` 持续运行：

```bash
tmux new -s poly
npm run multi-watch
```

断开 SSH 前按：

```text
Ctrl+B
D
```

重新连接：

```bash
tmux attach -t poly
```

dashboard 默认地址：

```text
http://你的VPS_IP:8787
```

## Docker 运行实盘 bot

默认不要直接用 profile 混跑。模拟和实盘已经拆成两个 profile：

- `simulation`：启动 `postgres` + `multi-watch` 模拟 dashboard。
- `live`：启动 `live-bot` 实盘单钱包跟单 dashboard。

如果要用 Docker 跑实盘单钱包跟单，需要显式启动 `live` profile：

```bash
docker compose --profile live up -d --build live-bot
```

查看实盘 bot 日志：

```bash
docker compose logs -f live-bot
```

实盘 bot 也会启动 Web dashboard。Docker 里默认映射到：

```text
http://你的VPS_IP:8788
```

停止实盘 bot：

```bash
docker compose stop live-bot
```

实盘前 `.env` 必须确认：

```env
DRY_RUN=false
PRIVATE_KEY=你的EOA私钥
PROXY_WALLET_ADDRESS=你的Polymarket proxy wallet地址
CLOB_SIGNATURE_TYPE=2
TRADER_ADDRESS=你要跟单的目标钱包地址
SIZE_MODE=percentage
SIZE_PERCENT=100
MAX_POSITION_SIZE=2
MIN_TRADE_SIZE=1
```

注意：当前实盘入口使用 Polymarket CLOB V2。V2 下单余额是 pUSD，不是旧版 USDC.e。程序启动时日志会显示 `pUSD Balance`；如果这里是 0，即使旧 USDC.e 地址有余额也不能下单，需要先完成 pUSD 资金准备。

如果之前看到 `order_version_mismatch`，说明旧版 V1 订单被新的 CLOB 拒绝。新版本实盘跟单入口已经改用 `@polymarket/clob-client-v2`，启动后需要确认日志包含 `CLOB client initialized (V2)`。

注意：`live-bot` 的 Web dashboard 只显示单钱包实盘/模拟状态、仓位和日志，不提供多钱包模拟配置表单。多钱包配置表单只属于 `multi-watch` 模拟模式。

## Dashboard 页面跳转

当前 Web dashboard 支持跨页面入口：

- `live-bot` 页面顶部会显示 `Multi-Watch` 链接。
- `multi-watch` 页面顶部会显示 `Live Bot` 链接。

这只是浏览器导航链接，不会把两个服务的数据流混在一起：

- live 页面仍然只显示实盘 bot 状态、仓位和日志。
- multi-watch 页面仍然只显示多钱包模拟、目标钱包 paper PnL 和 wallet analytics。
- live 页面不会读取 multi-watch 的分析表。
- multi-watch 页面不会触发 live 下单。

Docker 默认端口：

```text
multi-watch: http://你的VPS_IP:8787
live-bot   : http://你的VPS_IP:8788
```

如果你用了反向代理或自定义域名，可以在 `.env` 中显式设置：

```env
MULTI_WATCH_DASHBOARD_URL=https://你的域名/multi-watch
LIVE_DASHBOARD_URL=https://你的域名/live
```

## Dashboard 配置项说明

`npm run multi-watch` 启动后，可以在 Web dashboard 的 `Simulation Settings` 区域直接修改目标钱包和模拟跟单金额。保存后会立即影响后续新交易，并持久化到：

```text
data/multi_watch_settings.json
```

`.env` 里的同名配置只是默认值；dashboard 保存过之后，程序会优先使用 dashboard 保存的配置。

| 配置项 | 含义 | 示例 |
| --- | --- | --- |
| `Target wallets` | 要追踪的目标 Polymarket 钱包地址。可以填多个地址，一行一个或用逗号分隔。 | `0x57ee...8112` |
| `Start balance` | 每个目标钱包对应的模拟初始资金，不是真实链上余额。 | `500` 表示每个目标钱包从 500U 模拟开始 |
| `Size mode` | 模拟买入金额的计算方式。支持 `percentage` 和 `balance`。 | 推荐先用 `percentage` |
| `Size percent` | 跟单比例。具体含义取决于 `Size mode`。 | `100` 表示 100% |
| `Max per outcome` | 每个目标钱包、每个具体选项/token 最多投入多少模拟资金。 | `10` 表示同一个选项最多投入 10U |
| `Min trade` | 单次模拟买入低于这个金额时跳过。Polymarket 真实 CLOB 通常也有最小订单限制，模拟里默认至少按 1U 处理。 | `1` |

### Size mode = percentage

`percentage` 表示每次模拟买入金额按 `Max per outcome × Size percent` 计算，并且仍然受 `Max per outcome` 总上限限制。

例如：

```text
Start balance = 500
Size mode = percentage
Size percent = 100
Max per outcome = 10
Min trade = 1
```

含义是：

- 每个目标钱包初始模拟资金是 500U。
- 每次目标钱包买入时，程序尝试模拟买入 `10 × 100% = 10U`。
- 同一个目标钱包在同一个具体选项下，总投入最多 10U。
- 如果这个选项之前已经模拟买入 8U，后续同选项最多只能再追加 2U。
- 如果同一主题下面还有另一个选项，它会独立计算 10U 上限。
- 如果可追加金额低于 `Min trade`，这次买入会被跳过。

这适合你想要的模式：比如初始资金 500U，追踪多个钱包，每个选项最多模拟投入 10U，运行一段时间后看总盈亏。

### Size mode = balance

`balance` 表示每次模拟买入金额按当前剩余模拟现金的百分比计算，但仍然受 `Max per outcome` 限制。

例如：

```text
Start balance = 500
Size mode = balance
Size percent = 10
Max per outcome = 10
Min trade = 1
```

含义是：

- 初始模拟现金是 500U。
- 每次目标钱包买入时，理论买入金额是当前现金的 10%。
- 500U 的 10% 是 50U，但因为 `Max per outcome = 10`，最终同一选项最多只能买 10U。
- 随着模拟现金变化，后续理论买入金额也会变化。

如果你希望每个选项固定最多 10U，通常用 `percentage + Size percent = 100 + Max per outcome = 10` 更直观。

### Max per outcome 的范围

`Max per outcome` 是“每个目标钱包 + 每个具体选项/token”的上限，不是整个钱包的总开仓上限，也不是整个主题的总上限。

如果设置为：

```text
Max per outcome = 2
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

例如同时追踪两个钱包：

```text
Target wallets = A, B
Max per outcome = 10
```

那么：

- 钱包 A 在主题 X 的选项 1 最多模拟投入 10U。
- 钱包 A 在主题 X 的选项 2 也可以再投入 10U。
- 钱包 B 在主题 X 的选项 1 也可以独立投入 10U。

因此，多个钱包、多个主题同时出现时，总开仓成本可能超过 10U，这是正常的。

## 安全建议

如果只想模拟，不想发生真实交易：

- 使用 `npm run multi-watch`。
- 不要运行 `npm start`。
- 不要运行 `npm run bot`。
- `.env` 中可以不填写 `PRIVATE_KEY` 和 `PROXY_WALLET_ADDRESS`。
- 如果保留私钥，也建议确认 `DRY_RUN=true`，避免误跑老入口。

更安全的做法是 dashboard 只监听本机：

```env
WEB_HOST=127.0.0.1
```

然后通过 SSH 隧道访问：

```bash
ssh -L 8787:127.0.0.1:8787 root@你的VPS_IP
```

本地浏览器打开：

```text
http://127.0.0.1:8787
```

## 如果未来要做多钱包真实跟单

当前还没有实现“多钱包 dashboard + Postgres + 真实下单”。

要实现这个能力，至少需要补充：

- 多钱包模拟逻辑和真实 executor 的切换开关。
- 明确的 `LIVE_TRADING=true` 二次确认，避免误下单。
- 真实下单前的余额、授权、最小订单金额、滑点检查。
- 每个目标钱包独立的风控配置。
- 真实订单、失败订单、部分成交、取消订单的数据库记录。
- dashboard 明确区分 simulation 和 live trading。
- 防止重复事件导致重复下单的幂等保护。

在这些能力完成前，`multi-watch` 应按纯模拟程序使用。
