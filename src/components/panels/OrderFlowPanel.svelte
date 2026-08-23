<script>
    import { onMount } from "svelte";
    import { state, APP } from "../../lib/stores/app.js";
    import { setCvdAnchor, manualRefresh } from "../../lib/logic/app_controller.js";

    let bookDepthData = null;
    let depthLoading = false;

    async function fetchOrderBookDepth() {
        depthLoading = true;
        try {
            const res = await fetch(`/api/orderbook/depth?symbol=${APP.symbol}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.depth_profile) {
                    bookDepthData = data.depth_profile;
                }
            }
        } catch (e) {
            console.warn("Error fetching book depth:", e);
        } finally {
            depthLoading = false;
        }
    }

    onMount(() => {
        fetchOrderBookDepth();
    });

    $: cvd = $state.cvdData;
    $: divergences = cvd?.divergences || [];
    $: currentAnchor = $state.cvdAnchor || 'daily';

    // Calculate aggregated bid vs ask depth percentage for imbalance meter
    $: bidNotional = bookDepthData ? bookDepthData.filter(d => d.percentage < 0).reduce((acc, v) => acc + (v.notional_med ?? v['CAST(notional_med AS FLOAT)'] ?? 0), 0) : 0;
    $: askNotional = bookDepthData ? bookDepthData.filter(d => d.percentage > 0).reduce((acc, v) => acc + (v.notional_med ?? v['CAST(notional_med AS FLOAT)'] ?? 0), 0) : 0;
    $: totalDepthNotional = bidNotional + askNotional;
    $: bidPct = totalDepthNotional > 0 ? (bidNotional / totalDepthNotional * 100).toFixed(1) : 50.0;
    $: askPct = totalDepthNotional > 0 ? (askNotional / totalDepthNotional * 100).toFixed(1) : 50.0;

    function getRegimeBadge(regime) {
        switch (regime) {
            case 'PASSIVE_ABSORPTION':
                return { label: 'PASSIVE ABSORPTION (Iceberg)', color: 'bg-purple-500/20 text-purple-400 border-purple-500/40', icon: 'fas fa-shield-alt' };
            case 'LIQUIDITY_VACUUM':
                return { label: 'LIQUIDITY VACUUM (Thin Book)', color: 'bg-amber-500/20 text-amber-400 border-amber-500/40', icon: 'fas fa-exclamation-triangle' };
            case 'EFFICIENT_TREND':
                return { label: 'EFFICIENT TREND', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40', icon: 'fas fa-arrow-trend-up' };
            default:
                return { label: 'COMPRESSION / CHOP', color: 'bg-slate-500/20 text-slate-400 border-slate-500/40', icon: 'fas fa-compress-arrows-alt' };
        }
    }

    const anchors = [
        { id: 'daily', label: '1D (00:00 UTC)' },
        { id: 'weekly', label: '1W (Mon UTC)' },
        { id: 'monthly', label: '1M (Monthly)' },
        { id: 'quarterly', label: '1Q (Quarter)' },
        { id: 'yearly', label: '1Y (Yearly)' }
    ];
</script>

<div class="flex-1 flex flex-col overflow-hidden bg-panel">
    <!-- Header -->
    <div class="p-4 border-b border-border bg-black/10 space-y-3">
        <div class="flex justify-between items-center">
            <div class="flex items-center space-x-2">
                <i class="fas fa-water text-accent text-xs"></i>
                <h2 class="text-white font-bold text-xs uppercase tracking-widest">
                    Order Flow & Liquidity
                </h2>
            </div>
            <button 
                on:click={() => { manualRefresh(); fetchOrderBookDepth(); }}
                class="text-[10px] text-slate-400 hover:text-white transition-colors"
                title="Refresh Metrics"
            >
                <i class="fas fa-sync-alt {depthLoading ? 'fa-spin' : ''}"></i>
            </button>
        </div>

        <!-- Anchor Selector -->
        <div>
            <span class="text-[9px] text-slate-500 font-bold uppercase tracking-wider block mb-1.5">
                CVD Anchor Session
            </span>
            <div class="grid grid-cols-5 gap-1 bg-black/30 p-1 rounded-lg border border-border/50">
                {#each anchors as a}
                    <button
                        on:click={() => setCvdAnchor(a.id)}
                        class="py-1 text-[8.5px] font-bold uppercase rounded transition-all {currentAnchor === a.id ? 'bg-accent text-white shadow' : 'text-slate-400 hover:text-white'}"
                    >
                        {a.label.split(' ')[0]}
                    </button>
                {/each}
            </div>
        </div>
    </div>

    <!-- Scrollable Content -->
    <div class="flex-1 overflow-y-auto custom-scroll p-4 space-y-4">
        <!-- Market Microstructure Regime Banner -->
        {#if cvd}
            {@const badge = getRegimeBadge(cvd.marketRegime)}
            <div class="p-3 rounded-xl border {badge.color} space-y-1.5 shadow-lg">
                <div class="flex items-center justify-between">
                    <span class="text-[9px] uppercase font-bold tracking-widest text-slate-400">Microstructure Regime</span>
                    <span class="flex items-center space-x-1.5 text-[10px] font-bold">
                        <i class="{badge.icon}"></i>
                        <span>{badge.label}</span>
                    </span>
                </div>
                <p class="text-[10px] leading-relaxed text-slate-300 font-mono">
                    {cvd.regimeDescription}
                </p>
            </div>
        {/if}

        <!-- DER & Liquidity Fragility Metrics Grid -->
        <div class="grid grid-cols-2 gap-2.5">
            <!-- DER -->
            <div class="bg-black/20 p-3 rounded-xl border border-border/40 space-y-1">
                <div class="flex justify-between items-center">
                    <span class="text-[9px] text-slate-500 font-bold uppercase">DER (Efficiency)</span>
                    <i class="fas fa-bolt text-[9px] text-accent"></i>
                </div>
                <div class="text-sm font-mono font-bold text-white">
                    {cvd ? cvd.der.toFixed(3) : '0.000'}
                    <span class="text-[9px] font-normal text-slate-500">$/Δ</span>
                </div>
                <div class="text-[8px] text-slate-500">Price impact per unit delta</div>
            </div>

            <!-- Fragility Index -->
            <div class="bg-black/20 p-3 rounded-xl border border-border/40 space-y-1">
                <div class="flex justify-between items-center">
                    <span class="text-[9px] text-slate-500 font-bold uppercase">Fragility (Ψ)</span>
                    <i class="fas fa-feather-pointed text-[9px] {cvd && cvd.fragilityIndex > 2.0 ? 'text-amber-400' : 'text-slate-400'}"></i>
                </div>
                <div class="text-sm font-mono font-bold {cvd && cvd.fragilityIndex > 2.0 ? 'text-amber-400' : 'text-white'}">
                    {cvd ? cvd.fragilityIndex.toFixed(2) : '1.00'}
                    <span class="text-[9px] font-normal text-slate-500">xADR</span>
                </div>
                <div class="text-[8px] text-slate-500">{cvd && cvd.fragilityIndex > 2.0 ? 'Thin Book Warning' : 'Normal Liquidity'}</div>
            </div>

            <!-- aCVD Total -->
            <div class="bg-black/20 p-3 rounded-xl border border-border/40 space-y-1">
                <div class="flex justify-between items-center">
                    <span class="text-[9px] text-slate-500 font-bold uppercase">Session aCVD</span>
                    <i class="fas fa-chart-area text-[9px] text-slate-400"></i>
                </div>
                <div class="text-sm font-mono font-bold {cvd && cvd.currentCvd >= 0 ? 'text-bull' : 'text-bear'}">
                    {cvd ? (cvd.currentCvd >= 0 ? '+' : '') + cvd.currentCvd.toFixed(1) : '0.0'}
                    <span class="text-[9px] font-normal text-slate-500">BTC</span>
                </div>
                <div class="text-[8px] text-slate-500">{cvd ? cvd.cvdTrend : 'NEUTRAL'}</div>
            </div>

            <!-- Z-Score -->
            <div class="bg-black/20 p-3 rounded-xl border border-border/40 space-y-1">
                <div class="flex justify-between items-center">
                    <span class="text-[9px] text-slate-500 font-bold uppercase">CVD Z-Score</span>
                    <i class="fas fa-signal text-[9px] text-slate-400"></i>
                </div>
                <div class="text-sm font-mono font-bold {cvd && Math.abs(cvd.currentZScore) > 1.5 ? (cvd.currentZScore > 0 ? 'text-bull' : 'text-bear') : 'text-white'}">
                    {cvd ? (cvd.currentZScore >= 0 ? '+' : '') + cvd.currentZScore.toFixed(2) + 'σ' : '0.00σ'}
                </div>
                <div class="text-[8px] text-slate-500">{cvd && Math.abs(cvd.currentZScore) > 2.0 ? 'Statistical Extreme' : 'In 2σ Bands'}</div>
            </div>
        </div>

        <!-- Order Book Depth & Imbalance Meter -->
        <div class="bg-black/20 p-3 rounded-xl border border-border/40 space-y-3">
            <div class="flex justify-between items-center">
                <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                    Order Book Depth & Imbalance
                </span>
                <span class="text-[9px] font-mono text-slate-500">
                    Binance L2
                </span>
            </div>

            <!-- Imbalance Bar -->
            <div class="space-y-1.5">
                <div class="flex justify-between text-[10px] font-mono font-bold">
                    <span class="text-bull">Bids: {bidPct}%</span>
                    <span class="text-bear">Asks: {askPct}%</span>
                </div>
                <div class="w-full h-2 bg-black/40 rounded-full overflow-hidden flex border border-border/30">
                    <div class="bg-bull/80 transition-all duration-500" style="width: {bidPct}%"></div>
                    <div class="bg-bear/80 transition-all duration-500" style="width: {askPct}%"></div>
                </div>
            </div>

            <!-- Depth Profile Levels -->
            {#if bookDepthData && bookDepthData.length > 0}
                <div class="space-y-1.5 pt-1">
                    <span class="text-[8.5px] font-bold uppercase text-slate-500 block">Notional Depth by Range</span>
                    <div class="space-y-1">
                        {#each bookDepthData.slice(0, 12) as level}
                            {@const notional = level.notional_med ?? level['CAST(notional_med AS FLOAT)'] ?? 0}
                            {@const depth = level.depth_med ?? level['CAST(depth_med AS FLOAT)'] ?? 0}
                            <div class="flex justify-between items-center text-[9px] font-mono bg-panel/40 px-2 py-1 rounded border border-border/20">
                                <span class="{level.percentage < 0 ? 'text-bull' : 'text-bear'} font-bold">
                                    {level.percentage > 0 ? '+' : ''}{level.percentage}%
                                </span>
                                <span class="text-slate-300">
                                    ${(notional / 1e6).toFixed(1)}M
                                </span>
                                <span class="text-slate-500 text-[8px]">
                                    {depth.toFixed(0)} BTC
                                </span>
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}
        </div>

        <!-- Institutional Absorption Signals (Divergences) -->
        <div class="space-y-2">
            <div class="flex justify-between items-center">
                <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                    Absorption Signals ({divergences.length})
                </span>
                <span class="text-[9px] text-slate-500 font-mono">Statistical 2σ</span>
            </div>

            {#if divergences.length === 0}
                <div class="bg-black/10 border border-border/30 rounded-xl p-4 text-center">
                    <i class="fas fa-check-circle text-slate-600 mb-1"></i>
                    <p class="text-[10px] text-slate-500 font-mono">No active absorption traps detected in lookback.</p>
                </div>
            {:else}
                <div class="space-y-2">
                    {#each divergences.slice(-8).reverse() as div}
                        <div class="p-2.5 rounded-lg border {div.divType === 'BULLISH_ABSORPTION' ? 'bg-bull/10 border-bull/30' : 'bg-bear/10 border-bear/30'} space-y-1">
                            <div class="flex justify-between items-center">
                                <span class="text-[9px] font-bold uppercase {div.divType === 'BULLISH_ABSORPTION' ? 'text-bull' : 'text-bear'}">
                                    <i class="fas {div.divType === 'BULLISH_ABSORPTION' ? 'fa-arrow-up' : 'fa-arrow-down'} mr-1"></i>
                                    {div.divType === 'BULLISH_ABSORPTION' ? 'Bullish Absorption (Bear Trap)' : 'Bearish Absorption (Bull Trap)'}
                                </span>
                                <span class="text-[9px] font-mono text-slate-400">${div.price.toFixed(1)}</span>
                            </div>
                            <p class="text-[8.5px] text-slate-300 font-mono leading-tight">
                                {div.desc}
                            </p>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
</div>
