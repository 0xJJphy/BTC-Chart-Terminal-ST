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

    // Prioritize signalTime or entryTime for the IDEA marker
    const signalT = trade.signalTime || trade.entryTime;
    if (signalT) {
        markers.push({
            time: signalT,
            position: trade.type === 'LONG' ? 'belowBar' : 'aboveBar',
            color: '#3b82f6',
            shape: trade.type === 'LONG' ? 'arrowUp' : 'arrowDown',
            text: 'IDEA'
        });
    }

    if (trade.entryTime) {
        markers.push({
            time: trade.entryTime,
            position: trade.type === 'LONG' ? 'belowBar' : 'aboveBar',
            color: '#2962ff',
            shape: trade.type === 'LONG' ? 'arrowUp' : 'arrowDown',
            text: 'ENTRY'
        });
    }

    if (trade.exitTime && (trade.status === 'WIN' || trade.status === 'LOSS')) {
        markers.push({
            time: trade.exitTime,
            position: trade.type === 'LONG' ? 'aboveBar' : 'belowBar',
            color: trade.status === 'WIN' ? '#089981' : '#f23645',
            shape: 'circle',
            text: trade.status
        });
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
