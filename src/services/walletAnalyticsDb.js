import pg from 'pg';
import config from '../config/index.js';

const { Pool } = pg;

let pool = null;
let initialized = false;
let enabled = false;

function createPool() {
    return new Pool({
        connectionString: config.databaseUrl,
        max: config.databasePoolSize,
        connectionTimeoutMillis: config.databaseConnectTimeoutMs,
        idleTimeoutMillis: 30000,
    });
}

export function isWalletAnalyticsDbEnabled() {
    return enabled;
}

export async function initWalletAnalyticsReadOnlyDb(logger = console) {
    if (initialized) return enabled;

    if (!config.databaseUrl) {
        initialized = true;
        enabled = false;
        logger.warn?.('DATABASE_URL is not set. Wallet analytics read-only dashboard is disabled.');
        return false;
    }

    pool = createPool();
    try {
        await pool.query('select 1');
        initialized = true;
        enabled = true;
        logger.info?.('Wallet analytics database connected in read-only mode');
        return true;
    } catch (err) {
        initialized = true;
        enabled = false;
        await closeWalletAnalyticsDb();
        logger.error?.(`Wallet analytics read-only dashboard disabled: ${err.message}`);
        return false;
    }
}

export async function initWalletAnalyticsDb(logger = console) {
    if (initialized) return enabled;

    if (!config.databaseUrl) {
        initialized = true;
        enabled = false;
        logger.warn?.('DATABASE_URL is not set. Wallet analytics database is disabled.');
        return false;
    }

    pool = createPool();
    try {
        await pool.query('select 1');
        await pool.query(`
            create table if not exists wallet_candidates (
                address text primary key,
                status text not null default 'candidate'
                    check (status in ('candidate', 'paper_follow', 'rejected', 'disabled')),
                source text not null default 'manual',
                notes text not null default '',
                first_seen_at timestamptz not null default now(),
                last_backfilled_at timestamptz,
                last_scored_at timestamptz,
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now()
            );
        `);
        await pool.query(`
            create table if not exists wallet_historical_trades (
                id text primary key,
                wallet_address text not null references wallet_candidates(address) on delete cascade,
                trade_time timestamptz not null,
                side text not null check (side in ('BUY', 'SELL')),
                token_id text not null,
                condition_id text not null default '',
                market_key text not null,
                market text not null default '',
                outcome text not null default '',
                price numeric(18, 8) not null,
                shares numeric(28, 8) not null,
                usdc_size numeric(18, 8) not null,
                transaction_hash text not null default '',
                raw_trade jsonb not null default '{}'::jsonb,
                created_at timestamptz not null default now()
            );
        `);
        await pool.query(`
            create index if not exists idx_wallet_historical_trades_wallet_time
            on wallet_historical_trades (wallet_address, trade_time desc);
        `);
        await pool.query(`
            create index if not exists idx_wallet_historical_trades_market
            on wallet_historical_trades (market_key, token_id);
        `);
        await pool.query(`
            create table if not exists wallet_closed_positions (
                id text primary key,
                wallet_address text not null references wallet_candidates(address) on delete cascade,
                token_id text not null,
                condition_id text not null default '',
                market_key text not null,
                market text not null default '',
                outcome text not null default '',
                realized_pnl numeric(18, 8) not null default 0,
                total_bought numeric(18, 8) not null default 0,
                total_sold numeric(18, 8) not null default 0,
                buy_volume numeric(18, 8) not null default 0,
                sell_volume numeric(18, 8) not null default 0,
                end_time timestamptz,
                closed_at timestamptz,
                raw_position jsonb not null default '{}'::jsonb,
                created_at timestamptz not null default now()
            );
        `);
        await pool.query(`
            create index if not exists idx_wallet_closed_positions_wallet
            on wallet_closed_positions (wallet_address);
        `);
        await pool.query(`
            create table if not exists market_price_snapshots (
                id bigserial primary key,
                token_id text not null,
                captured_at timestamptz not null default now(),
                midpoint numeric(18, 8),
                bid numeric(18, 8),
                ask numeric(18, 8),
                spread numeric(18, 8),
                depth_usdc numeric(18, 8),
                source text not null default 'clob',
                raw_snapshot jsonb not null default '{}'::jsonb
            );
        `);
        await pool.query(`
            create index if not exists idx_market_price_snapshots_token_time
            on market_price_snapshots (token_id, captured_at desc);
        `);
        await pool.query(`
            create table if not exists wallet_trade_clv (
                trade_id text primary key references wallet_historical_trades(id) on delete cascade,
                wallet_address text not null references wallet_candidates(address) on delete cascade,
                token_id text not null,
                side text not null check (side in ('BUY', 'SELL')),
                entry_price numeric(18, 8) not null,
                future_price numeric(18, 8),
                clv numeric(18, 8),
                clv_window_minutes integer not null,
                price_timestamp timestamptz,
                source text not null default 'clob_prices_history',
                status text not null default 'unknown',
                raw_observation jsonb not null default '{}'::jsonb,
                updated_at timestamptz not null default now()
            );
        `);
        await pool.query(`
            create index if not exists idx_wallet_trade_clv_wallet
            on wallet_trade_clv (wallet_address, updated_at desc);
        `);
        await pool.query(`
            create table if not exists wallet_trade_liquidity (
                trade_id text primary key references wallet_historical_trades(id) on delete cascade,
                wallet_address text not null references wallet_candidates(address) on delete cascade,
                token_id text not null,
                side text not null check (side in ('BUY', 'SELL')),
                target_notional numeric(18, 8) not null,
                target_price numeric(18, 8) not null,
                estimated_avg_price numeric(18, 8),
                estimated_slippage numeric(18, 8),
                fillable boolean not null default false,
                snapshot_at timestamptz not null default now(),
                source text not null default 'clob_current_book',
                status text not null default 'unknown',
                raw_snapshot jsonb not null default '{}'::jsonb
            );
        `);
        await pool.query(`
            create index if not exists idx_wallet_trade_liquidity_wallet
            on wallet_trade_liquidity (wallet_address, snapshot_at desc);
        `);
        await pool.query(`
            create table if not exists wallet_scores (
                wallet_address text primary key references wallet_candidates(address) on delete cascade,
                score numeric(10, 4) not null default 0,
                eligible boolean not null default false,
                provisional_eligible boolean not null default false,
                stage text not null default 'stage1a',
                reason_codes text[] not null default '{}',
                metrics jsonb not null default '{}'::jsonb,
                scored_at timestamptz not null default now()
            );
        `);
        await pool.query(`
            create index if not exists idx_wallet_scores_score
            on wallet_scores (score desc);
        `);

        initialized = true;
        enabled = true;
        logger.info?.('Wallet analytics database initialized');
        return true;
    } catch (err) {
        initialized = true;
        enabled = false;
        await closeWalletAnalyticsDb();
        logger.error?.(`Wallet analytics database disabled: ${err.message}`);
        return false;
    }
}

export async function closeWalletAnalyticsDb() {
    if (!pool) return;
    const currentPool = pool;
    pool = null;
    enabled = false;
    await currentPool.end().catch(() => {});
}

export async function walletAnalyticsQuery(text, params = []) {
    if (!enabled || !pool) {
        throw new Error('Wallet analytics database is not initialized');
    }
    return pool.query(text, params);
}

export async function upsertWalletCandidate(address, source = 'manual', notes = '') {
    const normalized = address.toLowerCase();
    const result = await walletAnalyticsQuery(`
        insert into wallet_candidates (address, source, notes)
        values ($1, $2, $3)
        on conflict (address) do update set
            source = coalesce(nullif(wallet_candidates.source, ''), excluded.source),
            notes = case
                when excluded.notes = '' then wallet_candidates.notes
                else excluded.notes
            end,
            updated_at = now()
        returning *;
    `, [normalized, source, notes]);
    return result.rows[0];
}

export async function markWalletBackfilled(address) {
    await walletAnalyticsQuery(`
        update wallet_candidates
        set last_backfilled_at = now(), updated_at = now()
        where address = $1;
    `, [address.toLowerCase()]);
}

export async function markWalletScored(address) {
    await walletAnalyticsQuery(`
        update wallet_candidates
        set last_scored_at = now(), updated_at = now()
        where address = $1;
    `, [address.toLowerCase()]);
}
