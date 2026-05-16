import { AssetType, Chain, ClobClient, COLLATERAL_TOKEN_DECIMALS, SignatureTypeV2 } from '@polymarket/clob-client-v2';
import { ethers, Wallet } from 'ethers';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { setupAxiosProxy, testProxy } from '../utils/proxy.js';

let clobClient = null;
let signer = null;
let _provider = null; // singleton — reused across all onchain calls

export const PUSD_ADDRESS = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';

function signatureTypeName(value) {
    return SignatureTypeV2[value] || `UNKNOWN_${value}`;
}

function stringifyErrorValue(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function formatClobError(value) {
    const status = value?.response?.status ?? value?.status;
    const data = value?.response?.data ?? value?.data ?? value;
    const raw = data?.errorMsg ?? data?.error ?? data?.message ??
        value?.errorMsg ?? value?.error ?? value?.message ?? data;
    const message = stringifyErrorValue(raw) || 'unknown';
    return status ? `HTTP ${status}: ${message}` : message;
}

function parseCollateralBalance(value) {
    const text = String(value || '0');
    const balance = Number(text);
    if (!Number.isFinite(balance)) return 0;
    return text.includes('.') ? balance : balance / (10 ** COLLATERAL_TOKEN_DECIMALS);
}

function hasClobError(value) {
    return Boolean(value?.error || value?.errorMsg || value?.message);
}

async function fetchCollateralBalanceAllowance() {
    const response = await clobClient.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    if (hasClobError(response)) {
        throw new Error(`CLOB collateral balance error: ${formatClobError(response)}`);
    }
    return response;
}

async function updateCollateralBalanceAllowance() {
    const response = await clobClient.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    if (hasClobError(response)) {
        throw new Error(`CLOB collateral allowance update error: ${formatClobError(response)}`);
    }
    return response;
}

/**
 * Initialize the Polymarket CLOB client
 * Auto-derives API credentials if not provided in .env
 */
export async function initClient() {
    // ── Set up proxy (if configured) BEFORE any Polymarket API calls ──
    await setupAxiosProxy();

    // Test proxy connectivity
    const proxyOk = await testProxy();
    if (!proxyOk) {
        logger.error('Proxy test failed — cannot reach Polymarket. Exiting.');
        process.exit(1);
    }

    logger.info('Initializing Polymarket CLOB client...');

    signer = new Wallet(config.privateKey);
    logger.info(`EOA (signer)  : ${signer.address}`);
    logger.info(`Proxy wallet  : ${config.proxyWallet}`);

    // Step 1: Create temp client to derive API credentials
    let apiCreds;
    if (config.clobApiKey && config.clobApiSecret && config.clobApiPassphrase) {
        apiCreds = {
            key: config.clobApiKey,
            secret: config.clobApiSecret,
            passphrase: config.clobApiPassphrase,
        };
        logger.info('Using API credentials from .env');
    } else {
        const tempClient = new ClobClient({
            host: config.clobHost,
            chain: Chain.POLYGON,
            signer,
            useServerTime: true,
            retryOnError: true,
        });
        apiCreds = await tempClient.createOrDeriveApiKey();
        if (!apiCreds?.key) {
            throw new Error(`Failed to derive API credentials: ${formatClobError(apiCreds) || 'empty response'}`);
        }
        logger.info('API credentials derived successfully');
    }

    const signatureType = config.clobSignatureType;
    logger.info(`CLOB signature type: ${signatureType} (${signatureTypeName(signatureType)})`);

    // Step 2: Initialize full trading client.
    // In CLOB V2, funderAddress is the Polymarket proxy/deposit wallet.
    clobClient = new ClobClient({
        host: config.clobHost,
        chain: Chain.POLYGON,
        signer,
        creds: apiCreds,
        signatureType,
        funderAddress: config.proxyWallet,
        useServerTime: true,
        retryOnError: true,
    });

    const version = await clobClient.getVersion();
    logger.success(`CLOB client initialized (V${version})`);

    if (!config.dryRun) {
        try {
            await updateCollateralBalanceAllowance();
            logger.info('CLOB collateral allowance refreshed');
        } catch (err) {
            logger.warn(`Could not refresh CLOB collateral allowance: ${err.message}`);
        }
    }

    return clobClient;
}

/**
 * Get the initialized CLOB client
 */
export function getClient() {
    if (!clobClient) {
        throw new Error('CLOB client not initialized. Call initClient() first.');
    }
    return clobClient;
}

/**
 * Get the signer wallet
 */
export function getSigner() {
    if (!signer) {
        throw new Error('Signer not initialized. Call initClient() first.');
    }
    return signer;
}

/**
 * Get (or create) the singleton Polygon provider.
 * A single JsonRpcProvider instance is reused across all onchain calls
 * to avoid reconnection overhead on every balance check.
 */
export function getPolygonProvider() {
    if (!_provider) {
        _provider = new ethers.providers.JsonRpcProvider(config.polygonRpcUrl);
    }
    return _provider;
}

/**
 * Get CLOB V2 collateral balance (pUSD) for trading.
 * The exported name is kept for compatibility with existing callers.
 */
export async function getUsdcBalance() {
    if (clobClient) {
        const response = await fetchCollateralBalanceAllowance();
        return parseCollateralBalance(response?.balance);
    }

    const provider = getPolygonProvider();
    const abi = ['function balanceOf(address) view returns (uint256)'];
    const pusd = new ethers.Contract(PUSD_ADDRESS, abi, provider);
    const balance = await pusd.balanceOf(config.proxyWallet);
    return parseFloat(ethers.utils.formatUnits(balance, 6));
}
