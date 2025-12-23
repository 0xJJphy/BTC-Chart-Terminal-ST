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
