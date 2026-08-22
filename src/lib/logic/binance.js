import { APP, state, addToLog } from '../stores/app.js';
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

            state.update(s => {
                let candles = [...s.candles];
                if (candles.length === 0) {
                    candles.push(candle);
                    return { ...s, candles, livePrice: candle.close.toFixed(2) };
                }

                const last = candles[candles.length - 1];
                if (last && candle.time < last.time) return s;

                if (last && candle.time === last.time) {
                    candles[candles.length - 1] = candle;
                } else {
                    candles.push(candle);
                }

                if (currentCallbacks.onCandleUpdate) currentCallbacks.onCandleUpdate(candle);

                return {
                    ...s,
                    candles,
                    livePrice: candle.close.toFixed(2)
                };
            });

            if (currentCallbacks.onTick) currentCallbacks.onTick();
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
