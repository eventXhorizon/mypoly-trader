function parseTradeTimestampMs(timestamp) {
    if (timestamp === null || timestamp === undefined || timestamp === '') return null;

    if (typeof timestamp === 'number') {
        return timestamp < 1e12 ? timestamp * 1000 : timestamp;
    }

    const text = String(timestamp).trim();
    if (!text) return null;

    if (/^\d+(\.\d+)?$/.test(text)) {
        const value = Number(text);
        return value < 1e12 ? value * 1000 : value;
    }

    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
}

function formatIso(ms) {
    return new Date(ms).toISOString();
}

export function buildCopyOpenLatencyLog(trade, ownOpenedAt = new Date()) {
    const targetMs = parseTradeTimestampMs(trade?.timestamp);
    const ownMs = ownOpenedAt instanceof Date ? ownOpenedAt.getTime() : parseTradeTimestampMs(ownOpenedAt);

    if (!targetMs || !ownMs) {
        return `Copy open latency unavailable | target_open=${trade?.timestamp || 'unknown'} | own_open=${ownMs ? formatIso(ownMs) : 'unknown'}`;
    }

    const delayMs = ownMs - targetMs;
    const market = trade?.market || trade?.tokenId || 'unknown market';
    return `Copy open latency | target_open=${formatIso(targetMs)} | own_open=${formatIso(ownMs)} | delay=${delayMs}ms (${(delayMs / 1000).toFixed(3)}s) | ${market}`;
}
