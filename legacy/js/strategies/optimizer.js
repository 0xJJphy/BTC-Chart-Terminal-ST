/**
 * Optimizer Module
 * Used to find the optimal Take Profit (TP) and Break Even (BE) triggers for the current strategy.
 */

/**
 * Runs a multi-parameter optimization over the historical candle data.
 */
function runOptimizer() {
    const listEl = document.getElementById('strat-results');
    if (listEl) listEl.innerHTML = '<div class="p-8 flex flex-col items-center justify-center space-y-4"><div class="spinner w-8 h-8"></div><div class="text-xs text-slate-400">Optimizing parameters...</div></div>';

    setTimeout(() => {
        if (typeof analyzeSMC === 'function') analyzeSMC(true);
        const allLines = typeof calculateTrendLines === 'function' ? calculateTrendLines(true) : [];
        const c = state.candles;
        const brokenLines = allLines.filter(l => l.status === 'BROKEN');

        // Setup base entries
        const baseTrades = [];
        const bullishOBs = state.zones.filter(z => z.type === 'OB' && z.id.includes('-l-'));
        const bearishOBs = state.zones.filter(z => z.type === 'OB' && z.id.includes('-s-'));
        const bullishFVGs = state.zones.filter(z => z.type === 'FVG' && z.id.includes('-l-'));
        const bearishFVGs = state.zones.filter(z => z.type === 'FVG' && z.id.includes('-s-'));

        // Precalculate ATR
        const atrPeriod = 14;
        let atrValues = new Float64Array(c.length);
        for (let i = atrPeriod; i < c.length; i++) {
            let trSum = 0;
            for (let j = 0; j < atrPeriod; j++) {
                const tr = Math.max(c[i - j].high - c[i - j].low, Math.abs(c[i - j].high - c[i - j - 1].close), Math.abs(c[i - j].low - c[i - j - 1].close));
                trSum += tr;
            }
            atrValues[i] = trSum / atrPeriod;
        }

        // Generate base trade entries (common to all tests)
        for (const line of brokenLines) {
            const isShort = line.type === 'DOWN';
            const breakIdx = line.breakIndex;
            const obs = isShort ? bearishOBs : bullishOBs;
            const fvgs = isShort ? bearishFVGs : bullishFVGs;

            // Find matched OB at break
            const ob = obs.find(z => {
                const zIdx = parseInt(z.id.split('-')[2]);
                return zIdx < breakIdx && (!z.endTime || z.endTime >= c[breakIdx].time);
            });
            if (!ob) continue;

            const fvg = fvgs.find(z => Math.abs(parseInt(z.id.split('-')[2]) - parseInt(ob.id.split('-')[2])) < 10);
            if (!fvg) continue;

            const atrAtBreak = atrValues[breakIdx];
            const entryPrice = isShort ? ob.top + atrAtBreak : ob.bottom - atrAtBreak;

            let entryIdx = -1;
            for (let k = breakIdx + 1; k < Math.min(c.length, breakIdx + 50); k++) {
                if ((isShort && c[k].high >= entryPrice) || (!isShort && c[k].low <= entryPrice)) {
                    entryIdx = k; break;
                }
            }
            if (entryIdx === -1) continue;

            const slPrice = isShort ? entryPrice + atrValues[entryIdx] * 1.1 : entryPrice - atrValues[entryIdx] * 1.1;
            baseTrades.push({ entryIdx, entryPrice, slPrice, isShort, risk: Math.abs(entryPrice - slPrice) });
        }

        // Brute force TP and BE
        const tpOptions = [1.5, 2, 2.5, 3, 4, 5];
        const beOptions = [0, 0.5, 1, 1.5, 2];
        let results = [];

        tpOptions.forEach(tpRR => {
            beOptions.forEach(beRR => {
                let totalPnL = 0, wins = 0, losses = 0, bes = 0;
                baseTrades.forEach(t => {
                    let outcome = 'OPEN', tradePnL = 0;
                    let currentSL = t.slPrice;
                    let movedToBE = false;

                    for (let k = t.entryIdx + 1; k < c.length; k++) {
                        const bar = c[k];
                        const mfe = t.isShort ? t.entryPrice - bar.low : bar.high - t.entryPrice;
                        const currentRR = mfe / t.risk;

                        if (beRR > 0 && !movedToBE && currentRR >= beRR) {
                            currentSL = t.entryPrice;
                            movedToBE = true;
                        }

                        const hitSL = t.isShort ? bar.high >= currentSL : bar.low <= currentSL;
                        const hitTP = t.isShort ? bar.low <= (t.entryPrice - tpRR * t.risk) : bar.high >= (t.entryPrice + tpRR * t.risk);

                        if (hitSL) {
                            if (movedToBE) { outcome = 'BE'; tradePnL = 0; bes++; }
                            else { outcome = 'LOSS'; tradePnL = -1; losses++; }
                            break;
                        }
                        if (hitTP) { outcome = 'WIN'; tradePnL = tpRR; wins++; break; }
                    }
                    totalPnL += tradePnL;
                });
                results.push({ tp: tpRR, be: beRR, pnl: totalPnL, wr: baseTrades.length > 0 ? (wins / baseTrades.length) * 100 : 0 });
            });
        });

        results.sort((a, b) => b.pnl - a.pnl);

        let html = `
            <div class="p-4 space-y-4">
                <div class="text-[10px] font-bold text-slate-500 uppercase flex justify-between">
                    <span>Optimization Results (${baseTrades.length} base samples)</span>
                    <span class="text-accent">Sorted by Total R</span>
                </div>
                <div class="grid grid-cols-1 gap-2">`;

        results.slice(0, 10).forEach((res, i) => {
            html += `
                <div class="bg-panel border border-border/50 p-2 rounded flex justify-between items-center ${i === 0 ? 'border-accent' : ''}">
                    <div class="flex flex-col">
                        <div class="text-xs font-bold text-white">TP: ${res.tp}R | BE: ${res.be > 0 ? res.be + 'R' : 'OFF'}</div>
                        <div class="text-[9px] text-slate-500">WinRate: ${res.wr.toFixed(1)}%</div>
                    </div>
                    <div class="text-right">
                        <div class="text-sm font-mono font-bold ${res.pnl > 0 ? 'text-bull' : 'text-bear'}">${res.pnl > 0 ? '+' : ''}${res.pnl.toFixed(1)}R</div>
                    </div>
                </div>`;
        });

        html += `</div></div>`;
        if (listEl) listEl.innerHTML = html;
        if (typeof addToLog === 'function') addToLog(`Optimization finished. Best: TP ${results[0].tp}R, BE ${results[0].be}R`);
    }, 100);
}

/**
 * Adds the Optimizer to the strategy selector if not present.
 */
function addOptimizerToSelector() {
    const sel = document.getElementById('strat-select');
    if (sel && !Array.from(sel.options).some(o => o.value === 'optimizer')) {
        const opt = document.createElement('option');
        opt.value = 'optimizer';
        opt.text = '🚀 PARAM OPTIMIZER';
        sel.add(opt);
    }
}
