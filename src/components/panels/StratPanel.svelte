<script>
    import { state, APP } from "../../lib/stores/app.js";
    import {
        executeStrategy,
        executeOptimizer,
        applyOptimizerSelection,
        replayTrade,
        runCostSweep,
        updateStrategyParams,
    } from "../../lib/logic/app_controller.js";
    import {
        PARAM_SCHEMA,
        PARAM_GROUPS,
        COST_MODES,
        defaultStrategyParams,
    } from "../../lib/config/strategies.js";

    // Only strategies the engine actually implements. The old dropdown offered
    // "scalp", "reversal" and "breakout", none of which runLiquidityStrategy knows -
    // they silently fell through to "standard".
    const STRATEGIES = [
        { value: "crypto_pro", label: "CRYPTO SMART PRO v2 (Confluence + Retest)", group: "Multi-factor" },
        { value: "standard", label: "TL Trap 2R (Liquidity Sweep)", group: "Rule-based" },
        { value: "agro", label: "TL Trap 3R (Aggressive)", group: "Rule-based" },
        { value: "atr", label: "TL ATR 2R (Dynamic Stop)", group: "Rule-based" },
        { value: "atr_agro", label: "TL ATR 3R (Dynamic Stop)", group: "Rule-based" },
        { value: "atr_partial_1", label: "TL ATR Partials 3R/5R", group: "Rule-based" },
        { value: "atr_partial_2", label: "TL ATR Partials 2R/4R", group: "Rule-based" },
    ];

    let selectedStrat = "crypto_pro";
    let showOptimizer = false;
    let showParams = false;
    let openGroup = "Riesgo";

    $: params = $state.strategyParams;
    $: m = $state.pnlMetrics || {};
    $: isPro = selectedStrat === "crypto_pro";
    $: sweep = $state.costSensitivity || [];

    function runBacktest() {
        executeStrategy(selectedStrat);
        showOptimizer = false;
    }

    function runOpt() {
        executeOptimizer();
        showOptimizer = true;
    }

    function setParam(key, value) {
        updateStrategyParams({ [key]: value });
    }

    function setCost(key, value) {
        updateStrategyParams({ costs: { [key]: value } });
    }

    function resetParams() {
        state.update((s) => ({ ...s, strategyParams: defaultStrategyParams() }));
    }

    const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
    const pct = (v, d = 1) => (Number.isFinite(v) ? `${v.toFixed(d)}%` : "—");
    const money = (v, d = 2) =>
        Number.isFinite(v) ? `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(d)}` : "—";

    // Colour thresholds. A ratio is only "good" if it clears a bar that means something.
    const tone = (v, good, ok) =>
        !Number.isFinite(v) ? "text-slate-500" : v >= good ? "text-bull" : v >= ok ? "text-amber-400" : "text-bear";

    $: breakevenBps = sweep.find((p) => p.pnlUsd <= 0);

    $: sweepPath = (() => {
        if (sweep.length < 2) return "";
        const xs = sweep.map((p) => p.perSideBps);
        const ys = sweep.map((p) => p.sharpe);
        const xMin = Math.min(...xs), xMax = Math.max(...xs);
        const yMin = Math.min(...ys, 0), yMax = Math.max(...ys, 0);
        const xR = xMax - xMin || 1, yR = yMax - yMin || 1;
        return sweep
            .map((p, i) => {
                const x = ((p.perSideBps - xMin) / xR) * 260;
                const y = 60 - ((p.sharpe - yMin) / yR) * 60;
                return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ");
    })();

    $: zeroLineY = (() => {
        if (sweep.length < 2) return 30;
        const ys = sweep.map((p) => p.sharpe);
        const yMin = Math.min(...ys, 0), yMax = Math.max(...ys, 0);
        const yR = yMax - yMin || 1;
        return 60 - ((0 - yMin) / yR) * 60;
    })();
</script>

<div class="flex-1 flex flex-col overflow-hidden">
    <div class="flex-1 overflow-y-auto custom-scroll">
        <div class="p-4 border-b border-border bg-black/10 space-y-4">
            <div class="flex justify-between items-center">
                <h2 class="text-white font-bold text-xs uppercase tracking-widest">Strategy Lab</h2>
                <label class="flex items-center gap-1.5 cursor-pointer group" title="Backtest sobre la base histórica completa">
                    <input type="checkbox" bind:checked={$state.fullHistoryBacktest} class="hidden" />
                    <div class="w-3 h-3 border border-border rounded {$state.fullHistoryBacktest ? 'bg-accent border-accent' : ''} transition-all"></div>
                    <span class="text-[9px] {$state.fullHistoryBacktest ? 'text-accent font-bold' : 'text-slate-500'} uppercase transition-colors">All History</span>
                </label>
            </div>

            <div>
                <label class="text-[8px] text-slate-500 font-bold uppercase mb-1 block">Algoritmo</label>
                <select
                    bind:value={selectedStrat}
                    class="w-full bg-panel border border-border/80 text-white text-xs rounded-lg p-2.5 focus:border-accent outline-none font-mono cursor-pointer"
                >
                    <optgroup label="Multi-Factor Confluence Engines">
                        {#each STRATEGIES.filter((s) => s.group === "Multi-factor") as s}
                            <option value={s.value}>{s.label}</option>
                        {/each}
                    </optgroup>
                    <optgroup label="Rule-Based Quantitative Models">
                        {#each STRATEGIES.filter((s) => s.group === "Rule-based") as s}
                            <option value={s.value}>{s.label}</option>
                        {/each}
                    </optgroup>
                </select>
            </div>

            <div class="flex gap-2">
                <button
                    on:click={runBacktest}
                    disabled={$state.isBacktesting}
                    class="flex-1 bg-accent hover:bg-accent/80 disabled:opacity-40 text-white font-bold text-xs py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-accent/20 cursor-pointer"
                >
                    <i class="fas {$state.isBacktesting ? 'fa-spinner fa-spin' : 'fa-play'} text-[10px]"></i>
                    <span class="tracking-wider">{$state.isBacktesting ? "RUNNING" : "RUN BACKTEST"}</span>
                </button>
                <button on:click={runOpt} class="bg-strat/80 hover:bg-strat text-white text-xs py-2 px-3 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer" title="Parameter optimizer">
                    <i class="fas fa-microchip text-[10px]"></i>
                    <span class="text-[10px] font-bold">OPT</span>
                </button>
                <button on:click={() => (showParams = !showParams)} class="bg-panel border border-border hover:border-accent text-slate-300 text-xs py-2 px-3 rounded-lg transition-all cursor-pointer" title="Parámetros">
                    <i class="fas fa-sliders text-[10px]"></i>
                </button>
            </div>

            <!-- COST MODEL -->
            {#if isPro}
                <div class="bg-black/25 rounded-xl border border-border/40 p-2.5 space-y-2">
                    <div class="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Modelo de costes</div>
                    <select
                        value={params.costs.mode}
                        on:change={(e) => setCost("mode", e.target.value)}
                        class="w-full bg-panel border border-border/80 text-white text-[10px] rounded p-1.5 outline-none focus:border-accent font-mono cursor-pointer"
                    >
                        {#each COST_MODES as c}<option value={c.id}>{c.label}</option>{/each}
                    </select>
                    <div class="text-[8px] text-slate-500 leading-snug">
                        {COST_MODES.find((c) => c.id === params.costs.mode)?.hint}
                    </div>

                    {#if params.costs.mode === "flat"}
                        <label class="flex items-center justify-between gap-2 text-[9px] text-slate-400">
                            <span>bps por lado</span>
                            <input type="number" min="0" max="100" step="0.5" value={params.costs.perSideBps}
                                on:change={(e) => setCost("perSideBps", +e.target.value)}
                                class="w-20 bg-bg border border-border rounded px-2 py-1 text-white font-mono text-[10px] outline-none focus:border-accent" />
                        </label>
                    {:else if params.costs.mode === "realistic"}
                        <div class="grid grid-cols-2 gap-1.5">
                            {#each [["takerBps", "Taker bps"], ["makerBps", "Maker bps"], ["slippageBps", "Slippage bps"], ["fundingBps8h", "Funding bps/8h"]] as [k, label]}
                                <label class="flex flex-col gap-0.5 text-[8px] text-slate-500">
                                    <span class="uppercase">{label}</span>
                                    <input type="number" min="0" max="100" step="0.1" value={params.costs[k]}
                                        on:change={(e) => setCost(k, +e.target.value)}
                                        class="bg-bg border border-border rounded px-2 py-1 text-white font-mono text-[10px] outline-none focus:border-accent" />
                                </label>
                            {/each}
                        </div>
                    {/if}

                    <button on:click={() => runCostSweep()} disabled={$state.isSweeping}
                        class="w-full bg-panel border border-border hover:border-accent disabled:opacity-40 text-slate-300 text-[9px] font-bold uppercase tracking-wider py-1.5 rounded transition-all cursor-pointer">
                        <i class="fas {$state.isSweeping ? 'fa-spinner fa-spin' : 'fa-chart-line'} text-[9px] mr-1"></i>
                        Análisis de sensibilidad
                    </button>

                    {#if sweep.length > 1}
                        <div class="bg-bg/60 rounded p-2 space-y-1.5">
                            <div class="text-[8px] text-slate-500 uppercase font-bold">Sharpe vs coste (bps/lado)</div>
                            <svg viewBox="0 0 260 60" class="w-full h-14 overflow-visible">
                                <line x1="0" y1={zeroLineY} x2="260" y2={zeroLineY} stroke="#334155" stroke-width="1" stroke-dasharray="3 3" />
                                <path d={sweepPath} fill="none" stroke="#22d3ee" stroke-width="1.5" />
                            </svg>
                            <div class="flex justify-between text-[8px] text-slate-500 font-mono">
                                <span>{sweep[0].perSideBps} bps</span>
                                <span>{sweep[sweep.length - 1].perSideBps} bps</span>
                            </div>
                            <div class="text-[9px] {breakevenBps ? 'text-bear' : 'text-bull'} font-bold">
                                {#if breakevenBps}
                                    Deja de ser rentable a ~{breakevenBps.perSideBps} bps/lado
                                {:else}
                                    Rentable en todo el rango probado
                                {/if}
                            </div>
                        </div>
                    {/if}
                </div>
            {/if}

            <!-- PARAMETERS -->
            {#if showParams && isPro}
                <div class="bg-black/25 rounded-xl border border-border/40 overflow-hidden">
                    <div class="flex justify-between items-center px-2.5 py-2 border-b border-border/30">
                        <span class="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Parámetros del motor</span>
                        <button on:click={resetParams} class="text-[8px] text-accent hover:text-white uppercase font-bold transition-colors">Reset</button>
                    </div>
                    {#each PARAM_GROUPS as group}
                        <div class="border-b border-border/20 last:border-0">
                            <button
                                on:click={() => (openGroup = openGroup === group ? "" : group)}
                                class="w-full flex justify-between items-center px-2.5 py-1.5 text-[9px] font-bold uppercase text-slate-300 hover:bg-white/5 transition-colors"
                            >
                                <span>{group}</span>
                                <i class="fas fa-chevron-{openGroup === group ? 'up' : 'down'} text-[7px] text-slate-500"></i>
                            </button>
                            {#if openGroup === group}
                                <div class="px-2.5 pb-2 space-y-1.5">
                                    {#each PARAM_SCHEMA.filter((f) => f.group === group) as field}
                                        <div class="flex items-center justify-between gap-2" title={field.hint || ""}>
                                            <span class="text-[9px] text-slate-400 flex-1 leading-tight">{field.label}</span>
                                            {#if field.type === "boolean"}
                                                <button
                                                    on:click={() => setParam(field.key, !params[field.key])}
                                                    class="w-8 h-4 rounded-full transition-colors relative shrink-0 {params[field.key] ? 'bg-accent' : 'bg-slate-700'}"
                                                >
                                                    <span class="absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all {params[field.key] ? 'left-4' : 'left-0.5'}"></span>
                                                </button>
                                            {:else if field.type === "select"}
                                                <select
                                                    value={params[field.key]}
                                                    on:change={(e) => setParam(field.key, e.target.value)}
                                                    class="w-36 bg-bg border border-border rounded px-1.5 py-1 text-white font-mono text-[9px] outline-none focus:border-accent cursor-pointer"
                                                >
                                                    {#each field.options as opt}<option value={opt.id}>{opt.label}</option>{/each}
                                                </select>
                                            {:else}
                                                <input
                                                    type="number"
                                                    min={field.min} max={field.max} step={field.step}
                                                    value={params[field.key]}
                                                    on:change={(e) => setParam(field.key, +e.target.value)}
                                                    class="w-20 bg-bg border border-border rounded px-2 py-1 text-white font-mono text-[9px] outline-none focus:border-accent shrink-0"
                                                />
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/if}

            <!-- OPTIMIZER RESULTS -->
            {#if showOptimizer && $state.optimizerResults.length > 0}
                <div class="bg-black/30 rounded border border-border/50 overflow-hidden">
                    <table class="w-full text-[9px] text-left">
                        <thead class="bg-panel/50 text-slate-500 uppercase font-bold">
                            <tr><th class="p-2">Config</th><th class="p-2">WR%</th><th class="p-2">PnL</th><th class="p-2">Load</th></tr>
                        </thead>
                        <tbody class="divide-y divide-border/30">
                            {#each $state.optimizerResults as res}
                                <tr class="hover:bg-white/5 transition-colors">
                                    <td class="p-2 text-white font-mono">{res.label}</td>
                                    <td class="p-2 {res.winRate > 50 ? 'text-bull' : 'text-bear'}">{res.winRate.toFixed(1)}%</td>
                                    <td class="p-2 {res.totalPnL > 0 ? 'text-bull' : 'text-bear'}">{res.totalPnL.toFixed(1)}R</td>
                                    <td class="p-2">
                                        <button on:click={() => applyOptimizerSelection(res.key)} class="text-accent hover:text-white transition-colors">
                                            <i class="fas fa-download"></i>
                                        </button>
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                    <div class="px-2 py-1.5 text-[8px] text-amber-400/80 border-t border-border/30 leading-snug">
                        Elegir el mejor de {$state.optimizerResults.length} configuraciones es multiple testing.
                        El Sharpe deflactado del panel Analytics ya lo penaliza.
                    </div>
                </div>
            {/if}

            <!-- PERFORMANCE MATRIX -->
            {#if m.totalTrades > 0}
                <div class="space-y-1.5 bg-black/25 p-2.5 rounded-xl border border-border/40">
                    <div class="text-[8px] font-bold text-slate-400 uppercase tracking-wider flex justify-between items-center">
                        <span>Performance Matrix</span>
                        <span class="text-accent font-mono">{m.totalTrades} trades · {fmt(m.tradesPerDay, 1)}/día</span>
                    </div>

                    <div class="grid grid-cols-4 gap-1.5 text-center">
                        <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                            <div class="text-[7.5px] text-slate-500 uppercase">Win Rate</div>
                            <div class="text-[9.5px] font-bold {tone(m.winRate, 50, 45)}">{pct(m.winRate)}</div>
                        </div>
                        <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                            <div class="text-[7.5px] text-slate-500 uppercase">Profit Factor</div>
                            <div class="text-[9.5px] font-bold {tone(m.profitFactor, 1.5, 1.0)}">{fmt(m.profitFactor)}</div>
                        </div>
                        <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                            <div class="text-[7.5px] text-slate-500 uppercase" title="Anualizado sobre retornos diarios (365d)">Sharpe</div>
                            <div class="text-[9.5px] font-bold {tone(m.sharpe, 1.5, 1.0)}">{fmt(m.sharpe)}</div>
                        </div>
                        <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                            <div class="text-[7.5px] text-slate-500 uppercase">Sortino</div>
                            <div class="text-[9.5px] font-bold {tone(m.sortino, 2.0, 1.0)}">{fmt(m.sortino)}</div>
                        </div>
                    </div>

                    <div class="grid grid-cols-4 gap-1.5 text-center">
                        <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                            <div class="text-[7.5px] text-slate-500 uppercase" title="Del mark-to-market barra a barra">Max DD</div>
                            <!-- pnl.js already returns a percentage; the old panel multiplied by 100 again. -->
                            <div class="text-[9.5px] font-bold {m.drawdown?.maxPct > 15 ? 'text-bear' : 'text-slate-300'}">-{fmt(m.drawdown?.maxPct, 1)}%</div>
                        </div>
                        <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                            <div class="text-[7.5px] text-slate-500 uppercase">Expectancy</div>
                            <div class="text-[9.5px] font-bold {tone(m.expectancyR, 0.01, 0)}">{fmt(m.expectancyR)}R</div>
                        </div>
                        <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                            <div class="text-[7.5px] text-slate-500 uppercase">Payoff</div>
                            <div class="text-[9.5px] font-bold text-slate-200">{fmt(m.payoffRatio)}</div>
                        </div>
                        <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                            <div class="text-[7.5px] text-slate-500 uppercase" title="CAGR / Max DD">Calmar</div>
                            <div class="text-[9.5px] font-bold text-slate-200">{fmt(m.calmar)}</div>
                        </div>
                    </div>

                    <div class="grid grid-cols-3 gap-1.5 text-center pt-0.5">
                        <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                            <div class="text-[7.5px] text-slate-500 uppercase">PnL neto</div>
                            <div class="text-[9.5px] font-bold {m.totalPnl >= 0 ? 'text-bull' : 'text-bear'}">{money(m.totalPnl)}</div>
                        </div>
                        <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                            <div class="text-[7.5px] text-slate-500 uppercase" title="Fees + slippage + funding">Costes</div>
                            <div class="text-[9.5px] font-bold text-amber-400">{money(m.totalCosts)}</div>
                        </div>
                        <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                            <div class="text-[7.5px] text-slate-500 uppercase" title="Costes / beneficio bruto">Cost drag</div>
                            <div class="text-[9.5px] font-bold {m.costDragRatio > 0.5 ? 'text-bear' : 'text-slate-300'}">{fmt(m.costDragRatio)}x</div>
                        </div>
                    </div>

                    {#if Number.isFinite(m.winRateCi?.lower)}
                        <div class="text-[8px] text-slate-500 pt-1 leading-snug border-t border-border/20">
                            IC 95% (bootstrap): WR {fmt(m.winRateCi.lower, 1)}–{fmt(m.winRateCi.upper, 1)}% ·
                            PF {fmt(m.profitFactorCi.lower)}–{fmt(m.profitFactorCi.upper)} ·
                            Exp {fmt(m.expectancyRCi.lower)}–{fmt(m.expectancyRCi.upper)}R
                        </div>
                    {/if}
                </div>
            {/if}

            <!-- CRYPTO PRO LIVE DASHBOARD -->
            {#if $state.cryptoProDashboard}
                {@const isAudit = $state.isReplayMode && $state.selectedTrade?.dashboardSnapshot}
                {@const cp = isAudit ? $state.selectedTrade.dashboardSnapshot : $state.cryptoProDashboard}
                {@const d = $state.cryptoProDashboard}
                <div class="bg-black/40 rounded-xl border {isAudit ? 'border-amber-500/60 ring-1 ring-amber-500/30' : 'border-blue-500/40'} overflow-hidden text-[9px] font-mono">
                    <div class="{isAudit ? 'bg-amber-950/40 border-amber-500/40 text-amber-300' : 'bg-blue-950/40 border-blue-500/40 text-blue-300'} px-3 py-2 border-b flex justify-between items-center">
                        <div class="flex items-center gap-1.5 font-bold uppercase tracking-wider">
                            <i class="fas {isAudit ? 'fa-crosshairs' : 'fa-crown'} text-amber-400"></i>
                            {isAudit ? `TRADE SNAPSHOT (${$state.selectedTrade?.id})` : "CRYPTO PRO V2"}
                        </div>
                        <div class="text-[8px] {isAudit ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'bg-blue-500/20 text-blue-400 border-blue-500/30'} px-1.5 py-0.5 rounded border">
                            {isAudit ? `${$state.selectedTrade?.type} @ $${$state.selectedTrade?.entry?.toFixed(1)}` : APP.interval}
                        </div>
                    </div>

                    <div class="divide-y divide-border/20 text-slate-300">
                        <div class="flex justify-between px-3 py-1 bg-black/20 font-bold">
                            <span class="text-slate-400">SEÑAL</span>
                            <span class="{cp.signal === 'LONG' ? 'text-bull' : cp.signal === 'SHORT' ? 'text-bear' : 'text-slate-400'} font-extrabold">{cp.signal}</span>
                        </div>
                        <div class="flex justify-between px-3 py-1">
                            <span class="text-slate-400">SCORE (L / S)</span>
                            <span class="text-white">{fmt(cp.strengthLong, 0)} / {fmt(cp.strengthShort, 0)}</span>
                        </div>
                        <div class="flex justify-between px-3 py-1" title="Frecuencia empírica de acierto de los trades históricos con este score. Sin muestra suficiente muestra un guion.">
                            <span class="text-slate-400">PROB. CALIBRADA</span>
                            <span class="{cp.probUp == null ? 'text-slate-500' : cp.probUp >= 50 ? 'text-bull' : 'text-bear'}">
                                {cp.probUp == null ? "— (muestra insuficiente)" : `${cp.probUp.toFixed(0)}%`}
                            </span>
                        </div>
                        <div class="flex justify-between px-3 py-1">
                            <span class="text-slate-400">RÉGIMEN ADX</span>
                            <span class="text-emerald-400 font-bold">{fmt(cp.adxValue, 1)} {cp.adxRegime}</span>
                        </div>
                        <div class="flex justify-between px-3 py-1">
                            <span class="text-slate-400">SESGO DI</span>
                            <span class="{cp.diBias?.includes('ALCISTA') ? 'text-bull' : 'text-bear'}">{cp.diBias}</span>
                        </div>
                        <div class="flex justify-between px-3 py-1">
                            <span class="text-slate-400">MACD / RSI</span>
                            <span class="text-slate-200">{cp.macdState} <span class="text-slate-500">|</span> {fmt(cp.rsiValue, 1)} {cp.rsiState}</span>
                        </div>
                        <div class="flex justify-between px-3 py-1">
                            <span class="text-slate-400">VOLUMEN / TRAMPA</span>
                            <span class="text-white">{fmt(cp.volumeRatio, 2)}x {cp.volumeState} <span class="{cp.trapState !== 'NINGUNA' ? 'text-amber-400 font-bold' : 'text-slate-500'}">{cp.trapState !== "NINGUNA" ? "⚠" : ""}</span></span>
                        </div>

                        <div class="flex justify-between px-3 py-1 bg-black/30 font-bold">
                            <span class="text-slate-400">ENTRADA / SL</span>
                            <span class="text-white">${fmt(cp.currentEntry)} <span class="text-slate-500">|</span> <span class="text-bear">${fmt(cp.currentSl)}</span></span>
                        </div>
                        <div class="flex justify-between px-3 py-1 bg-black/30">
                            <span class="text-slate-400">TP1 / TP2 / TP3</span>
                            <span class="text-bull">${fmt(cp.currentTp1, 0)} / ${fmt(cp.currentTp2, 0)} / ${fmt(cp.currentTp3, 0)}</span>
                        </div>

                        <div class="flex justify-between px-3 py-1 bg-blue-950/40 text-blue-300 font-bold">
                            <span>RESULTADO GLOBAL</span>
                            <span>{d.totalTrades} OPS</span>
                        </div>
                        <div class="flex justify-between px-3 py-1">
                            <span class="text-slate-400">GANAN / PIERDEN / BE</span>
                            <span>
                                <span class="text-bull font-bold">{d.winningTrades}</span> <span class="text-slate-500">/</span>
                                <span class="text-bear font-bold">{d.losingTrades}</span> <span class="text-slate-500">/</span>
                                <span class="text-amber-400 font-bold">{d.breakevenTrades}</span>
                            </span>
                        </div>
                        <div class="flex justify-between px-3 py-1">
                            <span class="text-slate-400">TP1 / TP2 / TP3 HITS</span>
                            <span class="text-slate-200">{d.tp1Count} / {d.tp2Count} / {d.tp3Count}</span>
                        </div>
                        <div class="flex justify-between px-3 py-1 font-bold">
                            <span class="text-slate-400">WIN RATE</span>
                            <span class="{d.winRate >= 50 ? 'text-bull' : 'text-bear'}">{fmt(d.winRate, 1)}%</span>
                        </div>

                        <div class="flex justify-between px-3 py-1 bg-blue-950/40 text-blue-300 font-bold">
                            <span>CAPITAL</span>
                            <span class="{d.totalPnl >= 0 ? 'text-bull' : 'text-bear'}">{d.totalPnl >= 0 ? "+" : ""}{money(d.totalPnl)}</span>
                        </div>
                        <div class="flex justify-between px-3 py-1">
                            <span class="text-slate-400">ACTUAL <span class="text-[8px] text-slate-600">(lev x{d.leverage})</span></span>
                            <span class="text-white font-bold">{money(d.currentCapital)}</span>
                        </div>
                        <div class="flex justify-between px-3 py-1" title="Unidades separadas a propósito: R y $ ya no se mezclan.">
                            <span class="text-slate-400">EN R / COSTES</span>
                            <span class="text-slate-200">{fmt(d.totalPnlR)}R <span class="text-slate-500">|</span> <span class="text-amber-400">{money(d.totalCosts)}</span></span>
                        </div>

                        <div class="flex justify-between px-3 py-1 bg-blue-950/40 text-blue-300 font-bold">
                            <span>PERIODO ({d.analysisDays}D)</span>
                            <span class="{d.periodPnl >= 0 ? 'text-bull' : 'text-bear'}">{d.periodPnl >= 0 ? "+" : ""}{money(d.periodPnl)}</span>
                        </div>
                        <div class="flex justify-between px-3 py-1">
                            <span class="text-slate-400">$/DÍA · WR PERIODO</span>
                            <span class="text-slate-200">{money(d.pnlPerDay)}/d <span class="text-slate-500">|</span> <span class="{d.periodWinRate >= 50 ? 'text-bull' : 'text-bear'}">{fmt(d.periodWinRate, 0)}%</span></span>
                        </div>

                        {#if d.ruined}
                            <div class="px-3 py-1.5 bg-bear/20 text-bear font-bold text-center">⚠ CUENTA LIQUIDADA DURANTE EL BACKTEST</div>
                        {/if}
                    </div>
                </div>
            {/if}
        </div>

        <!-- TRADE LIST -->
        <div class="p-2 space-y-2">
            {#each $state.trades.slice().sort((a, b) => (b.time || 0) - (a.time || 0)) as res}
                <button
                    on:click={() => replayTrade(res)}
                    class="w-full text-left bg-panel border border-border/50 p-3 rounded hover:border-accent transition-all cursor-pointer flex justify-between items-center"
                >
                    <div class="flex flex-col min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="text-[9px] font-bold {res.pnl > 0 ? 'text-bull' : res.pnl < 0 ? 'text-bear' : 'text-amber-400'}">
                                {res.type} {res.exitReason || res.status}
                            </span>
                            <span class="text-[9px] text-slate-500 font-mono">{new Date(res.time * 1000).toLocaleDateString()}</span>
                        </div>
                        <div class="text-[10px] text-white font-medium mt-1 truncate">{res.desc}</div>
                    </div>
                    <div class="text-right shrink-0 ml-2">
                        <div class="text-xs font-mono font-bold {res.pnl > 0 ? 'text-bull' : res.pnl < 0 ? 'text-bear' : 'text-amber-400'}">
                            {res.pnl > 0 ? "+" : ""}{fmt(res.pnl)}R
                        </div>
                        <div class="text-[8px] text-slate-500">{money(res.pnlUsd)} · score {fmt(res.setupScore, 0)}</div>
                    </div>
                </button>
            {:else}
                <div class="p-8 text-center space-y-4">
                    <div class="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mx-auto border border-border/30">
                        <i class="fas fa-robot text-slate-600 text-xs"></i>
                    </div>
                    <div class="text-[9px] text-slate-600 uppercase font-bold tracking-widest leading-relaxed">
                        Estrategia no ejecutada o sin resultados.
                    </div>
                </div>
            {/each}
        </div>
    </div>
</div>
