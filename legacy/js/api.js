/**
 * API Module
 * Responsible for fetching historical data and managing WebSocket connections.
 */

/**
 * Fetches a batch of klines (candles) from Binance REST API.
 * @param {number|null} endTime - The end time in milliseconds for the batch.
 * @returns {Promise<Array>} Array of candle objects.
 */
async function fetchKlinesBatch(endTime) {
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
            // Additional data for Delta calculation
            buyVolume: parseFloat(c[9]), // Taker buy volume (approx. buy market orders)
            sellVolume: parseFloat(c[5]) - parseFloat(c[9]),
            delta: parseFloat(c[9]) - (parseFloat(c[5]) - parseFloat(c[9]))
        }));
    } catch (e) {
        console.warn("Binance REST API error:", e);
        return [];
    }
}

/**
 * Starts the WebSocket connection for live price updates.
 */
function startWebSocket() {
    if (ws) ws.close();
    
    ws = new WebSocket(`wss://stream.binance.com:9443/ws/${APP.symbol.toLowerCase()}@kline_${APP.interval}`);
    
    ws.onopen = () => { 
        const dot = document.getElementById('ws-dot');
        const text = document.getElementById('ws-text');
        if (dot) dot.className = "w-2 h-2 rounded-full bg-bull animate-pulse"; 
        if (text) text.innerText = "Live"; 
    };
    
    ws.onmessage = (event) => {
        const k = JSON.parse(event.data).k;

        const totalVol = parseFloat(k.v);
        const buyVol = parseFloat(k.V); // Taker buy volume in WS
        const sellVol = totalVol - buyVol;
        const delta = buyVol - sellVol;

        const candle = {
            time: k.t / 1000,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: totalVol,
            buyVolume: buyVol,
            sellVolume: sellVol,
            delta: delta
        };

        const last = state.candles[state.candles.length - 1];
        if (last && candle.time < last.time) {
            return;
        }

        if (last && candle.time === last.time) {
            state.candles[state.candles.length - 1] = candle;
        } else {
            state.candles.push(candle);
            if (state.candles.length > APP.historyTarget + 1000) state.candles.shift();
        }

        // Global variable 'candleSeries' is defined in chart.js
        if (typeof candleSeries !== 'undefined') candleSeries.update(candle);

        // Update Volume and Delta series in real-time
        if (typeof volumeSeries !== 'undefined' && volumeSeries) {
            volumeSeries.update({
                time: candle.time,
                value: candle.volume,
                color: candle.close >= candle.open ? 'rgba(8, 153, 129, 0.25)' : 'rgba(242, 54, 69, 0.25)'
            });
        }
        if (typeof deltaSeries !== 'undefined' && deltaSeries) {
            const deltaVal = candle.delta || 0;
            deltaSeries.update({
                time: candle.time,
                value: Math.abs(deltaVal),
                color: deltaVal >= 0 ? 'rgba(34, 197, 94, 0.8)' : 'rgba(248, 113, 113, 0.8)'
            });
        }

        const livePriceEl = document.getElementById('live-price');
        if (livePriceEl) livePriceEl.innerText = "$" + candle.close.toFixed(2);

        // Trigger updates based on active mode
        if (state.activeMode === 'zones') {
            if (typeof analyzeSMC === 'function') analyzeSMC();
        } else if (state.activeMode === 'trades') {
            const stratSelect = document.getElementById('trade-strat-select');
            const strat = stratSelect ? stratSelect.value : 'SMC';
            if (strat === 'SMC') {
                if (typeof analyzeSMC === 'function') analyzeSMC();
            } else {
                if (typeof runLiquidityStrategy === 'function') runLiquidityStrategy();
            }
        }

        if (state.activeMode === 'lines') { 
            if (typeof calculateTrendLines === 'function') calculateTrendLines(); 
            if (typeof calculateHurst === 'function') calculateHurst(); 
        }
        
        if (state.activeMode === 'reglin') {
            if (typeof calculateRegLin === 'function') calculateRegLin();
        }

        const closeBtn = document.getElementById('btn-back-live');
        if (closeBtn && !closeBtn.classList.contains('flex') && state.activeMode !== 'strat') {
            if (typeof renderVisuals === 'function') renderVisuals();
        }
        
        if (typeof updateUI === 'function') updateUI();

        if (state.activeMode !== 'strat') {
            if (typeof updatePnLMetrics === 'function') updatePnLMetrics();
        }
    };
    
    ws.onclose = () => { 
        const dot = document.getElementById('ws-dot');
        const text = document.getElementById('ws-text');
        if (dot) dot.className = "w-2 h-2 rounded-full bg-bear"; 
        if (text) text.innerText = "Disconnected"; 
    };
}
