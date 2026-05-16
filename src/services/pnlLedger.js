import pg from 'pg';
import config from '../config/index.js';

const { Pool } = pg;

let pool = null;
let initialized = false;
let enabled = false;

function asNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function shortMarket(name) {
    return (name || '').replace(/\s+/g, ' ').trim();
}

function marketKeyForTrade(trade) {
    return trade.conditionId || shortMarket(trade.market).toLowerCase() || trade.tokenId || '';
}

function createPool() {
    return new Pool({
        connectionString: config.databaseUrl,
        max: config.databasePoolSize,
        connectionTimeoutMillis: config.databaseConnectTimeoutMs,
        idleTimeoutMillis: 30000,
    });
}

async function query(text, params = []) {
    if (!enabled || !pool) return { rows: [] };
    return pool.query(text, params);
}

function summarizeAccounts(accounts, simConfig) {
    const totalStart = accounts.reduce((sum, account) => sum + (account.startBalance || simConfig.simStartBalance), 0);
    const totalCash = accounts.reduce((sum, account) => sum + asNumber(account.cash), 0);
    const totalOpenCost = accounts.reduce((sum, account) => sum + asNumber(account.openCost), 0);
    const totalEquity = accounts.reduce((sum, account) => sum + asNumber(account.equity), 0);
    const realizedPnl = accounts.reduce((sum, account) => sum + asNumber(account.realizedPnl), 0);

    return {
        totalStart,
        totalCash,
        totalOpenCost,
        totalEquity,
        totalPnl: totalEquity - totalStart,
        realizedPnl,
        walletCount: accounts.length,
        openPositions: accounts.reduce((sum, account) => sum + (account.positions || []).length, 0),
        totalBuys: accounts.reduce((sum, account) => sum + asNumber(account.totalBuys), 0),
        totalSells: accounts.reduce((sum, account) => sum + asNumber(account.totalSells), 0),
    };
}

export async function initPnlLedger(logger = console) {
    if (initialized) return enabled;

    if (!config.databaseUrl) {
        initialized = true;
        enabled = false;
        logger.warn?.('DATABASE_URL is not set. PnL database recording is disabled.');
        return false;
    }

    pool = createPool();
    try {
        await pool.query('select 1');
        await pool.query(`
            create table if not exists paper_trades (
                id text primary key,
                created_at timestamptz not null default now(),
                trader_address text not null,
                action text not null check (action in ('BUY', 'SELL')),
                source_trade_type text not null,
                token_id text not null,
                condition_id text not null,
                market_key text not null,
                market text not null,
                outcome text not null,
                price numeric(18, 8) not null,
                shares numeric(28, 8) not null,
                cost numeric(18, 8),
                proceeds numeric(18, 8),
                pnl numeric(18, 8) not null default 0,
                cash_after numeric(18, 8) not null,
                realized_pnl_after numeric(18, 8) not null,
                raw_trade jsonb not null default '{}'::jsonb
            );
        `);
        await pool.query(`
            create index if not exists idx_paper_trades_created_at
            on paper_trades (created_at desc);
        `);
        await pool.query(`
            create index if not exists idx_paper_trades_wallet_created_at
            on paper_trades (trader_address, created_at desc);
        `);
        await pool.query(`
            create table if not exists portfolio_snapshots (
                id bigserial primary key,
                created_at timestamptz not null default now(),
                reason text not null,
                total_start numeric(18, 8) not null,
                total_cash numeric(18, 8) not null,
                total_open_cost numeric(18, 8) not null,
                total_equity numeric(18, 8) not null,
                total_pnl numeric(18, 8) not null,
                realized_pnl numeric(18, 8) not null,
                wallet_count integer not null,
                open_positions integer not null,
                total_buys integer not null,
                total_sells integer not null,
                wallets jsonb not null
            );
        `);
        await pool.query(`
            create index if not exists idx_portfolio_snapshots_created_at
            on portfolio_snapshots (created_at desc);
        `);

        initialized = true;
        enabled = true;
        logger.info?.('PnL database initialized');
        return true;
    } catch (err) {
        initialized = true;
        enabled = false;
        await closePnlLedger();
        logger.error?.(`PnL database disabled: ${err.message}`);
        return false;
    }
}

export async function closePnlLedger() {
    if (!pool) return;
    const currentPool = pool;
    pool = null;
    enabled = false;
    await currentPool.end().catch(() => {});
}

export async function recordPnlTrade(trade, result, logger = console) {
    if (!enabled || !['buy', 'sell'].includes(result.action)) return null;

    const action = result.action.toUpperCase();
    const id = `${trade.id || `${trade.traderAddress}-${trade.timestamp}-${trade.tokenId}`}-${action}`;
    const record = {
        id,
        traderAddress: (trade.traderAddress || '').toLowerCase(),
        action,
        sourceTradeType: trade.type,
        tokenId: trade.tokenId || '',
        conditionId: trade.conditionId || '',
        marketKey: marketKeyForTrade(trade),
        market: shortMarket(trade.market || trade.tokenId),
        outcome: trade.outcome || '',
        price: asNumber(trade.price),
        shares: asNumber(result.shares),
        cost: result.action === 'buy' ? asNumber(result.cost) : null,
        proceeds: result.action === 'sell' ? asNumber(result.proceeds) : null,
        pnl: result.action === 'sell' ? asNumber(result.pnl) : 0,
        cashAfter: asNumber(result.account?.cash),
        realizedPnlAfter: asNumber(result.account?.realizedPnl),
        rawTrade: trade,
    };

    try {
        await query(`
            insert into paper_trades (
                id, trader_address, action, source_trade_type, token_id, condition_id,
                market_key, market, outcome, price, shares, cost, proceeds, pnl,
                cash_after, realized_pnl_after, raw_trade
            )
            values (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11, $12, $13, $14,
                $15, $16, $17::jsonb
            )
            on conflict (id) do nothing;
        `, [
            record.id,
            record.traderAddress,
            record.action,
            record.sourceTradeType,
            record.tokenId,
            record.conditionId,
            record.marketKey,
            record.market,
            record.outcome,
            record.price,
            record.shares,
            record.cost,
            record.proceeds,
            record.pnl,
            record.cashAfter,
            record.realizedPnlAfter,
            JSON.stringify(record.rawTrade),
        ]);
        return record;
    } catch (err) {
        logger.warn?.(`Failed to record PnL trade: ${err.message}`);
        return null;
    }
}

export async function recordPnlSnapshot(accounts, simConfig = config, reason = 'interval', logger = console) {
    if (!enabled) return null;

    const totals = summarizeAccounts(accounts, simConfig);
    const wallets = accounts.map((account) => ({
        address: account.address,
        startBalance: account.startBalance || simConfig.simStartBalance,
        cash: asNumber(account.cash),
        openCost: asNumber(account.openCost),
        equity: asNumber(account.equity),
        totalPnl: asNumber(account.totalPnl),
        realizedPnl: asNumber(account.realizedPnl),
        openPositions: (account.positions || []).length,
        totalBuys: asNumber(account.totalBuys),
        totalSells: asNumber(account.totalSells),
    }));

    try {
        const result = await query(`
            insert into portfolio_snapshots (
                reason, total_start, total_cash, total_open_cost, total_equity,
                total_pnl, realized_pnl, wallet_count, open_positions,
                total_buys, total_sells, wallets
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
            returning id, created_at;
        `, [
            reason,
            totals.totalStart,
            totals.totalCash,
            totals.totalOpenCost,
            totals.totalEquity,
            totals.totalPnl,
            totals.realizedPnl,
            totals.walletCount,
            totals.openPositions,
            totals.totalBuys,
            totals.totalSells,
            JSON.stringify(wallets),
        ]);

        return {
            id: result.rows[0]?.id,
            createdAt: result.rows[0]?.created_at,
            reason,
            totals,
            wallets,
        };
    } catch (err) {
        logger.warn?.(`Failed to record PnL snapshot: ${err.message}`);
        return null;
    }
}

export async function getPnlReport(limit = config.pnlHistoryLimit) {
    if (!enabled) {
        return {
            enabled: false,
            summary: null,
            byWallet: [],
            trades: [],
            snapshots: [],
        };
    }

    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;
    const [summaryResult, walletResult, tradeResult, snapshotResult] = await Promise.all([
        query(`
            select
                count(*) filter (where action = 'BUY')::int as total_buys,
                count(*) filter (where action = 'SELL')::int as total_sells,
                coalesce(sum(cost) filter (where action = 'BUY'), 0)::float8 as buy_volume,
                coalesce(sum(proceeds) filter (where action = 'SELL'), 0)::float8 as sell_volume,
                coalesce(sum(pnl) filter (where action = 'SELL'), 0)::float8 as realized_pnl
            from paper_trades;
        `),
        query(`
            select
                trader_address,
                count(*) filter (where action = 'BUY')::int as total_buys,
                count(*) filter (where action = 'SELL')::int as total_sells,
                coalesce(sum(cost) filter (where action = 'BUY'), 0)::float8 as buy_volume,
                coalesce(sum(proceeds) filter (where action = 'SELL'), 0)::float8 as sell_volume,
                coalesce(sum(pnl) filter (where action = 'SELL'), 0)::float8 as realized_pnl,
                max(created_at) as updated_at
            from paper_trades
            group by trader_address
            order by trader_address;
        `),
        query(`
            select
                id,
                created_at,
                trader_address,
                action,
                market,
                outcome,
                price::float8 as price,
                shares::float8 as shares,
                cost::float8 as cost,
                proceeds::float8 as proceeds,
                pnl::float8 as pnl,
                cash_after::float8 as cash_after,
                realized_pnl_after::float8 as realized_pnl_after
            from paper_trades
            order by created_at desc
            limit $1;
        `, [safeLimit]),
        query(`
            select
                id,
                created_at,
                reason,
                total_start::float8 as total_start,
                total_cash::float8 as total_cash,
                total_open_cost::float8 as total_open_cost,
                total_equity::float8 as total_equity,
                total_pnl::float8 as total_pnl,
                realized_pnl::float8 as realized_pnl,
                wallet_count,
                open_positions,
                total_buys,
                total_sells,
                wallets
            from portfolio_snapshots
            order by created_at desc
            limit $1;
        `, [Math.min(safeLimit, 300)]),
    ]);

    return {
        enabled: true,
        summary: summaryResult.rows[0] || null,
        byWallet: walletResult.rows,
        trades: tradeResult.rows,
        snapshots: snapshotResult.rows,
    };
}
