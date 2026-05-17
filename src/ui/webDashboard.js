import http from 'http';
import { getPnlReport } from '../services/pnlLedger.js';
import { getWalletAnalyticsReport } from '../services/walletScorer.js';

const MAX_LOGS = 2000;
const MAX_JSON_BODY_BYTES = 32 * 1024;

let server = null;
let dashboardActions = {};
let currentState = {
    accounts: [],
    config: {},
    pnl: { enabled: false, summary: null, byWallet: [], trades: [], snapshots: [] },
    analytics: { enabled: false, wallets: [] },
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

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
            body += chunk;
            if (Buffer.byteLength(body) > MAX_JSON_BODY_BYTES) {
                reject(new Error('Request body is too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            if (!body.trim()) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error('Request body must be valid JSON'));
            }
        });
        req.on('error', reject);
    });
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

    process.stdout.write(`${text}\n`);

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
        mode: config.dashboardMode || 'simulation',
        title: config.dashboardTitle || 'Polymarket Multi-Watch',
        subtitle: config.dashboardSubtitle || 'simulation dashboard',
        traderAddresses: config.traderAddresses,
        traderAddress: config.traderAddress,
        proxyWallet: config.proxyWallet,
        dryRun: config.dryRun,
        sizeMode: config.sizeMode,
        sizePercent: config.sizePercent,
        minTradeSize: config.minTradeSize,
        maxPositionSize: config.maxPositionSize,
        simStartBalance: config.simStartBalance,
        webHost: config.webHost,
        webPort: config.webPort,
        multiWatchDashboardUrl: config.multiWatchDashboardUrl,
        liveDashboardUrl: config.liveDashboardUrl,
        pnlHistoryLimit: config.pnlHistoryLimit,
        pnlSnapshotIntervalMs: config.pnlSnapshotIntervalMs,
    };
}

async function setDashboardState(accounts, config) {
    const mode = config.dashboardMode || 'simulation';
    const pnl = mode === 'multi-watch'
        ? await getPnlReport(config.pnlHistoryLimit)
        : { enabled: false, summary: null, byWallet: [], trades: [], snapshots: [] };
    const analytics = mode === 'multi-watch'
        ? await getWalletAnalyticsReport(config.traderAddresses || [])
        : { enabled: false, wallets: [] };
    currentState = {
        accounts,
        config: publicConfig(config),
        totals: summarize(accounts, config),
        pnl,
        analytics,
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
    const accountPnlValues = accounts
        .map((account) => account.totalPnl)
        .filter((value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)));
    const pnlAvailable = accountPnlValues.length > 0;
    const totalPnl = pnlAvailable
        ? accountPnlValues.reduce((sum, value) => sum + Number(value), 0)
        : null;

    return {
        totalStart,
        totalCash,
        totalOpenCost,
        totalEquity,
        totalPnl,
        pnlAvailable,
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

async function requestHandler(req, res) {
    try {
        const url = new URL(req.url || '/', 'http://localhost');
        const method = req.method || 'GET';
        if (method === 'GET' && url.pathname === '/') {
            sendHtml(res);
            return;
        }
        if (method === 'GET' && url.pathname === '/api/state') {
            sendJson(res, 200, { ...currentState, logs: logs.slice(-300) });
            return;
        }
        if (method === 'GET' && url.pathname === '/events') {
            handleEvents(req, res);
            return;
        }
        if (method === 'POST' && url.pathname === '/api/settings') {
            if (!dashboardActions.onSettingsChange) {
                sendJson(res, 503, { error: 'settings update is not available' });
                return;
            }
            const body = await readJsonBody(req);
            const settings = await dashboardActions.onSettingsChange(body);
            sendJson(res, 200, { ok: true, settings });
            return;
        }
        sendJson(res, 404, { error: 'not found' });
    } catch (err) {
        sendJson(res, 400, { error: err.message });
    }
}

export function startWebDashboard(config, actions = {}) {
    dashboardActions = actions;
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
  <script>
    (function initTheme() {
      try {
        const saved = window.localStorage.getItem('poly-dashboard-theme');
        const system = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        document.documentElement.dataset.theme = saved || system;
      } catch {
        document.documentElement.dataset.theme = 'dark';
      }
    }());
  </script>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f1115;
      --panel: #171a21;
      --panel-2: #1f2430;
      --surface: #131720;
      --log-bg: #0b0d12;
      --button-bg: #12161f;
      --button-hover: #566174;
      --header-bg: rgba(15, 17, 21, 0.96);
      --row-line: rgba(255, 255, 255, 0.05);
      --log-line: rgba(255, 255, 255, 0.04);
      --text: #e7e9ee;
      --muted: #9ba3b4;
      --line: #2d3442;
      --green: #39d98a;
      --red: #ff6b6b;
      --yellow: #ffd166;
      --blue: #64b5f6;
      --purple: #c084fc;
    }
    :root[data-theme="light"] {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: #ffffff;
      --panel-2: #eef2f8;
      --surface: #f9fbff;
      --log-bg: #ffffff;
      --button-bg: #ffffff;
      --button-hover: #9aa8bc;
      --header-bg: rgba(245, 247, 251, 0.96);
      --row-line: rgba(30, 41, 59, 0.08);
      --log-line: rgba(30, 41, 59, 0.08);
      --text: #172033;
      --muted: #607085;
      --line: #d7dee9;
      --green: #127c4f;
      --red: #c33a3f;
      --yellow: #8a6500;
      --blue: #1267b1;
      --purple: #7b3fbd;
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
      background: var(--header-bg);
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
    .header-tools {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .nav-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 30px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--button-bg);
      color: var(--text);
      text-decoration: none;
      padding: 0 10px;
      white-space: nowrap;
    }
    .nav-link:hover { border-color: var(--button-hover); }
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
      grid-template-columns: minmax(220px, 1.4fr) repeat(4, minmax(82px, 0.7fr));
      gap: 10px;
      align-items: center;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }
    .wallet > div {
      min-width: 0;
    }
    .addr {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      overflow-wrap: anywhere;
      min-width: 0;
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
      background: var(--surface);
    }
    .positions-summary {
      color: var(--muted);
      line-height: 1.45;
      padding: 4px 0;
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
      background: var(--surface);
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
      border-bottom: 1px solid var(--row-line);
    }
    .trade-row:last-child { border-bottom: 0; }
    .analytics-list {
      display: grid;
      gap: 8px;
    }
    .analytics-row {
      display: grid;
      grid-template-columns: minmax(190px, 1.4fr) repeat(6, minmax(78px, 0.7fr));
      gap: 8px;
      align-items: center;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      height: 22px;
      padding: 0 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      font-size: 12px;
      color: var(--muted);
      background: var(--button-bg);
      white-space: nowrap;
    }
    .badge.good { color: var(--green); border-color: color-mix(in srgb, var(--green) 42%, var(--line)); }
    .badge.bad { color: var(--red); border-color: color-mix(in srgb, var(--red) 42%, var(--line)); }
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
    .settings-form {
      display: grid;
      gap: 10px;
    }
    .form-row {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    .form-field {
      display: grid;
      gap: 5px;
    }
    label {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--button-bg);
      color: var(--text);
      font: inherit;
      letter-spacing: 0;
    }
    input, select {
      height: 34px;
      padding: 0 9px;
    }
    textarea {
      min-height: 82px;
      resize: vertical;
      padding: 9px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.45;
    }
    input:focus, select:focus, textarea:focus {
      outline: 2px solid color-mix(in srgb, var(--blue) 36%, transparent);
      outline-offset: 1px;
      border-color: var(--blue);
    }
    .form-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    .form-buttons {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .form-message {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }
    button {
      height: 30px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--button-bg);
      color: var(--text);
      cursor: pointer;
      padding: 0 10px;
    }
    #themeToggle { min-width: 104px; }
    button:hover { border-color: var(--button-hover); }
    #logList {
      flex: 1;
      overflow: auto;
      padding: 10px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.55;
      background: var(--log-bg);
    }
    .log-line {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      border-bottom: 1px solid var(--log-line);
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
      .analytics-row { grid-template-columns: 1fr 1fr; }
      .form-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 560px) {
      header { align-items: flex-start; flex-direction: column; }
      .header-tools { width: 100%; justify-content: space-between; }
      .metrics { grid-template-columns: 1fr; }
      .wallet { grid-template-columns: 1fr; }
      .ledger-grid { grid-template-columns: 1fr; }
      .analytics-row { grid-template-columns: 1fr; }
      .form-row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Polymarket Multi-Watch</h1>
      <div id="subtitle" class="subtle">simulation dashboard</div>
    </div>
    <div class="header-tools">
      <a id="dashboardNav" class="nav-link" href="#" target="_blank" rel="noopener">Multi-Watch</a>
      <button id="themeToggle" type="button">Theme</button>
      <div class="status"><span id="dot" class="dot"></span><span id="status">connecting</span></div>
    </div>
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
          <span>Simulation Settings</span>
          <span id="settingsStatus" class="small"></span>
        </div>
        <form id="settingsForm" class="panel-body settings-form">
          <div class="form-field">
            <label for="targetWallets">Target wallets</label>
            <textarea id="targetWallets" spellcheck="false" placeholder="0x...&#10;0x..."></textarea>
          </div>
          <div class="form-row">
            <div class="form-field">
              <label for="simStartBalance">Start balance</label>
              <input id="simStartBalance" type="number" min="0.01" step="0.01">
            </div>
            <div class="form-field">
              <label for="sizeMode">Size mode</label>
              <select id="sizeMode">
                <option value="percentage">percentage</option>
                <option value="balance">balance</option>
                <option value="target">target</option>
              </select>
            </div>
            <div class="form-field">
              <label for="sizePercent">Size percent</label>
              <input id="sizePercent" type="number" min="0.01" step="0.01">
            </div>
            <div class="form-field">
              <label for="maxPositionSize">Max per outcome</label>
              <input id="maxPositionSize" type="number" min="0.01" step="0.01">
            </div>
          </div>
          <div class="form-actions">
            <div class="form-field">
              <label for="minTradeSize">Min trade</label>
              <input id="minTradeSize" type="number" min="0.01" step="0.01">
            </div>
            <div class="form-buttons">
              <button id="saveSettings" type="submit">Save Settings</button>
            </div>
            <div id="settingsMessage" class="form-message"></div>
          </div>
        </form>
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
          <div class="log-toolbar">
            <span id="updatedAt" class="small"></span>
            <button id="togglePositions" type="button">Show positions</button>
          </div>
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
      <div class="panel" id="analyticsPanel">
        <div class="panel-title">
          <span>Wallet Analytics</span>
          <span id="analyticsStatus" class="small"></span>
        </div>
        <div id="analytics" class="panel-body analytics-list"><div class="empty">Waiting for analytics...</div></div>
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
      title: document.querySelector('h1'),
      subtitle: document.getElementById('subtitle'),
      totalEquity: document.getElementById('totalEquity'),
      totalPnl: document.getElementById('totalPnl'),
      totalCash: document.getElementById('totalCash'),
      openCost: document.getElementById('openCost'),
      settings: document.getElementById('settings'),
      settingsForm: document.getElementById('settingsForm'),
      settingsStatus: document.getElementById('settingsStatus'),
      targetWallets: document.getElementById('targetWallets'),
      simStartBalance: document.getElementById('simStartBalance'),
      sizeMode: document.getElementById('sizeMode'),
      sizePercent: document.getElementById('sizePercent'),
      maxPositionSize: document.getElementById('maxPositionSize'),
      minTradeSize: document.getElementById('minTradeSize'),
      saveSettings: document.getElementById('saveSettings'),
      settingsMessage: document.getElementById('settingsMessage'),
      wallets: document.getElementById('wallets'),
      positions: document.getElementById('positions'),
      togglePositions: document.getElementById('togglePositions'),
      updatedAt: document.getElementById('updatedAt'),
      ledger: document.getElementById('ledger'),
      ledgerStatus: document.getElementById('ledgerStatus'),
      analyticsPanel: document.getElementById('analyticsPanel'),
      analytics: document.getElementById('analytics'),
      analyticsStatus: document.getElementById('analyticsStatus'),
      logList: document.getElementById('logList'),
      themeToggle: document.getElementById('themeToggle'),
      dashboardNav: document.getElementById('dashboardNav'),
      toggleScroll: document.getElementById('toggleScroll'),
      clearLogs: document.getElementById('clearLogs'),
    };
    let autoScroll = true;
    let settingsDirty = false;
    let positionsExpanded = false;
    let lastState = null;

    function money(value, signed = false) {
      const number = Number(value || 0);
      const sign = signed && number > 0 ? '+' : '';
      return sign + '$' + number.toFixed(2);
    }

    function shortAddr(addr) {
      if (!addr) return '';
      return addr.slice(0, 6) + '...' + addr.slice(-4);
    }

    function sourceLabelForPosition(pos, account) {
      if (pos.traderLabel && pos.traderAddress) return pos.traderLabel + ' ' + shortAddr(pos.traderAddress);
      if (pos.traderLabel) return pos.traderLabel;
      if (pos.traderAddress) return shortAddr(pos.traderAddress);
      return shortAddr(account.address);
    }

    function setPnlClass(node, value) {
      node.classList.toggle('green', Number(value) >= 0);
      node.classList.toggle('red', Number(value) < 0);
    }

    function hasNumericValue(value) {
      return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
    }

    function currentTheme() {
      return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    }

    function setTheme(theme) {
      const nextTheme = theme === 'light' ? 'light' : 'dark';
      document.documentElement.dataset.theme = nextTheme;
      try {
        window.localStorage.setItem('poly-dashboard-theme', nextTheme);
      } catch { /* storage may be disabled */ }
      els.themeToggle.textContent = 'Theme: ' + nextTheme;
    }

    function numberInputValue(value) {
      const number = Number(value || 0);
      return Number.isFinite(number) ? String(number) : '';
    }

    function markSettingsSaved(message) {
      settingsDirty = false;
      els.settingsMessage.textContent = message || 'Saved';
      els.settingsMessage.className = 'form-message green';
      els.settingsStatus.textContent = 'saved';
    }

    function markSettingsError(message) {
      els.settingsMessage.textContent = message || 'Failed to save settings';
      els.settingsMessage.className = 'form-message red';
      els.settingsStatus.textContent = 'error';
    }

    function fillSettingsForm(cfg) {
      if (cfg.mode !== 'multi-watch') return;
      if (settingsDirty) return;
      els.targetWallets.value = (cfg.traderAddresses || []).join('\\n');
      els.simStartBalance.value = numberInputValue(cfg.simStartBalance);
      els.sizeMode.value = cfg.sizeMode || 'percentage';
      els.sizePercent.value = numberInputValue(cfg.sizePercent);
      els.maxPositionSize.value = numberInputValue(cfg.maxPositionSize);
      els.minTradeSize.value = numberInputValue(cfg.minTradeSize);
      els.settingsStatus.textContent = (cfg.traderAddresses || []).length + ' target(s)';
    }

    function settingsPayloadFromForm() {
      return {
        traderAddresses: els.targetWallets.value
          .split(/[\\s,]+/)
          .map((addr) => addr.trim())
          .filter(Boolean),
        simStartBalance: Number(els.simStartBalance.value),
        sizeMode: els.sizeMode.value,
        sizePercent: Number(els.sizePercent.value),
        maxPositionSize: Number(els.maxPositionSize.value),
        minTradeSize: Number(els.minTradeSize.value),
      };
    }

    async function saveSettings() {
      els.saveSettings.disabled = true;
      els.settingsMessage.textContent = 'Saving...';
      els.settingsMessage.className = 'form-message';
      try {
        const response = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(settingsPayloadFromForm()),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Save failed');
        markSettingsSaved('Settings saved. New trades use the updated config.');
      } catch (err) {
        markSettingsError(err.message);
      } finally {
        els.saveSettings.disabled = false;
      }
    }

    function renderState(state) {
      lastState = state;
      const totals = state.totals || {};
      const cfg = state.config || {};
      els.title.textContent = cfg.title || 'Polymarket Dashboard';
      els.subtitle.textContent = cfg.subtitle || (cfg.dryRun ? 'simulation dashboard' : 'live dashboard');
      els.totalEquity.textContent = money(totals.totalEquity);
      if (totals.pnlAvailable === false) {
        els.totalPnl.textContent = 'N/A';
        els.totalPnl.classList.remove('green', 'red');
      } else {
        els.totalPnl.textContent = money(totals.totalPnl, true);
        setPnlClass(els.totalPnl, totals.totalPnl);
      }
      els.totalCash.textContent = money(totals.totalCash);
      els.openCost.textContent = money(totals.totalOpenCost);

      const sizingText = cfg.sizeMode === 'target'
        ? 'Size target notional | Cap ' + money(cfg.maxPositionSize)
        : 'Size ' + (cfg.sizeMode || '-') + ' ' + (cfg.sizePercent ?? '-') + '% | Cap ' + money(cfg.maxPositionSize);
      els.settings.textContent = sizingText;
      els.updatedAt.textContent = state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString() : '';
      const isMultiWatch = cfg.mode === 'multi-watch';
      configureDashboardNav(cfg, isMultiWatch);
      els.settingsForm.closest('.panel').hidden = !isMultiWatch;
      els.ledger.closest('.panel').hidden = !isMultiWatch;
      els.analyticsPanel.hidden = !isMultiWatch;
      fillSettingsForm(cfg);

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
        els.togglePositions.disabled = true;
        els.togglePositions.textContent = 'Show positions';
        els.positions.innerHTML = '<div class="empty">No open positions</div>';
      } else if (!positionsExpanded) {
        els.togglePositions.disabled = false;
        els.togglePositions.textContent = 'Show positions (' + positions.length + ')';
        const openCost = positions.reduce((sum, item) => sum + Number(item.position.totalCost || 0), 0);
        els.positions.innerHTML = '<div class="positions-summary">' + positions.length + ' open position(s) hidden | Open cost ' + money(openCost) + '</div>';
      } else {
        els.togglePositions.disabled = false;
        els.togglePositions.textContent = 'Hide positions (' + positions.length + ')';
        els.positions.replaceChildren(...positions.map(renderPosition));
      }
      renderLedger(state.pnl || {});
      renderAnalytics(state.analytics || {}, accounts);
    }

    function sameHostUrl(port) {
      const url = new URL(window.location.href);
      url.port = String(port);
      url.pathname = '/';
      url.search = '';
      url.hash = '';
      return url.toString();
    }

    function configureDashboardNav(cfg, isMultiWatch) {
      if (isMultiWatch) {
        els.dashboardNav.textContent = 'Live Bot';
        els.dashboardNav.href = cfg.liveDashboardUrl || sameHostUrl(8788);
        return;
      }
      els.dashboardNav.textContent = 'Multi-Watch';
      els.dashboardNav.href = cfg.multiWatchDashboardUrl || sameHostUrl(8787);
    }

    function renderWallet(account) {
      const node = document.createElement('div');
      node.className = 'wallet';
      const hasPnl = hasNumericValue(account.totalPnl);
      const pnlClass = Number(account.totalPnl || 0) >= 0 ? 'green' : 'red';
      const pnlText = hasPnl ? money(account.totalPnl, true) : 'N/A';
      node.innerHTML =
        '<div><div class="addr">' + escapeHtml(shortAddr(account.address)) + '</div><div class="small">' + escapeHtml(account.address) + '</div></div>' +
        '<div><div class="small">Equity</div><strong>' + money(account.equity) + '</strong></div>' +
        '<div><div class="small">PnL</div><strong class="' + pnlClass + '">' + pnlText + '</strong></div>' +
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

    function percent(value, digits = 1) {
      if (!hasNumericValue(value)) return 'N/A';
      return (Number(value) * 100).toFixed(digits) + '%';
    }

    function priceDelta(value) {
      if (!hasNumericValue(value)) return 'N/A';
      const number = Number(value);
      const sign = number > 0 ? '+' : '';
      return sign + number.toFixed(4);
    }

    function findAccount(accounts, address) {
      const target = String(address || '').toLowerCase();
      return accounts.find((account) => String(account.address || '').toLowerCase() === target) || null;
    }

    function renderAnalytics(analytics, accounts) {
      if (els.analyticsPanel.hidden) return;
      if (!analytics.enabled) {
        els.analyticsStatus.textContent = 'disabled';
        els.analytics.innerHTML = '<div class="empty">Wallet analytics DB is not connected. Run wallet-score for target wallets after Postgres is available.</div>';
        return;
      }

      const wallets = analytics.wallets || [];
      els.analyticsStatus.textContent = wallets.length + ' target(s)';
      if (wallets.length === 0) {
        els.analytics.innerHTML = '<div class="empty">No target wallets configured</div>';
        return;
      }

      els.analytics.replaceChildren(...wallets.map((wallet) => renderAnalyticsRow(wallet, findAccount(accounts, wallet.address))));
    }

    function renderAnalyticsRow(wallet, account) {
      const metrics = wallet.metrics || {};
      const paperPnl = account && hasNumericValue(account.totalPnl) ? Number(account.totalPnl) : null;
      const paperClass = paperPnl === null ? '' : (paperPnl >= 0 ? 'green' : 'red');
      const score = hasNumericValue(wallet.score) ? Number(wallet.score).toFixed(1) : 'N/A';
      const scoreClass = wallet.eligible ? 'good' : wallet.provisionalEligible ? '' : 'bad';
      const statusText = wallet.eligible ? 'paper-ready' : wallet.provisionalEligible ? 'review' : 'blocked';
      const reasons = (wallet.reasonCodes || []).slice(0, 3).join(', ') || 'not scored';
      const scoredAt = wallet.scoredAt ? new Date(wallet.scoredAt).toLocaleString() : 'not scored';
      const node = document.createElement('div');
      node.className = 'analytics-row';
      node.innerHTML =
        '<div><div class="addr">' + escapeHtml(shortAddr(wallet.address)) + '</div><div class="small">' + escapeHtml(reasons) + '</div></div>' +
        '<div><div class="small">Paper PnL</div><strong class="' + paperClass + '">' + (paperPnl === null ? 'N/A' : money(paperPnl, true)) + '</strong></div>' +
        '<div><div class="small">Score</div><span class="badge ' + scoreClass + '">' + score + ' ' + statusText + '</span></div>' +
        '<div><div class="small">ROI</div><strong>' + percent(metrics.realizedRoi) + '</strong></div>' +
        '<div><div class="small">CLV</div><strong>' + priceDelta(metrics.weightedClv) + '</strong></div>' +
        '<div><div class="small">Slip</div><strong>' + priceDelta(metrics.copySlippageEstimate) + '</strong></div>' +
        '<div><div class="small">Updated</div><span class="small">' + escapeHtml(scoredAt) + '</span></div>';
      return node;
    }

    function renderPosition(item) {
      const pos = item.position;
      const source = sourceLabelForPosition(pos, item.account);
      const node = document.createElement('div');
      node.className = 'position';
      node.innerHTML =
        '<div class="market">' + escapeHtml(pos.market || pos.tokenId || '') + '</div>' +
        '<div class="small">' + escapeHtml(source) + ' | ' +
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
    els.togglePositions.addEventListener('click', () => {
      positionsExpanded = !positionsExpanded;
      if (lastState) renderState(lastState);
    });
    els.settingsForm.addEventListener('input', () => {
      if (els.settingsForm.closest('.panel').hidden) return;
      settingsDirty = true;
      els.settingsStatus.textContent = 'unsaved';
      els.settingsMessage.textContent = '';
      els.settingsMessage.className = 'form-message';
    });
    els.settingsForm.addEventListener('submit', (event) => {
      event.preventDefault();
      saveSettings();
    });
    els.themeToggle.addEventListener('click', () => {
      setTheme(currentTheme() === 'light' ? 'dark' : 'light');
    });
    setTheme(currentTheme());

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
