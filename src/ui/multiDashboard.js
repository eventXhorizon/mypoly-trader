import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const blessed = require('blessed');

let screen = null;
let logBox = null;
let summaryBox = null;
let detailBox = null;
let active = false;

export function initMultiDashboard() {
    screen = blessed.screen({
        smartCSR: false,
        title: 'Polymarket Multi-Wallet Simulation',
        fullUnicode: true,
        forceUnicode: true,
    });

    logBox = blessed.log({
        parent: screen,
        label: ' LIVE TRADES ',
        left: 0,
        top: 0,
        width: '58%',
        height: '100%-1',
        border: { type: 'line' },
        tags: true,
        scrollable: true,
        alwaysScroll: true,
        mouse: false,
        keys: false,
        input: false,
        style: {
            border: { fg: 'cyan' },
            label: { fg: 'cyan', bold: true },
        },
    });

    summaryBox = blessed.box({
        parent: screen,
        label: ' WALLETS ',
        left: '58%',
        top: 0,
        width: '42%',
        height: '45%',
        border: { type: 'line' },
        tags: true,
        scrollable: false,
        input: false,
        style: {
            border: { fg: 'yellow' },
            label: { fg: 'yellow', bold: true },
        },
        content: '\n {gray-fg}Initializing...{/gray-fg}',
    });

    detailBox = blessed.box({
        parent: screen,
        label: ' POSITIONS ',
        left: '58%',
        top: '45%',
        width: '42%',
        height: '55%-1',
        border: { type: 'line' },
        tags: true,
        scrollable: true,
        alwaysScroll: false,
        input: false,
        style: {
            border: { fg: 'green' },
            label: { fg: 'green', bold: true },
        },
        content: '\n {gray-fg}No positions{/gray-fg}',
    });

    blessed.box({
        parent: screen,
        bottom: 0,
        left: 0,
        width: '100%',
        height: 1,
        tags: true,
        content: ' {gray-fg}multi-watch simulation only{/gray-fg}  {gray-fg}Ctrl+C / q = exit{/gray-fg}',
        style: { bg: 'black', fg: 'white' },
    });

    screen.on('keypress', (_ch, key) => {
        if (!key) return;
        if (key.full === 'C-c' || key.sequence === '\x03' || key.name === 'q') {
            screen.destroy();
            process.exit(0);
        }
    });

    console.log = (...a) => appendMultiLog(a.join(' '));
    console.info = (...a) => appendMultiLog(a.join(' '));
    console.warn = (...a) => appendMultiLog(`{yellow-fg}${a.join(' ')}{/yellow-fg}`);
    console.error = (...a) => appendMultiLog(`{red-fg}${a.join(' ')}{/red-fg}`);

    active = true;
    screen.render();
    setTimeout(() => {
        screen.alloc();
        screen.render();
    }, 50);

    return screen;
}

export function appendMultiLog(text) {
    if (!active || !logBox) {
        process.stdout.write(String(text) + '\n');
        return;
    }
    logBox.log(String(text));
    screen.render();
}

function shortAddr(addr) {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function fmtMoney(value) {
    const sign = value > 0 ? '+' : '';
    return `${sign}$${value.toFixed(2)}`;
}

export function updateMultiDashboard(accounts, config) {
    if (!active || !summaryBox || !detailBox) return;

    const totalStart = accounts.reduce((sum, account) => sum + (account.startBalance || config.simStartBalance), 0);
    const totalCash = accounts.reduce((sum, account) => sum + account.cash, 0);
    const totalOpenCost = accounts.reduce((sum, account) => sum + account.openCost, 0);
    const totalEquity = accounts.reduce((sum, account) => sum + account.equity, 0);
    const totalPnl = totalEquity - totalStart;
    const totalPnlColor = totalPnl >= 0 ? 'green-fg' : 'red-fg';

    const summaryLines = [];
    summaryLines.push(` {yellow-fg}[SIMULATION]{/yellow-fg} tracking ${accounts.length} wallet(s)`);
    summaryLines.push(` {gray-fg}${'-'.repeat(40)}{/gray-fg}`);
    summaryLines.push(` Total Equity: {bold}$${totalEquity.toFixed(2)}{/bold} | PnL {${totalPnlColor}}${fmtMoney(totalPnl)}{/${totalPnlColor}}`);
    summaryLines.push(` Cash $${totalCash.toFixed(2)} | Open Cost $${totalOpenCost.toFixed(2)} | Start $${totalStart.toFixed(2)}`);
    summaryLines.push(` Size: ${config.sizeMode} ${config.sizePercent}% | Cap: $${config.maxPositionSize}`);
    summaryLines.push('');

    for (const account of accounts) {
        const pnlColor = account.totalPnl >= 0 ? 'green-fg' : 'red-fg';
        summaryLines.push(` {bold}${shortAddr(account.address)}{/bold}`);
        summaryLines.push(`  Equity $${account.equity.toFixed(2)} | PnL {${pnlColor}}${fmtMoney(account.totalPnl)}{/${pnlColor}}`);
        summaryLines.push(`  Cash $${account.cash.toFixed(2)} | Open ${account.positions.length} | Cost $${account.openCost.toFixed(2)}`);
        summaryLines.push(`  Buys ${account.totalBuys} | Sells ${account.totalSells} | Realized ${fmtMoney(account.realizedPnl)}`);
    }

    summaryLines.push('');
    summaryLines.push(` {gray-fg}Updated ${new Date().toISOString().substring(11, 19)}{/gray-fg}`);

    const detailLines = [];
    for (const account of accounts) {
        detailLines.push(` {cyan-fg}${shortAddr(account.address)}{/cyan-fg}`);
        if (account.positions.length === 0) {
            detailLines.push('  {gray-fg}No open positions{/gray-fg}');
        } else {
            for (const pos of account.positions.slice(0, 8)) {
                const market = (pos.market || pos.tokenId || '').slice(0, 34);
                detailLines.push(`  {bold}${market}{/bold}`);
                detailLines.push(`   ${pos.outcome || '?'} | ${pos.shares.toFixed(3)} sh @ $${pos.avgBuyPrice.toFixed(3)} | cost $${pos.totalCost.toFixed(2)}`);
            }
        }

        const recent = (account.recentTrades || []).slice(-3).reverse();
        if (recent.length > 0) {
            detailLines.push('  {gray-fg}Recent{/gray-fg}');
            for (const item of recent) {
                const market = (item.market || '').slice(0, 28);
                const result = item.pnl !== undefined ? ` ${fmtMoney(item.pnl)}` : item.note ? ` ${item.note}` : '';
                detailLines.push(`   ${item.type} ${market}${result}`);
            }
        }
        detailLines.push('');
    }

    summaryBox.setContent(summaryLines.join('\n'));
    detailBox.setContent(detailLines.join('\n'));
    screen.render();
}
