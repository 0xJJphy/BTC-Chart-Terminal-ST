<script>
    import { state, APP } from "../../lib/stores/app.js";
    import {
        executeStrategy,
        executeOptimizer,
        applyOptimizerSelection,
        replayTrade,
    } from "../../lib/logic/app_controller.js";

    let selectedStrat = "standard";
    let showOptimizer = false;

    function runBacktest() {
        executeStrategy(selectedStrat);
        showOptimizer = false;
    }

    function runOpt() {
        executeOptimizer();
        showOptimizer = true;
    }

    $: stats = (() => {
        if ($state.trades.length === 0) return null;
        const wins = $state.trades.filter((r) => r.status === "WIN" || (r.pnl && r.pnl > 0)).length;
        const total = $state.trades.length;
        const m = $state.pnlMetrics || {};
        return {
            count: total,
            wr: ((wins / total) * 100).toFixed(1),
            pnl: (m.realizedPnL || 0).toFixed(2),
            pf: (m.profitFactor || 0).toFixed(2),
            sharpe: (m.sharpe || 0).toFixed(2),
            sortino: (m.sortino || 0).toFixed(2),
            mdd: (m.maxDrawdown || 0).toFixed(1),
            expectancy: (m.expectancy !== undefined ? m.expectancy : 0).toFixed(2),
            payoff: (m.payoffRatio || 0).toFixed(2),
            calmar: (m.calmar || 0).toFixed(2)
        };
    })();
</script>

<div class="flex-1 flex flex-col overflow-hidden">
    <div class="p-4 border-b border-border bg-black/10 space-y-4">
        <div class="flex justify-between items-center">
            <h2 class="text-white font-bold text-xs uppercase tracking-widest">
                Strategy Lab
            </h2>
            <div class="flex items-center gap-3">
                <label class="flex items-center gap-1.5 cursor-pointer group" title="Run backtest on complete multi-year database (240k+ candles)">
                    <input
                        type="checkbox"
                        bind:checked={$state.fullHistoryBacktest}
                        class="hidden"
                    />
                    <div
                        class="w-3 h-3 border border-border rounded {$state.fullHistoryBacktest
                            ? 'bg-accent border-accent'
                            : ''} transition-all"
                    ></div>
                    <span
                        class="text-[9px] {$state.fullHistoryBacktest ? 'text-accent font-bold' : 'text-slate-500'} group-hover:text-accent uppercase transition-colors"
                        >All History (240k)</span
                    >
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer group">
                    <input
                        type="checkbox"
                        bind:checked={$state.useVolumeAnalysis}
                        class="hidden"
                    />
                    <div
                        class="w-3 h-3 border border-border rounded {$state.useVolumeAnalysis
                            ? 'bg-strat border-strat'
                            : ''} transition-all"
                    ></div>
                    <span
                        class="text-[9px] text-slate-500 group-hover:text-strat font-bold uppercase transition-colors"
                        >Vol Filter</span
                    >
                </label>
            </div>
        </div>

        <div class="space-y-2.5">
            <div>
                <label class="text-[8px] text-slate-500 font-bold uppercase mb-1 block">Strategy Algorithm</label>
                <select
                    bind:value={selectedStrat}
                    class="w-full bg-panel border border-border/80 text-white text-xs rounded-lg p-2.5 focus:border-accent outline-none font-mono cursor-pointer"
                >
                    <optgroup label="Multi-Factor Confluence Engines">
                        <option value="crypto_pro">👑 CRYPTO SMART PRO v2 (Confluence + Retest)</option>
                    </optgroup>
                    <optgroup label="Rule-Based Quantitative Models">
                        <option value="standard">EMA Trend Follower (50/200)</option>
                        <option value="scalp">Divergence Momentum Scalp</option>
                        <option value="reversal">Liquidity Sweep Mean-Reversion</option>
                        <option value="breakout">Volatility Compression Breakout</option>
                    </optgroup>
                </select>
            </div>

            <div class="flex gap-2">
                <button
                    on:click={runBacktest}
                    class="flex-1 bg-accent hover:bg-accent/80 text-white font-bold text-xs py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-accent/20 cursor-pointer"
                    title="Run Strategy Backtest"
                >
                    <i class="fas fa-play text-[10px]"></i>
                    <span class="tracking-wider">RUN BACKTEST</span>
                </button>
                <button
                    on:click={runOpt}
                    class="bg-strat/80 hover:bg-strat text-white text-xs py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-strat/20 cursor-pointer"
                    title="Run Parameter Optimizer"
                >
                    <i class="fas fa-microchip text-[10px]"></i>
                    <span class="text-[10px] font-bold">OPT</span>
                </button>
            </div>
        </div>

        {#if showOptimizer && $state.optimizerResults.length > 0}
            <div
                class="bg-black/30 rounded border border-border/50 overflow-hidden"
            >
                <table class="w-full text-[9px] text-left">
                    <thead
                        class="bg-panel/50 text-slate-500 uppercase font-bold"
                    >
                        <tr>
                            <th class="p-2">Config</th>
                            <th class="p-2">WR%</th>
                            <th class="p-2">PnL</th>
                            <th class="p-2">Load</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-border/30">
                        {#each $state.optimizerResults as res}
                            <tr class="hover:bg-white/5 transition-colors">
                                <td class="p-2 text-white font-mono"
                                    >{res.label}</td
                                >
                                <td
                                    class="p-2 {res.winRate > 50
                                        ? 'text-bull'
                                        : 'text-bear'}"
                                    >{res.winRate.toFixed(1)}%</td
                                >
                                <td
                                    class="p-2 {res.totalPnL > 0
                                        ? 'text-bull'
                                        : 'text-bear'}"
                                    >{res.totalPnL.toFixed(1)}R</td
                                >
                                <td class="p-2">
                                    <button
                                        on:click={() =>
                                            applyOptimizerSelection(res.key)}
                                        class="text-accent hover:text-white transition-colors"
                                    >
                                        <i class="fas fa-download"></i>
                                    </button>
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        {/if}

        {#if stats}
            <!-- Institutional Quant Metrics Grid -->
            <div class="space-y-1.5 bg-black/25 p-2.5 rounded-xl border border-border/40">
                <div class="text-[8px] font-bold text-slate-400 uppercase tracking-wider flex justify-between items-center">
                    <span>Performance Matrix</span>
                    <span class="text-accent font-mono">{stats.count} Trades</span>
                </div>
                <div class="grid grid-cols-4 gap-1.5 text-center">
                    <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                        <div class="text-[7.5px] text-slate-500 uppercase">Win Rate</div>
                        <div class="text-[9.5px] font-bold {parseFloat(stats.wr) >= 50 ? 'text-bull' : 'text-bear'}">
                            {stats.wr}%
                        </div>
                    </div>
                    <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                        <div class="text-[7.5px] text-slate-500 uppercase">Profit Factor</div>
                        <div class="text-[9.5px] font-bold {parseFloat(stats.pf) >= 1.5 ? 'text-bull' : 'text-slate-200'}">
                            {stats.pf}
                        </div>
                    </div>
                    <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                        <div class="text-[7.5px] text-slate-500 uppercase">Sharpe</div>
                        <div class="text-[9.5px] font-bold {parseFloat(stats.sharpe) >= 1.5 ? 'text-bull' : (parseFloat(stats.sharpe) >= 1.0 ? 'text-amber-400' : 'text-slate-300')}">
                            {stats.sharpe}
                        </div>
                    </div>
                    <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                        <div class="text-[7.5px] text-slate-500 uppercase">Sortino</div>
                        <div class="text-[9.5px] font-bold {parseFloat(stats.sortino) >= 2.0 ? 'text-bull' : 'text-slate-300'}">
                            {stats.sortino}
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-4 gap-1.5 text-center">
                    <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                        <div class="text-[7.5px] text-slate-500 uppercase">Max DD</div>
                        <div class="text-[9.5px] font-bold {parseFloat(stats.mdd) > 15 ? 'text-bear' : 'text-slate-300'}">
                            -{stats.mdd}%
                        </div>
                    </div>
                    <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                        <div class="text-[7.5px] text-slate-500 uppercase">Expectancy</div>
                        <div class="text-[9.5px] font-bold {parseFloat(stats.expectancy) >= 0 ? 'text-bull' : 'text-bear'}">
                            ${stats.expectancy}
                        </div>
                    </div>
                    <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                        <div class="text-[7.5px] text-slate-500 uppercase">Payoff (W/L)</div>
                        <div class="text-[9.5px] font-bold text-slate-200">
                            {stats.payoff}
                        </div>
                    </div>
                    <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                        <div class="text-[7.5px] text-slate-500 uppercase">Calmar</div>
                        <div class="text-[9.5px] font-bold text-slate-200">
                            {stats.calmar}
                        </div>
                    </div>
                </div>
            </div>
        {/if}

        <!-- CRYPTO SMART PRO v2 DASHBOARD TABLE -->
        {#if $state.cryptoProDashboard}
            {@const isTradeAudit = $state.isReplayMode && $state.selectedTrade?.dashboardSnapshot}
            {@const cp = isTradeAudit ? $state.selectedTrade.dashboardSnapshot : $state.cryptoProDashboard}
            <div class="bg-black/40 rounded-xl border {isTradeAudit ? 'border-amber-500/60 ring-1 ring-amber-500/30' : 'border-blue-500/40'} overflow-hidden shadow-2xl space-y-0 text-[9px] font-mono">
                <!-- HEADER -->
                <div class="{isTradeAudit ? 'bg-amber-950/40 border-amber-500/40 text-amber-300' : 'bg-blue-950/40 border-blue-500/40 text-blue-300'} px-3 py-2 border-b flex justify-between items-center">
                    <div class="flex items-center gap-1.5 font-bold uppercase tracking-wider">
                        <i class="fas {isTradeAudit ? 'fa-crosshairs text-amber-400' : 'fa-crown text-amber-400'}"></i> 
                        {isTradeAudit ? `TRADE SNAPSHOT (${$state.selectedTrade?.id})` : 'CRYPTO PRO V2'}
                    </div>
                    <div class="text-[8px] {isTradeAudit ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'bg-blue-500/20 text-blue-400 border-blue-500/30'} px-1.5 py-0.5 rounded border">
                        {isTradeAudit ? `${$state.selectedTrade?.type} @ $${$state.selectedTrade?.entry?.toFixed(1)}` : `${APP.interval} / 15D`}
                    </div>
                </div>

                <div class="divide-y divide-border/20 text-slate-300">
                    <!-- Signal & Strength -->
                    <div class="flex justify-between px-3 py-1 bg-black/20 font-bold">
                        <span class="text-slate-400">SEÑAL</span>
                        <span class="{cp.signal === 'LONG' ? 'text-bull font-extrabold' : cp.signal === 'SHORT' ? 'text-bear font-extrabold' : 'text-slate-400'}">
                            {cp.signal}
                        </span>
                    </div>

                    <div class="flex justify-between px-3 py-1">
                        <span class="text-slate-400">FUERZA</span>
                        <span class="text-white">L {cp.strengthLong.toFixed(0)} / S {cp.strengthShort.toFixed(0)}</span>
                    </div>

                    <div class="flex justify-between px-3 py-1">
                        <span class="text-slate-400">PROBABILIDAD</span>
                        <span class="text-bull">up {cp.probUp.toFixed(0)}% <span class="text-slate-500">/</span> <span class="text-bear">dn {cp.probDn.toFixed(0)}%</span></span>
                    </div>

                    <div class="flex justify-between px-3 py-1">
                        <span class="text-slate-400">REGIMEN ADX</span>
                        <span class="text-emerald-400 font-bold">{cp.adxValue.toFixed(1)} {cp.adxRegime}</span>
                    </div>

                    <div class="flex justify-between px-3 py-1">
                        <span class="text-slate-400">SESGO DI</span>
                        <span class="{cp.diBias.includes('ALCISTA') ? 'text-bull' : 'text-bear'}">{cp.diBias}</span>
                    </div>

                    <div class="flex justify-between px-3 py-1">
                        <span class="text-slate-400">MACD / RSI</span>
                        <span class="text-slate-200">{cp.macdState} <span class="text-slate-500">|</span> {cp.rsiValue.toFixed(1)} {cp.rsiState}</span>
                    </div>

                    <div class="flex justify-between px-3 py-1">
                        <span class="text-slate-400">VOLUMEN</span>
                        <span class="text-white">{cp.volumeRatio}x {cp.volumeState}</span>
                    </div>

                    <div class="flex justify-between px-3 py-1">
                        <span class="text-slate-400">TRAMPA</span>
                        <span class="{cp.trapState !== 'NINGUNA' ? 'text-amber-400 font-bold' : 'text-slate-400'}">{cp.trapState}</span>
                    </div>

                    <!-- Risk & Order Levels -->
                    <div class="flex justify-between px-3 py-1 bg-black/30 font-bold">
                        <span class="text-slate-400">ENTRADA / SL</span>
                        <span class="text-white">${cp.currentEntry.toFixed(2)} <span class="text-slate-500">|</span> <span class="text-bear">${cp.currentSl.toFixed(2)}</span></span>
                    </div>

                    <div class="flex justify-between px-3 py-1 bg-black/30">
                        <span class="text-slate-400">TP1 (50%) / TP2 / TP3</span>
                        <span class="text-bull">${cp.currentTp1.toFixed(0)} <span class="text-slate-500">/</span> ${cp.currentTp2.toFixed(0)} <span class="text-slate-500">/</span> ${cp.currentTp3.toFixed(0)}</span>
                    </div>

                    <!-- Global Stats -->
                    <div class="flex justify-between px-3 py-1 bg-blue-950/40 text-blue-300 font-bold">
                        <span>ESTADÍSTICAS</span>
                        <span>GLOBAL ({cp.totalTrades} OPS)</span>
                    </div>

                    <div class="flex justify-between px-3 py-1">
                        <span class="text-slate-400">GANADORAS / PERDEDORAS</span>
                        <span><span class="text-bull font-bold">{cp.winningTrades}</span> <span class="text-slate-500">/</span> <span class="text-bear font-bold">{cp.losingTrades}</span></span>
                    </div>

                    <div class="flex justify-between px-3 py-1">
                        <span class="text-slate-400">TP1 / TP2 / TP3 HITS</span>
                        <span class="text-slate-200">{cp.tp1Count} / {cp.tp2Count} / {cp.tp3Count}</span>
                    </div>

                    <div class="flex justify-between px-3 py-1 font-bold">
                        <span class="text-slate-400">WIN RATE GLOBAL</span>
                        <span class="{cp.winRate >= 50 ? 'text-bull' : 'text-bear'}">{cp.winRate.toFixed(1)}%</span>
                    </div>

                    <!-- Capital / PnL -->
                    <div class="flex justify-between px-3 py-1 bg-blue-950/40 text-blue-300 font-bold">
                        <span>CAPITAL / P&L</span>
                        <span class="{cp.totalPnl >= 0 ? 'text-bull' : 'text-bear'}">{cp.totalPnl >= 0 ? '+' : ''}${cp.totalPnl.toFixed(2)}</span>
                    </div>

                    <div class="flex justify-between px-3 py-1">
                        <span class="text-slate-400">CAPITAL ACTUAL</span>
                        <span class="text-white font-bold">${cp.currentCapital.toFixed(2)} <span class="text-[8px] text-slate-500">(Lev x{cp.leverage})</span></span>
                    </div>

                    <!-- Period Analysis -->
                    <div class="flex justify-between px-3 py-1 bg-blue-950/40 text-blue-300 font-bold">
                        <span>PERIODO ({cp.analysisDays} DÍAS)</span>
                        <span class="{cp.periodPnl >= 0 ? 'text-bull' : 'text-bear'}">{cp.periodPnl >= 0 ? '+' : ''}${cp.periodPnl.toFixed(2)}</span>
                    </div>

                    <div class="flex justify-between px-3 py-1">
                        <span class="text-slate-400">P&L / DÍA & WR PERIODO</span>
                        <span class="text-slate-200">${cp.pnlPerDay.toFixed(2)}/d <span class="text-slate-500">|</span> <span class="{cp.periodWinRate >= 50 ? 'text-bull' : 'text-bear'}">{cp.periodWinRate.toFixed(0)}%</span></span>
                    </div>

                    <div class="flex justify-between px-3 py-1 font-bold bg-black/40">
                        <span class="text-slate-400">ESTADO LIMIT</span>
                        <span class="{cp.limitStatus.includes('✓') ? 'text-bull' : 'text-amber-400'}">{cp.limitStatus}</span>
                    </div>
                </div>
            </div>
        {/if}
    </div>

    <div class="flex-1 overflow-y-auto custom-scroll p-2 space-y-2">
        {#each $state.trades.slice().sort((a, b) => (b.time || 0) - (a.time || 0)) as res}
            <div
                on:click={() => replayTrade(res)}
                class="bg-panel border border-border/50 p-3 rounded hover:border-accent transition-all cursor-pointer group flex justify-between items-center"
            >
                <div class="flex flex-col">
                    <div class="flex items-center gap-2">
                        <span
                            class="text-[9px] font-bold {res.type === 'LONG'
                                ? 'text-bull'
                                : 'text-bear'}"
                        >
                            {res.type}
                            {res.outcome || res.status}
                        </span>
                        <span class="text-[9px] text-slate-500 font-mono">
                            {new Date(res.time * 1000).toLocaleDateString()}
                        </span>
                    </div>
                    <div class="text-[10px] text-white font-medium mt-1">
                        {res.desc}
                    </div>
                </div>
                <div class="text-right">
                    <div
                        class="text-xs font-mono font-bold {res.pnl > 0
                            ? 'text-bull'
                            : 'text-bear'}"
                    >
                        {res.pnl > 0 ? "+" : ""}{res.pnl.toFixed(2)}R
                    </div>
                    <div class="text-[8px] text-slate-500">
                        Score: {res.setupScore?.toFixed(0) || 0}
                    </div>
                </div>
            </div>
        {:else}
            <div class="p-8 text-center space-y-4">
                <div
                    class="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mx-auto border border-border/30"
                >
                    <i class="fas fa-robot text-slate-600 text-xs"></i>
                </div>
                <div
                    class="text-[9px] text-slate-600 uppercase font-bold tracking-widest leading-relaxed"
                >
                    Estrategia no ejecutada o sin resultados.
                </div>
            </div>
        {/each}
    </div>
</div>
