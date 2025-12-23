/**
 * Strategies Module
 * Coordinator for running different strategy backtests and rendering results.
 */

/**
 * Runs the currently selected strategy in the UI.
 */
function runSelectedStrategy() {
    const sel = document.getElementById('strat-select');
    const mode = sel ? sel.value : 'standard';

    if (mode === 'optimizer') {
        if (typeof runOptimizer === 'function') runOptimizer();
        return;
    }

    if (typeof runLiquidityStrategy === 'function') runLiquidityStrategy(mode);
}

/**
 * Renders backtest results in the strategy panel.
 * @param {Array} trades - Array of backtested trade results.
 */
function renderStratResults(trades) {
    const listEl = document.getElementById('strat-results');
    if (!listEl) return;

    if (trades.length === 0) {
        listEl.innerHTML = '<div class="p-8 text-center text-xs text-slate-500 italic">No trades found for current configuration.</div>';
        return;
    }

    const wins = trades.filter(t => t.status === 'WIN').length;
    const losses = trades.filter(t => t.status === 'LOSS').length;
    const netR = trades.reduce((a, b) => a + (b.pnl || 0), 0);
    const wr = (wins / (wins + losses)) * 100;

    let html = `
        <div class="p-4 space-y-4">
            <div class="grid grid-cols-3 gap-2">
                <div class="bg-panel p-2 rounded border border-border/50 text-center">
                    <div class="text-[9px] text-slate-500 uppercase">Trades</div>
                    <div class="text-xs font-bold text-white">${trades.length}</div>
                </div>
                <div class="bg-panel p-2 rounded border border-border/50 text-center">
                    <div class="text-[9px] text-slate-500 uppercase">WinRate</div>
                    <div class="text-xs font-bold ${wr >= 50 ? 'text-bull' : 'text-bear'}">${wr.toFixed(1)}%</div>
                </div>
                <div class="bg-panel p-2 rounded border border-border/50 text-center">
                    <div class="text-[9px] text-slate-500 uppercase">Total R</div>
                    <div class="text-xs font-bold ${netR >= 0 ? 'text-bull' : 'text-bear'}">${netR.toFixed(1)}R</div>
                </div>
            </div>
            
            <div class="space-y-2">
                <div class="text-[10px] font-bold text-slate-500 uppercase">Recent Setups</div>
                <div class="grid grid-cols-1 gap-2">
    `;

    trades.forEach(t => {
        const pnlCol = t.pnl > 0 ? 'text-bull' : (t.pnl < 0 ? 'text-bear' : 'text-slate-500');
        const setupType = t.desc || t.type;

        html += `
            <div id="strat-card-${t.id}" 
                 class="strat-card bg-panel border border-border/50 p-3 rounded hover:border-slate-400 cursor-pointer flex justify-between items-center"
                 onclick="replayStratTrade('${t.id}')">
                <div class="flex flex-col">
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] font-bold ${t.type === 'LONG' ? 'text-bull' : 'text-bear'}">${t.type}</span>
                        <span class="text-[10px] text-white font-medium">${setupType}</span>
                    </div>
                    <div class="text-[9px] text-slate-500 mt-1">${new Date(t.time * 1000).toLocaleString()}</div>
                </div>
                <div class="text-right">
                    <div class="text-xs font-mono font-bold ${pnlCol}">${t.pnl > 0 ? '+' : ''}${t.pnl.toFixed(1)}R</div>
                    <div class="text-[9px] text-slate-500">${t.status}</div>
                </div>
            </div>
        `;
    });

    html += `</div></div></div>`;
    listEl.innerHTML = html;
}

/**
 * Updates the strategy choice based on UI interaction.
 */
function updateTradeStrategy() {
    const sel = document.getElementById('trade-strat-select');
    if (!sel) return;

    if (sel.value === 'SMC') {
        if (typeof analyzeSMC === 'function') analyzeSMC();
    } else {
        if (typeof runLiquidityStrategy === 'function') runLiquidityStrategy();
    }
}
