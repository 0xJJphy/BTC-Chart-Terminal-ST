<script>
    import { state } from "../../lib/stores/app.js";
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
        const wins = $state.trades.filter((r) => r.status === "WIN").length;
        return {
            count: $state.trades.length,
            wr: ((wins / $state.trades.length) * 100).toFixed(1),
            pnl: ($state.pnlMetrics?.realizedPnL || 0).toFixed(2),
            pf: ($state.pnlMetrics?.profitFactor || 0).toFixed(2),
        };
    })();
</script>

<div class="flex-1 flex flex-col overflow-hidden">
    <div class="p-4 border-b border-border bg-black/10 space-y-4">
        <div class="flex justify-between items-center">
            <h2 class="text-white font-bold text-xs uppercase tracking-widest">
                Strategy Lab
            </h2>
            <div class="flex items-center gap-2">
                <label class="flex items-center gap-2 cursor-pointer group">
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

        <div class="space-y-2">
            <div class="flex gap-2">
                <select
                    bind:value={selectedStrat}
                    class="flex-1 bg-bg border border-border text-[10px] text-white rounded px-2 py-2 outline-none font-bold appearance-none cursor-pointer"
                >
                    <optgroup label="SMC Logic">
                        <option value="SMC">SMC Reversal (OB/FVG)</option>
                    </optgroup>
                    <optgroup label="Core Traps (Fixed R)">
                        <option value="standard">🏹 LIQUIDITY TRAP (2:1)</option
                        >
                        <option value="agro">🔥 TRAP AGGRESSIVE (3:1)</option>
                    </optgroup>
                    <optgroup label="Enhanced Traps (ATR)">
                        <option value="atr">🎯 ATR BASED TRAP (2:1)</option>
                        <option value="atr_agro">⚡ ATR AGGRO (3:1)</option>
                    </optgroup>
                    <optgroup label="Professional (Partial)">
                        <option value="atr_partial_1"
                            >💎 PARTIAL FILL [3:5]</option
                        >
                        <option value="atr_partial_2"
                            >📊 PARTIAL FILL [2:4]</option
                        >
                    </optgroup>
                </select>
                <button
                    on:click={runBacktest}
                    class="bg-accent hover:bg-accent/80 text-white p-2 rounded flex items-center justify-center transition-all shadow-lg shadow-accent/20"
                    title="Run Strategy"
                >
                    <i class="fas fa-play text-[10px]"></i>
                </button>
                <button
                    on:click={runOpt}
                    class="bg-strat hover:bg-strat/80 text-white p-2 rounded flex items-center justify-center transition-all shadow-lg shadow-strat/20"
                    title="Run Optimizer"
                >
                    <i class="fas fa-microchip text-[10px]"></i>
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
            <div class="grid grid-cols-4 gap-2">
                <div
                    class="bg-panel p-2 rounded border border-border/50 text-center"
                >
                    <div class="text-[8px] text-slate-500 uppercase">
                        Trades
                    </div>
                    <div class="text-[10px] font-bold text-white">
                        {stats.count}
                    </div>
                </div>
                <div
                    class="bg-panel p-2 rounded border border-border/50 text-center"
                >
                    <div class="text-[8px] text-slate-500 uppercase">Win%</div>
                    <div
                        class="text-[10px] font-bold {parseFloat(stats.wr) >= 50
                            ? 'text-bull'
                            : 'text-bear'}"
                    >
                        {stats.wr}%
                    </div>
                </div>
                <div
                    class="bg-panel p-2 rounded border border-border/50 text-center"
                >
                    <div class="text-[8px] text-slate-500 uppercase">
                        Profit
                    </div>
                    <div
                        class="text-[10px] font-bold {parseFloat(stats.pnl) >= 0
                            ? 'text-bull'
                            : 'text-bear'}"
                    >
                        {stats.pnl}R
                    </div>
                </div>
                <div
                    class="bg-panel p-2 rounded border border-border/50 text-center"
                >
                    <div class="text-[8px] text-slate-500 uppercase">PF</div>
                    <div class="text-[10px] font-bold text-white">
                        {stats.pf}
                    </div>
                </div>
            </div>
        {/if}
    </div>

    <div class="flex-1 overflow-y-auto custom-scroll p-2 space-y-2">
        {#each $state.trades as res}
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
