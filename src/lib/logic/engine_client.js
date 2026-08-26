/**
 * Promise-based RPC client for the engine worker.
 *
 * Falls back to running the Wasm module on the main thread if the worker cannot start
 * (older browsers, blocked module workers). The fallback is slower but correct, and
 * `engineStatus` reports which path is live so the UI can say so instead of leaving the
 * user guessing — a Wasm failure used to be completely invisible.
 */

import { writable } from 'svelte/store';

export const engineStatus = writable({
    mode: 'starting', // 'worker' | 'main-thread' | 'failed' | 'starting'
    ready: false,
    version: '',
    error: null,
    busy: 0,
});

let worker = null;
let seq = 0;
const pending = new Map();

/** Main-thread fallback module namespace, loaded lazily. */
let inlineWasm = null;
let inlineCandles = new Map();

function markBusy(delta) {
    engineStatus.update((s) => ({ ...s, busy: Math.max(0, s.busy + delta) }));
}

function startWorker() {
    if (worker) return worker;
    try {
        worker = new Worker(new URL('../workers/engine.worker.js', import.meta.url), {
            type: 'module',
        });
        worker.onmessage = (event) => {
            const { id, ok, result, error } = event.data || {};
            const entry = pending.get(id);
            if (!entry) return;
            pending.delete(id);
            markBusy(-1);
            if (ok) entry.resolve(result);
            else entry.reject(new Error(error || 'engine error'));
        };
        worker.onerror = (err) => {
            const message = err?.message || 'engine worker crashed';
            engineStatus.update((s) => ({ ...s, mode: 'failed', error: message }));
            for (const [, entry] of pending) entry.reject(new Error(message));
            pending.clear();
            worker = null;
        };
    } catch (err) {
        worker = null;
        engineStatus.update((s) => ({ ...s, mode: 'main-thread', error: err.message }));
    }
    return worker;
}

async function ensureInlineWasm() {
    if (inlineWasm) return inlineWasm;
    const mod = await import('../wasm/btc_engine.js');
    await mod.default();
    try {
        mod.init_panic_hook();
    } catch {
        /* optional */
    }
    inlineWasm = mod;
    return mod;
}

/** Main-thread mirror of the worker's dispatch table. */
async function callInline(type, payload) {
    const m = await ensureInlineWasm();

    const candlesFor = () => {
        if (Array.isArray(payload.candles)) {
            if (payload.key) inlineCandles.set(payload.key, payload.candles);
            return payload.candles;
        }
        if (payload.key && inlineCandles.has(payload.key)) return inlineCandles.get(payload.key);
        throw new Error(`no candles for dataset key "${payload.key}"`);
    };

    switch (type) {
        case 'ping':
            return { ready: true, version: m.greet() };
        case 'cacheCandles':
            inlineCandles.set(payload.key, payload.candles || []);
            return { key: payload.key, count: (payload.candles || []).length };
        case 'dropDataset':
            inlineCandles.delete(payload.key);
            return { key: payload.key };
        case 'smc': {
            const c = candlesFor();
            return m.analyze_market_wasm(
                c,
                payload.sensitivity ?? 0.0001,
                payload.historyTarget ?? c.length,
                payload.riskReward ?? 2.0,
            );
        }
        case 'cryptoPro':
            return m.analyze_crypto_pro_wasm(candlesFor(), payload.config);
        case 'optimizer':
            return m.run_optimizer_wasm(candlesFor(), payload.sensitivity ?? 0.0001);
        case 'cvd':
            return m.analyze_anchored_cvd_wasm(
                candlesFor(),
                payload.anchor || 'daily',
                payload.smaPeriod ?? 20,
                payload.divLookback ?? 24,
            );
        case 'volumeProfile':
            return m.calculate_volume_profile_wasm(candlesFor(), payload.bins ?? 70);
        case 'indicators':
            return m.compute_indicators_wasm(
                candlesFor(),
                payload.rsiLength ?? 14,
                payload.adxLength ?? 14,
            );
        case 'resample':
            return m.resample_candles_wasm(candlesFor(), payload.targetSeconds ?? 900);
        case 'metrics':
            return m.compute_metrics_wasm(
                payload.trades || [],
                payload.equityCurve || [],
                payload.config,
            );
        case 'costSweep':
            return m.cost_sensitivity_wasm(candlesFor(), payload.config, payload.bpsList || []);
        case 'backtest': {
            const c = candlesFor();
            const run = m.analyze_crypto_pro_wasm(c, payload.config);
            const metrics = m.compute_metrics_wasm(
                run.trades || [],
                run.equityCurve || [],
                payload.metricsConfig,
            );
            return { ...run, metrics };
        }
        default:
            throw new Error(`unknown engine request "${type}"`);
    }
}

/**
 * Call the engine. Resolves with the Rust result, rejects with the real error message.
 */
export function callEngine(type, payload = {}) {
    const w = startWorker();

    if (!w) {
        markBusy(1);
        return callInline(type, payload).finally(() => markBusy(-1));
    }

    const id = ++seq;
    markBusy(1);
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ id, type, ...payload });
    });
}

/** Boot the engine and record which execution path won. */
export async function initEngine() {
    try {
        const res = await callEngine('ping');
        engineStatus.set({
            mode: worker ? 'worker' : 'main-thread',
            ready: true,
            version: res?.version || '',
            error: null,
            busy: 0,
        });
        return true;
    } catch (err) {
        // Worker path failed; retry once on the main thread before giving up.
        try {
            worker = null;
            const res = await callInline('ping', {});
            engineStatus.set({
                mode: 'main-thread',
                ready: true,
                version: res?.version || '',
                error: err.message,
                busy: 0,
            });
            return true;
        } catch (inlineErr) {
            engineStatus.set({
                mode: 'failed',
                ready: false,
                version: '',
                error: inlineErr.message,
                busy: 0,
            });
            return false;
        }
    }
}

/** Push a dataset into the engine cache so later calls can reference it by key. */
export function cacheCandles(key, candles) {
    return callEngine('cacheCandles', { key, candles });
}
