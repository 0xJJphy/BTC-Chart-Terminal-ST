/**
 * Liquidity and Strategy Module
 * Strict parity with terminal.html runLiquidityStrategy engine.
 */

import { analyzeSMC } from './smc.js';
import { calculateTrendLines } from './indicators.js';

export function runLiquidityStrategy(candles, mode = 'standard', options = {}) {
    const collectOnly = !!options.collectOnly;
    if (!candles || candles.length === 0) return collectOnly ? { trades: [], brokenLines: [] } : [];

    // 1. Analyze Core elements (Zones and Lines)
    const { zones } = analyzeSMC(candles, { ...options.config, keepTrades: true });
    const allLines = calculateTrendLines(candles, options.config);

    const useVolumeAnalysis = options.useVolumeAnalysis || false;

    // 2. Precalculate ATR for strategy
    const atrPeriod = 14;
    let atrValues = new Float64Array(candles.length);
    for (let i = atrPeriod; i < candles.length; i++) {
        let trSum = 0;
        for (let j = 0; j < atrPeriod; j++) {
            const idx = i - j;
            const tr = Math.max(
                candles[idx].high - candles[idx].low,
                Math.abs(candles[idx].high - candles[idx - 1].close),
                Math.abs(candles[idx].low - candles[idx - 1].close)
            );
            trSum += tr;
        }
        atrValues[i] = trSum / atrPeriod;
    }

    // 3. AVG Volume if needed
    let avgVolumes = null;
    if (useVolumeAnalysis) {
        avgVolumes = new Float64Array(candles.length);
        const volPeriod = 20;
        for (let i = volPeriod; i < candles.length; i++) {
            let volSum = 0;
            for (let j = 1; j <= volPeriod; j++) {
                volSum += candles[i - j].volume || 0;
            }
            avgVolumes[i] = volSum / volPeriod;
        }
    }

    const brokenLines = allLines.filter(l => l.status === 'BROKEN');
    const bullishOBs = zones.filter(z => z.label === 'OB' && z.type === 'BULL');
    const bearishOBs = zones.filter(z => z.label === 'OB' && z.type === 'BEAR');
    const bullishFVGs = zones.filter(z => z.label === 'FVG' && z.type === 'BULL');
    const bearishFVGs = zones.filter(z => z.label === 'FVG' && z.type === 'BEAR');

    const barTouchesZone = (bar, top, bottom) => {
        const zTop = Math.max(top, bottom);
        const zBottom = Math.min(top, bottom);
        return bar.low <= zTop && bar.high >= zBottom;
    };

    const findOBsAtTLTouches = (line, obs, toleranceBars = 5) => {
        if (!line.touchIndices || line.touchIndices.length === 0) return [];
        const matchedOBs = [];
        for (const ob of obs) {
            // ob.id format is "ob-l-INDEX"
            const parts = ob.id.split('-');
            const obIdx = parseInt(parts[parts.length - 1]);
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
                if (isShortTrap) {
                    if (ob.top > best.top) best = ob;
                } else {
                    if (ob.bottom < best.bottom) best = ob;
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
        if (volRatio > 1.2 && bodyRatio < 0.4) { signals.absorption = true; signals.score += 2; }
        if (wickRatio > 0.5) { signals.rejection = true; signals.score += 2; }
        if (volRatio > 1.5) { signals.highVolume = true; signals.score += 1; }
        if (signals.absorption && signals.rejection) signals.score += 2;
        return signals;
    };

    let rrMultiplier = 2;
    let isATRMode = false;
    let isPartialMode = false;
    let tp1RR = 0, tp2RR = 0;

    if (mode === 'agro') { rrMultiplier = 3; }
    else if (mode === 'atr') { isATRMode = true; rrMultiplier = 2; }
    else if (mode === 'atr_agro') { isATRMode = true; rrMultiplier = 3; }
    else if (mode === 'atr_partial_1') { isATRMode = true; isPartialMode = true; tp1RR = 3; tp2RR = 5; }
    else if (mode === 'atr_partial_2') { isATRMode = true; isPartialMode = true; tp1RR = 2; tp2RR = 4; }

    let strategyTrades = [];
    const processedOBs = new Set();
    const lookaheadBars = 100;
    const obTouchTolerance = 5;
    const obProximityPct = 0.01;
    const atrMultiplierSL = 1.0;
    const atrMultiplierSL_ATR = 1.1;

    for (const line of brokenLines) {
        const breakIdx = line.breakIndex;
        if (breakIdx == null || breakIdx <= 0 || breakIdx >= candles.length) continue;

        const isShortTrap = (line.type === 'DOWN');
        const obs = isShortTrap ? bearishOBs : bullishOBs;
        const fvgs = isShortTrap ? bearishFVGs : bullishFVGs;
        const breakTime = candles[breakIdx].time;

        const matchedOBs = findOBsAtTLTouches(line, obs, obTouchTolerance);
        if (matchedOBs.length === 0) continue;

        const validOBs = matchedOBs.filter(ob => {
            const parts = ob.id.split('-');
            const obIdx = parseInt(parts[parts.length - 1]);
            if (obIdx >= breakIdx) return false;
            // original logic: if (ob.endTime && ob.endTime < breakTime) return false;
            // Meaning if it was mitigated BEFORE the break, it's not a fresh trap
            if (ob.endTime && ob.endTime < breakTime) return false;
            return true;
        });

        if (validOBs.length === 0) continue;
        const filteredOBs = filterNearbyOBs(validOBs, isShortTrap, obProximityPct);

        for (const ob of filteredOBs) {
            if (processedOBs.has(ob.id)) continue;
            const parts = ob.id.split('-');
            const obIdx = parseInt(parts[parts.length - 1]);

            const obTop = Math.max(ob.top, ob.bottom);
            const obBottom = Math.min(ob.top, ob.bottom);

            // Find associated FVG
            let associatedFvg = null;
            for (const fvg of fvgs) {
                const fvgParts = fvg.id.split('-');
                const fvgIdx = parseInt(fvgParts[fvgParts.length - 1]);
                if (isNaN(fvgIdx) || fvgIdx >= breakIdx) continue;
                const dist = Math.abs(fvgIdx - obIdx);
                if (dist > 10) continue;
                if (fvg.endTime && fvg.endTime < breakTime) continue;
                if (!associatedFvg || dist < Math.abs(parseInt(associatedFvg.id.split('-')[associatedFvg.id.split('-').length - 1]) - obIdx)) {
                    associatedFvg = fvg;
                }
            }
            if (!associatedFvg) continue;

            let entryIdx = -1;
            let entryPrice = 0;
            let slPrice = 0;
            let entrySignals = null;

            if (isATRMode) {
                const atrAtBreak = atrValues[breakIdx] || (candles[breakIdx].high - candles[breakIdx].low);
                let limitOrderPrice = isShortTrap ? (obTop + atrAtBreak) : (obBottom - atrAtBreak);

                for (let k = breakIdx + 1; k < Math.min(candles.length, breakIdx + lookaheadBars); k++) {
                    const bar = candles[k];
                    if ((isShortTrap && bar.high >= limitOrderPrice) || (!isShortTrap && bar.low <= limitOrderPrice)) {
                        entryIdx = k;
                        entryPrice = limitOrderPrice;
                        break;
                    }
                }
                if (entryIdx !== -1) {
                    const atrAtEntry = atrValues[entryIdx] || (candles[entryIdx].high - candles[entryIdx].low);
                    slPrice = isShortTrap ? entryPrice + (atrAtEntry * atrMultiplierSL_ATR) : entryPrice - (atrAtEntry * atrMultiplierSL_ATR);
                }
            } else {
                for (let k = breakIdx + 1; k < Math.min(candles.length, breakIdx + lookaheadBars); k++) {
                    if (barTouchesZone(candles[k], ob.top, ob.bottom)) {
                        entryIdx = k;
                        break;
                    }
                }
                if (entryIdx !== -1) {
                    const entryBar = candles[entryIdx];
                    const validClose = isShortTrap ? entryBar.close <= obTop : entryBar.close >= obBottom;
                    if (!validClose) { entryIdx = -1; }
                    else {
                        entryPrice = entryBar.close;
                        const atrAtEntry = atrValues[entryIdx] || (entryBar.high - entryBar.low);
                        slPrice = isShortTrap ? obTop + (atrAtEntry * atrMultiplierSL) : obBottom - (atrAtEntry * atrMultiplierSL);
                    }
                }
            }

            if (entryIdx === -1) continue;
            if (useVolumeAnalysis) {
                entrySignals = analyzeEntryCandle(candles[entryIdx], avgVolumes?.[entryIdx] || 1, isShortTrap);
                if (entrySignals.score < 2) continue;
            }

            processedOBs.add(ob.id);
            const risk = Math.abs(entryPrice - slPrice);
            if (risk <= 0) continue;

            const tpPrice = isShortTrap ? entryPrice - rrMultiplier * risk : entryPrice + rrMultiplier * risk;
            let outcome = 'OPEN', exitTime = null, pnlR = 0, tpPriceForDisplay = tpPrice, modeLabel = 'TL Trap', tradeDesc = '';

            if (isPartialMode) {
                const tp1Price = isShortTrap ? entryPrice - tp1RR * risk : entryPrice + tp1RR * risk;
                const tp2Price = isShortTrap ? entryPrice - tp2RR * risk : entryPrice + tp2RR * risk;
                const bePrice = entryPrice;
                let currentSL = slPrice, tp1Hit = false, movedToBE = false, partialPnL = 0;

                for (let k = entryIdx + 1; k < candles.length; k++) {
                    const bar = candles[k];
                    const maxFavorable = isShortTrap ? entryPrice - bar.low : bar.high - entryPrice;
                    const currentRR = maxFavorable / risk;
                    if (!movedToBE && currentRR >= 1) { currentSL = bePrice; movedToBE = true; }
                    const hitSL = isShortTrap ? bar.high >= currentSL : bar.low <= currentSL;
                    const hitTP1 = isShortTrap ? bar.low <= tp1Price : bar.high >= tp1Price;
                    const hitTP2 = isShortTrap ? bar.low <= tp2Price : bar.high >= tp2Price;

                    if (!tp1Hit && hitTP1) { tp1Hit = true; partialPnL += 0.5 * tp1RR; currentSL = bePrice; }
                    if (tp1Hit && hitTP2) { partialPnL += 0.5 * tp2RR; outcome = 'WIN'; exitTime = bar.time; pnlR = partialPnL; break; }
                    if (hitSL) {
                        if (tp1Hit) { pnlR = partialPnL; outcome = 'WIN'; }
                        else if (movedToBE) { pnlR = 0; outcome = 'BE'; }
                        else { pnlR = -1; outcome = 'LOSS'; }
                        exitTime = bar.time; break;
                    }
                }
                tpPriceForDisplay = tp2Price; modeLabel = 'TL Parcial'; tradeDesc = `${modeLabel} [${tp1RR}:1 + ${tp2RR}:1]`;
            } else {
                for (let k = entryIdx + 1; k < candles.length; k++) {
                    const bar = candles[k];
                    const hitSL = isShortTrap ? bar.high >= slPrice : bar.low <= slPrice;
                    const hitTP = isShortTrap ? bar.low <= tpPrice : bar.high >= tpPrice;
                    if (hitSL) { outcome = 'LOSS'; exitTime = bar.time; pnlR = -1; break; }
                    if (hitTP) { outcome = 'WIN'; exitTime = bar.time; pnlR = rrMultiplier; break; }
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
                time: candles[entryIdx].time,
                type: isShortTrap ? 'SHORT' : 'LONG',
                entry: entryPrice,
                sl: slPrice,
                tp: tpPriceForDisplay,
                status: outcome === 'BE' ? 'WIN' : (outcome === 'OPEN' ? 'OPEN' : outcome),
                pnl: pnlR,
                pnlPercent: pnlR,
                desc: `${tradeDesc} ${signalTags}`.trim(),
                signalTime: breakTime,
                entryTime: candles[entryIdx].time,
                exitTime: exitTime,
                setupScore: (line.duration || 0) + (entrySignals ? entrySignals.score * 10 : 0),
                savedOB: JSON.parse(JSON.stringify(ob)),
                savedFVG: JSON.parse(JSON.stringify(associatedFvg)),
                savedLine: JSON.parse(JSON.stringify(line)),
                outcome: outcome
            });
        }
    }

    strategyTrades.sort((a, b) => b.time - a.time);
    return collectOnly ? { trades: strategyTrades, brokenLines } : strategyTrades;
}

export function runOptimizer(candles, options = {}) {
    if (!candles || candles.length === 0) return [];

    const configs = [
        { key: 'standard', label: 'TL Trap 2R', rr: '2R', be: 'N/A' },
        { key: 'agro', label: 'TL Trap 3R', rr: '3R', be: 'N/A' },
        { key: 'atr', label: 'TL ATR 2R', rr: '2R', be: 'N/A' },
        { key: 'atr_agro', label: 'TL ATR 3R', rr: '3R', be: 'N/A' },
        { key: 'atr_partial_1', label: 'TL Parcial 3R + 5R', rr: '3R + 5R', be: '1R' },
        { key: 'atr_partial_2', label: 'TL Parcial 2R + 4R', rr: '2R + 4R', be: '1R' }
    ];

    const results = [];
    for (const cfg of configs) {
        const res = runLiquidityStrategy(candles, cfg.key, { ...options, collectOnly: true });
        const trades = res.trades || [];
        const wins = trades.filter(t => t.status === 'WIN').length;
        const losses = trades.filter(t => t.status === 'LOSS').length;
        const totalPnL = trades.reduce((s, t) => s + (t.pnl || 0), 0);
        const wr = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
        const grossProfit = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
        const grossLoss = trades.filter(t => t.pnl < 0).reduce((s, t) => s + Math.abs(t.pnl), 0);
        const pf = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 999 : 0);

        results.push({
            ...cfg,
            trades,
            total: trades.length,
            wins,
            losses,
            winRate: wr,
            totalPnL,
            profitFactor: pf
        });
    }
    return results;
}
