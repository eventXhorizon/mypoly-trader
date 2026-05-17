import config from '../config/index.js';
import { readState, writeState } from '../utils/state.js';

const PORTFOLIO_FILE = 'multi_paper_portfolios.json';

function emptyAccount(address) {
    return {
        address,
        startBalance: config.simStartBalance,
        cash: config.simStartBalance,
        totalBuys: 0,
        totalSells: 0,
        skippedBuys: 0,
        skippedSells: 0,
        realizedPnl: 0,
        positions: {},
        recentTrades: [],
        updatedAt: new Date().toISOString(),
    };
}

function positionKeyFor(trade) {
    return trade.tokenId || trade.conditionId;
}

function shortMarket(name) {
    return (name || '').replace(/\s+/g, ' ').trim();
}

function marketKeyForTrade(trade) {
    return trade.tokenId || trade.conditionId || shortMarket(trade.market).toLowerCase();
}

function marketKeyForPosition(position) {
    return position.marketKey || position.tokenId || position.conditionId || shortMarket(position.market).toLowerCase();
}

function marketCost(account, marketKey) {
    return Object.values(account.positions || {}).reduce((sum, position) => {
        return marketKeyForPosition(position) === marketKey ? sum + (position.totalCost || 0) : sum;
    }, 0);
}

export function getPortfolios() {
    return readState(PORTFOLIO_FILE, { accounts: {} });
}

function savePortfolios(state) {
    writeState(PORTFOLIO_FILE, state);
}

export function ensureAccounts(addresses) {
    const state = getPortfolios();
    state.accounts = state.accounts || {};
    for (const address of addresses) {
        const key = address.toLowerCase();
        if (!state.accounts[key]) state.accounts[key] = emptyAccount(key);
    }
    savePortfolios(state);
    return state;
}

function tradeSize(account, trade) {
    if (config.sizeMode === 'target') {
        const targetNotional = Number(trade.size || 0) * Number(trade.price || 0);
        return Number.isFinite(targetNotional) && targetNotional > 0 ? targetNotional : 0;
    }
    if (config.sizeMode === 'balance') {
        return account.cash * (config.sizePercent / 100);
    }
    return config.maxPositionSize * (config.sizePercent / 100);
}

function appendRecent(account, event) {
    account.recentTrades = account.recentTrades || [];
    account.recentTrades.push({
        ...event,
        at: new Date().toISOString(),
    });
    if (account.recentTrades.length > 40) {
        account.recentTrades = account.recentTrades.slice(-40);
    }
}

export function applyPaperTrade(trade) {
    const state = getPortfolios();
    state.accounts = state.accounts || {};

    const address = trade.traderAddress.toLowerCase();
    const account = state.accounts[address] || emptyAccount(address);
    const posKey = positionKeyFor(trade);
    const marketKey = marketKeyForTrade(trade);
    const price = Number.isFinite(trade.price) && trade.price > 0 ? trade.price : 0;

    if (!posKey || !marketKey || price <= 0) {
        appendRecent(account, {
            type: trade.type,
            market: shortMarket(trade.market || trade.tokenId),
            note: 'skipped invalid market or price',
        });
        state.accounts[address] = account;
        savePortfolios(state);
        return { action: 'skipped', reason: 'invalid market or price', account };
    }

    if (trade.type === 'BUY') {
        const existing = account.positions[posKey];
        const alreadySpent = marketCost(account, marketKey);
        const remainingCap = Math.max(0, config.maxPositionSize - alreadySpent);
        let cost = Math.min(tradeSize(account, trade), remainingCap, account.cash);

        const effectiveMin = Math.max(config.minTradeSize, 1);
        if (cost < effectiveMin) {
            const reason = remainingCap <= 0 ? 'outcome cap reached' : 'below minimum';
            account.skippedBuys += 1;
            appendRecent(account, {
                type: 'BUY',
                market: shortMarket(trade.market || trade.tokenId),
                note: reason === 'outcome cap reached'
                    ? `skipped cap $${config.maxPositionSize.toFixed(2)} per outcome`
                    : `skipped size $${cost.toFixed(2)} < $${effectiveMin}`,
            });
            account.updatedAt = new Date().toISOString();
            state.accounts[address] = account;
            savePortfolios(state);
            return { action: 'skipped', reason, account };
        }

        const shares = cost / price;
        if (existing) {
            const newShares = existing.shares + shares;
            const newTotalCost = existing.totalCost + cost;
            account.positions[posKey] = {
                ...existing,
                shares: newShares,
                totalCost: newTotalCost,
                avgBuyPrice: newTotalCost / newShares,
                lastPrice: price,
                marketKey: existing.marketKey || marketKey,
                updatedAt: new Date().toISOString(),
            };
        } else {
            account.positions[posKey] = {
                conditionId: trade.conditionId,
                tokenId: trade.tokenId,
                marketKey,
                market: shortMarket(trade.market || trade.tokenId),
                outcome: trade.outcome || '',
                shares,
                avgBuyPrice: price,
                totalCost: cost,
                lastPrice: price,
                status: 'open',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
        }

        account.cash -= cost;
        account.totalBuys += 1;
        appendRecent(account, {
            type: 'BUY',
            market: shortMarket(trade.market || trade.tokenId),
            cost,
            shares,
            price,
        });
        account.updatedAt = new Date().toISOString();
        state.accounts[address] = account;
        savePortfolios(state);
        return { action: 'buy', cost, shares, account };
    }

    if (trade.type === 'SELL') {
        const position = account.positions[posKey];
        if (!position) {
            account.skippedSells += 1;
            appendRecent(account, {
                type: 'SELL',
                market: shortMarket(trade.market || trade.tokenId),
                note: 'skipped no local paper position',
            });
            account.updatedAt = new Date().toISOString();
            state.accounts[address] = account;
            savePortfolios(state);
            return { action: 'skipped', reason: 'no position', account };
        }

        const requestedShares = Number.isFinite(trade.size) && trade.size > 0 ? trade.size : position.shares;
        const sharesToSell = Math.min(position.shares, requestedShares);
        const proceeds = sharesToSell * price;
        const costBasis = position.avgBuyPrice * sharesToSell;
        const pnl = proceeds - costBasis;

        position.shares -= sharesToSell;
        position.totalCost = Math.max(0, position.totalCost - costBasis);
        position.lastPrice = price;
        position.updatedAt = new Date().toISOString();

        if (position.shares <= 0.000001) {
            delete account.positions[posKey];
        } else {
            account.positions[posKey] = position;
        }

        account.cash += proceeds;
        account.totalSells += 1;
        account.realizedPnl += pnl;
        appendRecent(account, {
            type: 'SELL',
            market: shortMarket(trade.market || trade.tokenId),
            proceeds,
            shares: sharesToSell,
            price,
            pnl,
        });
        account.updatedAt = new Date().toISOString();
        state.accounts[address] = account;
        savePortfolios(state);
        return { action: 'sell', proceeds, shares: sharesToSell, pnl, account };
    }

    state.accounts[address] = account;
    savePortfolios(state);
    return { action: 'skipped', reason: 'unsupported trade type', account };
}

export function portfolioSummary() {
    const state = getPortfolios();
    return Object.values(state.accounts || {}).map((account) => {
        const positions = Object.values(account.positions || {});
        const openCost = positions.reduce((sum, pos) => sum + (pos.totalCost || 0), 0);
        const startBalance = account.startBalance || config.simStartBalance;
        const equity = account.cash + openCost;
        return {
            ...account,
            startBalance,
            positions,
            openCost,
            equity,
            totalPnl: equity - startBalance,
        };
    });
}
