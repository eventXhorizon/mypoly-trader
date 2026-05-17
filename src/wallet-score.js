import config, { validateWalletAnalyticsConfig } from './config/index.js';
import logger from './utils/logger.js';
import { setupAxiosProxy } from './utils/proxy.js';
import { backfillWallet } from './services/walletBackfill.js';
import {
    closeWalletAnalyticsDb,
    initWalletAnalyticsDb,
} from './services/walletAnalyticsDb.js';
import { getTopWalletScores, scoreWallet } from './services/walletScorer.js';

function usage() {
    return [
        'Usage:',
        '  npm run wallet-score -- 0xWALLET_ADDRESS',
        '  npm run wallet-score -- --top 20',
        '',
        'This command reads public Polymarket data, writes local Postgres analytics tables,',
        'and prints a stage1a score. It never places orders.',
    ].join('\n');
}

function parseArgs(argv) {
    const args = argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        return { help: true };
    }

    const topIndex = args.indexOf('--top');
    if (topIndex !== -1) {
        const limit = Number.parseInt(args[topIndex + 1] || '20', 10);
        return { top: Number.isInteger(limit) && limit > 0 ? limit : 20 };
    }

    const wallet = args.find((arg) => /^0x[a-fA-F0-9]{40}$/.test(arg));
    return { wallet: wallet?.toLowerCase() || '' };
}

async function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        process.stdout.write(`${usage()}\n`);
        return;
    }

    try {
        validateWalletAnalyticsConfig();
    } catch (err) {
        logger.error(err.message);
        process.exit(1);
    }

    await setupAxiosProxy({ useEnvProxy: true });
    const dbReady = await initWalletAnalyticsDb(logger);
    if (!dbReady) {
        logger.error('Wallet analytics database is not available.');
        process.exit(1);
    }

    try {
        if (args.top) {
            const scores = await getTopWalletScores(args.top);
            process.stdout.write(`${JSON.stringify({ scores }, null, 2)}\n`);
            return;
        }

        if (!args.wallet) {
            logger.error('Missing wallet address.');
            process.stdout.write(`${usage()}\n`);
            process.exit(1);
        }

        logger.info(`Wallet analytics limits: trades=${config.walletAnalyticsTradeLimit}, closed_positions=${config.walletAnalyticsClosedPositionLimit}`);
        const backfill = await backfillWallet(args.wallet, logger);
        const score = await scoreWallet(args.wallet, logger);
        process.stdout.write(`${JSON.stringify({ backfill, score }, null, 2)}\n`);
    } finally {
        await closeWalletAnalyticsDb();
    }
}

main().catch(async (err) => {
    logger.error(`Wallet scoring failed: ${err.message}`);
    await closeWalletAnalyticsDb();
    process.exit(1);
});
