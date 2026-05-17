import dotenv from 'dotenv';
dotenv.config();

function parseTraderLabels(raw) {
  const labels = {};
  for (const entry of (raw || '').split(',')) {
    const text = entry.trim();
    if (!text) continue;
    const sepIndex = text.indexOf('=');
    if (sepIndex <= 0) continue;
    const address = text.slice(0, sepIndex).trim().toLowerCase();
    const label = text.slice(sepIndex + 1).trim();
    if (/^0x[a-f0-9]{40}$/.test(address) && label) labels[address] = label;
  }
  return labels;
}

function shortAddr(addr) {
  const text = String(addr || '');
  return text.length > 10 ? `${text.slice(0, 6)}...${text.slice(-4)}` : text;
}

function traderLabelMap(addresses, labels) {
  const map = {};
  addresses.forEach((address, index) => {
    map[address] = labels[address] || `W${index + 1}`;
  });
  return map;
}

function traderDisplayMap(addresses, labels) {
  const labelMap = traderLabelMap(addresses, labels);
  const map = {};
  for (const address of addresses) {
    map[address] = `${labelMap[address]} ${shortAddr(address)}`;
  }
  return map;
}

const traderAddresses = (process.env.TRADER_ADDRESSES || process.env.TRADER_ADDRESS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const traderLabels = parseTraderLabels(process.env.TRADER_WALLET_LABELS || '');

const config = {
  // Wallet
  privateKey: process.env.PRIVATE_KEY,         // EOA private key (for signing only)
  proxyWallet: process.env.PROXY_WALLET_ADDRESS, // Polymarket proxy/deposit wallet (CLOB V2 uses pUSD)

  // Polymarket API (optional, auto-derived if empty)
  clobApiKey: process.env.CLOB_API_KEY || '',
  clobApiSecret: process.env.CLOB_API_SECRET || '',
  clobApiPassphrase: process.env.CLOB_API_PASSPHRASE || '',
  clobSignatureType: parseInt(process.env.CLOB_SIGNATURE_TYPE || '2', 10),

  // Polymarket endpoints
  clobHost: 'https://clob.polymarket.com',
  gammaHost: 'https://gamma-api.polymarket.com',
  dataHost: 'https://data-api.polymarket.com',
  chainId: 137,

  // Polygon RPC
  polygonRpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com',

  // Trader to copy
  traderAddress: process.env.TRADER_ADDRESS || traderAddresses[0] || '',
  traderAddresses,
  traderLabels,
  traderLabelMap: traderLabelMap(traderAddresses, traderLabels),
  traderDisplayMap: traderDisplayMap(traderAddresses, traderLabels),
  simStartBalance: parseFloat(process.env.SIM_START_BALANCE || '100'),
  webHost: process.env.WEB_HOST || '0.0.0.0',
  webPort: parseInt(process.env.WEB_PORT || '8787', 10),
  multiWatchDashboardUrl: process.env.MULTI_WATCH_DASHBOARD_URL || '',
  liveDashboardUrl: process.env.LIVE_DASHBOARD_URL || '',
  statusPositionsVerbose: process.env.STATUS_POSITIONS_VERBOSE === 'true',
  databaseUrl: process.env.DATABASE_URL || '',
  databasePoolSize: parseInt(process.env.DATABASE_POOL_SIZE || '5', 10),
  databaseConnectTimeoutMs: parseInt(process.env.DATABASE_CONNECT_TIMEOUT_MS || '5000', 10),
  pnlSnapshotIntervalMs: parseInt(process.env.PNL_SNAPSHOT_INTERVAL || '60', 10) * 1000,
  pnlHistoryLimit: parseInt(process.env.PNL_HISTORY_LIMIT || '100', 10),
  multiWatchRequireDb: process.env.MULTI_WATCH_REQUIRE_DB !== 'false',
  walletAnalyticsTradesPath: process.env.WALLET_ANALYTICS_TRADES_PATH || '/trades',
  walletAnalyticsClosedPositionsPath: process.env.WALLET_ANALYTICS_CLOSED_POSITIONS_PATH || '/v1/closed-positions',
  walletAnalyticsTradeLimit: parseInt(process.env.WALLET_ANALYTICS_TRADE_LIMIT || '500', 10),
  walletAnalyticsClosedPositionLimit: parseInt(process.env.WALLET_ANALYTICS_CLOSED_POSITION_LIMIT || '500', 10),
  walletAnalyticsPageLimit: parseInt(process.env.WALLET_ANALYTICS_PAGE_LIMIT || '100', 10),
  walletAnalyticsMinTrades: parseInt(process.env.WALLET_ANALYTICS_MIN_TRADES || '50', 10),
  walletAnalyticsMinSettledMarkets: parseInt(process.env.WALLET_ANALYTICS_MIN_SETTLED_MARKETS || '30', 10),
  walletAnalyticsMinProfitFactor: parseFloat(process.env.WALLET_ANALYTICS_MIN_PROFIT_FACTOR || '1.2'),
  walletAnalyticsMaxDrawdown: parseFloat(process.env.WALLET_ANALYTICS_MAX_DRAWDOWN || '0.30'),
  walletAnalyticsMaxTopMarketProfitShare: parseFloat(process.env.WALLET_ANALYTICS_MAX_TOP_MARKET_PROFIT_SHARE || '0.40'),
  walletAnalyticsEnableClv: process.env.WALLET_ANALYTICS_ENABLE_CLV !== 'false',
  walletAnalyticsClvLimit: parseInt(process.env.WALLET_ANALYTICS_CLV_LIMIT || '80', 10),
  walletAnalyticsClvWindowMinutes: parseInt(process.env.WALLET_ANALYTICS_CLV_WINDOW_MINUTES || '30', 10),
  walletAnalyticsPriceHistoryFidelity: parseInt(process.env.WALLET_ANALYTICS_PRICE_HISTORY_FIDELITY || '5', 10),
  walletAnalyticsOrderbookLimit: parseInt(process.env.WALLET_ANALYTICS_ORDERBOOK_LIMIT || '40', 10),

  // Trade sizing
  sizeMode: process.env.SIZE_MODE || 'percentage', // "percentage" | "balance"
  sizePercent: parseFloat(process.env.SIZE_PERCENT || '50'),
  minTradeSize: parseFloat(process.env.MIN_TRADE_SIZE || '1'),
  maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || '10'),

  // Auto sell
  autoSellEnabled: process.env.AUTO_SELL_ENABLED === 'true',
  autoSellProfitPercent: parseFloat(process.env.AUTO_SELL_PROFIT_PERCENT || '10'),

  // Sell mode when copying sell
  sellMode: process.env.SELL_MODE || 'market', // "market" | "limit"

  // Redeem interval (seconds)
  redeemInterval: parseInt(process.env.REDEEM_INTERVAL || '60', 10) * 1000,

  // Dry run
  dryRun: process.env.DRY_RUN === 'true',

  // Order execution settings
  maxRetries: parseInt(process.env.ORDER_MAX_RETRIES || '5', 10),
  retryDelay: parseInt(process.env.ORDER_RETRY_DELAY_MS || '3000', 10),
  buySlippagePercent: parseFloat(process.env.BUY_SLIPPAGE_PERCENT || '2'),
  sellSlippagePercent: parseFloat(process.env.SELL_SLIPPAGE_PERCENT || '2'),

  // Skip buy if market closes within this many seconds (default 5 minutes)
  minMarketTimeLeft: parseInt(process.env.MIN_MARKET_TIME_LEFT || '300', 10),

  // Seconds to wait for a GTC limit order to fill when FAK finds no liquidity
  // (happens when copying trades into "next market" before sellers arrive)
  gtcFallbackTimeout: parseInt(process.env.GTC_FALLBACK_TIMEOUT || '60', 10),
  buyGtcFallbackTimeout: parseInt(process.env.BUY_GTC_FALLBACK_TIMEOUT || process.env.GTC_FALLBACK_TIMEOUT || '60', 10),
  sellGtcFallbackTimeout: parseInt(process.env.SELL_GTC_FALLBACK_TIMEOUT || process.env.GTC_FALLBACK_TIMEOUT || '60', 10),

  // ── Market Maker ──────────────────────────────────────────────
  mmAssets: (process.env.MM_ASSETS || 'btc')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  mmDuration: process.env.MM_DURATION || '5m',  // '5m' or '15m'
  mmTradeSize: parseFloat(process.env.MM_TRADE_SIZE || '5'),    // USDC per side
  mmSellPrice: parseFloat(process.env.MM_SELL_PRICE || '0.60'), // limit sell target
  mmCutLossTime: parseInt(process.env.MM_CUT_LOSS_TIME || '60', 10), // seconds before close
  mmMarketKeyword: process.env.MM_MARKET_KEYWORD || 'Bitcoin Up or Down',
  mmEntryWindow: parseInt(process.env.MM_ENTRY_WINDOW || '45', 10), // max secs after open
  mmPollInterval: parseInt(process.env.MM_POLL_INTERVAL || '10', 10) * 1000,
  mmAdaptiveCL: process.env.MM_ADAPTIVE_CL !== 'false',           // true = adaptive, false = legacy immediate market-sell
  mmAdaptiveMinCombined: parseFloat(process.env.MM_ADAPTIVE_MIN_COMBINED || '1.20'), // min combined sell (both legs) to qualify for limit
  mmAdaptiveMonitorSec: parseInt(process.env.MM_ADAPTIVE_MONITOR_SEC || '5', 10),

  // ── Defensive Pivot (5m markets only) ─────────────────────────
  // When NEITHER side fills within timeout, enter defensive mode:
  // At 30s before close, if worst side < threshold → market sell worst, keep best
  // Otherwise merge back to USDC (zero P&L)
  mmDefensiveEnabled: process.env.MM_DEFENSIVE_ENABLED !== 'false',  // default on
  mmDefensiveTimeout: parseInt(process.env.MM_DEFENSIVE_TIMEOUT || '120', 10),         // secs without fill → defensive
  mmDefensiveWorstThreshold: parseFloat(process.env.MM_DEFENSIVE_WORST_THRESHOLD || '0.10'), // sell worst if price < this

  // ── Recovery Buy (after cut-loss) ─────────────────────────────
  // When enabled: after cutting loss, monitor prices for 10s and
  // market-buy the dominant side if it's above threshold and rising/stable.
  mmRecoveryBuy: process.env.MM_RECOVERY_BUY === 'true',
  mmRecoveryThreshold: parseFloat(process.env.MM_RECOVERY_THRESHOLD || '0.70'), // min price to qualify
  mmRecoverySize: parseFloat(process.env.MM_RECOVERY_SIZE || '0'),    // 0 = use mmTradeSize

  // ── Maker Rebate MM ────────────────────────────────────────────
  // Buy YES+NO at top bid (maker), merge back to USDC ($1.00).
  // Profit = spread + maker rebate fees.
  makerMmAssets: (process.env.MAKER_MM_ASSETS || process.env.MM_ASSETS || 'btc')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  makerMmDuration: process.env.MAKER_MM_DURATION || process.env.MM_DURATION || '5m',
  makerMmTradeSize: parseFloat(process.env.MAKER_MM_TRADE_SIZE || '5'),        // USDC per side
  makerMmMaxCombined: parseFloat(process.env.MAKER_MM_MAX_COMBINED || '0.99'), // max bid_YES + bid_NO
  makerMmRepriceSec: parseInt(process.env.MAKER_MM_REPRICE_SEC || '3', 10),    // orderbook poll interval
  makerMmFillTimeout: parseInt(process.env.MAKER_MM_FILL_TIMEOUT || '120', 10),  // secs for 2nd fill after 1st
  makerMmCutLossTime: parseInt(process.env.MAKER_MM_CUT_LOSS_TIME || '60', 10), // secs before close to force exit
  makerMmEntryWindow: parseInt(process.env.MAKER_MM_ENTRY_WINDOW || '45', 10),  // max secs after open to enter
  makerMmPollInterval: parseInt(process.env.MAKER_MM_POLL_INTERVAL || process.env.MM_POLL_INTERVAL || '5', 10) * 1000,
  makerMmReentryDelay: parseInt(process.env.MAKER_MM_REENTRY_DELAY || '30', 10) * 1000, // ms delay between re-entry cycles
  makerMmReentryEnabled: process.env.MAKER_MM_REENTRY_ENABLED !== 'false', // set false to disable re-entry (one cycle per market)
  makerMmRepriceThreshold: parseFloat(process.env.MAKER_MM_REPRICE_THRESHOLD || '0.02'), // reprice if bid drifts > this (default 2c)
  makerMmMinPrice: parseFloat(process.env.MAKER_MM_MIN_PRICE || '0.30'),   // min bid for rebate range (both sides)
  makerMmMaxPrice: parseFloat(process.env.MAKER_MM_MAX_PRICE || '0.69'),   // max bid for rebate range (both sides)
  // When true: if expensive side fills first, cancel cheap side and hold to redemption
  makerMmCancelCheapOnExpFill: process.env.MAKER_MM_CANCEL_CHEAP_ON_EXP_FILL === 'true',
  makerMmPollSec: parseInt(process.env.MAKER_MM_POLL_SEC || '3', 10),

  // ── Current Market Settings ────────────────────────────────────
  // Enable trading on current active market (not just next market)
  currentMarketEnabled: process.env.CURRENT_MARKET_ENABLED === 'true',
  // Max odds threshold for current market (stop re-entry if odds drop below this)
  currentMarketMaxOdds: parseFloat(process.env.CURRENT_MARKET_MAX_ODDS || '0.70'),
  // Max odds threshold for next market (only enter if max odds <= this)
  nextMarketMaxOdds: parseFloat(process.env.NEXT_MARKET_MAX_ODDS || '0.52'),

  // ── Orderbook Sniper ───────────────────────────────────────────
  // 3-tier strategy: places GTC limit BUY orders at 3c, 2c, and 1c
  // Tier 1 (3c): smallest size | Tier 2 (2c): medium size | Tier 3 (1c): largest size
  // Min 5 shares per tier, total = SNIPER_MAX_SHARES_PER_SIDE
  sniperAssets: (process.env.SNIPER_ASSETS || 'eth,sol,xrp')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  sniperTierPrices: [
    parseFloat(process.env.SNIPER_TIER1_PRICE || '0.03'), // high price, small size
    parseFloat(process.env.SNIPER_TIER2_PRICE || '0.02'), // mid price, medium size
    parseFloat(process.env.SNIPER_TIER3_PRICE || '0.01'), // low price, large size
  ],
  sniperMaxShares: parseFloat(process.env.SNIPER_MAX_SHARES || '15'), // max total per side
  sniperMinSharesPerTier: 5, // minimum shares for each tier

  // ── Sniper Sizing Multiplier (UTC+8) ──────────────────────────
  // Time-based bet sizing multiplier. Format: HH:MM-HH:MM:factor,...
  // Example: SNIPER_MULTIPLIERS=21:00-00:00:1.41,06:00-12:00:0.85
  // Default multiplier outside any window = 1.0
  sniperMultipliers: (() => {
    const raw = process.env.SNIPER_MULTIPLIERS || '';
    if (!raw.trim()) return [];
    return raw.split(',').map((s) => s.trim()).filter(Boolean).map((entry) => {
      const m = entry.match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2}):(\d+\.?\d*)$/);
      if (!m) return null;
      return { start: m[1], end: m[2], multiplier: parseFloat(m[3]) };
    }).filter(Boolean);
  })(),

  // ── Sniper Pause After Win ───────────────────────────────────
  // Number of rounds (5-min slots) to pause an asset after a win is detected.
  sniperPauseRoundsAfterWin: parseInt(process.env.SNIPER_PAUSE_ROUNDS_AFTER_WIN || '3', 10),

  // ── Sniper Schedule (UTC+8) ────────────────────────────────────
  // Per-asset session windows. Format: SNIPER_SCHEDULE_{ASSET}=HH:MM-HH:MM,HH:MM-HH:MM
  // Assets without a schedule are always active.
  sniperSchedule: (() => {
    const schedule = {};
    const prefix = 'SNIPER_SCHEDULE_';
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(prefix) && value) {
        const asset = key.slice(prefix.length).toLowerCase();
        schedule[asset] = value;
      }
    }
    return schedule;
  })(),

  // ── Proxy (Polymarket API only, NOT Polygon RPC) ──────────────
  // Supports HTTP/HTTPS. Example: http://user:pass@host:port
  proxyUrl: process.env.PROXY_URL || '',
  envProxyUrl: process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '',
};

// Validation for copy-trade bot
export function validateConfig() {
  const required = ['privateKey', 'proxyWallet'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required config: ${missing.join(', ')}. Check your .env file.`);
  }
  if (config.traderAddresses.length === 0) {
    throw new Error('Missing required config: TRADER_ADDRESS or TRADER_ADDRESSES. Check your .env file.');
  }
  const invalid = config.traderAddresses.filter((addr) => !/^0x[a-f0-9]{40}$/.test(addr));
  if (invalid.length > 0) {
    throw new Error(`Invalid target wallet address value(s): ${invalid.join(', ')}`);
  }
  if (!['percentage', 'balance'].includes(config.sizeMode)) {
    throw new Error(`Invalid SIZE_MODE: ${config.sizeMode}. Use "percentage" or "balance".`);
  }
  if (!['market', 'limit'].includes(config.sellMode)) {
    throw new Error(`Invalid SELL_MODE: ${config.sellMode}. Use "market" or "limit".`);
  }
  if (![0, 1, 2, 3].includes(config.clobSignatureType)) {
    throw new Error('Invalid CLOB_SIGNATURE_TYPE. Use 0, 1, 2, or 3.');
  }
  if (!Number.isInteger(config.maxRetries) || config.maxRetries < 0) {
    throw new Error('ORDER_MAX_RETRIES must be a non-negative integer.');
  }
  if (!Number.isInteger(config.retryDelay) || config.retryDelay < 0) {
    throw new Error('ORDER_RETRY_DELAY_MS must be a non-negative integer.');
  }
  if (config.buySlippagePercent < 0 || config.sellSlippagePercent < 0) {
    throw new Error('BUY_SLIPPAGE_PERCENT and SELL_SLIPPAGE_PERCENT must be >= 0.');
  }
}

// Validation for pure multi-wallet simulation watcher
export function validateMultiWatchConfig() {
  const invalid = config.traderAddresses.filter((addr) => !/^0x[a-f0-9]{40}$/.test(addr));
  if (invalid.length > 0) {
    throw new Error(`Invalid TRADER_ADDRESSES value(s): ${invalid.join(', ')}`);
  }
  if (!['percentage', 'balance'].includes(config.sizeMode)) {
    throw new Error(`Invalid SIZE_MODE: ${config.sizeMode}. Use "percentage" or "balance".`);
  }
  if (config.simStartBalance <= 0) throw new Error('SIM_START_BALANCE must be > 0');
  if (config.sizePercent <= 0) throw new Error('SIZE_PERCENT must be > 0');
  if (config.maxPositionSize <= 0) throw new Error('MAX_POSITION_SIZE must be > 0');
  if (!Number.isInteger(config.webPort) || config.webPort <= 0 || config.webPort > 65535) {
    throw new Error('WEB_PORT must be an integer between 1 and 65535');
  }
  if (!Number.isInteger(config.databasePoolSize) || config.databasePoolSize <= 0) {
    throw new Error('DATABASE_POOL_SIZE must be a positive integer');
  }
  if (!Number.isInteger(config.databaseConnectTimeoutMs) || config.databaseConnectTimeoutMs <= 0) {
    throw new Error('DATABASE_CONNECT_TIMEOUT_MS must be a positive integer');
  }
  if (!Number.isInteger(config.pnlSnapshotIntervalMs) || config.pnlSnapshotIntervalMs <= 0) {
    throw new Error('PNL_SNAPSHOT_INTERVAL must be a positive integer number of seconds');
  }
  if (!Number.isInteger(config.pnlHistoryLimit) || config.pnlHistoryLimit <= 0) {
    throw new Error('PNL_HISTORY_LIMIT must be a positive integer');
  }
  if (config.multiWatchRequireDb && !config.databaseUrl) {
    throw new Error('DATABASE_URL is required for multi-watch PnL recording. Set MULTI_WATCH_REQUIRE_DB=false to run without DB.');
  }
}

export function validateWalletAnalyticsConfig() {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required for wallet analytics.');
  }
  if (!Number.isInteger(config.walletAnalyticsTradeLimit) || config.walletAnalyticsTradeLimit <= 0) {
    throw new Error('WALLET_ANALYTICS_TRADE_LIMIT must be a positive integer');
  }
  if (!Number.isInteger(config.walletAnalyticsClosedPositionLimit) || config.walletAnalyticsClosedPositionLimit <= 0) {
    throw new Error('WALLET_ANALYTICS_CLOSED_POSITION_LIMIT must be a positive integer');
  }
  if (!Number.isInteger(config.walletAnalyticsPageLimit) || config.walletAnalyticsPageLimit <= 0 || config.walletAnalyticsPageLimit > 500) {
    throw new Error('WALLET_ANALYTICS_PAGE_LIMIT must be an integer between 1 and 500');
  }
  if (!Number.isInteger(config.walletAnalyticsMinTrades) || config.walletAnalyticsMinTrades <= 0) {
    throw new Error('WALLET_ANALYTICS_MIN_TRADES must be a positive integer');
  }
  if (!Number.isInteger(config.walletAnalyticsMinSettledMarkets) || config.walletAnalyticsMinSettledMarkets <= 0) {
    throw new Error('WALLET_ANALYTICS_MIN_SETTLED_MARKETS must be a positive integer');
  }
  if (config.walletAnalyticsMinProfitFactor <= 0) {
    throw new Error('WALLET_ANALYTICS_MIN_PROFIT_FACTOR must be > 0');
  }
  if (config.walletAnalyticsMaxDrawdown <= 0 || config.walletAnalyticsMaxDrawdown > 1) {
    throw new Error('WALLET_ANALYTICS_MAX_DRAWDOWN must be between 0 and 1');
  }
  if (config.walletAnalyticsMaxTopMarketProfitShare <= 0 || config.walletAnalyticsMaxTopMarketProfitShare > 1) {
    throw new Error('WALLET_ANALYTICS_MAX_TOP_MARKET_PROFIT_SHARE must be between 0 and 1');
  }
  if (!Number.isInteger(config.walletAnalyticsClvLimit) || config.walletAnalyticsClvLimit <= 0) {
    throw new Error('WALLET_ANALYTICS_CLV_LIMIT must be a positive integer');
  }
  if (!Number.isInteger(config.walletAnalyticsClvWindowMinutes) || config.walletAnalyticsClvWindowMinutes <= 0) {
    throw new Error('WALLET_ANALYTICS_CLV_WINDOW_MINUTES must be a positive integer');
  }
  if (!Number.isInteger(config.walletAnalyticsPriceHistoryFidelity) || config.walletAnalyticsPriceHistoryFidelity <= 0) {
    throw new Error('WALLET_ANALYTICS_PRICE_HISTORY_FIDELITY must be a positive integer');
  }
  if (!Number.isInteger(config.walletAnalyticsOrderbookLimit) || config.walletAnalyticsOrderbookLimit <= 0) {
    throw new Error('WALLET_ANALYTICS_ORDERBOOK_LIMIT must be a positive integer');
  }
}

// Validation for market-maker bot
export function validateMMConfig() {
  const required = ['privateKey', 'proxyWallet'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required config: ${missing.join(', ')}. Check your .env file.`);
  }
  if (config.mmTradeSize <= 0) throw new Error('MM_TRADE_SIZE must be > 0');
  if (config.mmSellPrice <= 0 || config.mmSellPrice >= 1)
    throw new Error('MM_SELL_PRICE must be between 0 and 1');
}

// Validation for maker-rebate MM bot
export function validateMakerMMConfig() {
  const required = ['privateKey', 'proxyWallet'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required config: ${missing.join(', ')}. Check your .env file.`);
  }
  if (config.makerMmTradeSize <= 0) throw new Error('MAKER_MM_TRADE_SIZE must be > 0');
  if (config.makerMmMaxCombined <= 0 || config.makerMmMaxCombined >= 1)
    throw new Error('MAKER_MM_MAX_COMBINED must be between 0 and 1 exclusive');
}

export default config;
