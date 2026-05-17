import config from '../config/index.js';
import { readState, writeState } from '../utils/state.js';

const SETTINGS_FILE = 'multi_watch_settings.json';
const ADDRESS_RE = /^0x[a-f0-9]{40}$/;

function parseAddresses(value) {
    const items = Array.isArray(value)
        ? value
        : String(value || '').split(/[\s,]+/);

    return [...new Set(items
        .map((addr) => String(addr || '').trim().toLowerCase())
        .filter(Boolean))];
}

function positiveNumber(value, fieldName) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new Error(`${fieldName} must be greater than 0`);
    }
    return number;
}

function settingsFromConfig(source) {
    return {
        traderAddresses: parseAddresses(source.traderAddresses || source.traderAddress || []),
        simStartBalance: source.simStartBalance,
        sizeMode: source.sizeMode,
        sizePercent: source.sizePercent,
        minTradeSize: source.minTradeSize,
        maxPositionSize: source.maxPositionSize,
    };
}

function normalizeSettings(input) {
    const traderAddresses = parseAddresses(input.traderAddresses);
    const invalid = traderAddresses.filter((addr) => !ADDRESS_RE.test(addr));
    if (invalid.length > 0) {
        throw new Error(`Invalid target wallet address: ${invalid.join(', ')}`);
    }

    const sizeMode = input.sizeMode || 'percentage';
    if (!['percentage', 'balance', 'target'].includes(sizeMode)) {
        throw new Error('SIZE_MODE must be percentage, balance, or target');
    }

    return {
        traderAddresses,
        simStartBalance: positiveNumber(input.simStartBalance, 'SIM_START_BALANCE'),
        sizeMode,
        sizePercent: positiveNumber(input.sizePercent, 'SIZE_PERCENT'),
        minTradeSize: positiveNumber(input.minTradeSize, 'MIN_TRADE_SIZE'),
        maxPositionSize: positiveNumber(input.maxPositionSize, 'MAX_POSITION_SIZE'),
        updatedAt: new Date().toISOString(),
    };
}

function applySettingsToConfig(targetConfig, settings) {
    targetConfig.traderAddresses = settings.traderAddresses;
    targetConfig.traderAddress = settings.traderAddresses[0] || '';
    targetConfig.simStartBalance = settings.simStartBalance;
    targetConfig.sizeMode = settings.sizeMode;
    targetConfig.sizePercent = settings.sizePercent;
    targetConfig.minTradeSize = settings.minTradeSize;
    targetConfig.maxPositionSize = settings.maxPositionSize;
}

export function getMultiWatchSettings(targetConfig = config) {
    return settingsFromConfig(targetConfig);
}

export function loadMultiWatchSettings(targetConfig = config) {
    const defaults = settingsFromConfig(targetConfig);
    const saved = readState(SETTINGS_FILE, null);
    const merged = saved && typeof saved === 'object'
        ? { ...defaults, ...saved }
        : defaults;
    const settings = normalizeSettings(merged);
    applySettingsToConfig(targetConfig, settings);
    return settings;
}

export function updateMultiWatchSettings(patch, targetConfig = config) {
    const current = getMultiWatchSettings(targetConfig);
    const settings = normalizeSettings({ ...current, ...patch });
    writeState(SETTINGS_FILE, settings);
    applySettingsToConfig(targetConfig, settings);
    return settings;
}
