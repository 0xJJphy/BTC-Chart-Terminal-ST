import { APP, state, addToLog } from '../stores/app.js';
import { fetchKlinesBatch, startWebSocket } from './binance.js';
import { analyzeSMC } from './smc.js';
import { calculateTrendLines, calculateHurst, calculateRegLin } from './indicators.js';
import { runLiquidityStrategy, runOptimizer } from './liquidity.js';
import { calculatePnLMetrics } from './pnl.js';
import { zoomRange, prepareReplayData } from './replay.js';

// Rust Wasm Engine
import init, { analyze_market_wasm, run_optimizer_wasm } from '../wasm/btc_engine.js';

let wasmReady = false;
async function ensureWasm() {
    if (!wasmReady) {
        try {
            await init();
            wasmReady = true;
            console.log("🚀 Motor Rust (Wasm) inicializado correctamente");
        } catch (e) {
            console.error("Fallo al inicializar Wasm:", e);
        }
    }
}

let chartReference = null;
let cachedFullHistory = null;
let cachedFullHistorySymbol = null;

export function setChartReference(chart) {
    chartReference = chart;
}

/**
 * Fetch a batch of candles from Local Database with Binance REST fallback
 */
export async function fetchCandlesBatch({ symbol = APP.symbol, limit = APP.chunkSize, endTime = null } = {}) {
    // 1. Try local PostgreSQL DB (alt_scraper: futures_klines_15m)
    try {
        let dbUrl = `/api/db/klines?symbol=${symbol}&exchange=binance&limit=${limit}`;
        if (endTime) dbUrl += `&endTime=${endTime}`;

        const res = await fetch(dbUrl);
        if (res.ok) {
            const data = await res.json();
            if (data && data.candles && data.candles.length > 0) {
                return data.candles.map(c => ({
                    time: typeof c.time === 'string' ? parseInt(c.time, 10) : c.time,
                    open: parseFloat(c.open),
                    high: parseFloat(c.high),
                    low: parseFloat(c.low),
                    close: parseFloat(c.close),
                    volume: parseFloat(c.volume || 0),
                    buyVolume: (parseFloat(c.volume || 0) + parseFloat(c.volume_delta || 0)) / 2,
                    sellVolume: (parseFloat(c.volume || 0) - parseFloat(c.volume_delta || 0)) / 2,
                    delta: parseFloat(c.volume_delta || 0),
                    txnCount: c.txn_count ? parseInt(c.txn_count, 10) : 0
                }));
            }
        }
    } catch (err) {
        console.warn("[DataService] Local DB unavailable, falling back to Binance REST:", err.message);
    }

    // 2. Fallback to Binance REST API
    return await fetchKlinesBatch(endTime);
}

/**
 * Initial fast load pipeline with capped candle count
 */
export async function runFullLoadPipeline() {
    await ensureWasm();
    state.update(s => ({ 
        ...s, 
        loading: true, 
        candles: [], 
        hasMoreHistory: true,
        isLoadingMore: false 
    }));

    addToLog(`Loading initial ${APP.initialCap} candles (${APP.symbol} ${APP.interval})...`);

    const initialCandles = await fetchCandlesBatch({
        symbol: APP.symbol,
        limit: APP.initialCap,
        endTime: null
    });

    initialCandles.sort((a, b) => a.time - b.time);
    const cleanCandles = initialCandles.filter((v, i, a) => i === 0 || v.time > a[i - 1].time);

    state.update(s => ({ 
        ...s, 
        candles: cleanCandles, 
        loading: false,
        dataSourceStatus: cleanCandles.length > 0 ? 'Connected (Local DB/API)' : 'Connecting...'
    }));

    addToLog(`Loaded ${cleanCandles.length} candles instantly. Starting live feed & analysis.`);
    manualRefresh();

    startWebSocket({
        onTick: (_candle) => {
            state.update(s => s);
        }
    });
}

/**
 * Lazy loading of older historical candles when scrolling left
 */
export async function loadOlderCandles() {
    let currentCandles = [];
    let isAlreadyLoading = false;
    let hasMore = true;

    state.update(s => {
        currentCandles = s.candles;
        isAlreadyLoading = s.isLoadingMore;
        hasMore = s.hasMoreHistory;
        return s;
    });

    if (isAlreadyLoading || !hasMore || currentCandles.length === 0) return;

    state.update(s => ({ ...s, isLoadingMore: true }));
    const earliestTime = currentCandles[0].time * 1000 - 1;

    try {
        const olderBatch = await fetchCandlesBatch({
            symbol: APP.symbol,
            limit: APP.chunkSize,
            endTime: earliestTime
        });

        if (!olderBatch || olderBatch.length === 0) {
            state.update(s => ({ ...s, isLoadingMore: false, hasMoreHistory: false }));
            addToLog("Reached beginning of available historical data.");
            return;
        }

        olderBatch.sort((a, b) => a.time - b.time);
        
        state.update(s => {
            const combined = [...olderBatch, ...s.candles];
            const deduped = combined.filter((v, i, a) => i === 0 || v.time > a[i - 1].time);
            return {
                ...s,
                candles: deduped,
                isLoadingMore: false
            };
        });

        addToLog(`Loaded +${olderBatch.length} historical candles (Total in view: ${currentCandles.length + olderBatch.length})`);
    } catch (e) {
        console.error("Error loading older candles:", e);
        state.update(s => ({ ...s, isLoadingMore: false }));
    }
}

/**
 * Retrieve full historical candle dataset (240k+ candles) for backtesting
 */
export async function getFullHistoricalCandles() {
    if (cachedFullHistory && cachedFullHistorySymbol === APP.symbol && cachedFullHistory.length > 10000) {
        return cachedFullHistory;
    }

    addToLog(`Fetching complete multi-year history for backtest engine...`);
    try {
        const res = await fetch(`/api/db/klines?symbol=${APP.symbol}&exchange=binance&limit=250000`);
        if (res.ok) {
            const data = await res.json();
            if (data && data.candles && data.candles.length > 0) {
                const fullCandles = data.candles.map(c => ({
                    time: typeof c.time === 'string' ? parseInt(c.time, 10) : c.time,
                    open: parseFloat(c.open),
                    high: parseFloat(c.high),
                    low: parseFloat(c.low),
                    close: parseFloat(c.close),
                    volume: parseFloat(c.volume || 0),
                    buyVolume: (parseFloat(c.volume || 0) + parseFloat(c.volume_delta || 0)) / 2,
                    sellVolume: (parseFloat(c.volume || 0) - parseFloat(c.volume_delta || 0)) / 2,
                    delta: parseFloat(c.volume_delta || 0)
                }));
                fullCandles.sort((a, b) => a.time - b.time);
                cachedFullHistory = fullCandles;
                cachedFullHistorySymbol = APP.symbol;
                addToLog(`Cached full history: ${fullCandles.length} candles (2019-Present)`);
                return fullCandles;
            }
        }
    } catch (err) {
        console.warn("Full history fetch from DB failed, falling back to current visual slice:", err);
    }

    let current = [];
    state.update(s => { current = s.candles; return s; });
    return current;
}

export async function manualRefresh() {
    await ensureWasm();
    state.update(s => {
        const candles = s.candles;
        if (candles.length === 0) return s;

        const config = {
            sensitivity: APP.sensitivity,
            historyTarget: APP.historyTarget,
            fractalStrength: s.fractalStrength,
            angleFilter: s.angleFilter,
            interval: APP.interval
        };

        const indicatorConfig = {
            ...config,
            strictMode: true,
            showHistory: true,
            tolerance: 1 
        };

        // --- LLAMADA A RUST (WASM) CON FALLBACK JS ---
        let rustResult = { zones: [], trades: [] };
        try {
            const res = analyze_market_wasm(candles, config.sensitivity, config.historyTarget, 2.0);
            if (res && res.zones && res.zones.length > 0) {
                rustResult = res;
            }
        } catch (e) {
            console.warn("Wasm no disponible o error en Rust, usando fallback JS:", e);
        }
        
        // Fallback a JS si Rust no devolvió zonas
        if (!rustResult.zones || rustResult.zones.length === 0) {
            const zonesData = analyzeSMC(candles, indicatorConfig);
            rustResult = {
                zones: zonesData.zones || [],
                trades: zonesData.trades || []
            };
        }
        
        const lines = calculateTrendLines(candles, indicatorConfig);
        const channel = calculateRegLin(candles, {
            ...indicatorConfig,
            period: s.regPeriod || 200,
            stdMult: s.regStd || 2.0
        });
        const hurst = calculateHurst(candles);

        let trades = [];
        if (s.activeStrategy === 'SMC') {
            trades = rustResult.trades || []; 
        } else {
            const modeMap = {
                'TL_TRAP': 'standard',
                'TL_TRAP_AGRO': 'agro',
                'TL_TRAP_ATR': 'atr',
                'TL_TRAP_ATR_AGRO': 'atr_agro',
                'TL_TRAP_ATR_PARTIAL_1': 'atr_partial_1',
                'TL_TRAP_ATR_PARTIAL_2': 'atr_partial_2'
            };
            const mode = modeMap[s.activeStrategy] || 'standard';
            const strategyResult = runLiquidityStrategy(candles, mode, {
                collectOnly: true,
                useVolumeAnalysis: s.useVolumeAnalysis,
                config: indicatorConfig
            });
            trades = strategyResult.trades || [];
        }

        return {
            ...s,
            zones: rustResult.zones || [], 
            trades: trades,
            lines,
            channel,
            pnlMetrics: { ...s.pnlMetrics, hurst: hurst.hurst, hurstType: hurst.type }
        };
    });

    updatePnL();
}

export function runSelectedStrategy(stratName) {
    state.update(s => ({ ...s, activeStrategy: stratName, pnlLocked: false }));
    manualRefresh();
}

/**
 * Execute strategy with Full History support
 */
export async function executeStrategy(mode = 'standard') {
    await ensureWasm();
    let isFullHistory = true;
    state.update(s => { isFullHistory = s.fullHistoryBacktest; return s; });

    addToLog(`Running strategy [${mode}] ${isFullHistory ? '(Full 240k+ History)' : '(Visual Range)'}...`);
    const dataset = isFullHistory ? await getFullHistoricalCandles() : (await new Promise(res => {
        state.update(s => { res(s.candles); return s; });
    }));

    if (!dataset || dataset.length === 0) return;

    let currentState = {};
    state.update(s => { currentState = s; return s; });

    const strategyResult = runLiquidityStrategy(dataset, mode, {
        useVolumeAnalysis: currentState.useVolumeAnalysis,
        config: {
            sensitivity: APP.sensitivity,
            historyTarget: dataset.length,
            fractalStrength: currentState.fractalStrength,
            angleFilter: currentState.angleFilter
        }
    });

    const trades = strategyResult.trades || [];
    const pnlRes = calculatePnLMetrics(trades, dataset, {
        initialBalance: currentState.initialBalance,
        includeFees: currentState.includeFees,
        feeMaker: currentState.feeMaker,
        feeTaker: currentState.feeTaker
    });

    state.update(s => ({
        ...s,
        trades,
        pnlMetrics: { ...s.pnlMetrics, ...pnlRes.metrics },
        equityCurve: pnlRes.equityCurve,
        pnlLocked: false
    }));

    addToLog(`Strategy [${mode}] executed: ${trades.length} trades evaluated across ${dataset.length} candles. WinRate: ${pnlRes.metrics.winRate}%`);
}

/**
 * Execute Rust Wasm Optimizer across Full History
 */
export async function executeOptimizer() {
    await ensureWasm();
    let isFullHistory = true;
    state.update(s => { isFullHistory = s.fullHistoryBacktest; return s; });

    addToLog(`Running Rust Wasm Optimizer ${isFullHistory ? '(Full History)' : '(Active Slice)'}...`);
    const dataset = isFullHistory ? await getFullHistoricalCandles() : (await new Promise(res => {
        state.update(s => { res(s.candles); return s; });
    }));

    if (!dataset || dataset.length === 0) return;

    console.time("Rust Optimizer Full Dataset");
    let results = [];
    try {
        results = run_optimizer_wasm(dataset, APP.sensitivity) || [];
    } catch (e) {
        console.warn("Wasm optimizer error, using JS fallback:", e);
    }
    console.timeEnd("Rust Optimizer Full Dataset");

    if (!results || results.length === 0) {
        let currentState = {};
        state.update(s => { currentState = s; return s; });
        results = runOptimizer(dataset, {
            useVolumeAnalysis: currentState.useVolumeAnalysis,
            config: {
                sensitivity: APP.sensitivity,
                historyTarget: dataset.length,
                fractalStrength: currentState.fractalStrength,
                angleFilter: currentState.angleFilter
            }
        }) || [];
    }

    state.update(s => ({ ...s, optimizerResults: results }));
    addToLog(`Optimizer finished: ${results.length} setups evaluated across ${dataset.length} candles.`);
}

export function applyOptimizerSelection(modeKey) {
    state.update(s => {
        const cfg = s.optimizerResults.find(r => r.key === modeKey);
        if (!cfg) return s;

        const pnlRes = calculatePnLMetrics(cfg.trades || [], s.candles, {
            initialBalance: s.initialBalance,
            includeFees: s.includeFees,
            feeMaker: s.feeMaker,
            feeTaker: s.feeTaker
        });

        return {
            ...s,
            trades: (cfg.trades || []).map(t => ({ ...t })),
            pnlMetrics: { ...s.pnlMetrics, ...pnlRes.metrics },
            equityCurve: pnlRes.equityCurve,
            pnlLocked: true,
            activeMode: 'pnl'
        };
    });
}

export function replayTrade(trade) {
    state.update(s => {
        const replay = prepareReplayData(trade);
        if (chartReference) {
            zoomRange(chartReference, replay.zoomRange.from, replay.zoomRange.to);
        }
        return {
            ...s,
            isReplayMode: true,
            selectedTrade: trade
        };
    });
}

export function exitReplay() {
    state.update(s => ({ ...s, isReplayMode: false }));
    if (chartReference) {
        chartReference.timeScale().scrollToRealTime();
    }
}

export function switchMainTab(tab) {
    state.update(s => ({ ...s, activeMode: tab }));
    if (tab === 'pnl') {
        updatePnL();
    }
}

export function updatePnL() {
    state.update(s => {
        const trades = s.trades || [];
        const pnlRes = calculatePnLMetrics(trades, s.candles, {
            initialBalance: s.initialBalance,
            includeFees: s.includeFees,
            feeMaker: s.feeMaker,
            feeTaker: s.feeTaker
        });
        return {
            ...s,
            pnlMetrics: { ...s.pnlMetrics, ...pnlRes.metrics },
            equityCurve: pnlRes.equityCurve
        };
    });
}

