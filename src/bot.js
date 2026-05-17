/**
 * bot.js — PM2 / VPS entry point (no TUI)
 *
 * Plain-text stdout output, compatible with:
 *   pm2 start ecosystem.config.cjs
 *   pm2 logs polymarket-copy
 */
import config, { validateConfig } from './config/index.js';
import { initClient, getUsdcBalance, getClient } from './services/client.js';
import { executeBuy, executeSell } from './services/executor.js';
import { checkAndRedeemPositions } from './services/redeemer.js';
import { getOpenPositions } from './services/position.js';
import { startWsWatcher, stopWsWatcher } from './services/wsWatcher.js';
import { getSimStats } from './utils/simStats.js';
import { getPaperBalance } from './utils/paperBalance.js';
import { appendWebLog, startWebDashboard, stopWebDashboard, updateWebDashboard } from './ui/webDashboard.js';
import logger from './utils/logger.js';

config.dashboardMode = 'copy-bot';
config.dashboardTitle = 'Polymarket Copy Bot';
config.dashboardSubtitle = config.dryRun ? 'copy simulation' : 'live copy trading';

logger.setOutput(appendWebLog);
logger.interceptConsole(); // strip auth headers from CLOB axios error dumps

function sourceLabelForPosition(pos) {
    if (pos.traderLabel && pos.traderAddress) return `${pos.traderLabel} ${pos.traderAddress.slice(0, 6)}...${pos.traderAddress.slice(-4)}`;
    if (pos.traderLabel) return pos.traderLabel;
    if (pos.traderAddress) return `${pos.traderAddress.slice(0, 6)}...${pos.traderAddress.slice(-4)}`;
    return 'legacy';
}

function positionAccount(balance, positions) {
    const openCost = positions.reduce((sum, pos) => sum + (pos.totalCost || 0), 0);
    const equity = balance + openCost;
    const startBalance = config.dryRun ? config.simStartBalance : equity;
    return [{
        address: config.proxyWallet || 'copy-bot',
        startBalance,
        cash: balance,
        totalBuys: positions.length,
        totalSells: 0,
        skippedBuys: 0,
        skippedSells: 0,
        realizedPnl: 0,
        recentTrades: [],
        positions,
        openCost,
        equity,
        totalPnl: config.dryRun ? equity - startBalance : null,
        updatedAt: new Date().toISOString(),
    }];
}

async function refreshDashboard() {
    try {
        const balance = config.dryRun ? getPaperBalance() : await getUsdcBalance();
        const positions = getOpenPositions();
        await updateWebDashboard(positionAccount(balance, positions), config);
    } catch (err) {
        logger.warn(`Dashboard refresh failed: ${err.message}`);
    }
}

// ── Handle a trade event from WebSocket ───────────────────────────────────────
async function handleTrade(trade) {
    try {
        if (trade.type === 'BUY')  await executeBuy(trade);
        if (trade.type === 'SELL') await executeSell(trade);
        await refreshDashboard();
    } catch (err) {
        logger.error(`Error processing trade ${trade.id}: ${err.message}`);
    }
}

// ── Periodic status log (replaces TUI right panel) ────────────────────────────
async function printStatus() {
    try {
        const balance   = config.dryRun ? getPaperBalance() : await getUsdcBalance();
        const positions = getOpenPositions();

        logger.info(`--- Status | ${config.dryRun ? 'Paper balance' : 'Balance'}: $${balance.toFixed(2)} | Open positions: ${positions.length} ---`);

        if (!config.statusPositionsVerbose) {
            if (positions.length > 0) {
                const openCost = positions.reduce((sum, pos) => sum + (pos.totalCost || 0), 0);
                logger.info(`  Open cost: $${openCost.toFixed(2)} | position details hidden; expand Open Positions in the dashboard`);
            }
        } else {
            for (const pos of positions) {
                let pnlStr = '';
                try {
                    const client = getClient();
                    const mp = await client.getMidpoint(pos.tokenId);
                    const mid = parseFloat(mp?.mid ?? mp ?? '0');
                    if (mid > 0) {
                        const pnl  = (mid - pos.avgBuyPrice) * pos.shares;
                        const sign = pnl >= 0 ? '+' : '';
                        const pct  = pos.totalCost > 0 ? ((pnl / pos.totalCost) * 100).toFixed(1) : '0.0';
                        pnlStr = ` | unrealized ${sign}$${pnl.toFixed(2)} (${sign}${pct}%)`;
                    }
                } catch { /* price unavailable */ }

                const name = (pos.market || pos.tokenId || '').substring(0, 50);
                const source = sourceLabelForPosition(pos);
                logger.info(
                    `  [${source}] [${pos.outcome || '?'}] ${name}` +
                    ` | ${pos.shares.toFixed(4)} sh @ $${pos.avgBuyPrice.toFixed(4)}` +
                    ` | spent $${(pos.totalCost || 0).toFixed(2)}${pnlStr}`,
                );
            }
        }

        if (config.dryRun) {
            const s = getSimStats();
            if (s.totalBuys > 0 || s.totalResolved > 0) {
                const rate = s.totalResolved > 0
                    ? `${((s.wins / s.totalResolved) * 100).toFixed(0)}% win`
                    : 'no resolved yet';
                logger.info(
                    `  [SIM] ${s.totalBuys} buys tracked | ${s.wins}W/${s.losses}L (${rate})` +
                    ` | realized P&L: $${(s.closedPnl || 0).toFixed(2)}`,
                );
            }
        }
    } catch (err) {
        logger.warn(`Status check error: ${err.message}`);
    }
}

// ── Redeemer loop ─────────────────────────────────────────────────────────────
async function redeemerLoop() {
    try {
        await checkAndRedeemPositions();
    } catch (err) {
        logger.error('Redeemer loop error:', err.message);
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    try {
        validateConfig();
    } catch (err) {
        logger.error(err.message);
        process.exit(1);
    }

    try {
        await startWebDashboard(config);
        process.stdout.write(`Copy bot web dashboard: http://${config.webHost}:${config.webPort}\n`);
    } catch (err) {
        logger.error(`Failed to start web dashboard: ${err.message}`);
        process.exit(1);
    }

    const mode = config.dryRun ? 'SIMULATION' : 'LIVE TRADING';
    logger.info(`=== Polymarket Copy Trade [${mode}] ===`);
    logger.info(`Traders      : ${config.traderAddresses.map((addr) => config.traderDisplayMap[addr] || addr).join(', ')}`);
    logger.info(`Proxy wallet : ${config.proxyWallet}`);
    logger.info(`Size mode    : ${config.sizeMode === 'target' ? 'target notional' : `${config.sizeMode} (${config.sizePercent}%)`}`);
    logger.info(`Min trade    : $${config.minTradeSize}`);
    logger.info(`Max position : $${config.maxPositionSize} per outcome`);
    logger.info(`Auto sell    : ${config.autoSellEnabled ? `ON (+${config.autoSellProfitPercent}%)` : 'OFF'}`);
    logger.info(`Sell mode    : ${config.sellMode}`);
    logger.info(`Min time left: ${config.minMarketTimeLeft}s`);
    logger.info('==========================================');

    try {
        await initClient();
    } catch (err) {
        logger.error('Failed to initialize CLOB client:', err.message);
        process.exit(1);
    }

    try {
        const balance = config.dryRun ? getPaperBalance() : await getUsdcBalance();
        logger.money(`${config.dryRun ? 'Paper balance' : 'pUSD Balance'}: $${balance.toFixed(2)}`);
    } catch (err) {
        logger.warn('Could not fetch balance:', err.message);
    }

    logger.success(
        config.dryRun
            ? 'Simulation started — watching trader in real-time...'
            : 'Bot started — watching trader in real-time...',
    );

    await refreshDashboard();
    startWsWatcher(handleTrade);

    await redeemerLoop();
    await refreshDashboard();
    const redeemerInterval = setInterval(redeemerLoop, config.redeemInterval);

    // Print status every 60 seconds
    const statusInterval = setInterval(() => {
        printStatus();
        refreshDashboard();
    }, 60_000);
    const dashboardInterval = setInterval(refreshDashboard, 5_000);

    const shutdown = () => {
        logger.info('Shutting down...');
        stopWsWatcher();
        stopWebDashboard();
        clearInterval(redeemerInterval);
        clearInterval(statusInterval);
        clearInterval(dashboardInterval);
        setTimeout(() => process.exit(0), 300);
    };

    process.on('SIGINT',  shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    logger.error('Fatal error:', err.message);
    process.exit(1);
});
