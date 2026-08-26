/**
 * Engine worker: hosts the Rust/Wasm module off the main thread.
 *
 * Every heavy call (SMC, CryptoPRO, optimizer, CVD, volume profile, metrics, cost sweep)
 * used to run synchronously inside a Svelte `state.update()` on the UI thread. With a
 * 240k-candle dataset that blocks rendering for seconds at a time and makes the chart
 * unusable during a backtest. Here it costs the UI nothing.
 *
 * Candles are cached in the worker under a dataset key so a backtest, a cost sweep and an
 * indicator refresh over the same data transfer it once instead of once per call.
 */

import init, {
    init_panic_hook,
    analyze_market_wasm,
    run_optimizer_wasm,
    analyze_anchored_cvd_wasm,
    calculate_volume_profile_wasm,
    resample_candles_wasm,
    analyze_crypto_pro_wasm,
    compute_metrics_wasm,
    compute_indicators_wasm,
    cost_sensitivity_wasm,
    greet,
} from '../wasm/btc_engine.js';

let ready = false;
/** @type {Map<string, any[]>} datasetKey -> candles */
const datasets = new Map();
/** Only a couple of datasets are ever live (visual slice + full history). */
const MAX_CACHED_DATASETS = 4;

async function ensureReady() {
    if (ready) return;
    await init();
    try {
        init_panic_hook();
    } catch {
        // Older builds may not export the hook; not worth failing startup over.
    }
    ready = true;
}

function putDataset(key, candles) {
    if (!key) return;
    datasets.set(key, candles);
    while (datasets.size > MAX_CACHED_DATASETS) {
        datasets.delete(datasets.keys().next().value);
    }
}

/**
 * Resolve the candles for a request: either freshly supplied (and then cached) or pulled
 * from the cache by key.
 */
function resolveCandles(msg) {
    if (Array.isArray(msg.candles)) {
        putDataset(msg.key, msg.candles);
        return msg.candles;
    }
    if (msg.key && datasets.has(msg.key)) {
        return datasets.get(msg.key);
    }
    throw new Error(`no candles for dataset key "${msg.key}" - send them with the request`);
}

const handlers = {
    ping: () => ({ ready: true, version: greet() }),

    cacheCandles: (msg) => {
        putDataset(msg.key, msg.candles || []);
        return { key: msg.key, count: (msg.candles || []).length };
    },

    dropDataset: (msg) => {
        datasets.delete(msg.key);
        return { key: msg.key };
    },

    smc: (msg) => {
        const candles = resolveCandles(msg);
        return analyze_market_wasm(
            candles,
            msg.sensitivity ?? 0.0001,
            msg.historyTarget ?? candles.length,
            msg.riskReward ?? 2.0,
        );
    },

    cryptoPro: (msg) => analyze_crypto_pro_wasm(resolveCandles(msg), msg.config),

    optimizer: (msg) => run_optimizer_wasm(resolveCandles(msg), msg.sensitivity ?? 0.0001),

    cvd: (msg) =>
        analyze_anchored_cvd_wasm(
            resolveCandles(msg),
            msg.anchor || 'daily',
            msg.smaPeriod ?? 20,
            msg.divLookback ?? 24,
        ),

    volumeProfile: (msg) => calculate_volume_profile_wasm(resolveCandles(msg), msg.bins ?? 70),

    indicators: (msg) =>
        compute_indicators_wasm(resolveCandles(msg), msg.rsiLength ?? 14, msg.adxLength ?? 14),

    resample: (msg) => resample_candles_wasm(resolveCandles(msg), msg.targetSeconds ?? 900),

    metrics: (msg) => compute_metrics_wasm(msg.trades || [], msg.equityCurve || [], msg.config),

    costSweep: (msg) => cost_sensitivity_wasm(resolveCandles(msg), msg.config, msg.bpsList || []),

    /** Strategy + metrics in one round trip, which is how the UI actually uses it. */
    backtest: (msg) => {
        const candles = resolveCandles(msg);
        const run = analyze_crypto_pro_wasm(candles, msg.config);
        const metrics = compute_metrics_wasm(
            run.trades || [],
            run.equityCurve || [],
            msg.metricsConfig,
        );
        return { ...run, metrics };
    },
};

self.onmessage = async (event) => {
    const msg = event.data || {};
    const { id, type } = msg;

    try {
        await ensureReady();
        const handler = handlers[type];
        if (!handler) throw new Error(`unknown engine request "${type}"`);

        const started = performance.now();
        const result = handler(msg);
        self.postMessage({ id, ok: true, result, elapsedMs: performance.now() - started });
    } catch (err) {
        // Surface the real message. The old code caught these and fell through to an empty
        // result, so a broken payload looked identical to a quiet market.
        self.postMessage({
            id,
            ok: false,
            error: err && err.message ? err.message : String(err),
        });
    }
};
