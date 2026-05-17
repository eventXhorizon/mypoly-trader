import WebSocket from 'ws';
import logger from '../utils/logger.js';
import { readState, writeState } from '../utils/state.js';

const RTDS_WS_URL = 'wss://ws-live-data.polymarket.com';
const PING_INTERVAL_MS = 5000;
const INITIAL_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;
const PROCESSED_FILE = 'multi_processed_trades.json';

let ws = null;
let pingTimer = null;
let reconnectTimer = null;
let reconnectDelay = INITIAL_RECONNECT_DELAY;
let tradeHandler = null;
let isShuttingDown = false;
let watchedMap = new Map();

function shortAddr(addr) {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function getProcessedIds() {
    return readState(PROCESSED_FILE, { tradeIds: [] });
}

function markProcessed(tradeId) {
    const data = getProcessedIds();
    if (data.tradeIds.includes(tradeId)) return false;
    data.tradeIds.push(tradeId);
    if (data.tradeIds.length > 2000) {
        data.tradeIds = data.tradeIds.slice(-2000);
    }
    writeState(PROCESSED_FILE, data);
    return true;
}

function normalizeTrade(payload, traderAddress) {
    const type = (payload.side || '').toUpperCase();
    if (!['BUY', 'SELL'].includes(type)) return null;

    const tokenId = payload.asset || '';
    if (!tokenId) return null;

    const txHash = payload.transactionHash || payload.transaction_hash || '';
    const tradeId = txHash
        ? `${traderAddress}_${txHash}_${tokenId}_${type}`
        : `${traderAddress}_${payload.timestamp}_${tokenId}_${type}`;

    return {
        id: tradeId,
        traderAddress,
        type,
        tokenId,
        conditionId: payload.conditionId || payload.condition_id || '',
        market: payload.title || payload.name || '',
        price: parseFloat(payload.price || '0'),
        size: parseFloat(payload.size || '0'),
        side: type,
        timestamp: payload.timestamp || new Date().toISOString(),
        outcome: payload.outcome || '',
        txHash,
    };
}

function handleMessage(rawData) {
    let msg;
    try {
        msg = JSON.parse(rawData.toString());
    } catch {
        const text = rawData.toString().trim();
        if (text === 'ping') ws?.send('pong');
        return;
    }

    if (msg.type === 'ping' || msg === 'ping') {
        ws?.send('pong');
        return;
    }

    if (msg.topic !== 'activity') return;

    const payload = msg.payload;
    if (!payload) return;

    const proxyWallet = (payload.proxyWallet || payload.proxy_wallet || '').toLowerCase();
    const trader = watchedMap.get(proxyWallet);
    if (!trader) return;

    const trade = normalizeTrade(payload, trader);
    if (!trade) return;

    if (!markProcessed(trade.id)) return;

    logger.watch(`[${shortAddr(trader)}] ${trade.type} ${trade.market || trade.tokenId} | ${trade.size} sh @ $${trade.price}`);

    if (tradeHandler) {
        tradeHandler(trade).catch((err) => {
            logger.error(`Error handling ${shortAddr(trader)} trade: ${err.message}`);
        });
    }
}

function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send('ping');
    }, PING_INTERVAL_MS);
}

function stopPing() {
    if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
    }
}

function cleanup(reconnect = true) {
    stopPing();
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (ws) {
        ws.removeAllListeners();
        ws.on('error', () => {});
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.terminate();
        }
        ws = null;
    }
    if (reconnect && !isShuttingDown) scheduleReconnect();
}

function scheduleReconnect() {
    logger.info(`Multi-watch reconnecting in ${reconnectDelay / 1000}s...`);
    reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
        connect();
    }, reconnectDelay);
}

function connect() {
    if (isShuttingDown) return;

    logger.info('Connecting to Polymarket RTDS WebSocket...');
    ws = new WebSocket(RTDS_WS_URL);

    ws.on('open', () => {
        logger.success('WebSocket connected. Subscribing to activity feed...');
        logger.watch(`Watching ${watchedMap.size} trader(s): ${[...watchedMap.values()].map(shortAddr).join(', ')}`);
        reconnectDelay = INITIAL_RECONNECT_DELAY;

        ws.send(JSON.stringify({
            action: 'subscribe',
            subscriptions: [{
                topic: 'activity',
                type: 'trades',
            }],
        }));

        startPing();
    });

    ws.on('message', (data) => handleMessage(data));
    ws.on('ping', () => ws?.pong());
    ws.on('close', (code, reason) => {
        const reasonStr = reason ? reason.toString() : 'no reason';
        logger.warn(`WebSocket closed (${code}): ${reasonStr}`);
        cleanup(true);
    });
    ws.on('error', (err) => {
        logger.error(`WebSocket error: ${err.message}`);
        cleanup(true);
    });
}

export function updateWatchedTraders(traderAddresses) {
    watchedMap = new Map(traderAddresses.map((addr) => [addr.toLowerCase(), addr.toLowerCase()]));
    logger.watch(`Watching ${watchedMap.size} trader(s): ${[...watchedMap.values()].map(shortAddr).join(', ') || 'none'}`);
}

export function startMultiWsWatcher(traderAddresses, onTrade) {
    updateWatchedTraders(traderAddresses);
    tradeHandler = onTrade;
    isShuttingDown = false;
    reconnectDelay = INITIAL_RECONNECT_DELAY;
    connect();
}

export function stopMultiWsWatcher() {
    isShuttingDown = true;
    cleanup(false);
    logger.info('Multi-wallet watcher stopped');
}
