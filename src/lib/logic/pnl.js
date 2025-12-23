/**
 * PnL and Performance Metrics Module
 * Logic for calculating account growth, drawdown, and risk metrics.
 */

export function calculatePnLMetrics(trades, candles, config = {}) {
    const initialBalance = config.initialBalance || 10000;
    const makerFeePct = (config.feeMaker || 0.1) / 100;
    const takerFeePct = (config.feeTaker || 0.1) / 100;
    const useFees = config.includeFees || false;
    const riskPerTrade = initialBalance * 0.01;

    let realizedPnL = 0, unrealizedPnL = 0, wins = 0, losses = 0, grossProfit = 0, grossLoss = 0;
    let returns = [], equityCurve = [], firstTradeTime = null, lastTradeTime = null;
    let totalDuration = 0, maxDuration = 0, durationCount = 0;

    if (candles.length > 0) {
        equityCurve.push({ time: candles[0].time, value: initialBalance });
    }

    let currentEquity = initialBalance, maxPeak = initialBalance, maxDrawdown = 0;

    const closedTrades = trades
        .filter(t => t.status === 'WIN' || t.status === 'LOSS')
        .sort((a, b) => (a.exitTime || 0) - (b.exitTime || 0));

    trades.forEach(t => {
        if (t.status === 'WIN' || t.status === 'LOSS' || t.status === 'OPEN') {
            if (t.entryTime) {
                if (!firstTradeTime || t.entryTime < firstTradeTime) firstTradeTime = t.entryTime;
                let tradeEnd = t.exitTime || (candles.length > 0 ? candles[candles.length - 1].time : 0);
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
        let pnlVal = (t.pnl || 0) * riskPerTrade;

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
                pnlVal -= (feeEntry + feeExit);
            }
        }

        realizedPnL += pnlVal;
        currentEquity += pnlVal;
        returns.push(pnlVal);

        if (pnlVal > 0) { wins++; grossProfit += pnlVal; }
        else { losses++; grossLoss += Math.abs(pnlVal); }

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

    const totalTrades = closedTrades.length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 999 : 0);
    const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 1 ? Math.sqrt(returns.map(x => Math.pow(x - meanReturn, 2)).reduce((a, b) => a + b, 0) / returns.length) : 0;
    const sharpe = stdDev > 0 ? meanReturn / stdDev : 0;

    const downsideReturns = returns.filter(x => x < 0);
    const stdDevDown = downsideReturns.length > 0 ? Math.sqrt(downsideReturns.map(x => Math.pow(x, 2)).reduce((a, b) => a + b, 0) / downsideReturns.length) : 0;
    const sortino = stdDevDown > 0 ? meanReturn / stdDevDown : 0;

    return {
        metrics: {
            totalTrades,
            winRate,
            profitFactor,
            sharpe,
            sortino,
            maxDrawdown: maxDrawdown * 100,
            totalPnL: realizedPnL,
            currentEquity: currentEquity + unrealizedPnL,
            realizedPnL,
            unrealizedPnL,
            avgDuration: durationCount > 0 ? totalDuration / durationCount : 0,
            maxDuration,
            firstTradeTime,
            lastTradeTime
        },
        equityCurve
    };
}
