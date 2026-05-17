import config from '../config/index.js';
import { proxyFetch } from '../utils/proxy.js';
import { walletAnalyticsQuery } from './walletAnalyticsDb.js';

function asNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function toUnixSeconds(value) {
    const millis = new Date(value).getTime();
    return Number.isFinite(millis) ? Math.floor(millis / 1000) : 0;
}

async function fetchJson(url) {
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
    return response.json();
}

function normalizePriceHistory(payload) {
    const history = Array.isArray(payload?.history) ? payload.history : [];
    return history
        .map((point) => ({
            t: asNumber(point.t),
            p: asNumber(point.p),
        }))
        .filter((point) => point.t > 0 && point.p > 0)
        .sort((a, b) => a.t - b.t);
}

function pickFuturePoint(history, targetTs) {
    if (history.length === 0) return null;
    let best = null;
    for (const point of history) {
        if (point.t >= targetTs) {
            best = point;
            break;
        }
    }
    return best || history[history.length - 1];
}

function normalizeBookSide(levels) {
    if (!Array.isArray(levels)) return [];
    return levels
        .map((level) => ({
            price: asNumber(level.price ?? level.p),
            size: asNumber(level.size ?? level.s),
        }))
        .filter((level) => level.price > 0 && level.size > 0);
}

function estimateFillFromBook(book, side, targetNotional) {
    const levels = side === 'BUY'
        ? normalizeBookSide(book.asks).sort((a, b) => a.price - b.price)
        : normalizeBookSide(book.bids).sort((a, b) => b.price - a.price);

    let remaining = targetNotional;
    let cost = 0;
    let shares = 0;

    for (const level of levels) {
        if (remaining <= 0) break;
        const levelNotional = level.price * level.size;
        const takeNotional = Math.min(remaining, levelNotional);
        const takeShares = takeNotional / level.price;
        cost += takeNotional;
        shares += takeShares;
        remaining -= takeNotional;
    }

    if (shares <= 0) {
        return {
            estimatedAvgPrice: null,
            fillable: false,
            status: 'empty_book',
        };
    }

    return {
        estimatedAvgPrice: cost / shares,
        fillable: remaining <= 0.000001,
        status: remaining <= 0.000001 ? 'ok' : 'insufficient_depth',
    };
}

async function fetchPriceHistory(tokenId, startTs, endTs) {
    const url = new URL(`${config.clobHost}/prices-history`);
    url.searchParams.set('market', tokenId);
    url.searchParams.set('startTs', String(startTs));
    url.searchParams.set('endTs', String(endTs));
    url.searchParams.set('fidelity', String(config.walletAnalyticsPriceHistoryFidelity));
    const payload = await fetchJson(url.toString());
    return {
        payload,
        history: normalizePriceHistory(payload),
    };
}

async function fetchOrderBook(tokenId) {
    const url = new URL(`${config.clobHost}/book`);
    url.searchParams.set('token_id', tokenId);
    return fetchJson(url.toString());
}

async function loadTradesForMarketData(address) {
    const result = await walletAnalyticsQuery(`
        select
            id,
            wallet_address,
            trade_time,
            side,
            token_id,
            price::float8 as price,
            usdc_size::float8 as usdc_size
        from wallet_historical_trades
        where wallet_address = $1
        order by trade_time desc
        limit $2;
    `, [address.toLowerCase(), config.walletAnalyticsClvLimit]);
    return result.rows;
}

async function saveClv(trade, observation) {
    await walletAnalyticsQuery(`
        insert into wallet_trade_clv (
            trade_id, wallet_address, token_id, side, entry_price, future_price,
            clv, clv_window_minutes, price_timestamp, source, status, raw_observation, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'clob_prices_history', $10, $11::jsonb, now())
        on conflict (trade_id) do update set
            future_price = excluded.future_price,
            clv = excluded.clv,
            clv_window_minutes = excluded.clv_window_minutes,
            price_timestamp = excluded.price_timestamp,
            source = excluded.source,
            status = excluded.status,
            raw_observation = excluded.raw_observation,
            updated_at = excluded.updated_at;
    `, [
        trade.id,
        trade.wallet_address,
        trade.token_id,
        trade.side,
        trade.price,
        observation.futurePrice,
        observation.clv,
        config.walletAnalyticsClvWindowMinutes,
        observation.priceTimestamp,
        observation.status,
        JSON.stringify(observation.rawObservation || {}),
    ]);
}

async function saveLiquidity(trade, observation) {
    await walletAnalyticsQuery(`
        insert into wallet_trade_liquidity (
            trade_id, wallet_address, token_id, side, target_notional, target_price,
            estimated_avg_price, estimated_slippage, fillable, snapshot_at, source, status, raw_snapshot
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), 'clob_current_book', $10, $11::jsonb)
        on conflict (trade_id) do update set
            target_notional = excluded.target_notional,
            target_price = excluded.target_price,
            estimated_avg_price = excluded.estimated_avg_price,
            estimated_slippage = excluded.estimated_slippage,
            fillable = excluded.fillable,
            snapshot_at = excluded.snapshot_at,
            source = excluded.source,
            status = excluded.status,
            raw_snapshot = excluded.raw_snapshot;
    `, [
        trade.id,
        trade.wallet_address,
        trade.token_id,
        trade.side,
        trade.usdc_size,
        trade.price,
        observation.estimatedAvgPrice,
        observation.estimatedSlippage,
        observation.fillable,
        observation.status,
        JSON.stringify(observation.rawSnapshot || {}),
    ]);
}

async function analyzeTradeMarketData(trade) {
    const tradeTs = toUnixSeconds(trade.trade_time);
    const futureTs = tradeTs + (config.walletAnalyticsClvWindowMinutes * 60);
    const endTs = futureTs + (config.walletAnalyticsPriceHistoryFidelity * 60);

    let clvObservation = {
        futurePrice: null,
        clv: null,
        priceTimestamp: null,
        status: 'unknown',
        rawObservation: {},
    };
    try {
        const priceHistory = await fetchPriceHistory(trade.token_id, tradeTs, endTs);
        const futurePoint = pickFuturePoint(priceHistory.history, futureTs);
        if (futurePoint) {
            const rawClv = trade.side === 'BUY'
                ? futurePoint.p - trade.price
                : trade.price - futurePoint.p;
            clvObservation = {
                futurePrice: futurePoint.p,
                clv: rawClv,
                priceTimestamp: new Date(futurePoint.t * 1000).toISOString(),
                status: 'ok',
                rawObservation: {
                    targetTs: futureTs,
                    point: futurePoint,
                    historyCount: priceHistory.history.length,
                },
            };
        } else {
            clvObservation = {
                ...clvObservation,
                status: 'no_history',
                rawObservation: { historyCount: priceHistory.history.length },
            };
        }
    } catch (err) {
        clvObservation = {
            ...clvObservation,
            status: 'fetch_error',
            rawObservation: { error: err.message },
        };
    }
    await saveClv(trade, clvObservation);

    let liquidityObservation = {
        estimatedAvgPrice: null,
        estimatedSlippage: null,
        fillable: false,
        status: 'unknown',
        rawSnapshot: {},
    };
    try {
        const book = await fetchOrderBook(trade.token_id);
        const fill = estimateFillFromBook(book, trade.side, asNumber(trade.usdc_size));
        const estimatedSlippage = fill.estimatedAvgPrice === null
            ? null
            : trade.side === 'BUY'
                ? fill.estimatedAvgPrice - trade.price
                : trade.price - fill.estimatedAvgPrice;
        liquidityObservation = {
            estimatedAvgPrice: fill.estimatedAvgPrice,
            estimatedSlippage,
            fillable: fill.fillable,
            status: fill.status,
            rawSnapshot: {
                bookHash: book.hash || null,
                timestamp: book.timestamp || null,
                bidLevels: Array.isArray(book.bids) ? book.bids.length : 0,
                askLevels: Array.isArray(book.asks) ? book.asks.length : 0,
            },
        };
    } catch (err) {
        liquidityObservation = {
            ...liquidityObservation,
            status: 'fetch_error',
            rawSnapshot: { error: err.message },
        };
    }
    await saveLiquidity(trade, liquidityObservation);

    return {
        tradeId: trade.id,
        clvStatus: clvObservation.status,
        clv: clvObservation.clv,
        liquidityStatus: liquidityObservation.status,
        estimatedSlippage: liquidityObservation.estimatedSlippage,
    };
}

export async function analyzeWalletMarketData(address, logger = console) {
    const normalized = address.toLowerCase();
    if (!config.walletAnalyticsEnableClv) {
        logger.info?.('Wallet analytics CLV is disabled by WALLET_ANALYTICS_ENABLE_CLV=false');
        return { address: normalized, analyzedTrades: 0, skipped: true };
    }

    const trades = await loadTradesForMarketData(normalized);
    logger.info?.(`Analyzing CLOB market data for ${trades.length} trade(s)`);

    let analyzedTrades = 0;
    let clvOk = 0;
    let liquidityOk = 0;
    for (const trade of trades) {
        const result = await analyzeTradeMarketData(trade);
        analyzedTrades += 1;
        if (result.clvStatus === 'ok') clvOk += 1;
        if (result.liquidityStatus === 'ok') liquidityOk += 1;
    }

    return {
        address: normalized,
        analyzedTrades,
        clvOk,
        liquidityOk,
    };
}
