import { readState, writeState } from '../utils/state.js';
import logger from '../utils/logger.js';

const POSITIONS_FILE = 'positions.json';

/**
 * Get all current positions
 * @returns {Object} Map of positionKey -> position data
 */
export function getPositions() {
    return readState(POSITIONS_FILE, {});
}

/**
 * Build the storage key for a copy-trade position.
 *
 * Use tokenId first so multi-outcome markets can hold separate caps per outcome.
 * Older state used conditionId as the key; callers can still pass conditionId only
 * to read or remove legacy positions.
 */
export function positionKeyFor({ tokenId, conditionId } = {}) {
    return tokenId || conditionId || '';
}

export function sourcePositionKeyFor({ tokenId, conditionId, traderAddress } = {}) {
    const baseKey = positionKeyFor({ tokenId, conditionId });
    const source = String(traderAddress || '').trim().toLowerCase();
    return source && baseKey ? `${source}:${baseKey}` : baseKey;
}

function legacyConditionMatches(position, keyOrTrade) {
    if (!position || typeof keyOrTrade !== 'object') return false;
    if (!keyOrTrade.conditionId || position.conditionId !== keyOrTrade.conditionId) return false;
    return !keyOrTrade.tokenId || !position.tokenId || position.tokenId === keyOrTrade.tokenId;
}

function positionMatches(position, keyOrTrade) {
    if (!position || typeof keyOrTrade !== 'object') return false;
    if (keyOrTrade.traderAddress) {
        const requestedTrader = String(keyOrTrade.traderAddress).toLowerCase();
        const positionTrader = String(position.traderAddress || '').toLowerCase();
        if (positionTrader && positionTrader !== requestedTrader) return false;
    }
    if (keyOrTrade.tokenId && position.tokenId) return position.tokenId === keyOrTrade.tokenId;
    return legacyConditionMatches(position, keyOrTrade);
}

function findPositionEntry(keyOrTrade) {
    const positions = getPositions();
    if (!keyOrTrade) return { positions, key: null, position: null };

    if (typeof keyOrTrade === 'string') {
        return {
            positions,
            key: positions[keyOrTrade] ? keyOrTrade : null,
            position: positions[keyOrTrade] || null,
        };
    }

    const primaryKey = sourcePositionKeyFor(keyOrTrade);
    if (primaryKey && positions[primaryKey]) {
        return { positions, key: primaryKey, position: positions[primaryKey] };
    }

    const tokenKey = positionKeyFor(keyOrTrade);
    if (tokenKey && positions[tokenKey] && positionMatches(positions[tokenKey], keyOrTrade)) {
        return { positions, key: tokenKey, position: positions[tokenKey] };
    }

    // Legacy compatibility: older versions stored positions under conditionId.
    if (keyOrTrade.conditionId && legacyConditionMatches(positions[keyOrTrade.conditionId], keyOrTrade)) {
        return {
            positions,
            key: keyOrTrade.conditionId,
            position: positions[keyOrTrade.conditionId],
        };
    }

    for (const [key, position] of Object.entries(positions)) {
        if (positionMatches(position, keyOrTrade)) {
            return { positions, key, position };
        }
    }

    return { positions, key: null, position: null };
}

/**
 * Check if we already have a position for this outcome token
 * @param {Object|string} keyOrTrade
 * @returns {boolean}
 */
export function hasPosition(keyOrTrade) {
    return !!getPosition(keyOrTrade);
}

/**
 * Add a new position after buy is filled
 * @param {Object} params
 * @param {string} params.conditionId - Market condition ID
 * @param {string} params.tokenId - CLOB token ID
 * @param {string} params.market - Market question/title
 * @param {number} params.shares - Number of shares bought
 * @param {number} params.avgBuyPrice - Average buy price
 * @param {number} params.totalCost - Total USDC spent
 * @param {string} params.outcome - YES/NO outcome
 * @param {string} [params.sellOrderId] - Auto-sell order ID if placed
 */
export function addPosition({
    conditionId,
    tokenId,
    traderAddress,
    traderLabel,
    market,
    shares,
    avgBuyPrice,
    totalCost,
    outcome,
    sellOrderId,
}) {
    const positions = getPositions();
    const positionKey = sourcePositionKeyFor({ tokenId, conditionId, traderAddress });
    positions[positionKey] = {
        positionKey,
        conditionId,
        tokenId,
        traderAddress: traderAddress || '',
        traderLabel: traderLabel || '',
        market,
        shares,
        avgBuyPrice,
        totalCost,
        outcome: outcome || '',
        sellOrderId: sellOrderId || null,
        status: 'open', // open, selling, sold, redeemed
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    writeState(POSITIONS_FILE, positions);
    logger.success(`Position added: ${market} | ${shares} shares @ $${avgBuyPrice}`);
}

/**
 * Update a position
 * @param {Object|string} keyOrTrade
 * @param {Object} updates - Fields to update
 */
export function updatePosition(keyOrTrade, updates) {
    const { positions, key, position: existing } = findPositionEntry(keyOrTrade);
    if (existing && key) {
        const next = { ...existing, ...updates };
        const nextKey = sourcePositionKeyFor(next) || key;
        if (nextKey !== key) delete positions[key];
        positions[nextKey] = {
            ...existing,
            ...updates,
            positionKey: nextKey,
            updatedAt: new Date().toISOString(),
        };
        writeState(POSITIONS_FILE, positions);
    }
}

/**
 * Remove a position (after sell or redeem)
 * @param {Object|string} keyOrTrade
 */
export function removePosition(keyOrTrade) {
    const { positions, key, position: existing } = findPositionEntry(keyOrTrade);
    if (existing && key) {
        const market = existing.market;
        delete positions[key];
        writeState(POSITIONS_FILE, positions);
        logger.info(`Position removed: ${market}`);
    }
}

/**
 * Get position by token/condition key.
 * @param {Object|string} keyOrTrade
 * @returns {Object|null}
 */
export function getPosition(keyOrTrade) {
    return findPositionEntry(keyOrTrade).position;
}

/**
 * Get all open positions as an array
 * @returns {Array}
 */
export function getOpenPositions() {
    const positions = getPositions();
    return Object.values(positions).filter((p) => p.status === 'open');
}
