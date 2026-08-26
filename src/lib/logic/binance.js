import { APP, state, liveCandle, addToLog } from '../stores/app.js';
import { get } from 'svelte/store';

export async function fetchKlinesBatch(endTime) {
    let url = `https://api.binance.com/api/v3/klines?symbol=${APP.symbol}&interval=${APP.interval}&limit=${APP.limitPerReq}`;
    if (endTime) url += `&endTime=${endTime}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        return data.map(c => ({
            time: c[0] / 1000,
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5]),
            buyVolume: parseFloat(c[9]),
            sellVolume: parseFloat(c[5]) - parseFloat(c[9]),
            delta: parseFloat(c[9]) - (parseFloat(c[5]) - parseFloat(c[9]))
        }));
    } catch (e) {
        console.warn("Binance REST API error:", e);
        return [];
    }
}

let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let currentCallbacks = {};

export function startWebSocket(callbacks = {}) {
    if (callbacks) currentCallbacks = callbacks;

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    if (ws) {
        try {
            ws.onclose = null;
            ws.onerror = null;
            ws.close();
        } catch (e) {}
        ws = null;
    }

    state.update(s => ({ ...s, wsStatus: 'Connecting...' }));

    const symbol = (APP.symbol || 'BTCUSDT').toLowerCase();
    const interval = APP.interval || '15m';

    // Alternate between Spot and Futures stream endpoints for maximum resilience
    const streamUrls = [
        `wss://stream.binance.com:9443/ws/${symbol}@kline_${interval}`,
        `wss://fstream.binance.com/ws/${symbol}@kline_${interval}`
    ];
    const streamUrl = streamUrls[reconnectAttempts % streamUrls.length];

    try {
        ws = new WebSocket(streamUrl);
    } catch (err) {
        console.warn("[WebSocket] Creation error:", err);
        scheduleReconnect();
        return;
    }

    ws.onopen = () => {
        reconnectAttempts = 0;
        state.update(s => ({ ...s, wsStatus: 'Live' }));
        addToLog(`WebSocket live stream connected (${symbol.toUpperCase()} ${interval}).`);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            const k = data.k;
            if (!k) return;

            const totalVol = parseFloat(k.v);
            const buyVol = parseFloat(k.V);
            const candle = {
                time: Math.floor(k.t / 1000),
                open: parseFloat(k.o),
                high: parseFloat(k.h),
                low: parseFloat(k.l),
                close: parseFloat(k.c),
                volume: totalVol,
                buyVolume: buyVol,
                sellVolume: Math.max(0, totalVol - buyVol),
                delta: buyVol - (totalVol - buyVol),
                txnCount: parseInt(k.n, 10) || 0
            };

            // Mutate the tail in place and publish only the changed candle.
            //
            // This used to clone the whole candle array and push a new store value on every
            // tick. At 240k candles that is a 240k-object copy several times a second, and
            // it forced every subscriber - including the chart's full `setData()` path - to
            // re-run. The array identity now only changes when candles are actually loaded.
            const s = get(state);

            // In replay mode `state.candles` points at the cached full-history array.
            // Appending live candles to it would corrupt the backtest dataset for every
            // later run, so only track the price while a replay is on screen.
            if (s.isReplayMode) {
                state.update(prev => ({ ...prev, livePrice: candle.close.toFixed(2) }));
                return;
            }

            const candles = s.candles;
            const last = candles.length > 0 ? candles[candles.length - 1] : null;

            if (last && candle.time < last.time) return; // stale tick, ignore

            let appended = false;
            if (!last || candle.time > last.time) {
                candles.push(candle);
                appended = true;
            } else {
                candles[candles.length - 1] = candle;
            }

            liveCandle.set(candle);
            state.update(prev => ({ ...prev, livePrice: candle.close.toFixed(2) }));

            if (currentCallbacks.onCandleUpdate) currentCallbacks.onCandleUpdate(candle, appended);
            if (currentCallbacks.onTick) currentCallbacks.onTick(candle, appended);
        } catch (e) {
            console.error("[WebSocket] Message parsing error:", e);
        }
    };

    ws.onerror = (err) => {
        console.warn("[WebSocket] Stream error:", err);
        state.update(s => ({ ...s, wsStatus: 'Reconnecting...' }));
    };

    ws.onclose = () => {
        state.update(s => ({ ...s, wsStatus: 'Reconnecting...' }));
        scheduleReconnect();
    };
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 10000);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startWebSocket(currentCallbacks);
    }, delay);
}
