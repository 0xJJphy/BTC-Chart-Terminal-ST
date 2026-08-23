/**
 * Technical Indicators Module
 * Ports from terminal.html: calculateHurst, calculateRegLin, calculateTrendLines
 */

export function calculateHurst(candles) {
    if (!candles || candles.length < 200) return { hurst: 0, type: '---' };

    const slice = candles.slice(-200).map(x => x.close);
    const logs = [];
    for (let i = 1; i < slice.length; i++) {
        logs.push(Math.log(slice[i] / slice[i - 1]));
    }

    const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
    const std = Math.sqrt(logs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / logs.length);
    const deviation = logs.map(x => x - mean);

    let cumDev = 0, maxCum = -Infinity, minCum = Infinity;
    for (let v of deviation) {
        cumDev += v;
        if (cumDev > maxCum) maxCum = cumDev;
        if (cumDev < minCum) minCum = cumDev;
    }

    const R = maxCum - minCum;
    const S = std;
    const RS = R / S;
    let hurst = Math.log(RS) / Math.log(logs.length);

    if (hurst > 1) hurst = 0.99;
    if (hurst < 0) hurst = 0.01;

    let type = 'RUIDO (RANDOM WALK)';
    if (hurst > 0.55) type = 'TENDENCIA (TRENDING)';
    else if (hurst < 0.45) type = 'RANGO (MEAN REVERTING)';

    return { hurst, type };
}

export function calculateRegLin(candles, config = {}) {
    const period = config.period || 100;
    const stdMult = config.stdMult || 2;
    const interval = config.interval || '15m';

    if (!candles || candles.length < period) return null;

    const slice = candles.slice(-period);
    const n = slice.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += slice[i].close;
        sumXY += i * slice[i].close;
        sumXX += i * i;
    }

    const m = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const b = (sumY - m * sumX) / n;

    let sumSqErr = 0;
    for (let i = 0; i < n; i++) {
        const yPred = m * i + b;
        sumSqErr += Math.pow(slice[i].close - yPred, 2);
    }

    const stdDev = Math.sqrt(sumSqErr / n);
    const futureBars = 20;
    const t1 = slice[0].time;

    const intervalMult = {
        '1m': 60,
        '5m': 300,
        '15m': 900,
        '1h': 3600,
        '4h': 14400,
        '1d': 86400
    }[interval] || 900;

    const t2 = candles[candles.length - 1].time + (futureBars * intervalMult);
    const pStart = b;
    const pEnd = b + m * (n - 1 + futureBars);

    return {
        t1,
        t2,
        mid1: pStart,
        mid2: pEnd,
        up1: pStart + (stdDev * stdMult),
        up2: pEnd + (stdDev * stdMult),
        low1: pStart - (stdDev * stdMult),
        low2: pEnd - (stdDev * stdMult),
        slope: m
    };
}

export function calculateTrendLines(candles, config = {}) {
    if (!candles || candles.length < 100) return [];

    const fractalStrength = config.fractalStrength || 5;
    const strictMode = config.strictMode !== undefined ? config.strictMode : true;
    const showHistory = config.showHistory !== undefined ? config.showHistory : true;
    const useAngleFilter = config.useAngleFilter !== undefined ? config.useAngleFilter : true;
    const angleMax = config.angleMax !== undefined ? config.angleMax : 20;
    const tolerance = (config.tolerance !== undefined ? config.tolerance : 1) * 0.0005;

    let highs = [], lows = [];
    const strengths = [fractalStrength, Math.max(2, fractalStrength - 2), fractalStrength + 3];

    strengths.forEach(strength => {
        for (let i = strength; i < candles.length - strength; i++) {
            let isHigh = true;
            let isLow = true;
            for (let j = 1; j <= strength; j++) {
                if (candles[i - j].high > candles[i].high || candles[i + j].high > candles[i].high) isHigh = false;
                if (candles[i - j].low < candles[i].low || candles[i + j].low < candles[i].low) isLow = false;
            }
            if (isHigh && !highs.find(h => h.index === i)) {
                highs.push({ index: i, time: candles[i].time, price: candles[i].high, volume: candles[i].volume || 0, strength: strength });
            }
            if (isLow && !lows.find(l => l.index === i)) {
                lows.push({ index: i, time: candles[i].time, price: candles[i].low, volume: candles[i].volume || 0, strength: strength });
            }
        }
    });

    highs.sort((a, b) => a.index - b.index);
    lows.sort((a, b) => a.index - b.index);

    let candidates = [];

    const processCandidates = (pivots, type) => {
        for (let i = pivots.length - 1; i >= 1; i--) {
            let pivotA = pivots[i];
            for (let j = i - 1; j >= 0; j--) {
                let pivotB = pivots[j];
                let isDirectionValid = type === 'DOWN' ? (pivotB.price > pivotA.price) : (pivotB.price < pivotA.price);
                if (!isDirectionValid) continue;

                const slope = (pivotA.price - pivotB.price) / (pivotA.index - pivotB.index);
                const slopeNorm = Math.abs(slope / pivotB.price) * 10000;

                if (useAngleFilter && slopeNorm > angleMax * 2) continue;

                let validStrict = true;
                for (let k = pivotB.index + 1; k < pivotA.index; k++) {
                    const theoPrice = pivotB.price + slope * (k - pivotB.index);
                    if (type === 'DOWN' && candles[k].high > theoPrice * (1 + tolerance)) { validStrict = false; break; }
                    if (type === 'UP' && candles[k].low < theoPrice * (1 - tolerance)) { validStrict = false; break; }
                }
                if (!validStrict && strictMode) continue;

                let touches = 2;
                let touchIndices = [pivotB.index, pivotA.index];
                const touchTolerance = 0.002;

                for (let k = pivotB.index + 1; k < pivotA.index; k++) {
                    const theoPrice = pivotB.price + slope * (k - pivotB.index);
                    const bar = candles[k];
                    let touchPrice = type === 'DOWN' ? bar.high : bar.low;
                    let diff = Math.abs(touchPrice - theoPrice) / theoPrice;
                    if (diff <= touchTolerance) {
                        touches++;
                        touchIndices.push(k);
                    }
                }

                let breakIndex = -1;
                for (let k = pivotA.index + 1; k < candles.length; k++) {
                    const theoPrice = pivotB.price + slope * (k - pivotB.index);
                    if (type === 'DOWN' && candles[k].high > theoPrice * (1 + tolerance * 0.5)) { breakIndex = k; break; }
                    if (type === 'UP' && candles[k].low < theoPrice * (1 - tolerance * 0.5)) { breakIndex = k; break; }
                }

                const endIdx = breakIndex !== -1 ? breakIndex : candles.length - 1;
                const duration = candles[endIdx].time - candles[pivotB.index].time;
                const durationHours = duration / 3600;
                const score = Math.max(0, (touches - 2)) * 15 + durationHours * 2;

                let lineObj = {
                    t1: pivotB.time,
                    p1: pivotB.price,
                    color: type === 'DOWN' ? '#f23645' : '#089981',
                    width: 2,
                    score: score,
                    type: type,
                    slope: slope,
                    startIdx: pivotB.index,
                    endPivotIdx: pivotA.index,
                    touches: touches,
                    touchIndices: touchIndices,
                    duration: durationHours,
                    slopeNorm: slopeNorm
                };

                if (breakIndex !== -1) {
                    if (showHistory) {
                        lineObj.status = 'BROKEN';
                        lineObj.t2 = candles[breakIndex].time;
                        lineObj.p2 = pivotB.price + slope * (breakIndex - pivotB.index);
                        lineObj.breakIndex = breakIndex;
                        lineObj.endIdx = breakIndex;
                        candidates.push(lineObj);
                    }
                } else {
                    lineObj.status = 'ACTIVE';
                    const lastIdx = candles.length - 1;
                    lineObj.t2 = candles[lastIdx].time;
                    lineObj.p2 = pivotB.price + slope * (lastIdx - pivotB.index);
                    lineObj.endIdx = lastIdx;
                    candidates.push(lineObj);
                }
            }
        }
    };

    processCandidates(highs, 'DOWN');
    processCandidates(lows, 'UP');

    candidates.sort((a, b) => b.duration - a.duration);

    const activeLines = candidates.filter(l => l.status === 'ACTIVE');
    const brokenLines = candidates.filter(l => l.status === 'BROKEN');

    let filteredActive = [];
    for (let l of activeLines) {
        let dominated = false;
        for (let k of filteredActive) {
            const priceL = l.p1 + l.slope * (candles.length - 1 - l.startIdx);
            const priceK = k.p1 + k.slope * (candles.length - 1 - k.startIdx);
            const priceDiff = Math.abs(priceL - priceK) / priceK;
            if (l.type === k.type && priceDiff < 0.01) { dominated = true; break; }
        }
        if (!dominated) filteredActive.push(l);
        if (filteredActive.length >= 20) break;
    }

    let filteredBroken = [];
    for (let l of brokenLines) {
        let dominated = false;
        for (let k of filteredBroken) {
            const pDiff = Math.abs(l.p2 - k.p2) / k.p2;
            const tDiff = Math.abs(l.t2 - k.t2);
            if (l.type === k.type && tDiff < 3600 && pDiff < 0.01) { dominated = true; break; }
        }
        if (!dominated) filteredBroken.push(l);
    }

    return [...filteredActive, ...filteredBroken];
}

export function calculateRSI(candles, period = 14) {
    if (!candles || candles.length <= period) return [];
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const change = candles[i].close - candles[i - 1].close;
        if (change >= 0) gains += change;
        else losses += -change;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    const res = [];
    
    for (let i = period; i < candles.length; i++) {
        if (i > period) {
            const change = candles[i].close - candles[i - 1].close;
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? -change : 0;
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
        }
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = avgLoss === 0 ? 100 : (100 - (100 / (1 + rs)));
        res.push({ time: candles[i].time, value: rsi });
    }
    return res;
}

export function calculateMACD(candles, fast = 12, slow = 26, signal = 9) {
    if (!candles || candles.length <= slow + signal) return { macd: [], signal: [], hist: [] };
    const kFast = 2 / (fast + 1);
    const kSlow = 2 / (slow + 1);
    let emaFast = candles[0].close;
    let emaSlow = candles[0].close;
    
    const macdLine = [];
    for (let i = 0; i < candles.length; i++) {
        emaFast = candles[i].close * kFast + emaFast * (1 - kFast);
        emaSlow = candles[i].close * kSlow + emaSlow * (1 - kSlow);
        if (i >= slow - 1) {
            macdLine.push({ time: candles[i].time, value: emaFast - emaSlow });
        }
    }
    
    const kSig = 2 / (signal + 1);
    let emaSig = macdLine.length > 0 ? macdLine[0].value : 0;
    const macdRes = [];
    const sigRes = [];
    const histRes = [];
    
    for (let i = 0; i < macdLine.length; i++) {
        emaSig = macdLine[i].value * kSig + emaSig * (1 - kSig);
        if (i >= signal - 1) {
            macdRes.push(macdLine[i]);
            sigRes.push({ time: macdLine[i].time, value: emaSig });
            histRes.push({
                time: macdLine[i].time,
                value: macdLine[i].value - emaSig,
                color: (macdLine[i].value - emaSig) >= 0 ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)'
            });
        }
    }
    return { macd: macdRes, signal: sigRes, hist: histRes };
}

export function calculateDMI_ADX(candles, period = 14) {
    if (!candles || candles.length <= period * 2) return { adx: [], diPlus: [], diMinus: [] };
    const n = candles.length;
    const tr = new Float64Array(n);
    const plusDm = new Float64Array(n);
    const minusDm = new Float64Array(n);

    for (let i = 1; i < n; i++) {
        const h = candles[i].high;
        const l = candles[i].low;
        const prevH = candles[i - 1].high;
        const prevL = candles[i - 1].low;
        const prevC = candles[i - 1].close;

        tr[i] = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
        const upMove = h - prevH;
        const downMove = prevL - l;

        if (upMove > downMove && upMove > 0) plusDm[i] = upMove;
        if (downMove > upMove && downMove > 0) minusDm[i] = downMove;
    }

    let smoothTr = 0, smoothPlusDm = 0, smoothMinusDm = 0;
    for (let i = 1; i <= period; i++) {
        smoothTr += tr[i];
        smoothPlusDm += plusDm[i];
        smoothMinusDm += minusDm[i];
    }

    const diPlus = [];
    const diMinus = [];
    const dx = new Float64Array(n);

    for (let i = period; i < n; i++) {
        if (i > period) {
            smoothTr = smoothTr - (smoothTr / period) + tr[i];
            smoothPlusDm = smoothPlusDm - (smoothPlusDm / period) + plusDm[i];
            smoothMinusDm = smoothMinusDm - (smoothMinusDm / period) + minusDm[i];
        }

        const dip = smoothTr > 0 ? (smoothPlusDm / smoothTr) * 100 : 0;
        const dim = smoothTr > 0 ? (smoothMinusDm / smoothTr) * 100 : 0;
        diPlus.push({ time: candles[i].time, value: dip });
        diMinus.push({ time: candles[i].time, value: dim });

        const sumDi = dip + dim;
        dx[i] = sumDi > 0 ? (Math.abs(dip - dim) / sumDi) * 100 : 0;
    }

    let smoothAdx = 0;
    for (let i = period; i < period * 2 && i < n; i++) {
        smoothAdx += dx[i];
    }
    smoothAdx /= period;

    const adx = [];
    for (let i = period * 2 - 1; i < n; i++) {
        if (i > period * 2 - 1) {
            smoothAdx = (smoothAdx * (period - 1) + dx[i]) / period;
        }
        adx.push({ time: candles[i].time, value: smoothAdx });
    }

    return { adx, diPlus, diMinus };
}

/**
 * Calculates continuous Anchored CVD and Rolling Z-Score Time Series
 */
export function calculateAnchoredCVD(candles, anchorPeriod = 'daily', smaPeriod = 20) {
    if (!candles || candles.length === 0) return { cvd: [], sma: [], upper: [], lower: [], zScore: [] };
    const n = candles.length;
    let runningCvd = 0;
    const cvdValues = [];
    let prevTime = 0;

    const cvdRes = [];
    const smaRes = [];
    const upperRes = [];
    const lowerRes = [];
    const zScoreRes = [];

    const getReset = (curr, prev) => {
        if (!prev) return false;
        if (anchorPeriod === 'daily') return Math.floor(curr / 86400) !== Math.floor(prev / 86400);
        if (anchorPeriod === 'weekly') return Math.floor((curr + 345600) / 604800) !== Math.floor((prev + 345600) / 604800);
        if (anchorPeriod === 'monthly') return Math.floor(curr / 2629743) !== Math.floor(prev / 2629743);
        return false;
    };

    for (let i = 0; i < n; i++) {
        const c = candles[i];
        if (getReset(c.time, prevTime)) {
            runningCvd = 0;
        }

        const vol = c.volume || 1;
        const delta = c.delta !== undefined && c.delta !== null 
            ? c.delta 
            : ((c.buyVolume !== undefined && c.sellVolume !== undefined) 
                ? (c.buyVolume - c.sellVolume) 
                : (c.close >= c.open ? vol * 0.25 : -vol * 0.25));

        runningCvd += delta;
        cvdValues.push(runningCvd);

        const wStart = Math.max(0, cvdValues.length - smaPeriod);
        const window = cvdValues.slice(wStart);
        const mean = window.reduce((a, b) => a + b, 0) / window.length;
        const variance = window.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / window.length;
        const stdDev = Math.max(0.001, Math.sqrt(variance));

        const z = (runningCvd - mean) / stdDev;
        const up = mean + 2 * stdDev;
        const low = mean - 2 * stdDev;

        cvdRes.push({ time: c.time, value: runningCvd });
        smaRes.push({ time: c.time, value: mean });
        upperRes.push({ time: c.time, value: up });
        lowerRes.push({ time: c.time, value: low });
        zScoreRes.push({
            time: c.time,
            value: z,
            color: z >= 2.0 ? '#10b981' : (z <= -2.0 ? '#f43f5e' : (z >= 0 ? '#38bdf8' : '#fb923c'))
        });

        prevTime = c.time;
    }

    return { cvd: cvdRes, sma: smaRes, upper: upperRes, lower: lowerRes, zScore: zScoreRes };
}

/**
 * Calculates Delta Efficiency Ratio (DER = Price Displacement / Cum Delta)
 */
export function calculateDER(candles, period = 14) {
    if (!candles || candles.length < period) return [];
    const res = [];

    for (let i = period; i < candles.length; i++) {
        const pDist = Math.abs(candles[i].close - candles[i - period].close);
        let cumDelta = 0;

        for (let k = i - period + 1; k <= i; k++) {
            const c = candles[k];
            const vol = c.volume || 1;
            const delta = c.delta !== undefined && c.delta !== null 
                ? Math.abs(c.delta) 
                : ((c.buyVolume !== undefined && c.sellVolume !== undefined) 
                    ? Math.abs(c.buyVolume - c.sellVolume) 
                    : vol * 0.25);
            cumDelta += delta;
        }

        const der = pDist / Math.max(0.001, cumDelta);
        res.push({
            time: candles[i].time,
            value: der,
            color: der >= 5.0 ? '#10b981' : (der <= 1.0 ? '#f43f5e' : '#38bdf8')
        });
    }

    return res;
}

/**
 * Calculates Liquidity Fragility Index (Psi = Price Return / Relative Volume)
 */
export function calculateFragility(candles, period = 20) {
    if (!candles || candles.length < period) return [];
    const res = [];

    // Calculate moving average volume
    let sumVol = 0;
    for (let i = 0; i < candles.length; i++) {
        sumVol += (candles[i].volume || 1);
        if (i >= period) {
            sumVol -= (candles[i - period].volume || 1);
            const avgVol = Math.max(0.001, sumVol / period);
            const c = candles[i];
            const returnPct = Math.abs((c.high - c.low) / Math.max(1, c.close)) * 1000;
            const relVol = Math.max(0.01, (c.volume || 1) / avgVol);
            const fragility = (returnPct / relVol);

            res.push({
                time: c.time,
                value: fragility,
                color: fragility >= 100 ? '#f43f5e' : (fragility >= 50 ? '#fb923c' : '#38bdf8')
            });
        }
    }

    return res;
}

/**
 * Calculates Volume & Delta time series
 */
export function calculateVolumeDelta(candles, smaPeriod = 20) {
    if (!candles || candles.length === 0) return { delta: [], sma: [] };
    const deltaRes = [];
    const smaRes = [];
    let sumVol = 0;

    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const vol = c.volume || 1;
        const d = c.delta !== undefined && c.delta !== null 
            ? c.delta 
            : ((c.buyVolume !== undefined && c.sellVolume !== undefined) 
                ? (c.buyVolume - c.sellVolume) 
                : (c.close >= c.open ? vol * 0.25 : -vol * 0.25));

        deltaRes.push({
            time: c.time,
            value: d,
            color: d >= 0 ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.8)'
        });

        sumVol += vol;
        if (i >= smaPeriod) {
            sumVol -= (candles[i - smaPeriod].volume || 1);
            smaRes.push({ time: c.time, value: sumVol / smaPeriod });
        } else {
            smaRes.push({ time: c.time, value: sumVol / (i + 1) });
        }
    }

    return { delta: deltaRes, sma: smaRes };
}
