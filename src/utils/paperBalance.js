import config from '../config/index.js';
import { readState, writeState } from './state.js';

const PAPER_FILE = 'paper_balance.json';

function defaultState() {
    return {
        startBalance: config.simStartBalance,
        cash: config.simStartBalance,
        realizedPnl: 0,
        updatedAt: new Date().toISOString(),
    };
}

export function getPaperBalanceState() {
    const state = readState(PAPER_FILE, defaultState());
    if (typeof state.cash !== 'number') {
        return defaultState();
    }
    return state;
}

export function getPaperBalance() {
    return getPaperBalanceState().cash;
}

export function reservePaperBalance(amount) {
    const state = getPaperBalanceState();
    state.cash = Math.max(0, state.cash - amount);
    state.updatedAt = new Date().toISOString();
    writeState(PAPER_FILE, state);
    return state.cash;
}

export function releasePaperBalance(amount, pnl = 0) {
    const state = getPaperBalanceState();
    state.cash += amount;
    state.realizedPnl = (state.realizedPnl || 0) + pnl;
    state.updatedAt = new Date().toISOString();
    writeState(PAPER_FILE, state);
    return state.cash;
}
