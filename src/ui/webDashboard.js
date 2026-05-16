import http from 'http';
import { getPnlReport } from '../services/pnlLedger.js';

const MAX_LOGS = 2000;

let server = null;
let currentState = {
    accounts: [],
    config: {},
    pnl: { enabled: false, summary: null, byWallet: [], trades: [], snapshots: [] },
    updatedAt: new Date().toISOString(),
};
const logs = [];
const clients = new Set();

function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
    });
    res.end(body);
}

function sendHtml(res) {
    const body = html();
    res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
    });
    res.end(body);
}

function sendEvent(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function textFromBlessedTags(value) {
    return String(value)
        .replace(/\{\/?[a-z,-]+(?:-fg|-bg)?\}/gi, '')
        .replace(/\{\/?bold\}/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseLogLevel(text) {
    const match = text.match(/\b(INFO|SUCCESS|WARN|ERROR|TRADE|WATCH|MONEY)\b/);
    return match ? match[1].toLowerCase() : 'info';
}

function appendLog(rawText) {
    const text = textFromBlessedTags(rawText);
    if (!text) return;

    const item = {
        id: Date.now() + Math.random(),
        at: new Date().toISOString(),
        level: parseLogLevel(text),
        text,
    };
    logs.push(item);
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);

    for (const client of clients) {
        sendEvent(client, 'log', item);
    }
}

function publicConfig(config) {
    return {
        sizeMode: config.sizeMode,
        sizePercent: config.sizePercent,
        minTradeSize: config.minTradeSize,
        maxPositionSize: config.maxPositionSize,
        simStartBalance: config.simStartBalance,
        webHost: config.webHost,
        webPort: config.webPort,
        pnlHistoryLimit: config.pnlHistoryLimit,
        pnlSnapshotIntervalMs: config.pnlSnapshotIntervalMs,
    };
}

async function setDashboardState(accounts, config) {
    const pnl = await getPnlReport(config.pnlHistoryLimit);
    currentState = {
        accounts,
        config: publicConfig(config),
        totals: summarize(accounts, config),
        pnl,
        updatedAt: new Date().toISOString(),
    };

    for (const client of clients) {
        sendEvent(client, 'state', currentState);
    }
}

function summarize(accounts, config) {
    const totalStart = accounts.reduce((sum, account) => sum + (account.startBalance || config.simStartBalance), 0);
    const totalCash = accounts.reduce((sum, account) => sum + account.cash, 0);
    const totalOpenCost = accounts.reduce((sum, account) => sum + account.openCost, 0);
    const totalEquity = accounts.reduce((sum, account) => sum + account.equity, 0);

    return {
        totalStart,
        totalCash,
        totalOpenCost,
        totalEquity,
        totalPnl: totalEquity - totalStart,
        walletCount: accounts.length,
        openPositions: accounts.reduce((sum, account) => sum + account.positions.length, 0),
        totalBuys: accounts.reduce((sum, account) => sum + account.totalBuys, 0),
        totalSells: accounts.reduce((sum, account) => sum + account.totalSells, 0),
    };
}

function handleEvents(req, res) {
    res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
    });
    res.write('\n');

    clients.add(res);
    sendEvent(res, 'state', currentState);
    for (const log of logs.slice(-300)) {
        sendEvent(res, 'log', log);
    }

    req.on('close', () => clients.delete(res));
}

function requestHandler(req, res) {
    try {
        const url = new URL(req.url || '/', 'http://localhost');
        if (url.pathname === '/') {
            sendHtml(res);
            return;
        }
        if (url.pathname === '/api/state') {
            sendJson(res, 200, { ...currentState, logs: logs.slice(-300) });
            return;
        }
        if (url.pathname === '/events') {
            handleEvents(req, res);
            return;
        }
        sendJson(res, 404, { error: 'not found' });
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}

export function startWebDashboard(config) {
    if (server) return Promise.resolve(server);

    server = http.createServer(requestHandler);
    server.on('clientError', (_err, socket) => {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });

    return new Promise((resolve, reject) => {
        const onError = (err) => {
            server = null;
            reject(err);
        };
        server.once('error', onError);
        server.listen(config.webPort, config.webHost, () => {
            server.off('error', onError);
            resolve(server);
        });
    });
}

export function stopWebDashboard() {
    for (const client of clients) {
        client.end();
    }
    clients.clear();

    if (!server) return;
    server.close();
    server = null;
}

export { appendLog as appendWebLog, setDashboardState as updateWebDashboard };

function html() {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Polymarket Multi-Watch</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f1115;
      --panel: #171a21;
      --panel-2: #1f2430;
      --text: #e7e9ee;
      --muted: #9ba3b4;
      --line: #2d3442;
      --green: #39d98a;
      --red: #ff6b6b;
      --yellow: #ffd166;
      --blue: #64b5f6;
      --purple: #c084fc;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      letter-spacing: 0;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      background: rgba(15, 17, 21, 0.96);
      backdrop-filter: blur(10px);
    }
    h1 {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
      font-weight: 700;
    }
    .subtle { color: var(--muted); }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      white-space: nowrap;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--yellow);
    }
    .dot.live { background: var(--green); }
    main {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(380px, 0.85fr);
      gap: 14px;
      padding: 14px;
      min-height: calc(100vh - 56px);
    }
    section {
      min-width: 0;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .metric, .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .metric {
      min-height: 78px;
      padding: 12px;
    }
    .label {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
      margin-bottom: 6px;
    }
    .value {
      font-size: 22px;
      line-height: 1.2;
      font-weight: 750;
      overflow-wrap: anywhere;
    }
    .green { color: var(--green); }
    .red { color: var(--red); }
    .panel {
      overflow: hidden;
      margin-bottom: 14px;
    }
    .panel-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 11px 12px;
      border-bottom: 1px solid var(--line);
      background: var(--panel-2);
      font-weight: 700;
    }
    .panel-body { padding: 12px; }
    .wallets {
      display: grid;
      gap: 10px;
    }
    .wallet {
      display: grid;
      grid-template-columns: minmax(120px, 1fr) repeat(4, minmax(80px, 0.7fr));
      gap: 10px;
      align-items: center;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #131720;
    }
    .addr {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      overflow-wrap: anywhere;
    }
    .small { font-size: 12px; color: var(--muted); }
    .positions {
      display: grid;
      gap: 8px;
      max-height: 42vh;
      overflow: auto;
      padding-right: 4px;
    }
    .position {
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #131720;
    }
    .market {
      font-weight: 650;
      line-height: 1.35;
      margin-bottom: 7px;
      overflow-wrap: anywhere;
    }
    .pnl-ledger {
      display: grid;
      gap: 10px;
    }
    .ledger-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .ledger-item {
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #131720;
    }
    .trade-history {
      max-height: 260px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .trade-row {
      display: grid;
      grid-template-columns: 76px 88px minmax(140px, 1fr) 82px;
      gap: 8px;
      align-items: start;
      padding: 8px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .trade-row:last-child { border-bottom: 0; }
    .logs {
      height: calc(100vh - 96px);
      min-height: 520px;
      display: flex;
      flex-direction: column;
    }
    .log-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    button {
      height: 30px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #12161f;
      color: var(--text);
      cursor: pointer;
    }
    button:hover { border-color: #566174; }
    #logList {
      flex: 1;
      overflow: auto;
      padding: 10px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.55;
      background: #0b0d12;
    }
    .log-line {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      padding: 3px 0;
    }
    .level-error { color: var(--red); }
    .level-warn { color: var(--yellow); }
    .level-success, .level-money { color: var(--green); }
    .level-trade { color: var(--purple); }
    .level-watch { color: var(--blue); }
    .empty {
      color: var(--muted);
      padding: 12px;
    }
    @media (max-width: 980px) {
      main { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .logs { height: 70vh; min-height: 420px; }
      .wallet { grid-template-columns: 1fr 1fr; }
      .ledger-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .trade-row { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      header { align-items: flex-start; flex-direction: column; }
      .metrics { grid-template-columns: 1fr; }
      .wallet { grid-template-columns: 1fr; }
      .ledger-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Polymarket Multi-Watch</h1>
      <div class="subtle">simulation dashboard</div>
    </div>
    <div class="status"><span id="dot" class="dot"></span><span id="status">connecting</span></div>
  </header>
  <main>
    <section>
      <div class="metrics">
        <div class="metric"><div class="label">Total Equity</div><div id="totalEquity" class="value">$0.00</div></div>
        <div class="metric"><div class="label">Total PnL</div><div id="totalPnl" class="value">$0.00</div></div>
        <div class="metric"><div class="label">Cash</div><div id="totalCash" class="value">$0.00</div></div>
        <div class="metric"><div class="label">Open Cost</div><div id="openCost" class="value">$0.00</div></div>
      </div>
      <div class="panel">
        <div class="panel-title">
          <span>Wallets</span>
          <span id="settings" class="small"></span>
        </div>
        <div id="wallets" class="panel-body wallets"><div class="empty">Waiting for state...</div></div>
      </div>
      <div class="panel">
        <div class="panel-title">
          <span>Open Positions</span>
          <span id="updatedAt" class="small"></span>
        </div>
        <div id="positions" class="panel-body positions"><div class="empty">No open positions</div></div>
      </div>
      <div class="panel">
        <div class="panel-title">
          <span>Persisted PnL</span>
          <span id="ledgerStatus" class="small"></span>
        </div>
        <div id="ledger" class="panel-body pnl-ledger"><div class="empty">Waiting for database...</div></div>
      </div>
    </section>
    <section class="panel logs">
      <div class="panel-title">
        <span>Live Logs</span>
        <div class="log-toolbar">
          <button id="toggleScroll" type="button">Auto scroll: on</button>
          <button id="clearLogs" type="button">Clear</button>
        </div>
      </div>
      <div id="logList"></div>
    </section>
  </main>
  <script>
    const els = {
      dot: document.getElementById('dot'),
      status: document.getElementById('status'),
      totalEquity: document.getElementById('totalEquity'),
      totalPnl: document.getElementById('totalPnl'),
      totalCash: document.getElementById('totalCash'),
      openCost: document.getElementById('openCost'),
      settings: document.getElementById('settings'),
      wallets: document.getElementById('wallets'),
      positions: document.getElementById('positions'),
      updatedAt: document.getElementById('updatedAt'),
      ledger: document.getElementById('ledger'),
      ledgerStatus: document.getElementById('ledgerStatus'),
      logList: document.getElementById('logList'),
      toggleScroll: document.getElementById('toggleScroll'),
      clearLogs: document.getElementById('clearLogs'),
    };
    let autoScroll = true;

    function money(value, signed = false) {
      const number = Number(value || 0);
      const sign = signed && number > 0 ? '+' : '';
      return sign + '$' + number.toFixed(2);
    }

    function shortAddr(addr) {
      if (!addr) return '';
      return addr.slice(0, 6) + '...' + addr.slice(-4);
    }

    function setPnlClass(node, value) {
      node.classList.toggle('green', Number(value) >= 0);
      node.classList.toggle('red', Number(value) < 0);
    }

    function renderState(state) {
      const totals = state.totals || {};
      els.totalEquity.textContent = money(totals.totalEquity);
      els.totalPnl.textContent = money(totals.totalPnl, true);
      setPnlClass(els.totalPnl, totals.totalPnl);
      els.totalCash.textContent = money(totals.totalCash);
      els.openCost.textContent = money(totals.totalOpenCost);

      const cfg = state.config || {};
      els.settings.textContent = 'Size ' + (cfg.sizeMode || '-') + ' ' + (cfg.sizePercent ?? '-') + '% | Cap ' + money(cfg.maxPositionSize);
      els.updatedAt.textContent = state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString() : '';

      const accounts = state.accounts || [];
      if (accounts.length === 0) {
        els.wallets.innerHTML = '<div class="empty">No wallets configured</div>';
      } else {
        els.wallets.replaceChildren(...accounts.map(renderWallet));
      }

      const positions = [];
      for (const account of accounts) {
        for (const position of account.positions || []) {
          positions.push({ account, position });
        }
      }
      if (positions.length === 0) {
        els.positions.innerHTML = '<div class="empty">No open positions</div>';
      } else {
        els.positions.replaceChildren(...positions.map(renderPosition));
      }
      renderLedger(state.pnl || {});
    }

    function renderWallet(account) {
      const node = document.createElement('div');
      node.className = 'wallet';
      const pnlClass = Number(account.totalPnl || 0) >= 0 ? 'green' : 'red';
      node.innerHTML =
        '<div><div class="addr">' + escapeHtml(shortAddr(account.address)) + '</div><div class="small">' + escapeHtml(account.address) + '</div></div>' +
        '<div><div class="small">Equity</div><strong>' + money(account.equity) + '</strong></div>' +
        '<div><div class="small">PnL</div><strong class="' + pnlClass + '">' + money(account.totalPnl, true) + '</strong></div>' +
        '<div><div class="small">Cash</div><strong>' + money(account.cash) + '</strong></div>' +
        '<div><div class="small">Open</div><strong>' + (account.positions || []).length + ' / ' + money(account.openCost) + '</strong></div>';
      return node;
    }

    function renderLedger(pnl) {
      if (!pnl.enabled) {
        els.ledgerStatus.textContent = 'disabled';
        els.ledger.innerHTML = '<div class="empty">DATABASE_URL is not connected. Start Postgres and restart multi-watch.</div>';
        return;
      }

      els.ledgerStatus.textContent = 'Postgres connected';
      const summary = pnl.summary || {};
      const realized = Number(summary.realized_pnl || 0);
      const realizedClass = realized >= 0 ? 'green' : 'red';
      const trades = pnl.trades || [];
      const latestSnapshot = (pnl.snapshots || [])[0];

      const wrapper = document.createElement('div');
      wrapper.className = 'pnl-ledger';
      wrapper.innerHTML =
        '<div class="ledger-grid">' +
          '<div class="ledger-item"><div class="label">DB Realized PnL</div><div class="value ' + realizedClass + '">' + money(realized, true) + '</div></div>' +
          '<div class="ledger-item"><div class="label">Buy Volume</div><div class="value">' + money(summary.buy_volume) + '</div></div>' +
          '<div class="ledger-item"><div class="label">Sell Volume</div><div class="value">' + money(summary.sell_volume) + '</div></div>' +
          '<div class="ledger-item"><div class="label">Recorded Trades</div><div class="value">' + Number((summary.total_buys || 0) + (summary.total_sells || 0)) + '</div></div>' +
        '</div>' +
        '<div class="small">Latest snapshot: ' + (latestSnapshot ? new Date(latestSnapshot.created_at).toLocaleString() + ' | equity ' + money(latestSnapshot.total_equity) + ' | pnl ' + money(latestSnapshot.total_pnl, true) : 'none') + '</div>';

      const history = document.createElement('div');
      history.className = 'trade-history';
      if (trades.length === 0) {
        history.innerHTML = '<div class="empty">No recorded trades yet</div>';
      } else {
        history.replaceChildren(...trades.slice(0, 20).map(renderLedgerTrade));
      }
      wrapper.appendChild(history);
      els.ledger.replaceChildren(wrapper);
    }

    function renderLedgerTrade(trade) {
      const pnl = Number(trade.pnl || 0);
      const pnlClass = pnl >= 0 ? 'green' : 'red';
      const node = document.createElement('div');
      node.className = 'trade-row';
      node.innerHTML =
        '<div><strong>' + escapeHtml(trade.action || '') + '</strong><div class="small">' + new Date(trade.created_at).toLocaleTimeString() + '</div></div>' +
        '<div class="addr">' + escapeHtml(shortAddr(trade.trader_address)) + '</div>' +
        '<div><div class="market">' + escapeHtml(trade.market || '') + '</div><div class="small">' + escapeHtml(trade.outcome || '?') + ' | ' + Number(trade.shares || 0).toFixed(3) + ' sh @ $' + Number(trade.price || 0).toFixed(3) + '</div></div>' +
        '<div><strong class="' + pnlClass + '">' + money(pnl, true) + '</strong><div class="small">' + (trade.action === 'BUY' ? money(trade.cost) : money(trade.proceeds)) + '</div></div>';
      return node;
    }

    function renderPosition(item) {
      const pos = item.position;
      const node = document.createElement('div');
      node.className = 'position';
      node.innerHTML =
        '<div class="market">' + escapeHtml(pos.market || pos.tokenId || '') + '</div>' +
        '<div class="small">' + shortAddr(item.account.address) + ' | ' +
        escapeHtml(pos.outcome || '?') + ' | ' +
        Number(pos.shares || 0).toFixed(3) + ' sh @ $' +
        Number(pos.avgBuyPrice || 0).toFixed(3) + ' | cost ' +
        money(pos.totalCost) + '</div>';
      return node;
    }

    function addLog(log) {
      const node = document.createElement('div');
      node.className = 'log-line level-' + (log.level || 'info');
      node.textContent = log.text || '';
      els.logList.appendChild(node);
      while (els.logList.children.length > 1200) {
        els.logList.firstChild.remove();
      }
      if (autoScroll) els.logList.scrollTop = els.logList.scrollHeight;
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[ch]));
    }

    els.toggleScroll.addEventListener('click', () => {
      autoScroll = !autoScroll;
      els.toggleScroll.textContent = 'Auto scroll: ' + (autoScroll ? 'on' : 'off');
    });
    els.clearLogs.addEventListener('click', () => {
      els.logList.replaceChildren();
    });

    const events = new EventSource('/events');
    events.addEventListener('open', () => {
      els.dot.classList.add('live');
      els.status.textContent = 'connected';
    });
    events.addEventListener('error', () => {
      els.dot.classList.remove('live');
      els.status.textContent = 'reconnecting';
    });
    events.addEventListener('state', (event) => renderState(JSON.parse(event.data)));
    events.addEventListener('log', (event) => addLog(JSON.parse(event.data)));
  </script>
</body>
</html>`;
}
