/**
 * Indicators Module
 * Logic for calculating technical indicators like Hurst exponent, Linear Regression, and Trend Lines.
 */

/**
 * Calculates the Hurst exponent to determine market regime (Trending, Mean Reverting, or Random).
 */
function calculateHurst() {
    const c = state.candles;
    if (c.length < 200) {
        const hurstValEl = document.getElementById('hurst-val');
        if (hurstValEl) hurstValEl.innerText = "---";
        return;
    }

    const slice = c.slice(-200).map(x => x.close);
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

    const elVal = document.getElementById('hurst-val');
    const elType = document.getElementById('hurst-type');

    if (elVal) elVal.innerText = hurst.toFixed(2);

    if (elType) {
        if (hurst > 0.55) {
            elType.innerText = "TRENDING";
            elType.className = "text-xs font-bold text-trend";
        } else if (hurst < 0.45) {
            elType.innerText = "MEAN REVERTING (RANGE)";
            elType.className = "text-xs font-bold text-reg";
        } else {
            elType.innerText = "RANDOM WALK (NOISE)";
            elType.className = "text-xs font-bold text-slate-500";
        }
    }
}

/**
 * Calculates Linear Regression channel.
 */
function calculateRegLin() {
    const periodEl = document.getElementById('reg-period');
    const stdEl = document.getElementById('reg-std');
    const lblPeriodEl = document.getElementById('lbl-reg-period');
    const lblStdEl = document.getElementById('lbl-reg-std');

    const period = periodEl ? parseInt(periodEl.value) : 200;
    const stdMult = stdEl ? parseFloat(stdEl.value) : 2.0;

    if (lblPeriodEl) lblPeriodEl.innerText = period;
    if (lblStdEl) lblStdEl.innerText = stdMult;

    const c = state.candles;
    if (c.length < period) return;

    const slice = c.slice(-period);
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
    const t2 = c[c.length - 1].time + (futureBars * 60 * (APP.interval === '1m' ? 1 : APP.interval === '5m' ? 5 : 60));
    const pStart = b;
    const pEnd = m * (n - 1 + futureBars) + b;

    state.channel = {
        t1: t1,
        t2: t2,
        mid1: pStart,
        mid2: pEnd,
        up1: pStart + (stdDev * stdMult),
        up2: pEnd + (stdDev * stdMult),
        low1: pStart - (stdDev * stdMult),
        low2: pEnd - (stdDev * stdMult)
    };

    const slopeEl = document.getElementById('reg-slope');
    if (slopeEl) slopeEl.innerText = (m > 0 ? "+" : "") + m.toFixed(4);

    if (state.activeMode === 'reglin') {
        if (typeof renderVisuals === 'function') renderVisuals();
    }
}

/**
 * Calculates trendlines based on fractal pivots.
 * @param {boolean} returnOnly - If true, returns the lines without updating the global state.
 * @returns {Array} Array of trendline objects.
 */
function calculateTrendLines(returnOnly = false) {
    if (typeof calculateHurst === 'function') calculateHurst();

    const fractalStrEl = document.getElementById('fractal-strength');
    const strictEl = document.getElementById('trend-strict');
    const historyEl = document.getElementById('trend-history');
    const angleActiveEl = document.getElementById('angle-filter-active');
    const angleMaxEl = document.getElementById('angle-max');
    const toleranceEl = document.getElementById('trend-tolerance');
    const lblFractalEl = document.getElementById('lbl-fractal');
    const lblToleranceEl = document.getElementById('lbl-tolerance');

    const fractalStrength = fractalStrEl ? parseInt(fractalStrEl.value) : 5;
    const strictMode = strictEl ? strictEl.checked : true;
    const showHistory = historyEl ? historyEl.checked : false;
    const useAngleFilter = angleActiveEl ? angleActiveEl.checked : true;
    const angleMax = angleMaxEl ? parseInt(angleMaxEl.value) : 50;
    const toleranceValue = toleranceEl ? toleranceEl.value : 0;
    const tolerance = parseInt(toleranceValue) * 0.0005;

    if (lblFractalEl) lblFractalEl.innerText = fractalStrength;
    if (lblToleranceEl) {
        lblToleranceEl.innerText = parseInt(toleranceValue) === 0
            ? "Strict"
            : (tolerance * 100).toFixed(2) + "%";
    }

    const c = state.candles;
    if (c.length < 100) return [];

    let highs = [], lows = [];

    // Detect pivots with different strengths
    const strengths = [fractalStrength, Math.max(2, fractalStrength - 2), fractalStrength + 3];

    strengths.forEach(strength => {
        for (let i = strength; i < c.length - strength; i++) {
            let isHigh = true;
            let isLow = true;

            for (let j = 1; j <= strength; j++) {
                if (c[i - j].high > c[i].high || c[i + j].high > c[i].high) isHigh = false;
                if (c[i - j].low < c[i].low || c[i + j].low < c[i].low) isLow = false;
            }

            if (isHigh && !highs.find(h => h.index === i)) {
                highs.push({ index: i, time: c[i].time, price: c[i].high, volume: c[i].volume || 0, strength: strength });
            }
            if (isLow && !lows.find(l => l.index === i)) {
                lows.push({ index: i, time: c[i].time, price: c[i].low, volume: c[i].volume || 0, strength: strength });
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

                // Strict violation check
                let validStrict = true;
                for (let k = pivotB.index + 1; k < pivotA.index; k++) {
                    const theoPrice = pivotB.price + slope * (k - pivotB.index);
                    if (type === 'DOWN' && c[k].high > theoPrice * (1 + tolerance)) {
                        validStrict = false;
                        break;
                    }
                    if (type === 'UP' && c[k].low < theoPrice * (1 - tolerance)) {
                        validStrict = false;
                        break;
                    }
                }
                if (!validStrict) continue;

                // Count touches
                let touches = 2;
                let touchIndices = [pivotB.index, pivotA.index];
                let touchVolume = (pivotA.volume || 0) + (pivotB.volume || 0);
                const touchTolerance = 0.002;

                for (let k = pivotB.index + 1; k < pivotA.index; k++) {
                    const theoPrice = pivotB.price + slope * (k - pivotB.index);
                    const bar = c[k];
                    let touchPrice = type === 'DOWN' ? bar.high : bar.low;
                    let diff = Math.abs(touchPrice - theoPrice) / theoPrice;

                    if (diff <= touchTolerance) {
                        touches++;
                        touchIndices.push(k);
                        touchVolume += bar.volume || 0;
                    }
                }

                // Check for breakage
                let breakIndex = -1;
                for (let k = pivotA.index + 1; k < c.length; k++) {
                    const theoPrice = pivotB.price + slope * (k - pivotB.index);
                    if (type === 'DOWN' && c[k].high > theoPrice * (1 + tolerance * 0.5)) {
                        breakIndex = k;
                        break;
                    }
                    if (type === 'UP' && c[k].low < theoPrice * (1 - tolerance * 0.5)) {
                        breakIndex = k;
                        break;
                    }
                }

                // Duration calculation
                const endIdx = breakIndex !== -1 ? breakIndex : c.length - 1;
                const duration = c[endIdx].time - c[pivotB.index].time;
                const durationHours = duration / 3600;

                // Scoring
                const touchBonus = Math.max(0, (touches - 2)) * 15;
                const durationBonus = durationHours * 2;
                const score = touchBonus + durationBonus;

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
                    if (showHistory || returnOnly) {
                        lineObj.status = 'BROKEN';
                        lineObj.t2 = c[breakIndex].time;
                        lineObj.p2 = pivotB.price + slope * (breakIndex - pivotB.index);
                        lineObj.breakIndex = breakIndex;
                        lineObj.endIdx = breakIndex;
                        candidates.push(lineObj);
                    }
                } else {
                    lineObj.status = 'ACTIVE';
                    const lastIdx = c.length - 1;
                    lineObj.t2 = c[lastIdx].time;
                    lineObj.p2 = pivotB.price + slope * (lastIdx - pivotB.index);
                    lineObj.endIdx = lastIdx;
                    candidates.push(lineObj);
                }
            }
        }
    };

    processCandidates(highs, 'DOWN');
    processCandidates(lows, 'UP');

    // Sort by duration
    candidates.sort((a, b) => b.duration - a.duration);

    const activeLines = candidates.filter(l => l.status === 'ACTIVE');
    const brokenLines = candidates.filter(l => l.status === 'BROKEN');

    // Filter duplicates: keep the longest duration line when multiple are close
    let filteredActive = [];
    for (let l of activeLines) {
        let dominated = false;
        for (let k of filteredActive) {
            const priceL = l.p1 + l.slope * (c.length - l.startIdx);
            const priceK = k.p1 + k.slope * (c.length - k.startIdx);
            const priceDiff = Math.abs(priceL - priceK) / priceK;

            if (l.type === k.type && priceDiff < 0.01) {
                dominated = true;
                break;
            }
        }
        if (!dominated) filteredActive.push(l);
        if (filteredActive.length >= 20) break;
    }

    let filteredBroken = [];
    if (showHistory || returnOnly) {
        for (let l of brokenLines) {
            let dominated = false;
            for (let k of filteredBroken) {
                const pDiff = Math.abs(l.p2 - k.p2) / k.p2;
                const tDiff = Math.abs(l.t2 - k.t2);

                if (l.type === k.type && tDiff < 3600 && pDiff < 0.01) {
                    dominated = true;
                    break;
                }
            }
            if (!dominated) filteredBroken.push(l);
        }
    }

    const result = [...filteredActive, ...filteredBroken];
    if (returnOnly) return result;

    state.lines = result;
    const statsEl = document.getElementById('lines-stats');
    if (statsEl) {
        statsEl.innerText = `Lines: ${state.lines.length} (${filteredActive.length} Active, ${filteredBroken.length} Broken)`;
    }

    if (state.activeMode === 'lines') {
        if (typeof renderVisuals === 'function') renderVisuals();
    }

    return result;
}
