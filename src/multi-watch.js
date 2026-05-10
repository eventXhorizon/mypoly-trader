import config, { validateMultiWatchConfig } from './config/index.js';
import logger from './utils/logger.js';
import { initMultiDashboard, appendMultiLog, updateMultiDashboard } from './ui/multiDashboard.js';
import { startMultiWsWatcher, stopMultiWsWatcher } from './services/multiWsWatcher.js';
import { applyPaperTrade, ensureAccounts, portfolioSummary } from './services/paperPortfolio.js';

function shortAddr(addr) {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

initMultiDashboard();
logger.setOutput(appendMultiLog);
logger.interceptConsole();

function refreshDashboard() {
    updateMultiDashboard(portfolioSummary(), config);
}

async function handleTrade(trade) {
    const result = applyPaperTrade(trade);
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
    refreshDashboard();
}

async function main() {
    try {
        validateMultiWatchConfig();
    } catch (err) {
        logger.error(err.message);
        process.exit(1);
    }

    ensureAccounts(config.traderAddresses);

    logger.info('=== Polymarket Multi-Wallet Watch [SIMULATION] ===');
    logger.info(`Wallets        : ${config.traderAddresses.map(shortAddr).join(', ')}`);
    logger.info(`Start balance  : $${config.simStartBalance} per wallet`);
    logger.info(`Size mode      : ${config.sizeMode} (${config.sizePercent}%)`);
    logger.info(`Min trade      : $${config.minTradeSize}`);
    logger.info(`Max position   : $${config.maxPositionSize} per market`);
    logger.info('No private key, no proxy wallet, no real orders.');
    logger.info('===============================================');

    refreshDashboard();
    startMultiWsWatcher(config.traderAddresses, handleTrade);

    const refreshInterval = setInterval(refreshDashboard, 5000);

    const shutdown = () => {
        logger.info('Shutting down multi-wallet watcher...');
        stopMultiWsWatcher();
        clearInterval(refreshInterval);
        setTimeout(() => process.exit(0), 300);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    logger.error('Fatal error:', err.message);
    process.exit(1);
});
