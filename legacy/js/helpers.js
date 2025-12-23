/**
 * Helpers Module
 * Utility functions for trade processing, PnL calculations, and chart annotations.
 */

/**
 * Calculates a quality score for a zone based on gap, ATR, and impulse.
 */
function calculateZoneQuality(gap, atr, impulsePercent, gapPercent) {
    const atrScore = (gap / atr) * 10;
    const impulseScore = impulsePercent * 100;
    const gapScore = gapPercent * 1000;
    return atrScore + impulseScore + gapScore;
}

/**
 * Creates a trade object and processes its lifecycle.
 */
function createTrade(idx, type, entry, sl, time, candles) {
    let trade = {
        id: idx,
        type: type,
        status: 'PENDING',
        entry: entry,
        sl: sl,
        tp: 0,
        signalTime: time,
        pnlValue: 0,
        pnlPercent: 0,
        pnl: 0
    };

    if (type === 'LONG') trade.tp = trade.entry + ((trade.entry - trade.sl) * APP.riskReward);
    else trade.tp = trade.entry - ((trade.sl - trade.entry) * APP.riskReward);

    processTradeLifecycle(trade, idx, candles);
    return trade.status !== 'CANCELLED' ? trade : null;
}

/**
 * Processes a trade's lifecycle across candle data.
 */
function processTradeLifecycle(trade, idx, candles) {
    for (let j = idx + 1; j < candles.length; j++) {
        const bar = candles[j];
        if (trade.status === 'PENDING') {
            if (trade.type === 'LONG') {
                if (bar.low <= trade.entry) { trade.status = 'OPEN'; trade.entryTime = bar.time; }
                else if (bar.low <= trade.sl) trade.status = 'CANCELLED';
            } else { // SHORT
                if (bar.high >= trade.entry) { trade.status = 'OPEN'; trade.entryTime = bar.time; }
                else if (bar.high >= trade.sl) trade.status = 'CANCELLED';
            }
        }
        else if (trade.status === 'OPEN') {
            if (trade.type === 'LONG') {
                if (bar.low <= trade.sl) { trade.status = 'LOSS'; trade.exitTime = bar.time; trade.pnl = -1; trade.pnlPercent = -1; break; }
                if (bar.high >= trade.tp) { trade.status = 'WIN'; trade.exitTime = bar.time; trade.pnl = APP.riskReward; trade.pnlPercent = APP.riskReward; break; }
            } else { // SHORT
                if (bar.high >= trade.sl) { trade.status = 'LOSS'; trade.exitTime = bar.time; trade.pnl = -1; trade.pnlPercent = -1; break; }
                if (bar.low <= trade.tp) { trade.status = 'WIN'; trade.exitTime = bar.time; trade.pnl = APP.riskReward; trade.pnlPercent = APP.riskReward; break; }
            }
        }
    }
    if (trade.status === 'OPEN') {
        const lastPrice = candles[candles.length - 1].close;
        let rMultiple = 0;
        if (trade.type === 'LONG') rMultiple = (lastPrice - trade.entry) / (trade.entry - trade.sl);
        else rMultiple = (trade.entry - lastPrice) / (trade.sl - trade.entry);
        trade.pnl = rMultiple; trade.pnlPercent = rMultiple;
    }
}

/**
 * Updates PnL metrics and equity curve.
 */
function updatePnLMetrics() {
    const balInput = document.getElementById('initial-balance');
    state.initialBalance = balInput ? parseFloat(balInput.value) : 10000;

    const makerFeePct = parseFloat(document.getElementById('fee-maker')?.value || 0.1) / 100;
    const takerFeePct = parseFloat(document.getElementById('fee-taker')?.value || 0.1) / 100;
    const useFees = document.getElementById('include-fees')?.checked || false;

    const riskPerTrade = state.initialBalance * 0.01;

    let realizedPnL = 0, unrealizedPnL = 0, wins = 0, losses = 0, grossProfit = 0, grossLoss = 0, totalTradesCount = 0;
    let returns = [], equityCurve = [], firstTradeTime = null, lastTradeTime = null, totalDuration = 0, maxDuration = 0, durationCount = 0;

    if (state.candles.length > 0) equityCurve.push({ time: state.candles[0].time, value: state.initialBalance });

    let currentEquity = state.initialBalance, maxPeak = state.initialBalance, maxDrawdown = 0;

    const closedTrades = state.trades.filter(t => t.status === 'WIN' || t.status === 'LOSS' || t.status === 'BE');
    closedTrades.sort((a, b) => (a.exitTime || 0) - (b.exitTime || 0));

    state.trades.forEach(t => {
        if (t.status === 'WIN' || t.status === 'LOSS' || t.status === 'OPEN' || t.status === 'BE') {
            if (t.entryTime) {
                if (!firstTradeTime || t.entryTime < firstTradeTime) firstTradeTime = t.entryTime;
                let tradeEnd = t.exitTime || state.candles[state.candles.length - 1].time;
                if (!lastTradeTime || tradeEnd > lastTradeTime) lastTradeTime = tradeEnd;
                let dur = tradeEnd - t.entryTime;
                totalDuration += dur;
                if (dur > maxDuration) maxDuration = dur;
                durationCount++;
            }
            if (t.status === 'OPEN') {
                unrealizedPnL += (t.pnlPercent * riskPerTrade);
            }
        }
    });

    closedTrades.forEach(t => {
        let pnlR = t.pnlPercent || t.pnl || 0;
        let pnlVal = pnlR * riskPerTrade;

        if (useFees) {
            const entryPrice = t.entry;
            const slPrice = t.sl;
            const distSL = Math.abs(entryPrice - slPrice);

            if (distSL > 0) {
                const positionSizeUnits = riskPerTrade / distSL;
                const notionalEntry = positionSizeUnits * entryPrice;
                const exitPrice = (t.status === 'WIN' && t.tp) ? t.tp : (t.sl || entryPrice);
                const notionalExit = positionSizeUnits * exitPrice;

                const feeEntry = notionalEntry * takerFeePct;
                const feeExit = (t.status === 'WIN') ? notionalExit * makerFeePct : notionalExit * takerFeePct;

                const totalFees = feeEntry + feeExit;
                pnlVal -= totalFees;
            }
        }

        realizedPnL += pnlVal;
        currentEquity += pnlVal;
        returns.push(pnlVal);

        if (pnlVal > 0) { wins++; grossProfit += pnlVal; }
        else { losses++; grossLoss += Math.abs(pnlVal); }

        totalTradesCount++;

        if (currentEquity > maxPeak) maxPeak = currentEquity;
        const dd = (maxPeak - currentEquity) / maxPeak;
        if (dd > maxDrawdown) maxDrawdown = dd;

        const lastPoint = equityCurve[equityCurve.length - 1];
        if (lastPoint && lastPoint.time === t.exitTime) {
            lastPoint.value = currentEquity;
        } else {
            equityCurve.push({ time: t.exitTime, value: currentEquity });
        }
    });

    if (pnlSeries) {
        pnlSeries.setData(equityCurve);
        const pnlView = document.getElementById('view-pnl');
        if (pnlView && pnlView.style.display !== 'none') pnlChart.timeScale().fitContent();
    }

    const balanceVal = state.initialBalance + realizedPnL;
    const equityVal = balanceVal + unrealizedPnL;

    const elBal = document.getElementById('balance-current');
    const elEq = document.getElementById('balance-equity');
    if (elBal) elBal.innerText = "$" + balanceVal.toFixed(2);
    if (elEq) elEq.innerText = "$" + equityVal.toFixed(2);

    const relPnLEl = document.getElementById('pnl-realized');
    const unrelPnLEl = document.getElementById('pnl-unrealized');
    if (relPnLEl) relPnLEl.innerText = realizedPnL.toFixed(2);
    if (unrelPnLEl) unrelPnLEl.innerText = unrealizedPnL.toFixed(2);

    const winRate = totalTradesCount > 0 ? (wins / totalTradesCount) * 100 : 0;
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 999 : 0);
    const meanReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
    const stdDev = Math.sqrt(returns.map(x => Math.pow(x - meanReturn, 2)).reduce((a, b) => a + b, 0) / (returns.length || 1));
    const sharpe = stdDev > 0 ? meanReturn / stdDev : 0;
    const downsideReturns = returns.filter(x => x < 0);
    const stdDevDown = Math.sqrt(downsideReturns.map(x => Math.pow(x, 2)).reduce((a, b) => a + b, 0) / (downsideReturns.length || 1));
    const sortino = stdDevDown > 0 ? meanReturn / stdDevDown : 0;

    const fmtDuration = (sec) => {
        if (!sec) return "---";
        const d = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return d > 0 ? `${d}d ${h}h` : (h > 0 ? `${h}h ${m}m` : `${m}m`);
    };

    const fmtDate = (sec) => {
        if (!sec) return "---";
        const d = new Date(sec * 1000);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}-${month}-${year}`;
    };

    const pfEl = document.getElementById('metric-pf');
    const wrEl = document.getElementById('metric-wr');
    const sharpeEl = document.getElementById('metric-sharpe');
    const sortinoEl = document.getElementById('metric-sortino');
    const ddEl = document.getElementById('metric-dd');
    const totalEl = document.getElementById('metric-total-trades');
    const activeEl = document.getElementById('metric-active-time');
    const avgDurEl = document.getElementById('metric-avg-duration');
    const maxDurEl = document.getElementById('metric-max-duration');

    if (pfEl) pfEl.innerText = profitFactor.toFixed(2);
    if (wrEl) wrEl.innerText = winRate.toFixed(1) + "%";
    if (sharpeEl) sharpeEl.innerText = sharpe.toFixed(2);
    if (sortinoEl) sortinoEl.innerText = sortino.toFixed(2);
    if (ddEl) ddEl.innerText = "-" + (maxDrawdown * 100).toFixed(2) + "%";
    if (totalEl) totalEl.innerText = totalTradesCount;
    if (activeEl) activeEl.innerText = `${fmtDate(firstTradeTime)} - ${fmtDate(lastTradeTime)}`;
    if (avgDurEl) avgDurEl.innerText = fmtDuration(durationCount > 0 ? totalDuration / durationCount : 0);
    if (maxDurEl) maxDurEl.innerText = fmtDuration(maxDuration);
}

/**
 * Clears trade price lines from the chart.
 */
function clearLines() {
    tradeLines.forEach(l => candleSeries.removePriceLine(l));
    tradeLines = [];
}

/**
 * Creates a price line on the candlestick series.
 */
function createLine(price, color, title) {
    tradeLines.push(candleSeries.createPriceLine({
        price, color, title, lineStyle: 2, lineWidth: 1, axisLabelVisible: true
    }));
}

/**
 * Zooms the chart to a specific time range.
 */
function zoomRange(from, to) {
    if (!chart || !from || !to) return;

    if (from > to) {
        const tmp = from;
        from = to;
        to = tmp;
    }

    const span = to - from;
    const pad = Math.max(span * 0.25, 60 * 15);

    chart.timeScale().setVisibleRange({
        from: from - pad,
        to: to + pad
    });
}
