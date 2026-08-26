import { get } from 'svelte/store';
import { APP, state, addToLog } from '../stores/app.js';
import { startWebSocket } from './binance.js';
import { analyzeSMC } from './smc.js';
import { calculateTrendLines, calculateHurst, calculateRegLin } from './indicators.js';
import { runLiquidityStrategy, runOptimizer } from './liquidity.js';
import { callEngine, cacheCandles, initEngine, engineStatus } from './engine_client.js';
import {
    resolveStrategyConfig,
    resolveMetricsConfig,
    COST_SWEEP_BPS,
} from '../config/strategies.js';

export { engineStatus };

let chartReference = null;
let cachedFullHistory = null;
let cachedFullHistorySymbol = null;
let cachedFullHistoryInterval = null;

export function setChartReference(chart) {
    chartReference = chart;
}

/**
 * Stable identity for a candle array, used as the engine-side cache key. Changing symbol,
 * timeframe or the loaded range yields a new key; a live tick appending to the tail does
 * too, which is what we want — the engine must not analyse a stale tail.
 */
function datasetKey(candles, tag = 'view') {
    if (!candles || candles.length === 0) return `${tag}:empty`;
    return `${tag}:${APP.symbol}:${APP.interval}:${candles[0].time}:${candles[candles.length - 1].time}:${candles.length}`;
}

/** Sort ascending and drop duplicate timestamps. */
function normalizeCandles(list) {
    const sorted = [...list].sort((a, b) => a.time - b.time);
    return sorted.filter((v, i, a) => i === 0 || v.time > a[i - 1].time);
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

async function fetchBinanceRestKlines({
    symbol = APP.symbol,
    interval = APP.interval,
    limit = 1000,
    startTime = null,
    endTime = null,
} = {}) {
    try {
        let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(limit, 1000)}`;
        if (startTime) url += `&startTime=${startTime}`;
        if (endTime) url += `&endTime=${endTime}`;

        const res = await fetch(url);
        if (!res.ok) return [];
        const raw = await res.json();
        if (!Array.isArray(raw)) return [];

        return raw.map((c) => {
            const volume = parseFloat(c[5]);
            const buyVolume = parseFloat(c[9]);
            return {
                time: Math.floor(c[0] / 1000),
                open: parseFloat(c[1]),
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
                volume,
                buyVolume,
                sellVolume: volume - buyVolume,
                delta: buyVolume - (volume - buyVolume),
                txnCount: parseInt(c[8], 10) || 0,
            };
        });
    } catch (e) {
        console.warn('[BinanceREST] Failed to fetch klines:', e.message);
        return [];
    }
}

function mapDbCandle(c) {
    const volume = parseFloat(c.volume || 0);
    const delta = parseFloat(c.volume_delta || 0);
    return {
        time: typeof c.time === 'string' ? parseInt(c.time, 10) : c.time,
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
        volume,
        buyVolume: (volume + delta) / 2,
        sellVolume: (volume - delta) / 2,
        delta,
        txnCount: c.txn_count ? parseInt(c.txn_count, 10) : 0,
    };
}

export async function fetchCandlesBatch({
    symbol = APP.symbol,
    interval = APP.interval,
    limit = APP.chunkSize,
    endTime = null,
} = {}) {
    let dbCandles = [];

    try {
        let dbUrl = `/api/db/klines?symbol=${symbol}&exchange=binance&interval=${interval}&limit=${limit}`;
        if (endTime) dbUrl += `&endTime=${endTime}`;

        const res = await fetch(dbUrl);
        if (res.ok) {
            const data = await res.json();
            if (data && data.candles && data.candles.length > 0) {
                dbCandles = data.candles.map(mapDbCandle);
            }
        }
    } catch (err) {
        console.warn('[DataService] Local DB unavailable, falling back to Binance REST:', err.message);
    }

    if (endTime === null) {
        const intervalSecMap = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 };
        const intervalSec = intervalSecMap[interval] || 900;
        const nowSec = Math.floor(Date.now() / 1000);

        if (dbCandles.length > 0) {
            const latestDbTime = dbCandles[dbCandles.length - 1].time;
            if (nowSec - latestDbTime > intervalSec * 1.5) {
                addToLog(`Synchronizing recent market gap from Binance Live API (${interval})...`);
                const gapCandles = await fetchBinanceRestKlines({
                    symbol,
                    interval,
                    limit: 1000,
                    startTime: (latestDbTime + 1) * 1000,
                });

                if (gapCandles.length > 0) {
                    addToLog(`Synchronized ${gapCandles.length} latest live candles from Binance API.`);
                    return normalizeCandles([...dbCandles, ...gapCandles]).slice(-limit);
                }
            }
            return dbCandles;
        }

        addToLog(`Fetching ${limit} ${interval} candles from Binance REST API...`);
        return await fetchBinanceRestKlines({ symbol, interval, limit, startTime: null, endTime: null });
    }

    if (dbCandles.length > 0) return dbCandles;
    return await fetchBinanceRestKlines({ symbol, interval, limit, endTime });
}

export async function getFullHistoricalCandles() {
    if (
        cachedFullHistory &&
        cachedFullHistorySymbol === APP.symbol &&
        cachedFullHistoryInterval === APP.interval &&
        cachedFullHistory.length > 500
    ) {
        return cachedFullHistory;
    }

    addToLog(`Fetching complete multi-year history for backtest engine (${APP.symbol} ${APP.interval})...`);
    try {
        const res = await fetch(
            `/api/db/klines?symbol=${APP.symbol}&exchange=binance&interval=${APP.interval}&limit=250000`,
        );
        if (res.ok) {
            const data = await res.json();
            if (data && data.candles && data.candles.length > 0) {
                const fullCandles = normalizeCandles(data.candles.map(mapDbCandle));
                cachedFullHistory = fullCandles;
                cachedFullHistorySymbol = APP.symbol;
                cachedFullHistoryInterval = APP.interval;
                addToLog(`Cached full history: ${fullCandles.length} candles for ${APP.interval} backtesting`);
                return fullCandles;
            }
        }
    } catch (err) {
        console.warn('Full history fetch from DB failed, falling back to current visual slice:', err);
    }

    return get(state).candles;
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

export async function runFullLoadPipeline() {
    await initEngine();
    state.update((s) => ({
        ...s,
        loading: true,
        candles: [],
        hasMoreHistory: true,
        isLoadingMore: false,
    }));

    try {
        addToLog(`Loading initial ${APP.initialCap} candles (${APP.symbol} ${APP.interval})...`);

        const initialCandles = await fetchCandlesBatch({
            symbol: APP.symbol,
            interval: APP.interval,
            limit: APP.initialCap,
            endTime: null,
        });

        const cleanCandles = normalizeCandles(initialCandles);

        state.update((s) => ({
            ...s,
            candles: cleanCandles,
            loading: false,
            dataSourceStatus:
                cleanCandles.length > 0 ? 'Connected (Local DB + Live Sync)' : 'Connecting...',
        }));

        addToLog(`Loaded ${cleanCandles.length} candles for ${APP.interval}. Starting live WebSocket & analysis.`);
        await manualRefresh();

        startWebSocket({});
    } catch (e) {
        console.error('Error in runFullLoadPipeline:', e);
        state.update((s) => ({ ...s, loading: false }));
    }
}

export async function loadOlderCandles() {
    const snapshot = get(state);
    if (snapshot.isLoadingMore || !snapshot.hasMoreHistory || snapshot.candles.length === 0) return;

    state.update((s) => ({ ...s, isLoadingMore: true }));
    const earliestTime = snapshot.candles[0].time * 1000 - 1;

    try {
        const olderBatch = await fetchCandlesBatch({
            symbol: APP.symbol,
            interval: APP.interval,
            limit: APP.chunkSize,
            endTime: earliestTime,
        });

        if (!olderBatch || olderBatch.length === 0) {
            state.update((s) => ({ ...s, isLoadingMore: false, hasMoreHistory: false }));
            addToLog('Reached beginning of available historical data.');
            return;
        }

        state.update((s) => ({
            ...s,
            candles: normalizeCandles([...olderBatch, ...s.candles]),
            isLoadingMore: false,
        }));

        addToLog(`Loaded +${olderBatch.length} historical candles (${APP.interval})`);
    } catch (e) {
        console.error('Error loading older candles:', e);
        state.update((s) => ({ ...s, isLoadingMore: false }));
    }
}

/**
 * Refresh every derived view for the current candle slice.
 *
 * All the heavy work happens in the worker and awaits here; only the final assignment
 * touches the store. Previously this ran the whole analysis stack synchronously *inside*
 * `state.update()`, which both blocked the UI thread and made the updater impure.
 */
export async function manualRefresh() {
    const snapshot = get(state);
    const candles = snapshot.candles;
    if (!candles || candles.length === 0) return;

    const key = datasetKey(candles);
    const indicatorConfig = {
        sensitivity: APP.sensitivity,
        historyTarget: APP.historyTarget,
        fractalStrength: snapshot.fractalStrength,
        angleFilter: snapshot.angleFilter,
        interval: APP.interval,
        strictMode: true,
        showHistory: true,
        tolerance: 1,
    };

    // One transfer, many calls.
    await cacheCandles(key, candles).catch(() => {});

    const strategyConfig = resolveStrategyConfig(snapshot.strategyParams);
    const metricsConfig = resolveMetricsConfig(snapshot.strategyParams);

    const wants = [
        callEngine('smc', {
            key,
            sensitivity: APP.sensitivity,
            historyTarget: APP.historyTarget,
            riskReward: 2.0,
        }).catch((e) => {
            console.warn('SMC engine error:', e.message);
            return null;
        }),
        callEngine('cvd', { key, anchor: snapshot.cvdAnchor || 'daily', smaPeriod: 20, divLookback: 24 }).catch(
            () => null,
        ),
        callEngine('volumeProfile', { key, bins: 70 }).catch(() => null),
        callEngine('indicators', {
            key,
            rsiLength: strategyConfig.rsiLength,
            adxLength: strategyConfig.adxLength,
        }).catch(() => null),
        snapshot.activeStrategy === 'CRYPTO_PRO'
            ? callEngine('backtest', { key, config: strategyConfig, metricsConfig }).catch((e) => {
                  console.warn('CryptoPRO engine error:', e.message);
                  return null;
              })
            : Promise.resolve(null),
    ];

    const [smcRes, cvdData, volumeProfile, indicatorSeries, proRes] = await Promise.all(wants);

    // JS fallback only if the Rust path produced nothing at all.
    let zones = smcRes?.zones || [];
    let smcTrades = smcRes?.trades || [];
    if (zones.length === 0) {
        const jsResult = analyzeSMC(candles, indicatorConfig);
        zones = jsResult.zones || [];
        smcTrades = jsResult.trades || [];
    }

    const lines = calculateTrendLines(candles, indicatorConfig);
    const channel = calculateRegLin(candles, {
        ...indicatorConfig,
        period: snapshot.regPeriod || 200,
        stdMult: snapshot.regStd || 2.0,
    });
    const hurst = calculateHurst(candles);

    let trades = [];
    let cryptoProDashboard = null;
    let metrics = null;
    let equityCurve = [];

    if (snapshot.activeStrategy === 'CRYPTO_PRO' && proRes) {
        trades = proRes.trades || [];
        cryptoProDashboard = proRes.dashboard || null;
        metrics = proRes.metrics || null;
        equityCurve = proRes.equityCurve || [];
    } else if (snapshot.activeStrategy === 'SMC') {
        trades = smcTrades;
    } else {
        const modeMap = {
            TL_TRAP: 'standard',
            TL_TRAP_AGRO: 'agro',
            TL_TRAP_ATR: 'atr',
            TL_TRAP_ATR_AGRO: 'atr_agro',
            TL_TRAP_ATR_PARTIAL_1: 'atr_partial_1',
            TL_TRAP_ATR_PARTIAL_2: 'atr_partial_2',
        };
        const mode = modeMap[snapshot.activeStrategy] || 'standard';
        trades =
            runLiquidityStrategy(candles, mode, {
                collectOnly: true,
                useVolumeAnalysis: snapshot.useVolumeAnalysis,
                config: indicatorConfig,
            }).trades || [];
    }

    state.update((s) => ({
        ...s,
        zones,
        trades,
        lines,
        channel,
        cvdData,
        volumeProfile,
        indicatorSeries,
        cryptoProDashboard,
        equityCurve: equityCurve.length ? equityCurve : s.equityCurve,
        pnlMetrics: metrics || s.pnlMetrics,
        hurst: hurst.hurst,
        hurstType: hurst.type,
    }));

    if (!metrics) await updatePnL();
}

export function runSelectedStrategy(stratName) {
    state.update((s) => ({ ...s, activeStrategy: stratName, pnlLocked: false }));
    return manualRefresh();
}

/**
 * Run a strategy over the full history (or the visual slice) and compute the full metrics
 * report in the same worker round trip.
 */
export async function executeStrategy(mode = 'crypto_pro') {
    const snapshot = get(state);
    const isFullHistory = snapshot.fullHistoryBacktest;

    addToLog(`Running strategy [${mode}] ${isFullHistory ? '(Full History)' : '(Visual Range)'}...`);
    state.update((s) => ({ ...s, isBacktesting: true }));

    try {
        const dataset = isFullHistory ? await getFullHistoricalCandles() : snapshot.candles;
        if (!dataset || dataset.length === 0) {
            addToLog('No candles available for the backtest.');
            return;
        }

        const key = datasetKey(dataset, isFullHistory ? 'full' : 'view');
        await cacheCandles(key, dataset).catch(() => {});

        const strategyConfig = resolveStrategyConfig(snapshot.strategyParams);
        const metricsConfig = resolveMetricsConfig(snapshot.strategyParams, {
            // The optimizer tries four configurations; tell the deflated Sharpe about it.
            trialsTested: Math.max(1, snapshot.optimizerResults?.length || 1),
        });

        if (mode === 'CRYPTO_PRO' || mode === 'crypto_pro') {
            const res = await callEngine('backtest', { key, config: strategyConfig, metricsConfig });
            state.update((s) => ({
                ...s,
                trades: res.trades || [],
                cryptoProDashboard: res.dashboard || null,
                equityCurve: res.equityCurve || [],
                pnlMetrics: res.metrics || s.pnlMetrics,
                pnlLocked: false,
                lastBacktestKey: key,
            }));
            addToLog(
                `Backtest done: ${res.trades?.length || 0} trades over ${dataset.length} candles. ` +
                    `WR ${res.metrics?.winRate?.toFixed(1)}%, PF ${res.metrics?.profitFactor?.toFixed(2)}, ` +
                    `PnL $${res.metrics?.totalPnl?.toFixed(2)}, costs $${res.metrics?.totalCosts?.toFixed(2)}`,
            );
            return;
        }

        // Rule-based JS strategies still run inline; they are far cheaper than CryptoPRO.
        const trades =
            runLiquidityStrategy(dataset, mode, {
                useVolumeAnalysis: snapshot.useVolumeAnalysis,
                config: {
                    sensitivity: APP.sensitivity,
                    historyTarget: dataset.length,
                    fractalStrength: snapshot.fractalStrength,
                    angleFilter: snapshot.angleFilter,
                },
            }).trades || [];

        const metrics = await callEngine('metrics', {
            trades,
            equityCurve: [],
            config: metricsConfig,
        });

        state.update((s) => ({
            ...s,
            trades,
            cryptoProDashboard: null,
            equityCurve: metrics?.equityCurve || [],
            pnlMetrics: metrics || s.pnlMetrics,
            pnlLocked: false,
        }));
        addToLog(`Strategy [${mode}] executed: ${trades.length} trades. WR ${metrics?.winRate?.toFixed(1)}%`);
    } catch (err) {
        console.error('Backtest failed:', err);
        addToLog(`Backtest failed: ${err.message}`);
    } finally {
        state.update((s) => ({ ...s, isBacktesting: false }));
    }
}

/**
 * Re-run the backtest across a sweep of per-side costs.
 *
 * The single most useful diagnostic this terminal can show: how much of the edge is
 * margin over transaction costs, and where it disappears.
 */
export async function runCostSweep(bpsList = COST_SWEEP_BPS) {
    const snapshot = get(state);
    const dataset = snapshot.fullHistoryBacktest ? await getFullHistoricalCandles() : snapshot.candles;
    if (!dataset || dataset.length === 0) return [];

    state.update((s) => ({ ...s, isSweeping: true }));
    addToLog(`Running cost sensitivity sweep over ${bpsList.length} levels...`);

    try {
        const key = datasetKey(dataset, snapshot.fullHistoryBacktest ? 'full' : 'view');
        await cacheCandles(key, dataset).catch(() => {});
        const points = await callEngine('costSweep', {
            key,
            config: resolveStrategyConfig(snapshot.strategyParams),
            bpsList,
        });
        state.update((s) => ({ ...s, costSensitivity: points }));

        const breakeven = points.find((p) => p.pnlUsd <= 0);
        addToLog(
            breakeven
                ? `Sweep done. Strategy turns unprofitable at ~${breakeven.perSideBps} bps per side.`
                : 'Sweep done. Strategy stays profitable across the whole cost range.',
        );
        return points;
    } catch (err) {
        addToLog(`Cost sweep failed: ${err.message}`);
        return [];
    } finally {
        state.update((s) => ({ ...s, isSweeping: false }));
    }
}

export async function executeOptimizer() {
    const snapshot = get(state);
    const isFullHistory = snapshot.fullHistoryBacktest;

    addToLog(`Running Rust optimizer ${isFullHistory ? '(Full History)' : '(Active Slice)'}...`);
    const dataset = isFullHistory ? await getFullHistoricalCandles() : snapshot.candles;
    if (!dataset || dataset.length === 0) return;

    const key = datasetKey(dataset, isFullHistory ? 'full' : 'view');
    await cacheCandles(key, dataset).catch(() => {});

    let results = [];
    try {
        results = (await callEngine('optimizer', { key, sensitivity: APP.sensitivity })) || [];
    } catch (e) {
        console.warn('Optimizer error, using JS fallback:', e.message);
    }

    if (!results || results.length === 0) {
        results =
            runOptimizer(dataset, {
                useVolumeAnalysis: snapshot.useVolumeAnalysis,
                config: {
                    sensitivity: APP.sensitivity,
                    historyTarget: dataset.length,
                    fractalStrength: snapshot.fractalStrength,
                    angleFilter: snapshot.angleFilter,
                },
            }) || [];
    }

    state.update((s) => ({ ...s, optimizerResults: results }));
    addToLog(`Optimizer finished: ${results.length} setups evaluated across ${dataset.length} candles.`);
}

export async function applyOptimizerSelection(modeKey) {
    const snapshot = get(state);
    const cfg = snapshot.optimizerResults.find((r) => r.key === modeKey);
    if (!cfg) return;

    const metrics = await callEngine('metrics', {
        trades: cfg.trades || [],
        equityCurve: [],
        config: resolveMetricsConfig(snapshot.strategyParams, {
            // Selecting the best of N configurations is exactly the multiple-testing
            // situation the deflated Sharpe exists to penalize.
            trialsTested: Math.max(1, snapshot.optimizerResults.length),
        }),
    }).catch(() => null);

    state.update((s) => ({
        ...s,
        trades: (cfg.trades || []).map((t) => ({ ...t })),
        pnlMetrics: metrics || s.pnlMetrics,
        equityCurve: metrics?.equityCurve || [],
        pnlLocked: true,
        activeMode: 'pnl',
    }));
}

export async function updatePnL() {
    const snapshot = get(state);
    const metrics = await callEngine('metrics', {
        trades: snapshot.trades || [],
        equityCurve: snapshot.equityCurve || [],
        config: resolveMetricsConfig(snapshot.strategyParams),
    }).catch((e) => {
        console.warn('Metrics engine error:', e.message);
        return null;
    });

    if (!metrics) return;
    state.update((s) => ({
        ...s,
        pnlMetrics: metrics,
        equityCurve: metrics.equityCurve?.length ? metrics.equityCurve : s.equityCurve,
    }));
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export async function replayTrade(trade) {
    if (!trade) return;
    const tradeTime = Number(
        trade.entryTime || trade.entry_time || trade.signalTime || trade.signal_time || trade.time,
    );

    const pick = (...vals) => {
        for (const v of vals) if (v !== undefined && v !== null) return Number(v);
        return null;
    };

    const initialSlVal = pick(trade.initial_sl, trade.initialSl, trade.sl);
    const trailingSlVal = pick(trade.trailing_sl, trade.trailingSl);
    const tp1TimeVal = pick(trade.tp1_time, trade.tp1Time);
    const tp2TimeVal = pick(trade.tp2_time, trade.tp2Time);
    const tp3TimeVal = pick(trade.tp3_time, trade.tp3Time);

    const normalizedTrade = {
        ...trade,
        entry: Number(trade.entry),
        sl: Number(trade.sl),
        initial_sl: initialSlVal,
        initialSl: initialSlVal,
        trailing_sl: trailingSlVal,
        trailingSl: trailingSlVal,
        tp: pick(trade.tp, trade.tp1),
        tp1: pick(trade.tp1, trade.tp),
        tp2: pick(trade.tp2),
        tp3: pick(trade.tp3),
        tp1_time: tp1TimeVal,
        tp1Time: tp1TimeVal,
        tp2_time: tp2TimeVal,
        tp2Time: tp2TimeVal,
        tp3_time: tp3TimeVal,
        tp3Time: tp3TimeVal,
        time: tradeTime,
        entryTime: Number(trade.entryTime || trade.entry_time || tradeTime),
        signalTime: Number(trade.signalTime || trade.signal_time || tradeTime),
        exitTime: Number(trade.exitTime || trade.exit_time || tradeTime + 3600 * 4),
        srLevel: pick(trade.srLevel, trade.sr_level),
        srTime: pick(trade.srTime, trade.sr_time),
        srType: trade.srType || trade.sr_type || (trade.type === 'LONG' ? 'SUPPORT' : 'RESISTANCE'),
    };

    let targetSubPanes = ['RSI', 'MACD', 'ADX'];
    if (trade.id?.startsWith('OF-') || normalizedTrade.desc?.toLowerCase().includes('order flow')) {
        targetSubPanes = ['CVD', 'Z_SCORE'];
    } else if (trade.id?.startsWith('SMC-') || trade.id?.startsWith('smc-')) {
        targetSubPanes = ['CVD'];
    }

    const fullHistory = await getFullHistoricalCandles();
    if (fullHistory && fullHistory.length > 0) {
        state.update((s) => ({
            ...s,
            liveCandlesBackup: s.liveCandlesBackup || s.candles,
            candles: fullHistory,
            isReplayMode: true,
            selectedTrade: normalizedTrade,
            activeSubPanes: targetSubPanes,
        }));
        return;
    }

    state.update((s) => ({
        ...s,
        isReplayMode: true,
        selectedTrade: normalizedTrade,
        activeSubPanes: targetSubPanes,
    }));
}

export function exitReplay() {
    state.update((s) => ({
        ...s,
        isReplayMode: false,
        selectedTrade: null,
        candles: s.liveCandlesBackup || s.candles,
        liveCandlesBackup: null,
    }));
    setTimeout(() => {
        if (chartReference) chartReference.timeScale().scrollToRealTime();
    }, 80);
}

export function switchMainTab(tab) {
    state.update((s) => ({ ...s, activeMode: tab }));
    if (tab === 'pnl' || tab === 'analytics') updatePnL();
}

export function setCvdAnchor(anchor) {
    state.update((s) => ({ ...s, cvdAnchor: anchor }));
    return manualRefresh();
}

/** Apply edited strategy parameters and re-run. */
export function updateStrategyParams(patch) {
    state.update((s) => ({
        ...s,
        strategyParams: {
            ...s.strategyParams,
            ...patch,
            costs: { ...s.strategyParams.costs, ...(patch.costs || {}) },
        },
    }));
}
