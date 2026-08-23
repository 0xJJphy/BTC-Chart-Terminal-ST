import { APP, state, addToLog } from '../stores/app.js';
import { fetchKlinesBatch, startWebSocket } from './binance.js';
import { analyzeSMC } from './smc.js';
import { calculateTrendLines, calculateHurst, calculateRegLin } from './indicators.js';
import { runLiquidityStrategy, runOptimizer } from './liquidity.js';
import { calculatePnLMetrics } from './pnl.js';
import { zoomRange, prepareReplayData } from './replay.js';

// Rust Wasm Engine v2.1 (SMC + CVD + Volume Profile + Resampler + CryptoPro)
import init, { 
    analyze_market_wasm, 
    run_optimizer_wasm,
    analyze_cvd_wasm,
    analyze_anchored_cvd_wasm,
    calculate_volume_profile_wasm,
    resample_candles_wasm,
    analyze_crypto_pro_wasm
} from '../wasm/btc_engine.js';

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
let cachedFullHistoryInterval = null;

export function setChartReference(chart) {
    chartReference = chart;
}

/**
 * Helper to fetch candles directly from Binance REST API
 */
async function fetchBinanceRestKlines({ symbol = APP.symbol, interval = APP.interval, limit = 1000, startTime = null, endTime = null } = {}) {
    try {
        let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(limit, 1000)}`;
        if (startTime) url += `&startTime=${startTime}`;
        if (endTime) url += `&endTime=${endTime}`;

        const res = await fetch(url);
        if (!res.ok) return [];
        const raw = await res.json();
        if (!Array.isArray(raw)) return [];

        return raw.map(c => ({
            time: Math.floor(c[0] / 1000),
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5]),
            buyVolume: parseFloat(c[9]),
            sellVolume: parseFloat(c[5]) - parseFloat(c[9]),
            delta: parseFloat(c[9]) - (parseFloat(c[5]) - parseFloat(c[9])),
            txnCount: parseInt(c[8], 10) || 0
        }));
    } catch (e) {
        console.warn("[BinanceREST] Failed to fetch klines:", e.message);
        return [];
    }
}

/**
 * Fetch a batch of candles with Local Database + Live Binance Gap Synchronization
 */
export async function fetchCandlesBatch({ symbol = APP.symbol, interval = APP.interval, limit = APP.chunkSize, endTime = null } = {}) {
    let dbCandles = [];

    // 1. Try local PostgreSQL DB (alt_scraper: futures_klines_15m + aggregation)
    try {
        let dbUrl = `/api/db/klines?symbol=${symbol}&exchange=binance&interval=${interval}&limit=${limit}`;
        if (endTime) dbUrl += `&endTime=${endTime}`;

        const res = await fetch(dbUrl);
        if (res.ok) {
            const data = await res.json();
            if (data && data.candles && data.candles.length > 0) {
                dbCandles = data.candles.map(c => ({
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

    // 2. If this is the latest load (endTime === null), synchronize with Binance live market to fill any gap
    if (endTime === null) {
        const intervalSecMap = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 };
        const intervalSec = intervalSecMap[interval] || 900;
        const nowSec = Math.floor(Date.now() / 1000);

        if (dbCandles.length > 0) {
            const latestDbTime = dbCandles[dbCandles.length - 1].time;
            // If DB latest candle is older than 1.5 periods, fetch missing gap candles from Binance REST
            if (nowSec - latestDbTime > intervalSec * 1.5) {
                addToLog(`Synchronizing recent market gap from Binance Live API (${interval})...`);
                const gapCandles = await fetchBinanceRestKlines({
                    symbol,
                    interval,
                    limit: 1000,
                    startTime: (latestDbTime + 1) * 1000
                });

                if (gapCandles.length > 0) {
                    const combined = [...dbCandles, ...gapCandles];
                    combined.sort((a, b) => a.time - b.time);
                    const deduped = combined.filter((v, i, a) => i === 0 || v.time > a[i - 1].time);
                    addToLog(`Synchronized ${gapCandles.length} latest live candles from Binance API.`);
                    return deduped.slice(-limit);
                }
            }
            return dbCandles;
        }

        // If local DB returned 0 candles (e.g. 1m/5m timeframe or offline), fetch full initial chunk from Binance REST
        addToLog(`Fetching ${limit} ${interval} candles from Binance REST API...`);
        return await fetchBinanceRestKlines({ symbol, interval, limit, startTime: null, endTime: null });
    }

    // 3. If paginating to the past (endTime !== null)
    if (dbCandles.length > 0) {
        return dbCandles;
    }

    // Fallback to Binance REST for older candles
    return await fetchBinanceRestKlines({ symbol, interval, limit, endTime });
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

    try {
        addToLog(`Loading initial ${APP.initialCap} candles (${APP.symbol} ${APP.interval})...`);

        const initialCandles = await fetchCandlesBatch({
            symbol: APP.symbol,
            interval: APP.interval,
            limit: APP.initialCap,
            endTime: null
        });

        initialCandles.sort((a, b) => a.time - b.time);
        const cleanCandles = initialCandles.filter((v, i, a) => i === 0 || v.time > a[i - 1].time);

        state.update(s => ({ 
            ...s, 
            candles: cleanCandles, 
            loading: false,
            dataSourceStatus: cleanCandles.length > 0 ? 'Connected (Local DB + Live Sync)' : 'Connecting...'
        }));

        addToLog(`Loaded ${cleanCandles.length} candles for ${APP.interval}. Starting live WebSocket & analysis.`);
        manualRefresh();

        startWebSocket({
            onTick: (_candle) => {
                // Live candle updates handled inside binance.js
            }
        });
    } catch (e) {
        console.error("Error in runFullLoadPipeline:", e);
        state.update(s => ({ ...s, loading: false }));
    }
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
            interval: APP.interval,
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
            combined.sort((a, b) => a.time - b.time);
            const deduped = combined.filter((v, i, a) => i === 0 || v.time > a[i - 1].time);
            return {
                ...s,
                candles: deduped,
                isLoadingMore: false
            };
        });

        addToLog(`Loaded +${olderBatch.length} historical candles (${APP.interval}) (Total in view: ${currentCandles.length + olderBatch.length})`);
    } catch (e) {
        console.error("Error loading older candles:", e);
        state.update(s => ({ ...s, isLoadingMore: false }));
    }
}

/**
 * Retrieve full historical candle dataset (240k+ candles) for backtesting
 */
export async function getFullHistoricalCandles() {
    if (cachedFullHistory && cachedFullHistorySymbol === APP.symbol && cachedFullHistoryInterval === APP.interval && cachedFullHistory.length > 500) {
        return cachedFullHistory;
    }

    addToLog(`Fetching complete multi-year history for backtest engine (${APP.symbol} ${APP.interval})...`);
    try {
        const res = await fetch(`/api/db/klines?symbol=${APP.symbol}&exchange=binance&interval=${APP.interval}&limit=250000`);
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
                cachedFullHistoryInterval = APP.interval;
                addToLog(`Cached full history: ${fullCandles.length} candles for ${APP.interval} backtesting`);
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
        let cryptoProDashboard = null;

        if (s.activeStrategy === 'CRYPTO_PRO') {
            try {
                const proRes = analyze_crypto_pro_wasm(candles, {
                    showEma: true,
                    pivotLeft: 6,
                    pivotRight: 6,
                    maxLevels: 3,
                    fvgMinPct: 0.08,
                    obLookback: 8,
                    volumeLength: 20,
                    highVolume: 1.50,
                    veryHighVolume: 2.00,
                    minimumScore: 65.0,
                    waitForRetest: true,
                    minPullbackAtr: 0.30,
                    maxPullbackAtr: 1.50,
                    minPullbackPct: 0.15,
                    maxWaitBars: 8,
                    requireRecoveryCandle: true,
                    atrLength: 14,
                    atrMultiplier: 1.50,
                    maxSlAtr: 2.50,
                    rrTp1: 1.0,
                    rrTp2: 2.0,
                    rrTp3: 3.0,
                    initialCapital: s.initialBalance || 1000.0,
                    capitalPerTrade: 150.0,
                    leverage: 10.0,
                    riskPercent: 2.0,
                    compoundCapital: false,
                    compoundPercent: 15.0,
                    analysisDays: 15,
                });
                if (proRes) {
                    trades = proRes.trades || [];
                    cryptoProDashboard = proRes.dashboard || null;
                }
            } catch (err) {
                console.warn("CryptoPRO Wasm error:", err);
            }
        } else if (s.activeStrategy === 'SMC') {
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

        // Compute Quantitative CVD & Volume Profile via Rust Wasm
        let cvdData = null;
        let volumeProfile = null;
        try {
            cvdData = analyze_anchored_cvd_wasm(candles, s.cvdAnchor || 'daily', 20, 24);
            volumeProfile = calculate_volume_profile_wasm(candles, 70);
        } catch (wasmErr) {
            console.warn("Wasm CVD / VP error:", wasmErr);
        }

        return {
            ...s,
            zones: rustResult.zones || [], 
            trades: trades,
            lines,
            channel,
            cvdData,
            volumeProfile,
            cryptoProDashboard,
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

    let trades = [];
    let cryptoProDashboard = null;

    if (mode === 'CRYPTO_PRO' || mode === 'crypto_pro') {
        try {
            const proRes = analyze_crypto_pro_wasm(dataset, {
                showEma: true,
                pivotLeft: 6,
                pivotRight: 6,
                maxLevels: 3,
                fvgMinPct: 0.08,
                obLookback: 8,
                volumeLength: 20,
                highVolume: 1.50,
                veryHighVolume: 2.00,
                minimumScore: 65.0,
                waitForRetest: true,
                minPullbackAtr: 0.30,
                maxPullbackAtr: 1.50,
                minPullbackPct: 0.15,
                maxWaitBars: 8,
                requireRecoveryCandle: true,
                atrLength: 14,
                atrMultiplier: 1.50,
                maxSlAtr: 2.50,
                rrTp1: 1.0,
                rrTp2: 2.0,
                rrTp3: 3.0,
                initialCapital: currentState.initialBalance || 1000.0,
                capitalPerTrade: 150.0,
                leverage: 10.0,
                riskPercent: 2.0,
                compoundCapital: false,
                compoundPercent: 15.0,
                analysisDays: 15,
            });
            if (proRes) {
                trades = proRes.trades || [];
                cryptoProDashboard = proRes.dashboard || null;
            }
        } catch (e) {
            console.warn("Error running CryptoPRO in Wasm:", e);
        }
    } else {
        const strategyResult = runLiquidityStrategy(dataset, mode, {
            useVolumeAnalysis: currentState.useVolumeAnalysis,
            config: {
                sensitivity: APP.sensitivity,
                historyTarget: dataset.length,
                fractalStrength: currentState.fractalStrength,
                angleFilter: currentState.angleFilter
            }
        });
        trades = strategyResult.trades || [];
    }

    const pnlRes = calculatePnLMetrics(trades, dataset, {
        initialBalance: currentState.initialBalance,
        includeFees: currentState.includeFees,
        feeMaker: currentState.feeMaker,
        feeTaker: currentState.feeTaker
    });

    state.update(s => ({
        ...s,
        trades,
        cryptoProDashboard,
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

export async function replayTrade(trade) {
    if (!trade) return;
    const tradeTime = trade.entryTime || trade.signalTime || trade.time;

    // Always fetch or use complete history to slice candles perfectly centered around this trade
    const fullHistory = await getFullHistoricalCandles();
    if (fullHistory && fullHistory.length > 0) {
        const idx = fullHistory.findIndex(c => c.time >= tradeTime);
        if (idx !== -1) {
            const startIdx = Math.max(0, idx - 120);
            const endIdx = Math.min(fullHistory.length, idx + 80);
            const replaySlice = fullHistory.slice(startIdx, endIdx);

            state.update(s => ({
                ...s,
                liveCandlesBackup: s.liveCandlesBackup || s.candles,
                candles: replaySlice,
                isReplayMode: true,
                selectedTrade: trade,
                activeSubPanes: ['CVD', 'RSI', 'MACD', 'ADX']
            }));

            setTimeout(() => {
                if (chartReference) {
                    const replay = prepareReplayData(trade);
                    zoomRange(chartReference, replay.zoomRange.from, replay.zoomRange.to);
                }
            }, 60);
            return;
        }
    }

    state.update(s => {
        const replay = prepareReplayData(trade);
        if (chartReference) {
            zoomRange(chartReference, replay.zoomRange.from, replay.zoomRange.to);
        }
        return {
            ...s,
            isReplayMode: true,
            selectedTrade: trade,
            activeSubPanes: ['CVD', 'RSI', 'MACD', 'ADX']
        };
    });
}

export function exitReplay() {
    state.update(s => {
        const restored = s.liveCandlesBackup || s.candles;
        return {
            ...s,
            isReplayMode: false,
            selectedTrade: null,
            candles: restored,
            liveCandlesBackup: null
        };
    });
    setTimeout(() => {
        if (chartReference) {
            chartReference.timeScale().scrollToRealTime();
        }
    }, 80);
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

export function setCvdAnchor(anchor) {
    state.update(s => ({ ...s, cvdAnchor: anchor }));
    manualRefresh();
}

