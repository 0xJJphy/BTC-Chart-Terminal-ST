/**
 * SMC Strategy Module
 * Logic for detecting FVG and OrderBlocks with advanced scoring.
 * Refactored for full parity with original engine including trade idea generation.
 */

/**
 * GLOBAL HELPERS for Trade Generation (Parity with original)
 */
function createTrade(idx, type, entry, sl, time, candles, riskReward = 2) {
    let trade = {
        id: `smc-${idx}`,
        type: type,
        status: 'PENDING',
        entry: entry,
        sl: sl,
        tp: 0,
        signalTime: time,
        time: time, // standardized for UI components
        pnlValue: 0,
        pnlPercent: 0,
        pnl: 0,
        desc: 'SMC Setup'
    };

    if (type === 'LONG') {
        trade.tp = trade.entry + ((trade.entry - trade.sl) * riskReward);
    } else {
        trade.tp = trade.entry - ((trade.entry - trade.sl) * riskReward);
    }

    processTradeLifecycle(trade, idx, candles, riskReward);
    return trade.status !== 'CANCELLED' ? trade : null;
}

function processTradeLifecycle(trade, idx, candles, riskReward) {
    for (let j = idx + 1; j < candles.length; j++) {
        const bar = candles[j];
        if (trade.status === 'PENDING') {
            if (trade.type === 'LONG') {
                if (bar.low <= trade.entry) {
                    trade.status = 'OPEN';
                    trade.entryTime = bar.time;
                } else if (bar.low <= trade.sl) {
                    trade.status = 'CANCELLED';
                }
            } else { // SHORT
                if (bar.high >= trade.entry) {
                    trade.status = 'OPEN';
                    trade.entryTime = bar.time;
                } else if (bar.high >= trade.sl) {
                    trade.status = 'CANCELLED';
                }
            }
        } else if (trade.status === 'OPEN') {
            if (trade.type === 'LONG') {
                if (bar.low <= trade.sl) {
                    trade.status = 'LOSS';
                    trade.exitTime = bar.time;
                    trade.pnl = -1;
                    trade.pnlPercent = -1;
                    break;
                }
                if (bar.high >= trade.tp) {
                    trade.status = 'WIN';
                    trade.exitTime = bar.time;
                    trade.pnl = riskReward;
                    trade.pnlPercent = riskReward;
                    break;
                }
            } else { // SHORT
                if (bar.high >= trade.sl) {
                    trade.status = 'LOSS';
                    trade.exitTime = bar.time;
                    trade.pnl = -1;
                    trade.pnlPercent = -1;
                    break;
                }
                if (bar.low <= trade.tp) {
                    trade.status = 'WIN';
                    trade.exitTime = bar.time;
                    trade.pnl = riskReward;
                    trade.pnlPercent = riskReward;
                    break;
                }
            }
        }
    }

    if (trade.status === 'OPEN') {
        const lastPrice = candles[candles.length - 1].close;
        let rMultiple = 0;
        if (trade.type === 'LONG') {
            rMultiple = (lastPrice - trade.entry) / (trade.entry - trade.sl);
        } else {
            rMultiple = (trade.entry - lastPrice) / (trade.sl - trade.entry);
        }
        trade.pnl = rMultiple;
        trade.pnlPercent = rMultiple;
    }
}

export function analyzeSMC(candles, config = {}) {
    if (!candles || candles.length < 50) return { zones: [], trades: [] };

    const zones = [];
    const trades = [];
    const sens = config.sensitivity || 0.0001;
    const historyTarget = config.historyTarget || 30000;
    const riskReward = config.riskReward || 2;
    const startIndex = Math.max(20, candles.length - historyTarget);

    // --- ATR ---
    const atrPeriod = 14;
    let atrValues = new Float64Array(candles.length);
    for (let i = startIndex; i < candles.length; i++) {
        if (i < atrPeriod) continue;
        let trSum = 0;
        for (let j = 0; j < atrPeriod; j++) {
            const idx = i - j;
            const high = candles[idx].high;
            const low = candles[idx].low;
            const prevClose = candles[idx - 1].close;
            const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
            trSum += tr;
        }
        atrValues[i] = trSum / atrPeriod;
    }

    // --- Avg Volume ---
    const volPeriod = 20;
    let avgVolumes = new Float64Array(candles.length);
    for (let i = volPeriod; i < candles.length; i++) {
        let volSum = 0;
        for (let j = 0; j < volPeriod; j++) {
            volSum += candles[i - j].volume || 0;
        }
        avgVolumes[i] = volSum / volPeriod;
    }

    // --- Swings for BOS ---
    const swingLookback = 10;
    let swingHighs = [];
    let swingLows = [];
    for (let i = swingLookback; i < candles.length - swingLookback; i++) {
        let isSwingHigh = true;
        let isSwingLow = true;
        for (let j = 1; j <= swingLookback; j++) {
            if (candles[i - j].high > candles[i].high || candles[i + j].high > candles[i].high) isSwingHigh = false;
            if (candles[i - j].low < candles[i].low || candles[i + j].low < candles[i].low) isSwingLow = false;
        }
        if (isSwingHigh) swingHighs.push({ index: i, price: candles[i].high });
        if (isSwingLow) swingLows.push({ index: i, price: candles[i].low });
    }

    const getLastSwingHigh = (idx) => {
        for (let i = swingHighs.length - 1; i >= 0; i--) {
            if (swingHighs[i].index < idx) return swingHighs[i];
        }
        return null;
    };
    const getLastSwingLow = (idx) => {
        for (let i = swingLows.length - 1; i >= 0; i--) {
            if (swingLows[i].index < idx) return swingLows[i];
        }
        return null;
    };

    const barTouchesZone = (bar, top, bottom) => {
        if (!bar) return false;
        const zTop = Math.max(top, bottom);
        const zBottom = Math.min(top, bottom);
        return bar.low <= zTop && bar.high >= zBottom;
    };

    const calculateOBScore = (obCandle, idx, isBullish, atr, avgVol) => {
        let score = 0;
        const vol = obCandle.volume || 0;
        const volRatio = avgVol > 0 ? vol / avgVol : 1;
        if (volRatio > 2.0) score += 30;
        else if (volRatio > 1.5) score += 20;
        else if (volRatio > 1.2) score += 10;

        const obSize = obCandle.high - obCandle.low;
        const sizeRatio = atr > 0 ? obSize / atr : 1;
        if (sizeRatio > 1.5) score += 25;
        else if (sizeRatio > 1.0) score += 15;
        else if (sizeRatio > 0.7) score += 8;

        if (isBullish) {
            const lastSwingHigh = getLastSwingHigh(idx);
            if (lastSwingHigh) {
                for (let k = idx + 1; k < Math.min(idx + 20, candles.length); k++) {
                    if (candles[k].high > lastSwingHigh.price) { score += 35; break; }
                }
            }
        } else {
            const lastSwingLow = getLastSwingLow(idx);
            if (lastSwingLow) {
                for (let k = idx + 1; k < Math.min(idx + 20, candles.length); k++) {
                    if (candles[k].low < lastSwingLow.price) { score += 35; break; }
                }
            }
        }

        if (idx > 0) {
            const prev = candles[idx - 1];
            const isEngulfing = obCandle.high > prev.high && obCandle.low < prev.low;
            if (isEngulfing) score += 15;
        }

        const midPrice = (obCandle.high + obCandle.low) / 2;
        const roundLevel = Math.round(midPrice / 1000) * 1000;
        const distToRound = Math.abs(midPrice - roundLevel) / midPrice;
        if (distToRound < 0.005) score += 20;
        else if (distToRound < 0.01) score += 10;

        return score;
    };

    const calculateFVGScore = (gap, impulsePercent, atr, avgVol, velas) => {
        let score = 0;
        const gapRatio = atr > 0 ? gap / atr : 0;
        if (gapRatio > 1.0) score += 30;
        else if (gapRatio > 0.7) score += 20;
        else if (gapRatio > 0.5) score += 12;
        else if (gapRatio > 0.3) score += 5;

        if (impulsePercent > 0.015) score += 25;
        else if (impulsePercent > 0.01) score += 18;
        else if (impulsePercent > 0.005) score += 10;

        const totalVol = velas.reduce((sum, v) => sum + (v.volume || 0), 0);
        const avgImpulseVol = totalVol / 3;
        const volRatio = avgVol > 0 ? avgImpulseVol / avgVol : 1;
        if (volRatio > 2.0) score += 25;
        else if (volRatio > 1.5) score += 15;
        else if (volRatio > 1.2) score += 8;

        return score;
    };

    const processedOBs = new Set();
    const keepTrades = !!config.keepTrades; // If true, don't generate new trades

    for (let i = Math.max(startIndex, 2); i < candles.length; i++) {
        const curr = candles[i];
        const prev1 = candles[i - 1];
        const prev2 = candles[i - 2];
        const atr = atrValues[i] || (curr.high - curr.low);
        const avgVol = avgVolumes[i] || 1;

        // --- FVG Bullish ---
        if (curr.low > prev2.high) {
            const gap = curr.low - prev2.high;
            let validFVG = true;

            const minGap = curr.close * sens;
            if (gap < minGap) validFVG = false;
            if (gap < atr * 0.2) validFVG = false;

            const impulse = curr.close - prev2.close;
            const impulsePercent = Math.abs(impulse / prev2.close);
            if (impulsePercent < 0.003) validFVG = false;

            if (curr.volume && prev1.volume && prev2.volume) {
                const avgVolLocal = (prev1.volume + prev2.volume) / 2;
                if (curr.volume < avgVolLocal * 0.5) validFVG = false;
            }

            if (validFVG) {
                const fvgScore = calculateFVGScore(gap, impulsePercent, atr, avgVol, [prev2, prev1, curr]);
                let zone = {
                    id: `fvg-l-${i}`,
                    label: 'FVG',
                    type: 'BULL',
                    top: curr.low,
                    bottom: prev2.high,
                    time: prev1.time,
                    endTime: null,
                    status: 'ACTIVE',
                    color: 'rgba(168, 85, 247, 0.4)',
                    score: fvgScore,
                    quality: fvgScore,
                    gapSize: gap,
                    impulsePercent: impulsePercent
                };
                for (let j = i + 1; j < candles.length; j++) {
                    if (barTouchesZone(candles[j], zone.top, zone.bottom)) {
                        zone.status = 'MITIGATED';
                        zone.endTime = candles[j].time;
                        break;
                    }
                }
                zones.push(zone);

                // OB Bullish asociado
                let obCandleIdx = -1;
                for (let k = i - 1; k >= Math.max(0, i - 10); k--) {
                    if (candles[k].close < candles[k].open) { obCandleIdx = k; break; }
                }

                let associatedOB = null;
                if (obCandleIdx !== -1 && !processedOBs.has(obCandleIdx)) {
                    const obCandle = candles[obCandleIdx];
                    const obAtr = atrValues[obCandleIdx] || atr;
                    const obAvgVol = avgVolumes[obCandleIdx] || avgVol;
                    const obScore = calculateOBScore(obCandle, obCandleIdx, true, obAtr, obAvgVol);
                    associatedOB = {
                        id: `ob-l-${obCandleIdx}`,
                        label: 'OB',
                        type: 'BULL',
                        top: obCandle.high,
                        bottom: obCandle.low,
                        time: obCandle.time,
                        endTime: null,
                        status: 'ACTIVE',
                        color: 'rgba(234, 179, 8, 0.4)',
                        score: obScore,
                        quality: obScore,
                        volume: obCandle.volume || 0,
                        hasBOS: obScore >= 35,
                        size: obCandle.high - obCandle.low
                    };
                    for (let j = i + 1; j < candles.length; j++) {
                        if (barTouchesZone(candles[j], associatedOB.top, associatedOB.bottom)) {
                            associatedOB.status = 'MITIGATED';
                            associatedOB.endTime = candles[j].time;
                            break;
                        }
                    }
                    zones.push(associatedOB);
                    processedOBs.add(obCandleIdx);
                }

                if (!keepTrades) {
                    const trade = createTrade(i, 'LONG', curr.low, Math.min(candles[i - 1].low, candles[i - 2].low), curr.time, candles, riskReward);
                    if (trade) {
                        trade.savedFVG = JSON.parse(JSON.stringify(zone));
                        if (associatedOB) trade.savedOB = JSON.parse(JSON.stringify(associatedOB));
                        trades.push(trade);
                    }
                }
            }
        }

        // --- FVG Bearish ---
        if (curr.high < prev2.low) {
            const gap = prev2.low - curr.high;
            let validFVG = true;

            const minGap = curr.close * sens;
            if (gap < minGap) validFVG = false;
            if (gap < atr * 0.2) validFVG = false;

            const impulse = prev2.close - curr.close;
            const impulsePercent = Math.abs(impulse / prev2.close);
            if (impulsePercent < 0.003) validFVG = false;

            if (curr.volume && prev1.volume && prev2.volume) {
                const avgVolLocal = (prev1.volume + prev2.volume) / 2;
                if (curr.volume < avgVolLocal * 0.5) validFVG = false;
            }

            if (validFVG) {
                const fvgScore = calculateFVGScore(gap, impulsePercent, atr, avgVol, [prev2, prev1, curr]);
                let zone = {
                    id: `fvg-s-${i}`,
                    label: 'FVG',
                    type: 'BEAR',
                    top: prev2.low,
                    bottom: curr.high,
                    time: prev1.time,
                    endTime: null,
                    status: 'ACTIVE',
                    color: 'rgba(168, 85, 247, 0.4)',
                    score: fvgScore,
                    quality: fvgScore,
                    gapSize: gap,
                    impulsePercent: impulsePercent
                };
                for (let j = i + 1; j < candles.length; j++) {
                    if (barTouchesZone(candles[j], zone.top, zone.bottom)) {
                        zone.status = 'MITIGATED';
                        zone.endTime = candles[j].time;
                        break;
                    }
                }
                zones.push(zone);

                // OB Bearish asociado
                let obCandleIdx = -1;
                for (let k = i - 1; k >= Math.max(0, i - 10); k--) {
                    if (candles[k].close > candles[k].open) { obCandleIdx = k; break; }
                }

                let associatedOB = null;
                if (obCandleIdx !== -1 && !processedOBs.has(obCandleIdx)) {
                    const obCandle = candles[obCandleIdx];
                    const obAtr = atrValues[obCandleIdx] || atr;
                    const obAvgVol = avgVolumes[obCandleIdx] || avgVol;
                    const obScore = calculateOBScore(obCandle, obCandleIdx, false, obAtr, obAvgVol);
                    associatedOB = {
                        id: `ob-s-${obCandleIdx}`,
                        label: 'OB',
                        type: 'BEAR',
                        top: obCandle.high,
                        bottom: obCandle.low,
                        time: obCandle.time,
                        endTime: null,
                        status: 'ACTIVE',
                        color: 'rgba(234, 179, 8, 0.4)',
                        score: obScore,
                        quality: obScore,
                        volume: obCandle.volume || 0,
                        hasBOS: obScore >= 35,
                        size: obCandle.high - obCandle.low
                    };
                    for (let j = i + 1; j < candles.length; j++) {
                        if (barTouchesZone(candles[j], associatedOB.top, associatedOB.bottom)) {
                            associatedOB.status = 'MITIGATED';
                            associatedOB.endTime = candles[j].time;
                            break;
                        }
                    }
                    zones.push(associatedOB);
                    processedOBs.add(obCandleIdx);
                }

                if (!keepTrades) {
                    const trade = createTrade(i, 'SHORT', curr.high, Math.max(candles[i - 1].high, candles[i - 2].high), curr.time, candles, riskReward);
                    if (trade) {
                        trade.savedFVG = JSON.parse(JSON.stringify(zone));
                        if (associatedOB) trade.savedOB = JSON.parse(JSON.stringify(associatedOB));
                        trades.push(trade);
                    }
                }
            }
        }
    }

    return { zones: zones.sort((a, b) => (a.time || 0) - (b.time || 0)), trades };
}
