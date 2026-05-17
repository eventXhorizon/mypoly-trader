import config from '../config/index.js';
import {
    markWalletScored,
    walletAnalyticsQuery,
} from './walletAnalyticsDb.js';

function asNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function safeRatio(numerator, denominator, fallback = 0) {
    return denominator > 0 ? numerator / denominator : fallback;
}

function daysBetween(first, last) {
    if (!first || !last) return 0;
    const start = new Date(first).getTime();
    const end = new Date(last).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return (end - start) / 86_400_000;
}

function calculateDrawdown(pnlRows) {
    if (pnlRows.length === 0) return { maxDrawdownUsd: 0, maxDrawdownRatio: 0 };

    let equity = 0;
    let peak = 0;
    let maxDrawdownUsd = 0;
    for (const row of pnlRows) {
        equity += asNumber(row.realized_pnl);
        peak = Math.max(peak, equity);
        maxDrawdownUsd = Math.max(maxDrawdownUsd, peak - equity);
    }

    const grossProfit = pnlRows.reduce((sum, row) => {
        const pnl = asNumber(row.realized_pnl);
        return pnl > 0 ? sum + pnl : sum;
    }, 0);
    const maxDrawdownRatio = grossProfit > 0 ? maxDrawdownUsd / grossProfit : 0;
    return { maxDrawdownUsd, maxDrawdownRatio };
}

function scorePositive(value, target) {
    return clamp(safeRatio(value, target), 0, 1);
}

function scorePenalty(value, maxAllowed) {
    if (value <= 0) return 1;
    return clamp(1 - safeRatio(value, maxAllowed * 2), 0, 1);
}

function buildReasonCodes(metrics) {
    const reasons = [];

    if (metrics.tradeCount >= config.walletAnalyticsMinTrades) reasons.push('enough_trades');
    else reasons.push('insufficient_trades');

    if (metrics.settledMarketCount >= config.walletAnalyticsMinSettledMarkets) reasons.push('enough_settled_markets');
    else reasons.push('insufficient_settled_markets');

    if (metrics.realizedRoi > 0) reasons.push('positive_realized_roi');
    else reasons.push('non_positive_realized_roi');

    if (metrics.profitFactor >= config.walletAnalyticsMinProfitFactor) reasons.push('profit_factor_ok');
    else reasons.push('profit_factor_low');

    if (metrics.maxDrawdownRatio <= config.walletAnalyticsMaxDrawdown) reasons.push('drawdown_ok');
    else reasons.push('drawdown_high');

    if (metrics.topMarketProfitShare <= config.walletAnalyticsMaxTopMarketProfitShare) reasons.push('profit_not_concentrated');
    else reasons.push('profit_concentrated');

    if (metrics.tradesPerDay > 0 && metrics.tradesPerDay <= 50) reasons.push('frequency_copyable');
    else if (metrics.tradesPerDay > 50) reasons.push('frequency_high');
    else reasons.push('frequency_unknown');

    if (metrics.clvSampleCount > 0) {
        if (metrics.weightedClv > 0) reasons.push('positive_weighted_clv');
        else reasons.push('non_positive_weighted_clv');
    } else {
        reasons.push('clv_unknown');
    }

    if (metrics.liquiditySampleCount > 0) {
        if (metrics.copySlippageEstimate <= Math.max(0.01, Math.abs(metrics.weightedClv || 0) * 0.5)) reasons.push('copy_slippage_ok');
        else reasons.push('copy_slippage_high');
    } else {
        reasons.push('slippage_unknown');
    }

    return reasons;
}

function calculateScore(metrics) {
    const clvScore = metrics.clvSampleCount > 0 ? scorePositive(metrics.weightedClv, 0.03) : 0;
    const slippageScore = metrics.liquiditySampleCount > 0
        ? scorePenalty(Math.max(0, metrics.copySlippageEstimate), Math.max(0.01, Math.abs(metrics.weightedClv || 0) * 0.5))
        : 0;
    const roiScore = scorePositive(metrics.realizedRoi, 0.20);
    const profitFactorScore = scorePositive(metrics.profitFactor - 1, config.walletAnalyticsMinProfitFactor - 1);
    const sampleScore = Math.min(
        scorePositive(metrics.tradeCount, config.walletAnalyticsMinTrades),
        scorePositive(metrics.settledMarketCount, config.walletAnalyticsMinSettledMarkets),
    );
    const drawdownScore = metrics.settledMarketCount > 0
        ? scorePenalty(metrics.maxDrawdownRatio, config.walletAnalyticsMaxDrawdown)
        : 0;
    const concentrationScore = metrics.grossProfit > 0
        ? scorePenalty(metrics.topMarketProfitShare, config.walletAnalyticsMaxTopMarketProfitShare)
        : 0;
    const frequencyScore = metrics.tradesPerDay > 0 && metrics.tradesPerDay <= 50
        ? 1
        : metrics.tradesPerDay > 50
            ? clamp(1 - ((metrics.tradesPerDay - 50) / 100), 0, 1)
            : 0;

    return 100 * (
        0.25 * clvScore
        + 0.10 * slippageScore
        + 0.20 * roiScore
        + 0.15 * profitFactorScore
        + 0.15 * sampleScore
        + 0.07 * drawdownScore
        + 0.04 * concentrationScore
        + 0.04 * frequencyScore
    );
}

function provisionalEligible(metrics) {
    return metrics.tradeCount >= config.walletAnalyticsMinTrades
        && metrics.settledMarketCount >= config.walletAnalyticsMinSettledMarkets
        && metrics.realizedRoi > 0
        && metrics.profitFactor >= config.walletAnalyticsMinProfitFactor
        && metrics.maxDrawdownRatio <= config.walletAnalyticsMaxDrawdown
        && metrics.topMarketProfitShare <= config.walletAnalyticsMaxTopMarketProfitShare
        && metrics.tradesPerDay > 0
        && metrics.tradesPerDay <= 50;
}

function fullyEligible(metrics) {
    return provisionalEligible(metrics)
        && metrics.clvSampleCount > 0
        && metrics.weightedClv > 0
        && metrics.liquiditySampleCount > 0
        && metrics.copySlippageEstimate <= Math.max(0.01, Math.abs(metrics.weightedClv) * 0.5);
}

async function loadTradeStats(address) {
    const result = await walletAnalyticsQuery(`
        select
            count(*)::int as trade_count,
            min(trade_time) as first_trade_at,
            max(trade_time) as last_trade_at,
            count(distinct market_key)::int as traded_market_count
        from wallet_historical_trades
        where wallet_address = $1;
    `, [address]);
    return result.rows[0] || {};
}

async function loadClosedPositionStats(address) {
    const [summary, pnlRows, marketProfitRows] = await Promise.all([
        walletAnalyticsQuery(`
            select
                count(*)::int as closed_position_count,
                count(distinct market_key)::int as settled_market_count,
                coalesce(sum(realized_pnl), 0)::float8 as realized_pnl,
                coalesce(sum(buy_volume), 0)::float8 as buy_volume,
                coalesce(sum(realized_pnl) filter (where realized_pnl > 0), 0)::float8 as gross_profit,
                abs(coalesce(sum(realized_pnl) filter (where realized_pnl < 0), 0))::float8 as gross_loss
            from wallet_closed_positions
            where wallet_address = $1;
        `, [address]),
        walletAnalyticsQuery(`
            select realized_pnl::float8 as realized_pnl, coalesce(closed_at, end_time, created_at) as event_time
            from wallet_closed_positions
            where wallet_address = $1
            order by coalesce(closed_at, end_time, created_at) asc;
        `, [address]),
        walletAnalyticsQuery(`
            select
                market_key,
                coalesce(sum(realized_pnl), 0)::float8 as market_pnl
            from wallet_closed_positions
            where wallet_address = $1
            group by market_key
            order by market_pnl desc;
        `, [address]),
    ]);

    return {
        summary: summary.rows[0] || {},
        pnlRows: pnlRows.rows,
        marketProfitRows: marketProfitRows.rows,
    };
}

async function loadMarketDataStats(address) {
    const [clvResult, liquidityResult] = await Promise.all([
        walletAnalyticsQuery(`
            select
                count(*) filter (where status = 'ok' and clv is not null)::int as clv_sample_count,
                coalesce(
                    sum((clv::float8) * greatest(abs(t.usdc_size::float8), 0.000001))
                    / nullif(sum(greatest(abs(t.usdc_size::float8), 0.000001)), 0),
                    0
                )::float8 as weighted_clv,
                avg(clv::float8) filter (where status = 'ok' and clv is not null)::float8 as average_clv
            from wallet_trade_clv c
            join wallet_historical_trades t on t.id = c.trade_id
            where c.wallet_address = $1;
        `, [address]),
        walletAnalyticsQuery(`
            select
                count(*) filter (where status in ('ok', 'insufficient_depth') and estimated_slippage is not null)::int as liquidity_sample_count,
                coalesce(
                    sum((estimated_slippage::float8) * greatest(abs(target_notional::float8), 0.000001))
                    / nullif(sum(greatest(abs(target_notional::float8), 0.000001)), 0),
                    0
                )::float8 as copy_slippage_estimate,
                count(*) filter (where fillable)::int as fillable_count
            from wallet_trade_liquidity
            where wallet_address = $1;
        `, [address]),
    ]);

    return {
        clv: clvResult.rows[0] || {},
        liquidity: liquidityResult.rows[0] || {},
    };
}

export async function scoreWallet(address, logger = console) {
    const normalized = address.toLowerCase();
    const [tradeStats, closedStats, marketDataStats] = await Promise.all([
        loadTradeStats(normalized),
        loadClosedPositionStats(normalized),
        loadMarketDataStats(normalized),
    ]);

    const closedSummary = closedStats.summary;
    const tradeCount = asNumber(tradeStats.trade_count);
    const settledMarketCount = asNumber(closedSummary.settled_market_count);
    const realizedPnl = asNumber(closedSummary.realized_pnl);
    const buyVolume = asNumber(closedSummary.buy_volume);
    const grossProfit = asNumber(closedSummary.gross_profit);
    const grossLoss = asNumber(closedSummary.gross_loss);
    const realizedRoi = safeRatio(realizedPnl, buyVolume);
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 999 : 0);
    const tradeDays = daysBetween(tradeStats.first_trade_at, tradeStats.last_trade_at);
    const tradesPerDay = tradeDays > 0 ? tradeCount / tradeDays : 0;
    const drawdown = calculateDrawdown(closedStats.pnlRows);
    const topMarketProfit = Math.max(0, ...closedStats.marketProfitRows.map((row) => asNumber(row.market_pnl)));
    const topMarketProfitShare = grossProfit > 0 ? topMarketProfit / grossProfit : 0;
    const clvSampleCount = asNumber(marketDataStats.clv.clv_sample_count);
    const liquiditySampleCount = asNumber(marketDataStats.liquidity.liquidity_sample_count);
    const fillableCount = asNumber(marketDataStats.liquidity.fillable_count);

    const metrics = {
        stage: 'stage1b',
        tradeCount,
        tradedMarketCount: asNumber(tradeStats.traded_market_count),
        settledMarketCount,
        closedPositionCount: asNumber(closedSummary.closed_position_count),
        firstTradeAt: tradeStats.first_trade_at || null,
        lastTradeAt: tradeStats.last_trade_at || null,
        tradeDays,
        tradesPerDay,
        realizedPnl,
        buyVolume,
        realizedRoi,
        grossProfit,
        grossLoss,
        profitFactor,
        maxDrawdownUsd: drawdown.maxDrawdownUsd,
        maxDrawdownRatio: drawdown.maxDrawdownRatio,
        topMarketProfit,
        topMarketProfitShare,
        clvSampleCount,
        weightedClv: clvSampleCount > 0 ? asNumber(marketDataStats.clv.weighted_clv) : null,
        averageClv: clvSampleCount > 0 ? asNumber(marketDataStats.clv.average_clv) : null,
        liquiditySampleCount,
        fillableCount,
        fillableRate: liquiditySampleCount > 0 ? fillableCount / liquiditySampleCount : null,
        copySlippageEstimate: liquiditySampleCount > 0 ? asNumber(marketDataStats.liquidity.copy_slippage_estimate) : null,
        copySlippageSource: liquiditySampleCount > 0 ? 'current_orderbook_estimate' : null,
    };

    const reasonCodes = buildReasonCodes(metrics);
    const score = calculateScore(metrics);
    const isProvisionalEligible = provisionalEligible(metrics);
    const isEligible = fullyEligible(metrics);

    await walletAnalyticsQuery(`
        insert into wallet_scores (
            wallet_address, score, eligible, provisional_eligible, stage, reason_codes, metrics, scored_at
        )
        values ($1, $2, $3, $4, 'stage1b', $5, $6::jsonb, now())
        on conflict (wallet_address) do update set
            score = excluded.score,
            eligible = excluded.eligible,
            provisional_eligible = excluded.provisional_eligible,
            stage = excluded.stage,
            reason_codes = excluded.reason_codes,
            metrics = excluded.metrics,
            scored_at = excluded.scored_at;
    `, [
        normalized,
        score,
        isEligible,
        isProvisionalEligible,
        reasonCodes,
        JSON.stringify(metrics),
    ]);
    await markWalletScored(normalized);

    const result = {
        walletAddress: normalized,
        score,
        eligible: isEligible,
        provisionalEligible: isProvisionalEligible,
        stage: 'stage1b',
        reasonCodes,
        metrics,
    };

    logger.info?.(`Wallet score ${normalized}: ${score.toFixed(2)} eligible=${isEligible} provisional=${isProvisionalEligible}`);
    return result;
}

export async function getTopWalletScores(limit = 20) {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;
    const result = await walletAnalyticsQuery(`
        select
            s.wallet_address,
            s.score::float8 as score,
            s.eligible,
            s.provisional_eligible,
            s.stage,
            s.reason_codes,
            s.metrics,
            s.scored_at,
            c.status,
            c.source,
            c.notes
        from wallet_scores s
        join wallet_candidates c on c.address = s.wallet_address
        order by s.score desc, s.scored_at desc
        limit $1;
    `, [safeLimit]);
    return result.rows;
}
