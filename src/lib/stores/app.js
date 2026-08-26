import { writable } from 'svelte/store';
import { defaultStrategyParams } from '../config/strategies.js';

export const APP = {
    symbol: 'BTCUSDT',
    interval: '15m',
    initialCap: 2000,
    chunkSize: 2000,
    historyTarget: 2000,
    limitPerReq: 1000,
    sensitivity: 0.0001,
    riskReward: 2,
    dataSource: 'local_db' // 'local_db' | 'local_parquet' | 'binance_live'
};

/**
 * The live candle, kept out of the main store on purpose.
 *
 * A WebSocket tick used to clone the entire candle array (`[...s.candles]`) and push a new
 * store value several times a second. With 240k candles loaded that is a 240k-object copy
 * per tick plus a full re-render of every subscriber. The tick now mutates the tail in
 * place and publishes only the changed candle here; the chart applies it with
 * `series.update()` instead of `setData()`.
 */
export const liveCandle = writable(null);

export const state = writable({
    loading: true,
    isLoadingMore: false,
    hasMoreHistory: true,
    fullHistoryBacktest: true,
    isBacktesting: false,
    isSweeping: false,
    dataSource: 'local_db',
    dataSourceStatus: 'Ready',
    candles: [],
    zones: [],
    trades: [],
    lines: [],
    channel: null,
    activeMode: 'zones',
    initialBalance: 10000,
    activeZoneTab: 'active',
    activeTradeTab: 'ideas',
    isReplayMode: false,
    activeSubPanes: ['CVD'],
    activeStrategy: 'CRYPTO_PRO',
    selectedTrade: null,
    livePrice: '---',
    wsStatus: 'Connecting...',
    pnlLocked: false,
    optimizerResults: [],

    /** Editable engine parameters; see src/lib/config/strategies.js. */
    strategyParams: defaultStrategyParams(),

    /** Full metrics report from the Rust engine. Shape: metrics::Metrics. */
    pnlMetrics: {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        breakeven: 0,
        winRate: 0,
        profitFactor: 0,
        sharpe: 0,
        sortino: 0,
        calmar: 0,
        totalPnl: 0,
        totalCosts: 0,
        drawdown: { maxPct: 0, ulcerIndex: 0, longestDays: 0 },
        equityCurve: [],
        drawdownCurve: []
    },
    equityCurve: [],
    /** RSI / MACD / ADX series from the engine, shared by every subpane. */
    indicatorSeries: null,
    /** Cost-sensitivity sweep results. */
    costSensitivity: [],

    hurst: 0.5,
    hurstType: 'RUIDO (RANDOM WALK)',

    showFVG: true,
    showOB: true,
    zoneLimit: 50,
    fractalStrength: 5,
    angleFilter: true,
    angleMax: 50,
    showBrokenLines: false,
    regPeriod: 200,
    regStd: 2.0,
    useVolumeAnalysis: false,
    cvdData: null,
    cvdAnchor: 'daily', // 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'
    volumeProfile: null,
    cryptoProDashboard: null
});

export const logs = writable(['Terminal initialized. Ready for analysis.']);

export function addToLog(msg) {
    logs.update(l => [`> ${msg}`, ...l].slice(0, 400));
}
