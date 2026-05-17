import config from '../config/index.js';
import { proxyFetch } from '../utils/proxy.js';
import {
    markWalletBackfilled,
    upsertWalletCandidate,
    walletAnalyticsQuery,
} from './walletAnalyticsDb.js';

function asNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function asText(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    return String(value);
}

function normalizeTimestamp(value) {
    if (!value) return new Date(0).toISOString();
    if (typeof value === 'number') {
        const millis = value > 10_000_000_000 ? value : value * 1000;
        return new Date(millis).toISOString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

function shortMarket(name) {
    return asText(name).replace(/\s+/g, ' ').trim();
}

function marketKeyFor(item) {
    return asText(item.conditionId || item.condition_id || item.market || item.title || item.question || item.eventSlug || item.slug || '')
        .toLowerCase()
        .trim();
}

function tradeIdFor(address, trade) {
    const txHash = asText(trade.transactionHash || trade.transaction_hash || trade.txHash || trade.tx_hash);
    const tokenId = asText(trade.asset || trade.tokenId || trade.token_id);
    const side = asText(trade.side).toUpperCase();
    const timestamp = asText(trade.timestamp || trade.createdAt || trade.created_at || trade.time);
    if (txHash) return `${address}_${txHash}_${tokenId}_${side}`;
    return `${address}_${timestamp}_${tokenId}_${side}`;
}

function closedPositionIdFor(address, position) {
    const tokenId = asText(position.asset || position.tokenId || position.token_id);
    const conditionId = asText(position.conditionId || position.condition_id);
    const outcome = asText(position.outcome || position.title || position.market);
    const closedAt = asText(position.closedAt || position.closed_at || position.endDate || position.end_time || position.updatedAt);
    return `${address}_${conditionId || tokenId}_${outcome}_${closedAt}`.toLowerCase();
}

function normalizeTrade(address, raw) {
    const side = asText(raw.side || raw.type).toUpperCase();
    const tokenId = asText(raw.asset || raw.tokenId || raw.token_id);
    const price = asNumber(raw.price || raw.avgPrice || raw.averagePrice);
    const shares = asNumber(raw.size || raw.shares || raw.quantity);
    const usdcSize = asNumber(raw.usdcSize || raw.usdc_size || raw.amount || (price * shares));

    if (!['BUY', 'SELL'].includes(side) || !tokenId || price <= 0) {
        return null;
    }

    return {
        id: tradeIdFor(address, raw),
        walletAddress: address,
        tradeTime: normalizeTimestamp(raw.timestamp || raw.createdAt || raw.created_at || raw.time),
        side,
        tokenId,
        conditionId: asText(raw.conditionId || raw.condition_id),
        marketKey: marketKeyFor(raw) || tokenId,
        market: shortMarket(raw.title || raw.question || raw.market || raw.slug || tokenId),
        outcome: asText(raw.outcome || raw.outcomeName || raw.name),
        price,
        shares,
        usdcSize,
        transactionHash: asText(raw.transactionHash || raw.transaction_hash || raw.txHash || raw.tx_hash),
        rawTrade: raw,
    };
}

function normalizeClosedPosition(address, raw) {
    const tokenId = asText(raw.asset || raw.tokenId || raw.token_id);
    const conditionId = asText(raw.conditionId || raw.condition_id);
    const marketKey = marketKeyFor(raw) || tokenId || conditionId;
    if (!marketKey && !tokenId && !conditionId) return null;

    const realizedPnl = asNumber(raw.realizedPnl || raw.realized_pnl || raw.pnl || raw.realized || raw.totalPnl);
    const totalBought = asNumber(raw.totalBought || raw.total_bought || raw.bought || raw.totalBuyShares);
    const totalSold = asNumber(raw.totalSold || raw.total_sold || raw.sold || raw.totalSellShares);
    const buyVolume = asNumber(raw.buyVolume || raw.buy_volume || raw.totalBoughtUsd || raw.totalBoughtUSDC || raw.cost);
    const sellVolume = asNumber(raw.sellVolume || raw.sell_volume || raw.totalSoldUsd || raw.totalSoldUSDC || raw.proceeds);

    return {
        id: closedPositionIdFor(address, raw),
        walletAddress: address,
        tokenId,
        conditionId,
        marketKey,
        market: shortMarket(raw.title || raw.question || raw.market || raw.slug || marketKey),
        outcome: asText(raw.outcome || raw.outcomeName || raw.name),
        realizedPnl,
        totalBought,
        totalSold,
        buyVolume,
        sellVolume,
        endTime: raw.endDate || raw.end_time || raw.endTime ? normalizeTimestamp(raw.endDate || raw.end_time || raw.endTime) : null,
        closedAt: raw.closedAt || raw.closed_at || raw.updatedAt ? normalizeTimestamp(raw.closedAt || raw.closed_at || raw.updatedAt) : null,
        rawPosition: raw,
    };
}

async function fetchJson(url, logger = console) {
    let response;
    try {
        response = await proxyFetch(url, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(15000),
        });
    } catch (err) {
        const cause = err.cause?.message ? `: ${err.cause.message}` : '';
        throw new Error(`Fetch failed for ${url}${cause}`);
    }
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 160)}`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) {
        logger.warn?.(`Expected array response from ${url}; got ${typeof payload}`);
        return [];
    }
    return payload;
}

async function fetchPaged(path, address, maxItems, logger = console) {
    const rows = [];
    const pageLimit = Math.min(config.walletAnalyticsPageLimit, maxItems);

    for (let offset = 0; rows.length < maxItems; offset += pageLimit) {
        const url = new URL(`${config.dataHost}${path}`);
        url.searchParams.set('user', address);
        url.searchParams.set('limit', String(pageLimit));
        url.searchParams.set('offset', String(offset));

        const page = await fetchJson(url.toString(), logger);
        rows.push(...page);
        if (page.length < pageLimit) break;
    }

    return rows.slice(0, maxItems);
}

async function saveTrades(trades) {
    let inserted = 0;
    for (const trade of trades) {
        const result = await walletAnalyticsQuery(`
            insert into wallet_historical_trades (
                id, wallet_address, trade_time, side, token_id, condition_id,
                market_key, market, outcome, price, shares, usdc_size,
                transaction_hash, raw_trade
            )
            values (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11, $12,
                $13, $14::jsonb
            )
            on conflict (id) do nothing;
        `, [
            trade.id,
            trade.walletAddress,
            trade.tradeTime,
            trade.side,
            trade.tokenId,
            trade.conditionId,
            trade.marketKey,
            trade.market,
            trade.outcome,
            trade.price,
            trade.shares,
            trade.usdcSize,
            trade.transactionHash,
            JSON.stringify(trade.rawTrade),
        ]);
        inserted += result.rowCount;
    }
    return inserted;
}

async function saveClosedPositions(positions) {
    let inserted = 0;
    for (const position of positions) {
        const result = await walletAnalyticsQuery(`
            insert into wallet_closed_positions (
                id, wallet_address, token_id, condition_id, market_key, market, outcome,
                realized_pnl, total_bought, total_sold, buy_volume, sell_volume,
                end_time, closed_at, raw_position
            )
            values (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12,
                $13, $14, $15::jsonb
            )
            on conflict (id) do update set
                realized_pnl = excluded.realized_pnl,
                total_bought = excluded.total_bought,
                total_sold = excluded.total_sold,
                buy_volume = excluded.buy_volume,
                sell_volume = excluded.sell_volume,
                end_time = excluded.end_time,
                closed_at = excluded.closed_at,
                raw_position = excluded.raw_position;
        `, [
            position.id,
            position.walletAddress,
            position.tokenId,
            position.conditionId,
            position.marketKey,
            position.market,
            position.outcome,
            position.realizedPnl,
            position.totalBought,
            position.totalSold,
            position.buyVolume,
            position.sellVolume,
            position.endTime,
            position.closedAt,
            JSON.stringify(position.rawPosition),
        ]);
        inserted += result.rowCount;
    }
    return inserted;
}

export async function backfillWallet(address, logger = console) {
    const normalized = address.toLowerCase();
    await upsertWalletCandidate(normalized, 'manual');

    logger.info?.(`Backfilling wallet analytics for ${normalized}`);
    const [rawTrades, rawClosedPositions] = await Promise.all([
        fetchPaged(config.walletAnalyticsTradesPath, normalized, config.walletAnalyticsTradeLimit, logger),
        fetchPaged(config.walletAnalyticsClosedPositionsPath, normalized, config.walletAnalyticsClosedPositionLimit, logger),
    ]);

    const trades = rawTrades.map((row) => normalizeTrade(normalized, row)).filter(Boolean);
    const closedPositions = rawClosedPositions.map((row) => normalizeClosedPosition(normalized, row)).filter(Boolean);

    const [insertedTrades, insertedClosedPositions] = await Promise.all([
        saveTrades(trades),
        saveClosedPositions(closedPositions),
    ]);

    await markWalletBackfilled(normalized);

    return {
        address: normalized,
        fetchedTrades: rawTrades.length,
        savedTrades: trades.length,
        insertedTrades,
        fetchedClosedPositions: rawClosedPositions.length,
        savedClosedPositions: closedPositions.length,
        insertedClosedPositions,
    };
}
