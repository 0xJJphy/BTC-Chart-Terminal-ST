<script>
    import { state, APP } from "../../lib/stores/app.js";
    import {
        replayTrade,
        runSelectedStrategy,
    } from "../../lib/logic/app_controller.js";

    function switchSubTab(tab) {
        state.update((s) => ({ ...s, activeTradeTab: tab }));
    }

    $: trades = $state.trades || [];
    $: ideas = trades.filter((t) => t.status === "PENDING");
    $: live = trades.filter((t) => t.status === "OPEN");
    $: history = trades.filter(
        (t) => t.status === "WIN" || t.status === "LOSS" || t.status === "BE",
    );
</script>

<div class="flex-1 flex flex-col">
    <div class="p-4 border-b border-border bg-black/10">
        <div class="flex justify-between items-center mb-4">
            <div class="flex flex-col gap-2">
                <h2
                    class="text-white font-bold text-xs uppercase tracking-widest"
                >
                    Trade Terminal
                </h2>
                <select
                    class="bg-black/40 border border-border/50 text-[10px] text-slate-300 rounded px-1 py-0.5 focus:outline-none focus:border-accent"
                    value={$state.activeStrategy}
                    on:change={(e) => runSelectedStrategy(e.target.value)}
                >
                    <option value="SMC">SMC ZONES</option>
                    <option value="TL_TRAP">TL TRAP (2R)</option>
                    <option value="TL_TRAP_AGRO">TL TRAP AGRO (3R)</option>
                    <option value="TL_TRAP_ATR">TL TRAP ATR (2R)</option>
                    <option value="TL_TRAP_ATR_AGRO"
                        >TL TRAP ATR AGRO (3R)</option
                    >
                    <option value="TL_TRAP_ATR_PARTIAL_1"
                        >TL PARTIAL (3R/5R)</option
                    >
                    <option value="TL_TRAP_ATR_PARTIAL_2"
                        >TL PARTIAL (2R/4R)</option
                    >
                </select>
            </div>
            <div class="flex items-center gap-1">
                <div
                    class="w-1.5 h-1.5 rounded-full bg-bull animate-pulse"
                ></div>
                <span
                    class="text-[9px] text-slate-500 font-bold uppercase tracking-tighter"
                    >Monitoring</span
                >
            </div>
        </div>
        <div class="grid grid-cols-3 gap-1">
            <button
                on:click={() => switchSubTab("ideas")}
                class="sub-tab {$state.activeTradeTab === 'ideas'
                    ? 'active'
                    : ''}"
            >
                IDEAS ({ideas.length})
            </button>
            <button
                on:click={() => switchSubTab("active")}
                class="sub-tab {$state.activeTradeTab === 'active'
                    ? 'active'
                    : ''}"
            >
                LIVE ({live.length})
            </button>
            <button
                on:click={() => switchSubTab("history")}
                class="sub-tab {$state.activeTradeTab === 'history'
                    ? 'active'
                    : ''}"
            >
                HISTORY ({history.length})
            </button>
        </div>
    </div>
    <div class="flex-1 overflow-y-auto custom-scroll p-2 space-y-2">
        {#if $state.activeTradeTab === "ideas"}
            {#each ideas as trade}
                <div
                    on:click={() => replayTrade(trade)}
                    class="bg-panel border border-border/50 p-3 rounded hover:border-accent transition-all cursor-pointer"
                >
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-[10px] font-bold text-accent"
                            >{trade.type} SETUP</span
                        >
                        <span class="text-[9px] text-slate-500 font-mono"
                            >{new Date(
                                trade.time * 1000,
                            ).toLocaleTimeString()}</span
                        >
                    </div>
                    <div class="text-[10px] text-white font-medium">
                        {trade.desc}
                    </div>
                </div>
            {:else}
                <div class="p-8 text-center text-xs text-slate-500 italic">
                    No trade ideas generated.
                </div>
            {/each}
        {:else if $state.activeTradeTab === "active"}
            {#each live as trade}
                <div
                    on:click={() => replayTrade(trade)}
                    class="bg-panel border border-accent/50 p-3 rounded hover:border-accent transition-all cursor-pointer"
                >
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-[10px] font-bold text-bull"
                            >{trade.type} LIVE</span
                        >
                        <div class="flex items-center gap-2">
                            <span
                                class="text-[10px] font-mono font-bold {trade.pnl >=
                                0
                                    ? 'text-bull'
                                    : 'text-bear'}"
                            >
                                {trade.pnl > 0 ? "+" : ""}{trade.pnl.toFixed(
                                    2,
                                )}R
                            </span>
                        </div>
                    </div>
                    <div class="text-[10px] text-white font-medium">
                        {trade.desc}
                    </div>
                </div>
            {:else}
                <div class="p-8 text-center text-xs text-slate-500 italic">
                    No active trades.
                </div>
            {/each}
        {:else}
            {#each history as trade}
                <div
                    on:click={() => replayTrade(trade)}
                    class="bg-panel/50 border border-border/30 p-3 rounded hover:border-slate-500 transition-all cursor-pointer"
                >
                    <div class="flex justify-between items-center mb-1">
                        <span
                            class="text-[10px] font-bold {trade.status === 'WIN'
                                ? 'text-bull'
                                : trade.status === 'LOSS'
                                  ? 'text-bear'
                                  : 'text-slate-400'}"
                        >
                            {trade.type}
                            {trade.status}
                        </span>
                        <span
                            class="text-[10px] font-mono font-bold {trade.pnl >
                            0
                                ? 'text-bull'
                                : trade.pnl < 0
                                  ? 'text-bear'
                                  : 'text-slate-400'}"
                        >
                            {trade.pnl > 0 ? "+" : ""}{trade.pnl.toFixed(2)}R
                        </span>
                    </div>
                    <div class="text-[10px] text-slate-400">{trade.desc}</div>
                </div>
            {:else}
                <div class="p-8 text-center text-xs text-slate-500 italic">
                    No trade history available.
                </div>
            {/each}
        {/if}
    </div>
</div>
