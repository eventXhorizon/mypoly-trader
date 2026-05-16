import config, { validateMultiWatchConfig } from './config/index.js';
import logger from './utils/logger.js';
import { appendWebLog, startWebDashboard, stopWebDashboard, updateWebDashboard } from './ui/webDashboard.js';
import { startMultiWsWatcher, stopMultiWsWatcher } from './services/multiWsWatcher.js';
import { applyPaperTrade, ensureAccounts, portfolioSummary } from './services/paperPortfolio.js';
import { closePnlLedger, initPnlLedger, recordPnlSnapshot, recordPnlTrade } from './services/pnlLedger.js';

function shortAddr(addr) {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

async function refreshDashboard() {
    await updateWebDashboard(portfolioSummary(), config);
}

async function handleTrade(trade) {
    const result = applyPaperTrade(trade);
    await recordPnlTrade(trade, result, logger);
    if (result.action === 'buy') {
        logger.trade(`[${shortAddr(trade.traderAddress)}] PAPER BUY $${result.cost.toFixed(2)} @ $${trade.price} | ${trade.market || trade.tokenId}`);
    } else if (result.action === 'sell') {
        const sign = result.pnl >= 0 ? '+' : '';
        logger.trade(`[${shortAddr(trade.traderAddress)}] PAPER SELL ${result.shares.toFixed(3)} sh @ $${trade.price} | ${sign}$${result.pnl.toFixed(2)}`);
    } else if (result.reason === 'below minimum' || result.reason === 'market cap reached') {
        // Expected simulation skips are stored in Recent; avoid flooding the live log.
    } else {
        logger.warn(`[${shortAddr(trade.traderAddress)}] skipped ${trade.type}: ${result.reason}`);
    }
    await refreshDashboard();
}

async function main() {
    try {
        validateMultiWatchConfig();
    } catch (err) {
        logger.error(err.message);
        process.exit(1);
    }

    ensureAccounts(config.traderAddresses);
    await startWebDashboard(config);
    logger.setOutput(appendWebLog);
    logger.interceptConsole();
    process.stdout.write(`Multi-watch web dashboard: http://${config.webHost}:${config.webPort}\n`);
    process.stdout.write('Simulation is running. Press Ctrl+C to stop.\n');
    const dbReady = await initPnlLedger(logger);
    if (config.multiWatchRequireDb && !dbReady) {
        logger.error('PnL database is required. Start Postgres and restart multi-watch.');
        stopWebDashboard();
        await closePnlLedger();
        process.exit(1);
    }

    logger.info('=== Polymarket Multi-Wallet Watch [SIMULATION] ===');
    logger.info(`Wallets        : ${config.traderAddresses.map(shortAddr).join(', ')}`);
    logger.info(`Start balance  : $${config.simStartBalance} per wallet`);
    logger.info(`Size mode      : ${config.sizeMode} (${config.sizePercent}%)`);
    logger.info(`Min trade      : $${config.minTradeSize}`);
    logger.info(`Max position   : $${config.maxPositionSize} per market`);
    logger.info('No private key, no proxy wallet, no real orders.');
    logger.info(`Web dashboard  : http://${config.webHost}:${config.webPort}`);
    logger.info('===============================================');

    await refreshDashboard();
    await recordPnlSnapshot(portfolioSummary(), config, 'startup', logger);
    startMultiWsWatcher(config.traderAddresses, handleTrade);

    const refreshInterval = setInterval(() => {
        refreshDashboard().catch((err) => logger.warn(`Dashboard refresh failed: ${err.message}`));
    }, 5000);
    const snapshotInterval = setInterval(() => {
        recordPnlSnapshot(portfolioSummary(), config, 'interval', logger)
            .catch((err) => logger.warn(`PnL snapshot failed: ${err.message}`));
    }, config.pnlSnapshotIntervalMs);

    const shutdown = async () => {
        logger.info('Shutting down multi-wallet watcher...');
        stopMultiWsWatcher();
        stopWebDashboard();
        clearInterval(refreshInterval);
        clearInterval(snapshotInterval);
        await recordPnlSnapshot(portfolioSummary(), config, 'shutdown', logger);
        await closePnlLedger();
        setTimeout(() => process.exit(0), 300);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    logger.error('Fatal error:', err.message);
    process.exit(1);
});
