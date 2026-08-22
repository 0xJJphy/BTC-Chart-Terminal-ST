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

export function setChartReference(chart) {
    chartReference = chart;
}

export async function runFullLoadPipeline() {
    await ensureWasm(); 
    state.update(s => ({ ...s, loading: true, candles: [] }));
    let endTime = null;
    let allCandles = [];

    addToLog(`Initializing ${APP.symbol} ${APP.interval}...`);

    while (allCandles.length < APP.historyTarget) {
        const batch = await fetchKlinesBatch(endTime);
        if (batch.length === 0) break;

        allCandles = [...batch, ...allCandles];
        allCandles.sort((a, b) => a.time - b.time);
        allCandles = allCandles.filter((v, i, a) => i === 0 || v.time > a[i - 1].time);

        endTime = allCandles[0].time * 1000 - 1;
        if (allCandles.length % 5000 === 0) addToLog(`Loaded ${allCandles.length} candles...`);
    }

    state.update(s => ({ ...s, candles: allCandles }));
    manualRefresh();

    startWebSocket({
        onTick: (_candle) => {
            state.update(s => {
                return s;
            });
        }
    });

    state.update(s => ({ ...s, loading: false }));
    addToLog(`Ready. Analysis complete.`);
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
        console.time("Rust SMC Analysis");
        let rustResult = { zones: [], trades: [] };
        try {
            const res = analyze_market_wasm(candles, config.sensitivity, config.historyTarget, 2.0);
            if (res && res.zones && res.zones.length > 0) {
                rustResult = res;
            }
        } catch (e) {
            console.warn("Wasm no disponible o error en Rust, usando fallback JS:", e);
        }
        console.timeEnd("Rust SMC Analysis");
        
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

export async function executeStrategy(mode = 'standard') {
    await ensureWasm();
    state.update(s => {
        if (s.candles.length === 0) return s;

        const strategyResult = runLiquidityStrategy(s.candles, mode, {
            useVolumeAnalysis: s.useVolumeAnalysis,
            config: {
                sensitivity: APP.sensitivity,
                historyTarget: APP.historyTarget,
                fractalStrength: s.fractalStrength,
                angleFilter: s.angleFilter
            }
        });

        const trades = strategyResult.trades || [];

        const pnlRes = calculatePnLMetrics(trades, s.candles, {
            initialBalance: s.initialBalance,
            includeFees: s.includeFees,
            feeMaker: s.feeMaker,
            feeTaker: s.feeTaker
        });

        return {
            ...s,
            trades,
            pnlMetrics: { ...s.pnlMetrics, ...pnlRes.metrics },
            equityCurve: pnlRes.equityCurve,
            pnlLocked: false
        };
    });
}

export async function executeOptimizer() {
    await ensureWasm();
    state.update(s => {
        if (s.candles.length === 0) return s;
        
        console.time("Rust Optimizer");
        let results = [];
        try {
            results = run_optimizer_wasm(s.candles, APP.sensitivity) || [];
        } catch (e) {
            console.warn("Wasm optimizer error o no disponible, usando fallback JS:", e);
        }
        console.timeEnd("Rust Optimizer");

        if (!results || results.length === 0) {
            results = runOptimizer(s.candles, {
                useVolumeAnalysis: s.useVolumeAnalysis,
                config: {
                    sensitivity: APP.sensitivity,
                    historyTarget: APP.historyTarget,
                    fractalStrength: s.fractalStrength,
                    angleFilter: s.angleFilter
                }
            }) || [];
        }

        return { ...s, optimizerResults: results };
    });
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
