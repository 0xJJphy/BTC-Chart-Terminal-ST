import { APP, state, addToLog } from '../stores/app.js';
import { get } from 'svelte/store';

let ws = null;

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

export function startWebSocket(callbacks = {}) {
    if (ws) ws.close();

    ws = new WebSocket(`wss://stream.binance.com:9443/ws/${APP.symbol.toLowerCase()}@kline_${APP.interval}`);

    ws.onopen = () => {
        state.update(s => ({ ...s, wsStatus: 'Live' }));
    };

    ws.onmessage = (event) => {
        const k = JSON.parse(event.data).k;
        const totalVol = parseFloat(k.v);
        const buyVol = parseFloat(k.V);
        const candle = {
            time: k.t / 1000,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: totalVol,
            buyVolume: buyVol,
            sellVolume: totalVol - buyVol,
            delta: buyVol - (totalVol - buyVol)
        };

        state.update(s => {
            let candles = [...s.candles];
            const last = candles[candles.length - 1];

            if (last && candle.time < last.time) return s;

            if (last && candle.time === last.time) {
                candles[candles.length - 1] = candle;
            } else {
                candles.push(candle);
                if (candles.length > APP.historyTarget + 1000) candles.shift();
            }

            // Real-time callback for chart update
            if (callbacks.onCandleUpdate) callbacks.onCandleUpdate(candle);

            return {
                ...s,
                candles,
                livePrice: candle.close.toFixed(2)
            };
        });

        // Trigger updates if needed (delegated to a controller later)
        if (callbacks.onTick) callbacks.onTick();
    };

    ws.onclose = () => {
        state.update(s => ({ ...s, wsStatus: 'Disconnected' }));
    };
}
