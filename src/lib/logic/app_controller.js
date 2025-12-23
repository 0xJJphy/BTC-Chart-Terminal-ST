import { APP, state, addToLog } from '../stores/app.js';
import { fetchKlinesBatch, startWebSocket } from './binance.js';
import { analyzeSMC } from './smc.js';
import { calculateTrendLines, calculateHurst, calculateRegLin } from './indicators.js';
import { runLiquidityStrategy, runOptimizer } from './liquidity.js';
import { calculatePnLMetrics } from './pnl.js';
import { zoomRange, prepareReplayData } from './replay.js';

let chartReference = null;

export function setChartReference(chart) {
    chartReference = chart;
}

export async function runFullLoadPipeline() {
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
        onTick: (candle) => {
            state.update(s => {
                const candles = s.candles;
                // Periodic light analysis on tick if needed
                return s;
            });
        }
    });

    state.update(s => ({ ...s, loading: false }));
    addToLog(`Ready. Analysis complete.`);
}

export function manualRefresh() {
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
            tolerance: 1 // Ported from terminal.html default
        };

        const zonesData = analyzeSMC(candles, indicatorConfig);
        const lines = calculateTrendLines(candles, indicatorConfig);
        const channel = calculateRegLin(candles, {
            ...indicatorConfig,
            period: s.regPeriod || 200,
            stdMult: s.regStd || 2.0
        });
        const hurst = calculateHurst(candles);

        // Strategy Selection Logic
        let trades = [];
        if (s.activeStrategy === 'SMC') {
            trades = zonesData.trades;
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
            trades = strategyResult.trades;
        }

        return {
            ...s,
            zones: zonesData.zones,
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

export function executeStrategy(mode = 'standard') {
    state.update(s => {
        if (s.candles.length === 0) return s;

        const trades = runLiquidityStrategy(s.candles, mode, {
            useVolumeAnalysis: s.useVolumeAnalysis,
            config: {
                sensitivity: APP.sensitivity,
                historyTarget: APP.historyTarget,
                fractalStrength: s.fractalStrength,
                angleFilter: s.angleFilter
            }
        });

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

export function executeOptimizer() {
    state.update(s => {
        if (s.candles.length === 0) return s;
        const results = runOptimizer(s.candles, {
            useVolumeAnalysis: s.useVolumeAnalysis,
            config: {
                sensitivity: APP.sensitivity,
                historyTarget: APP.historyTarget,
                fractalStrength: s.fractalStrength,
                angleFilter: s.angleFilter
            }
        });
        return { ...s, optimizerResults: results };
    });
}

export function applyOptimizerSelection(modeKey) {
    state.update(s => {
        const cfg = s.optimizerResults.find(r => r.key === modeKey);
        if (!cfg) return s;

        const pnlRes = calculatePnLMetrics(cfg.trades, s.candles, {
            initialBalance: s.initialBalance,
            includeFees: s.includeFees,
            feeMaker: s.feeMaker,
            feeTaker: s.feeTaker
        });

        return {
            ...s,
            trades: cfg.trades.map(t => ({ ...t })),
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
        const pnlRes = calculatePnLMetrics(s.trades, s.candles, {
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
