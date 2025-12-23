/**
 * App Module
 * Global state definition and application initialization.
 */

// --- APP CONFIG ---
const APP = {
    symbol: 'BTCUSDT',
    interval: '15m',
    historyTarget: 30000,
    limitPerReq: 1000,
    sensitivity: 0.0001,
    riskReward: 2
};

// --- GLOBAL STATE ---
let state = {
    candles: [],
    zones: [],
    trades: [],
    lines: [],
    channel: null,
    activeMode: 'zones',
    initialBalance: 10000,
    activeZoneTab: 'active',
    activeTradeTab: 'ideas',
    isReplayMode: false
};

// --- GLOBAL VARIABLES (Modules will access these) ---
let chart, candleSeries, volumeSeries, deltaSeries, pnlChart, pnlSeries, ws = null;
let boxPrimitive, trendPrimitive, regPrimitive;
let tradeLines = [];

/**
 * Main initialization pipeline to load historical data and start WebSocket.
 */
async function runFullLoadPipeline() {
    const loader = document.getElementById('loader');
    if (loader) loader.classList.remove('hidden');

    state.candles = [];
    let endTime = null;
    let loadedCount = 0;

    if (typeof addToLog === 'function') addToLog(`Initializing ${APP.symbol} ${APP.interval}...`);

    while (loadedCount < APP.historyTarget) {
        const batch = await fetchKlinesBatch(endTime);
        if (batch.length === 0) break;
        state.candles = [...batch, ...state.candles];
        loadedCount += batch.length;
        endTime = batch[0].time * 1000 - 1;
        if (typeof addToLog === 'function') addToLog(`Loaded ${loadedCount} candles...`);
    }

    // Sort and remove duplicates
    state.candles.sort((a, b) => a.time - b.time);
    state.candles = state.candles.filter((v, i, a) => i === 0 || v.time > a[i - 1].time);

    if (candleSeries) candleSeries.setData(state.candles);
    if (typeof updateVolumeData === 'function') updateVolumeData();
    if (typeof analyzeSMC === 'function') analyzeSMC();
    if (typeof renderVisuals === 'function') renderVisuals();
    if (typeof updateUI === 'function') updateUI();
    if (typeof updatePnLMetrics === 'function') updatePnLMetrics();

    startWebSocket();

    if (loader) loader.classList.add('hidden');
    if (typeof addToLog === 'function') addToLog(`Ready. ${state.candles.length} candles in memory.`);
}

/**
 * Sets the current timeframe for the chart and reloads data.
 */
function setTF(tf) {
    APP.interval = tf;
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    runFullLoadPipeline();
}

/**
 * Manually refreshes the current analysis.
 */
function manualRefresh() {
    if (state.activeMode === 'strat') {
        if (typeof runSelectedStrategy === 'function') runSelectedStrategy();
    } else {
        if (typeof analyzeSMC === 'function') analyzeSMC();
        if (typeof calculateTrendLines === 'function') calculateTrendLines();
        if (typeof calculateRegLin === 'function') calculateRegLin();
        if (typeof renderVisuals === 'function') renderVisuals();
        if (typeof updateUI === 'function') updateUI();
    }
}

// Global Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    if (typeof initChart === 'function') initChart();
    if (typeof initPnLChart === 'function') initPnLChart();
    runFullLoadPipeline();
});
