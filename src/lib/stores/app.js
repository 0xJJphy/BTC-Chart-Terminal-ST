import { writable } from 'svelte/store';

export const APP = {
    symbol: 'BTCUSDT',
    interval: '15m',
    historyTarget: 30000,
    limitPerReq: 1000,
    sensitivity: 0.0001,
    riskReward: 2
};

export const state = writable({
    loading: true,
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
    activeStrategy: 'SMC', // Default strategy
    selectedTrade: null,
    livePrice: '---',
    wsStatus: 'Connecting...',
    pnlLocked: false,
    optimizerResults: [],
    pnlMetrics: {
        totalTrades: 0,
        winRate: 0,
        profitFactor: 0,
        sharpe: 0,
        sortino: 0,
        maxDrawdown: 0,
        totalPnL: 0,
        currentEquity: 10000,
        hurst: 0.5,
        hurstType: 'RUIDO (RANDOM WALK)'
    },
    equityCurve: [],
    showFVG: true,
    showOB: true,
    zoneLimit: 50,
    fractalStrength: 5,
    angleFilter: true,
    angleMax: 50,
    showBrokenLines: false, // New variable
    regPeriod: 200,         // New variable
    regStd: 2.0,           // New variable
    useVolumeAnalysis: false,
    includeFees: false,
    feeMaker: 0.1,
    feeTaker: 0.1
});

export const logs = writable(['Terminal initialized. Ready for analysis.']);

export function addToLog(msg) {
    logs.update(l => [`> ${msg}`, ...l]);
}
