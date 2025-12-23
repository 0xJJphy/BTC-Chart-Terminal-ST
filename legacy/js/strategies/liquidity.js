/**
 * Liquidity / TL Trap Strategy Module
 * Logic for detecting Liquidity Traps and Trendline Breakouts/Reversals.
 */

/**
 * Executes the Liquidity/TL Trap strategy backtest.
 * @param {string} mode - The strategy variant (standard, agro, atr, etc.).
 */
function runLiquidityStrategy(mode = 'standard') {
    if (typeof analyzeSMC === 'function') analyzeSMC(true);
    const allLines = typeof calculateTrendLines === 'function' ? calculateTrendLines(true) : [];
    const c = state.candles;
    if (!c || c.length === 0) return;

    console.log(`[TL Trap ${mode}] Candles: ${c.length}, Total Lines: ${allLines.length}`);

    const useVolumeAnalysis = document.getElementById('check-volume-analysis')?.checked || false;

    // --- Precalculate ATR ---
    const atrPeriod = 14;
    let atrValues = new Float64Array(c.length);
    for (let i = atrPeriod; i < c.length; i++) {
        let trSum = 0;
        for (let j = 0; j < atrPeriod; j++) {
            const idx = i - j;
            const tr = Math.max(
                c[idx].high - c[idx].low,
                Math.abs(c[idx].high - c[idx - 1].close),
                Math.abs(c[idx].low - c[idx - 1].close)
            );
            trSum += tr;
        }
        atrValues[i] = trSum / atrPeriod;
    }

    // --- Average Volume ---
    let avgVolumes = null;
    if (useVolumeAnalysis) {
        avgVolumes = new Float64Array(c.length);
        const volPeriod = 20;
        for (let i = volPeriod; i < c.length; i++) {
            let volSum = 0;
            for (let j = 0; j < volPeriod; j++) {
                volSum += c[i - j].volume || 0;
            }
            avgVolumes[i] = volSum / volPeriod;
        }
    }

    let strategyTrades = [];
    const processedOBs = new Set();

    const brokenLines = allLines.filter(l => l.status === 'BROKEN');

    // Index zones for fast lookup
    const bullishOBs = state.zones.filter(z => z.type === 'OB' && z.id.includes('-l-'));
    const bearishOBs = state.zones.filter(z => z.type === 'OB' && z.id.includes('-s-'));
    const bullishFVGs = state.zones.filter(z => z.type === 'FVG' && z.id.includes('-l-'));
    const bearishFVGs = state.zones.filter(z => z.type === 'FVG' && z.id.includes('-s-'));

    const barTouchesZone = (bar, top, bottom) => {
        const zTop = Math.max(top, bottom);
        const zBottom = Math.min(top, bottom);
        return bar.low <= zTop && bar.high >= zBottom;
    };

    const findOBsAtTLTouches = (line, obs, toleranceBars = 5) => {
        if (!line.touchIndices || line.touchIndices.length === 0) return [];
        const matchedOBs = [];
        for (const ob of obs) {
            const obIdx = parseInt(ob.id.split('-')[2]);
            if (isNaN(obIdx)) continue;
            for (const touchIdx of line.touchIndices) {
                if (Math.abs(obIdx - touchIdx) <= toleranceBars) {
                    matchedOBs.push(ob);
                    break;
                }
            }
        }
        return matchedOBs;
    };

    const filterNearbyOBs = (obs, isShortTrap, proximityPct = 0.01) => {
        if (obs.length <= 1) return obs;
        const sorted = [...obs].sort((a, b) => {
            const midA = (a.top + a.bottom) / 2;
            const midB = (b.top + b.bottom) / 2;
            return midA - midB;
        });
        const selected = [];
        let i = 0;
        while (i < sorted.length) {
            const current = sorted[i];
            const currentMid = (current.top + current.bottom) / 2;
            let group = [current];
            let j = i + 1;
            while (j < sorted.length) {
                const nextMid = (sorted[j].top + sorted[j].bottom) / 2;
                const diff = Math.abs(nextMid - currentMid) / currentMid;
                if (diff <= proximityPct) {
                    group.push(sorted[j]);
                    j++;
                } else {
                    break;
                }
            }
            let best = group[0];
            for (const ob of group) {
                const obTop = Math.max(ob.top, ob.bottom);
                const obBottom = Math.min(ob.top, ob.bottom);
                const bestTop = Math.max(best.top, best.bottom);
                const bestBottom = Math.min(best.top, best.bottom);
                if (isShortTrap) {
                    if (obTop > bestTop) best = ob;
                } else {
                    if (obBottom < bestBottom) best = ob;
                }
            }
            selected.push(best);
            i = j;
        }
        return selected;
    };

    const analyzeEntryCandle = (bar, avgVol, isShortTrap) => {
        if (!useVolumeAnalysis) return { score: 0 };

        const body = Math.abs(bar.close - bar.open);
        const range = bar.high - bar.low;
        const volume = bar.volume || 0;

        const bodyRatio = range > 0 ? body / range : 0;
        const volRatio = avgVol > 0 ? volume / avgVol : 1;

        const upperWick = bar.high - Math.max(bar.open, bar.close);
        const lowerWick = Math.min(bar.open, bar.close) - bar.low;
        const wickRatio = range > 0 ? (isShortTrap ? upperWick : lowerWick) / range : 0;

        const signals = { absorption: false, rejection: false, highVolume: false, score: 0 };

        if (volRatio > 1.2 && bodyRatio < 0.4) {
            signals.absorption = true;
            signals.score += 2;
        }

        if (wickRatio > 0.5) {
            signals.rejection = true;
            signals.score += 2;
        }

        if (volRatio > 1.5) {
            signals.highVolume = true;
            signals.score += 1;
        }

        if (signals.absorption && signals.rejection) {
            signals.score += 2;
        }

        return signals;
    };

    // Parameters
    const atrMultiplierSL = 1.0;
    const atrMultiplierSL_ATR = 1.1;
    const lookaheadBars = 100;
    const obTouchTolerance = 5;
    const obProximityPct = 0.01;

    // Config based on mode
    let rrMultiplier = 2;
    let isATRMode = false;
    let isPartialMode = false;
    let tp1RR = 0, tp2RR = 0;

    if (mode === 'agro') {
        rrMultiplier = 3;
    } else if (mode === 'atr') {
        isATRMode = true;
        rrMultiplier = 2;
    } else if (mode === 'atr_agro') {
        isATRMode = true;
        rrMultiplier = 3;
    } else if (mode === 'atr_partial_1') {
        isATRMode = true;
        isPartialMode = true;
        tp1RR = 3;
        tp2RR = 5;
    } else if (mode === 'atr_partial_2') {
        isATRMode = true;
        isPartialMode = true;
        tp1RR = 2;
        tp2RR = 4;
    }

    for (const line of brokenLines) {
        const breakIdx = line.breakIndex;
        if (breakIdx == null || breakIdx <= 0 || breakIdx >= c.length) continue;

        const isShortTrap = (line.type === 'DOWN');
        const obs = isShortTrap ? bearishOBs : bullishOBs;
        const fvgs = isShortTrap ? bearishFVGs : bullishFVGs;
        const breakTime = c[breakIdx].time;

        const matchedOBs = findOBsAtTLTouches(line, obs, obTouchTolerance);

        if (matchedOBs.length === 0) continue;

        // Filter valid OBs
        const validOBs = matchedOBs.filter(ob => {
            const obIdx = parseInt(ob.id.split('-')[2]);
            if (obIdx >= breakIdx) return false;
            if (ob.endTime && ob.endTime < breakTime) return false;
            return true;
        });

        if (validOBs.length === 0) continue;

        const filteredOBs = filterNearbyOBs(validOBs, isShortTrap, obProximityPct);

        for (const ob of filteredOBs) {
            const obIdx = parseInt(ob.id.split('-')[2]);
            if (processedOBs.has(ob.id)) continue;

            const obTop = Math.max(ob.top, ob.bottom);
            const obBottom = Math.min(ob.top, ob.bottom);

            // Find associated FVG
            let associatedFvg = null;
            for (const fvg of fvgs) {
                const fvgIdx = parseInt(fvg.id.split('-')[2]);
                if (isNaN(fvgIdx) || fvgIdx >= breakIdx) continue;

                const dist = Math.abs(fvgIdx - obIdx);
                if (dist > 10) continue;

                if (fvg.endTime && fvg.endTime < breakTime) continue;

                if (!associatedFvg || dist < Math.abs(parseInt(associatedFvg.id.split('-')[2]) - obIdx)) {
                    associatedFvg = fvg;
                }
            }

            if (!associatedFvg) continue;

            let entryIdx = -1;
            let entryPrice = 0;
            let slPrice = 0;
            let entrySignals = null;

            if (isATRMode) {
                const atrAtBreak = atrValues[breakIdx] || (c[breakIdx].high - c[breakIdx].low);
                let limitOrderPrice;

                if (isShortTrap) {
                    limitOrderPrice = obTop + atrAtBreak;
                } else {
                    limitOrderPrice = obBottom - atrAtBreak;
                }

                for (let k = breakIdx + 1; k < Math.min(c.length, breakIdx + lookaheadBars); k++) {
                    const bar = c[k];

                    if ((isShortTrap && bar.high >= limitOrderPrice) || (!isShortTrap && bar.low <= limitOrderPrice)) {
                        entryIdx = k;
                        entryPrice = limitOrderPrice;
                        break;
                    }
                }

                if (entryIdx !== -1) {
                    const atrAtEntry = atrValues[entryIdx] || (c[entryIdx].high - c[entryIdx].low);
                    slPrice = isShortTrap ? entryPrice + (atrAtEntry * atrMultiplierSL_ATR) : entryPrice - (atrAtEntry * atrMultiplierSL_ATR);
                    if (useVolumeAnalysis) {
                        entrySignals = analyzeEntryCandle(c[entryIdx], avgVolumes?.[entryIdx] || 1, isShortTrap);
                    }
                }
            } else {
                for (let k = breakIdx + 1; k < Math.min(c.length, breakIdx + lookaheadBars); k++) {
                    if (barTouchesZone(c[k], ob.top, ob.bottom)) {
                        entryIdx = k;
                        break;
                    }
                }

                if (entryIdx === -1) continue;

                const entryBar = c[entryIdx];
                const validCloseCheck = isShortTrap ? entryBar.close <= obTop : entryBar.close >= obBottom;

                if (!validCloseCheck) continue;

                entryPrice = entryBar.close;
                const atrAtEntry = atrValues[entryIdx] || (entryBar.high - entryBar.low);
                slPrice = isShortTrap ? obTop + (atrAtEntry * atrMultiplierSL) : obBottom - (atrAtEntry * atrMultiplierSL);

                if (useVolumeAnalysis) {
                    entrySignals = analyzeEntryCandle(entryBar, avgVolumes?.[entryIdx] || 1, isShortTrap);
                }
            }

            if (entryIdx === -1) continue;

            // Volume filter
            if (useVolumeAnalysis && entrySignals && entrySignals.score < 2) {
                continue;
            }

            processedOBs.add(ob.id);

            const entryBar = c[entryIdx];
            const risk = Math.abs(entryPrice - slPrice);
            if (!isFinite(risk) || risk <= 0) continue;

            const tpPrice = isShortTrap ? entryPrice - rrMultiplier * risk : entryPrice + rrMultiplier * risk;
            const setupScore = (line.duration || 0) + (entrySignals ? entrySignals.score * 10 : 0);

            let outcome = 'OPEN';
            let exitTime = null;
            let pnlR = 0;
            let tpPriceForDisplay = tpPrice;
            let modeLabel = 'TL Trap';
            let tradeDesc = '';

            // --- PARTIAL MODE ---
            if (isPartialMode) {
                const tp1Price = isShortTrap ? entryPrice - tp1RR * risk : entryPrice + tp1RR * risk;
                const tp2Price = isShortTrap ? entryPrice - tp2RR * risk : entryPrice + tp2RR * risk;
                const bePrice = entryPrice;

                let currentSL = slPrice;
                let tp1Hit = false;
                let movedToBE = false;
                let partialPnL = 0;

                for (let k = entryIdx + 1; k < c.length; k++) {
                    const bar = c[k];
                    const maxFavorable = isShortTrap ? entryPrice - bar.low : bar.high - entryPrice;
                    const currentRR = maxFavorable / risk;

                    // Move to BE
                    if (!movedToBE && currentRR >= 1) {
                        currentSL = bePrice;
                        movedToBE = true;
                    }

                    const hitSL = isShortTrap ? bar.high >= currentSL : bar.low <= currentSL;
                    const hitTP1 = isShortTrap ? bar.low <= tp1Price : bar.high >= tp1Price;
                    const hitTP2 = isShortTrap ? bar.low <= tp2Price : bar.high >= tp2Price;

                    if (!tp1Hit && hitTP1) {
                        tp1Hit = true;
                        partialPnL += 0.5 * tp1RR;
                        currentSL = bePrice; // Secure BE
                    }

                    if (tp1Hit && hitTP2) {
                        partialPnL += 0.5 * tp2RR;
                        outcome = 'WIN';
                        exitTime = bar.time;
                        pnlR = partialPnL;
                        break;
                    }

                    if (hitSL) {
                        if (tp1Hit) {
                            pnlR = partialPnL;
                            outcome = 'WIN';
                        } else if (movedToBE) {
                            pnlR = 0;
                            outcome = 'BE';
                        } else {
                            pnlR = -1;
                            outcome = 'LOSS';
                        }
                        exitTime = bar.time;
                        break;
                    }
                }

                tpPriceForDisplay = tp2Price;
                modeLabel = 'TL Partial';
                tradeDesc = `${modeLabel} [${tp1RR}:1 + ${tp2RR}:1]`;

            } else {
                // --- SIMPLE MODE ---
                for (let k = entryIdx + 1; k < c.length; k++) {
                    const bar = c[k];
                    const hitSL = isShortTrap ? bar.high >= slPrice : bar.low <= slPrice;
                    const hitTP = isShortTrap ? bar.low <= tpPrice : bar.high >= tpPrice;

                    if (hitSL && hitTP) { outcome = 'LOSS'; exitTime = bar.time; pnlR = -1; break; }
                    else if (hitSL) { outcome = 'LOSS'; exitTime = bar.time; pnlR = -1; break; }
                    else if (hitTP) { outcome = 'WIN'; exitTime = bar.time; pnlR = rrMultiplier; break; }
                }

                if (mode === 'agro') modeLabel = 'TL Agro';
                else if (mode === 'atr') modeLabel = 'TL ATR';
                else if (mode === 'atr_agro') modeLabel = 'TL ATR Agro';

                tradeDesc = `${modeLabel} [${rrMultiplier}:1]`;
            }

            let signalTags = '';
            if (entrySignals) {
                if (entrySignals.absorption) signalTags += '🔄';
                if (entrySignals.rejection) signalTags += '📍';
                if (entrySignals.highVolume) signalTags += '📊';
            }

            strategyTrades.push({
                id: `trap-${mode}-${line.type}-${ob.id}`,
                time: entryBar.time,
                type: isShortTrap ? 'SHORT' : 'LONG',
                entry: entryPrice,
                sl: slPrice,
                tp: tpPriceForDisplay,
                outcome: outcome,
                status: outcome,
                pnl: pnlR,
                pnlPercent: pnlR,
                desc: `${tradeDesc} ${signalTags}`.trim(),
                entryTime: entryBar.time,
                exitTime: exitTime,
                setupScore: setupScore,
                entrySignals: entrySignals,
                savedOB: JSON.parse(JSON.stringify(ob)),
                savedFVG: JSON.parse(JSON.stringify(associatedFvg)),
                savedLine: JSON.parse(JSON.stringify(line))
            });
        }
    }

    // Sort by time, most recent first
    strategyTrades.sort((a, b) => b.time - a.time);

    state.trades = strategyTrades;
    if (typeof renderStratResults === 'function') renderStratResults(state.trades);
    if (typeof trendPrimitive !== 'undefined') trendPrimitive.setData(brokenLines.slice(-100));
}
