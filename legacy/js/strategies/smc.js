/**
 * SMC (Smart Money Concepts) Strategy
 * Logic for detecting Order Blocks (OB) and Fair Value Gaps (FVG).
 */

/**
 * Higher-level function to detect SMC zones and trades in the market.
 * @param {boolean} keepTrades - Whether to preserve existing trades in the application state.
 */
function analyzeSMC(keepTrades = false) {
    state.zones = [];
    if (!keepTrades) state.trades = [];

    const c = state.candles;
    if (c.length < 50) return;
    const sens = APP.sensitivity;

    const startIndex = Math.max(20, c.length - APP.historyTarget);
    let localTrades = [];

    // --- ATR for history ---
    const atrPeriod = 14;
    let atrValues = [];
    for (let i = startIndex; i < c.length; i++) {
        if (i < atrPeriod) continue;
        let trSum = 0;
        for (let j = 0; j < atrPeriod; j++) {
            const idx = i - j;
            const high = c[idx].high;
            const low = c[idx].low;
            const prevClose = c[idx - 1].close;
            const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
            trSum += tr;
        }
        atrValues[i] = trSum / atrPeriod;
    }

    // --- Volume average ---
    const volPeriod = 20;
    let avgVolumes = [];
    for (let i = volPeriod; i < c.length; i++) {
        let volSum = 0;
        for (let j = 0; j < volPeriod; j++) {
            volSum += c[i - j].volume || 0;
        }
        avgVolumes[i] = volSum / volPeriod;
    }

    // --- Swing Highs/Lows for BOS detection ---
    const swingLookback = 10;
    let swingHighs = [];
    let swingLows = [];
    for (let i = swingLookback; i < c.length - swingLookback; i++) {
        let isSwingHigh = true;
        let isSwingLow = true;
        for (let j = 1; j <= swingLookback; j++) {
            if (c[i - j].high > c[i].high || c[i + j].high > c[i].high) isSwingHigh = false;
            if (c[i - j].low < c[i].low || c[i + j].low < c[i].low) isSwingLow = false;
        }
        if (isSwingHigh) swingHighs.push({ index: i, price: c[i].high });
        if (isSwingLow) swingLows.push({ index: i, price: c[i].low });
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

    const processedOBs = new Set();

    const barTouchesZone = (bar, top, bottom) => {
        const zTop = Math.max(top, bottom);
        const zBottom = Math.min(top, bottom);
        return bar.low <= zTop && bar.high >= zBottom;
    };

    /**
     * Calculates a significance score for an Order Block.
     */
    const calculateOBScore = (obCandle, idx, isBullish, atr, avgVol) => {
        let score = 0;

        // 1. Relative Volume (> 1.5x = institutional)
        const vol = obCandle.volume || 0;
        const volRatio = avgVol > 0 ? vol / avgVol : 1;
        if (volRatio > 2.0) score += 30;
        else if (volRatio > 1.5) score += 20;
        else if (volRatio > 1.2) score += 10;

        // 2. Size vs ATR (Significant size = more important)
        const obSize = obCandle.high - obCandle.low;
        const sizeRatio = atr > 0 ? obSize / atr : 1;
        if (sizeRatio > 1.5) score += 25;
        else if (sizeRatio > 1.0) score += 15;
        else if (sizeRatio > 0.7) score += 8;

        // 3. BOS (Break of Structure) check
        if (isBullish) {
            const lastSwingHigh = getLastSwingHigh(idx);
            if (lastSwingHigh) {
                for (let k = idx + 1; k < Math.min(idx + 20, c.length); k++) {
                    if (c[k].high > lastSwingHigh.price) {
                        score += 35; // BOS confirmed
                        break;
                    }
                }
            }
        } else {
            const lastSwingLow = getLastSwingLow(idx);
            if (lastSwingLow) {
                for (let k = idx + 1; k < Math.min(idx + 20, c.length); k++) {
                    if (c[k].low < lastSwingLow.price) {
                        score += 35; // BOS confirmed
                        break;
                    }
                }
            }
        }

        // 4. Engulfing pattern
        if (idx > 0) {
            const prev = c[idx - 1];
            const isEngulfing = obCandle.high > prev.high && obCandle.low < prev.low;
            if (isEngulfing) score += 15;
        }

        // 5. Proximity to round numbers
        const midPrice = (obCandle.high + obCandle.low) / 2;
        const roundLevel = Math.round(midPrice / 1000) * 1000;
        const distToRound = Math.abs(midPrice - roundLevel) / midPrice;
        if (distToRound < 0.005) score += 20;
        else if (distToRound < 0.01) score += 10;

        return score;
    };

    /**
     * Calculates a significance score for a Fair Value Gap.
     */
    const calculateFVGScore = (gap, impulsePercent, atr, avgVol, velas) => {
        let score = 0;

        // 1. Gap size vs ATR
        const gapRatio = atr > 0 ? gap / atr : 0;
        if (gapRatio > 1.0) score += 30;
        else if (gapRatio > 0.7) score += 20;
        else if (gapRatio > 0.5) score += 12;
        else if (gapRatio > 0.3) score += 5;

        // 2. Impulse velocity (% movement)
        if (impulsePercent > 0.015) score += 25;
        else if (impulsePercent > 0.01) score += 18;
        else if (impulsePercent > 0.005) score += 10;

        // 3. Volume of the impulse
        const totalVol = velas.reduce((sum, v) => sum + (v.volume || 0), 0);
        const avgImpulseVol = totalVol / 3;
        const volRatio = avgVol > 0 ? avgImpulseVol / avgVol : 1;
        if (volRatio > 2.0) score += 25;
        else if (volRatio > 1.5) score += 15;
        else if (volRatio > 1.2) score += 8;

        return score;
    };

    for (let i = startIndex; i < c.length; i++) {
        const curr = c[i];
        const prev1 = c[i - 1];
        const prev2 = c[i - 2];
        const atr = atrValues[i] || (curr.high - curr.low);
        const avgVol = avgVolumes[i] || 1;

        // --- Bullish FVG ---
        if (curr.low > prev2.high) {
            const gap = curr.low - prev2.high;
            const gapPercent = gap / curr.close;
            let validFVG = true;

            if (gap < (curr.close * sens)) validFVG = false;
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
                    type: 'FVG',
                    top: curr.low,
                    bottom: prev2.high,
                    time: prev1.time,
                    endTime: null,
                    status: 'ACTIVE',
                    color: 'rgba(168, 85, 247, 0.4)',
                    quality: fvgScore,
                    midPoint: prev2.high + (gap / 2),
                    gapSize: gap,
                    impulsePercent: impulsePercent
                };

                for (let j = i + 1; j < c.length; j++) {
                    if (barTouchesZone(c[j], zone.top, zone.bottom)) {
                        zone.status = 'MITIGATED';
                        zone.endTime = c[j].time;
                        break;
                    }
                }
                state.zones.push(zone);

                if (!keepTrades) {
                    const trade = createTrade(i, 'LONG', curr.low, Math.min(c[i - 1].low, c[i - 2].low), curr.time, c);
                    if (trade) localTrades.push(trade);
                }

                // Bullish Order Block associated with FVG
                let obCandleIdx = -1;
                for (let k = i - 1; k >= Math.max(0, i - 10); k--) {
                    if (c[k].close < c[k].open) { obCandleIdx = k; break; }
                }

                if (obCandleIdx !== -1 && !processedOBs.has(obCandleIdx)) {
                    const obCandle = c[obCandleIdx];
                    const obAtr = atrValues[obCandleIdx] || atr;
                    const obAvgVol = avgVolumes[obCandleIdx] || avgVol;
                    const obScore = calculateOBScore(obCandle, obCandleIdx, true, obAtr, obAvgVol);

                    let ob = {
                        id: `ob-l-${obCandleIdx}`,
                        type: 'OB',
                        top: obCandle.high,
                        bottom: obCandle.low,
                        time: obCandle.time,
                        endTime: null,
                        status: 'ACTIVE',
                        color: 'rgba(234, 179, 8, 0.4)',
                        quality: obScore,
                        volume: obCandle.volume || 0,
                        hasBOS: obScore >= 35,
                        size: obCandle.high - obCandle.low
                    };

                    for (let j = i + 1; j < c.length; j++) {
                        if (barTouchesZone(c[j], ob.top, ob.bottom)) {
                            ob.status = 'MITIGATED';
                            ob.endTime = c[j].time;
                            break;
                        }
                    }
                    state.zones.push(ob);
                    processedOBs.add(obCandleIdx);
                }
            }
        }

        // --- Bearish FVG ---
        if (curr.high < prev2.low) {
            const gap = prev2.low - curr.high;
            const gapPercent = gap / curr.close;
            let validFVG = true;

            if (gap < (curr.close * sens)) validFVG = false;
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
                    type: 'FVG',
                    top: prev2.low,
                    bottom: curr.high,
                    time: prev1.time,
                    endTime: null,
                    status: 'ACTIVE',
                    color: 'rgba(168, 85, 247, 0.4)',
                    quality: fvgScore,
                    midPoint: curr.high + (gap / 2),
                    gapSize: gap,
                    impulsePercent: impulsePercent
                };

                for (let j = i + 1; j < c.length; j++) {
                    if (barTouchesZone(c[j], zone.top, zone.bottom)) {
                        zone.status = 'MITIGATED';
                        zone.endTime = c[j].time;
                        break;
                    }
                }
                state.zones.push(zone);

                if (!keepTrades) {
                    const trade = createTrade(i, 'SHORT', curr.high, Math.max(c[i - 1].high, c[i - 2].high), curr.time, c);
                    if (trade) localTrades.push(trade);
                }

                // Bearish Order Block associated with FVG
                let obCandleIdx = -1;
                for (let k = i - 1; k >= Math.max(0, i - 10); k--) {
                    if (c[k].close > c[k].open) { obCandleIdx = k; break; }
                }

                if (obCandleIdx !== -1 && !processedOBs.has(obCandleIdx)) {
                    const obCandle = c[obCandleIdx];
                    const obAtr = atrValues[obCandleIdx] || atr;
                    const obAvgVol = avgVolumes[obCandleIdx] || avgVol;
                    const obScore = calculateOBScore(obCandle, obCandleIdx, false, obAtr, obAvgVol);

                    let ob = {
                        id: `ob-s-${obCandleIdx}`,
                        type: 'OB',
                        top: obCandle.high,
                        bottom: obCandle.low,
                        time: obCandle.time,
                        endTime: null,
                        status: 'ACTIVE',
                        color: 'rgba(234, 179, 8, 0.4)',
                        quality: obScore,
                        volume: obCandle.volume || 0,
                        hasBOS: obScore >= 35,
                        size: obCandle.high - obCandle.low
                    };

                    for (let j = i + 1; j < c.length; j++) {
                        if (barTouchesZone(c[j], ob.top, ob.bottom)) {
                            ob.status = 'MITIGATED';
                            ob.endTime = c[j].time;
                            break;
                        }
                    }
                    state.zones.push(ob);
                    processedOBs.add(obCandleIdx);
                }
            }
        }
    }

    state.zones.sort((a, b) => (a.time || 0) - (b.time || 0));
    if (!keepTrades) state.trades = localTrades;
}
