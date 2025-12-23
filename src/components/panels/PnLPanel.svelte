<script>
    import { state } from "../../lib/stores/app.js";
    import { updatePnL } from "../../lib/logic/app_controller.js";

    $: metrics = $state.pnlMetrics || {};
    $: equity = $state.equityCurve || [];

    $: sparklinePoints =
        equity.length > 1
            ? (() => {
                  const values = equity.map((p) => p.value);
                  const min = Math.min(...values);
                  const max = Math.max(...values);
                  const range = max - min || 1;
                  const width = 300;
                  const height = 100;
                  return values
                      .map((v, i) => ({
                          x: (i / (values.length - 1)) * width,
                          y: height - ((v - min) / range) * height,
                      }))
                      .map((p) => `${p.x},${p.y}`)
                      .join(" ");
              })()
            : "";
</script>

<div class="flex-1 flex flex-col overflow-y-auto custom-scroll p-4 space-y-6">
    <div class="flex justify-between items-center">
        <h2 class="text-white font-bold text-xs uppercase tracking-widest">
            Performance
        </h2>
        <div class="flex items-center space-x-2">
            <span class="text-[9px] text-slate-500 uppercase font-bold"
                >Safe Mode</span
            >
            <div class="w-2 h-2 rounded-full bg-bull shadow-sm"></div>
        </div>
    </div>

    <!-- Account Settings -->
    <div class="bg-black/20 p-4 rounded-xl border border-border/40 space-y-4">
        <div>
            <label
                class="text-[9px] text-slate-500 font-bold uppercase mb-2 block"
                >Initial Balance</label
            >
            <div class="flex gap-2">
                <input
                    type="number"
                    bind:value={$state.initialBalance}
                    on:change={updatePnL}
                    class="flex-1 bg-bg border border-border rounded px-3 py-2 text-xs text-white font-mono outline-none focus:border-accent"
                />
            </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
            <div>
                <label
                    class="text-[9px] text-slate-500 font-bold uppercase mb-2 block"
                    >Maker %</label
                >
                <input
                    type="number"
                    step="0.01"
                    bind:value={$state.feeMaker}
                    on:change={updatePnL}
                    class="w-full bg-bg border border-border rounded px-3 py-2 text-xs text-white font-mono outline-none focus:border-accent"
                />
            </div>
            <div>
                <label
                    class="text-[9px] text-slate-500 font-bold uppercase mb-2 block"
                    >Taker %</label
                >
                <input
                    type="number"
                    step="0.01"
                    bind:value={$state.feeTaker}
                    on:change={updatePnL}
                    class="w-full bg-bg border border-border rounded px-3 py-2 text-xs text-white font-mono outline-none focus:border-accent"
                />
            </div>
        </div>
        <label class="flex items-center gap-2 cursor-pointer group">
            <input
                type="checkbox"
                bind:checked={$state.includeFees}
                on:change={updatePnL}
                class="hidden"
            />
            <div
                class="w-4 h-4 border border-border rounded {$state.includeFees
                    ? 'bg-accent border-accent'
                    : ''} transition-all flex items-center justify-center"
            >
                {#if $state.includeFees}<i
                        class="fas fa-check text-[8px] text-white"
                    ></i>{/if}
            </div>
            <span
                class="text-[10px] text-slate-400 group-hover:text-white transition-colors font-medium"
                >Apply Commission Fees</span
            >
        </label>
    </div>

    <!-- Stats Grid -->
    <div class="grid grid-cols-2 gap-2">
        <div class="bg-panel border border-border/50 p-3 rounded-lg">
            <div class="text-[9px] text-slate-500 uppercase font-bold mb-1">
                Realized
            </div>
            <div
                class="text-sm font-mono font-bold {metrics.realizedPnL >= 0
                    ? 'text-bull'
                    : 'text-bear'}"
            >
                ${metrics.realizedPnL?.toFixed(2) || "0.00"}
            </div>
        </div>
        <div class="bg-panel border border-border/50 p-3 rounded-lg">
            <div class="text-[9px] text-slate-500 uppercase font-bold mb-1">
                Floating
            </div>
            <div
                class="text-sm font-mono font-bold {metrics.unrealizedPnL >= 0
                    ? 'text-bull'
                    : 'text-bear'}"
            >
                ${metrics.unrealizedPnL?.toFixed(2) || "0.00"}
            </div>
        </div>
    </div>

    <div class="grid grid-cols-3 gap-2">
        <div class="metric-card">
            <span class="metric-label">PF</span><span
                class="metric-value font-mono"
                >{metrics.profitFactor?.toFixed(2) || "---"}</span
            >
        </div>
        <div class="metric-card">
            <span class="metric-label">WR%</span><span
                class="metric-value font-mono"
                >{metrics.winRate?.toFixed(1) || "---"}%</span
            >
        </div>
        <div class="metric-card">
            <span class="metric-label">DD%</span><span
                class="metric-value font-mono text-bear"
                >{metrics.maxDrawdown?.toFixed(2) || "---"}%</span
            >
        </div>
        <div class="metric-card">
            <span class="metric-label">Sharpe</span><span
                class="metric-value font-mono"
                >{metrics.sharpe?.toFixed(2) || "---"}</span
            >
        </div>
        <div class="metric-card">
            <span class="metric-label">Sortino</span><span
                class="metric-value font-mono"
                >{metrics.sortino?.toFixed(2) || "---"}</span
            >
        </div>
        <div class="metric-card">
            <span class="metric-label">Trades</span><span
                class="metric-value font-mono"
                >{metrics.totalTrades || "0"}</span
            >
        </div>
    </div>

    <!-- Sparkline -->
    <div class="space-y-2">
        <div
            class="text-[9px] text-slate-500 font-bold uppercase tracking-widest text-center border-t border-border/50 pt-4"
        >
            Equity Curve
        </div>
        <div
            class="h-24 w-full bg-black/20 rounded border border-border/30 flex flex-col justify-center p-2"
        >
            {#if sparklinePoints}
                <svg
                    viewBox="0 0 300 100"
                    class="w-full h-full overflow-visible"
                >
                    <polyline
                        fill="none"
                        stroke="#2962ff"
                        stroke-width="2"
                        points={sparklinePoints}
                    />
                </svg>
            {:else}
                <div class="text-[9px] text-slate-600 text-center italic">
                    No data to plot
                </div>
            {/if}
        </div>
    </div>
</div>
