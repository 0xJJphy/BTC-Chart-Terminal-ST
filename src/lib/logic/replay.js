/**
 * Replay and Chart Interaction Module
 * Logic for zooming, trade replay, and state management for the review mode.
 */

export function zoomRange(chart, from, to) {
    if (!chart || !from || !to || isNaN(from) || isNaN(to)) return;

    if (from > to) {
        const tmp = from;
        from = to;
        to = tmp;
    }

    const span = to - from;
    const pad = Math.max(span * 0.25, 60 * 15); // Consistent with terminal.html

    chart.timeScale().setVisibleRange({
        from: from - pad,
        to: to + pad
    });
}

export function getTradeMarkers(trade) {
    const markers = [];

    const signalT = trade.signalTime || trade.time;
    const entryT = trade.entryTime || trade.time;

    // 0. S/R Pivot Anchor Marker
    if (trade.srTime && trade.srLevel && trade.srTime !== signalT) {
        markers.push({
            time: trade.srTime,
            position: trade.srType === 'SUPPORT' ? 'belowBar' : 'aboveBar',
            color: trade.srType === 'SUPPORT' ? '#06b6d4' : '#f43f5e',
            shape: 'circle',
            text: `PIVOT ${trade.srType || 'S/R'} ($${trade.srLevel.toFixed(1)})`
        });
    }

    // 1. Setup / Order Placed Marker
    if (signalT && signalT !== entryT) {
        markers.push({
            time: signalT,
            position: trade.type === 'LONG' ? 'belowBar' : 'aboveBar',
            color: '#eab308',
            shape: 'square',
            text: '1. SETUP (LIMIT ORDEN)'
        });
    }

    // 2. Execution / Fill Marker
    if (entryT) {
        markers.push({
            time: entryT,
            position: trade.type === 'LONG' ? 'belowBar' : 'aboveBar',
            color: trade.type === 'LONG' ? '#10b981' : '#f43f5e',
            shape: trade.type === 'LONG' ? 'arrowUp' : 'arrowDown',
            text: signalT && signalT !== entryT ? '2. FILL (ENTRADA)' : 'ENTRADA'
        });
    }

    // 2.1 Partial TP1 Hit (50% Closed) Marker
    const tp1T = trade.tp1Time || trade.tp1_time;
    if (tp1T && tp1T !== entryT) {
        markers.push({
            time: tp1T,
            position: trade.type === 'LONG' ? 'aboveBar' : 'belowBar',
            color: '#10b981',
            shape: 'circle',
            text: '● TP1 HIT (50% CERRADO → SL A BE)'
        });
    }

    // 2.2 Partial TP2 Hit (25% Closed) Marker
    const tp2T = trade.tp2Time || trade.tp2_time;
    if (tp2T && tp2T !== entryT) {
        markers.push({
            time: tp2T,
            position: trade.type === 'LONG' ? 'aboveBar' : 'belowBar',
            color: '#06b6d4',
            shape: 'circle',
            text: '● TP2 HIT (25% CERRADO → SL A TP1)'
        });
    }

    // 2.3 Partial TP3 Hit (25% Closed) Marker
    const tp3T = trade.tp3Time || trade.tp3_time;
    if (tp3T && tp3T !== entryT) {
        markers.push({
            time: tp3T,
            position: trade.type === 'LONG' ? 'aboveBar' : 'belowBar',
            color: '#34d399',
            shape: 'circle',
            text: '● TP3 HIT (25% FINAL)'
        });
    }

    // 3. Exit Marker
    if (trade.exitTime && (trade.status === 'WIN' || trade.status === 'LOSS')) {
        const exitT = trade.exitTime;
        if (exitT !== tp1T && exitT !== tp2T && exitT !== tp3T) {
            markers.push({
                time: exitT,
                position: trade.type === 'LONG' ? 'aboveBar' : 'belowBar',
                color: trade.status === 'WIN' ? '#089981' : '#f23645',
                shape: 'circle',
                text: `${trade.status === 'WIN' ? '3. SALIDA BE / TP' : '3. SL HIT'} (${trade.pnl >= 0 ? '+' : ''}${trade.pnl?.toFixed(2)}R)`
            });
        }
    }

    return markers;
}

export function prepareReplayData(trade) {
    const boxes = [];
    if (trade.savedOB) boxes.push(trade.savedOB);
    if (trade.savedFVG) boxes.push(trade.savedFVG);

    const lines = trade.savedLine ? [trade.savedLine] : [];

    const markers = getTradeMarkers(trade);

    // Fallbacks for missing timestamps to avoid NaNs
    const fromTime = trade.entryTime || trade.signalTime || trade.time;
    // Default 1 hour lookback for entry
    const startTime = fromTime ? fromTime - 3600 : 0;
    const toTime = trade.exitTime || (fromTime ? fromTime + 7200 : 0);

    return { boxes, lines, markers, zoomRange: { from: startTime, to: toTime } };
}
