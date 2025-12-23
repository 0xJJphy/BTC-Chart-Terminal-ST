<script>
    import { state } from "../../lib/stores/app.js";

    $: activeZones = $state.zones
        .filter(
            (z) =>
                z.status === "ACTIVE" &&
                (($state.showFVG && z.label === "FVG") ||
                    ($state.showOB && z.label === "OB")),
        )
        .slice(-$state.zoneLimit)
        .reverse();

    $: mitigatedZones = $state.zones
        .filter(
            (z) =>
                z.status === "MITIGATED" &&
                (($state.showFVG && z.label === "FVG") ||
                    ($state.showOB && z.label === "OB")),
        )
        .slice(-$state.zoneLimit)
        .reverse();

    function switchSubTab(tab) {
        state.update((s) => ({ ...s, activeZoneTab: tab }));
    }
</script>

<div class="flex-1 flex flex-col">
    <div class="p-4 border-b border-border bg-black/10">
        <div class="flex justify-between items-center mb-3">
            <h2 class="text-white font-bold text-xs uppercase tracking-widest">
                SMC Explorer
            </h2>
            <span
                class="text-[10px] bg-accent/20 text-accent px-2 py-0.5 rounded font-bold"
                >AutoScan</span
            >
        </div>
        <div class="grid grid-cols-2 gap-1 mb-4">
            <button
                on:click={() => switchSubTab("active")}
                class="sub-tab {$state.activeZoneTab === 'active'
                    ? 'active'
                    : ''}">ACTIVE ZONES</button
            >
            <button
                on:click={() => switchSubTab("history")}
                class="sub-tab {$state.activeZoneTab === 'history'
                    ? 'active'
                    : ''}">MITIGATED</button
            >
        </div>
        <div class="space-y-3">
            <div class="flex items-center justify-between">
                <label class="text-[9px] text-slate-500 font-bold uppercase"
                    >Display Limit</label
                >
                <span class="text-[10px] text-accent font-mono"
                    >{$state.zoneLimit}</span
                >
            </div>
            <input
                type="range"
                class="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                min="10"
                max="200"
                bind:value={$state.zoneLimit}
            />
            <div class="flex items-center gap-4">
                <label class="flex items-center gap-2 cursor-pointer group">
                    <input
                        type="checkbox"
                        bind:checked={$state.showFVG}
                        class="hidden"
                    />
                    <div
                        class="w-4 h-4 border border-border rounded {$state.showFVG
                            ? 'bg-fvg border-fvg'
                            : ''} transition-all flex items-center justify-center"
                    >
                        {#if $state.showFVG}<i
                                class="fas fa-check text-[8px] text-white"
                            ></i>{/if}
                    </div>
                    <span
                        class="text-[10px] text-slate-400 group-hover:text-fvg transition-colors font-medium"
                        >FVGs</span
                    >
                </label>
                <label class="flex items-center gap-2 cursor-pointer group">
                    <input
                        type="checkbox"
                        bind:checked={$state.showOB}
                        class="hidden"
                    />
                    <div
                        class="w-4 h-4 border border-border rounded {$state.showOB
                            ? 'bg-ob border-ob'
                            : ''} transition-all flex items-center justify-center"
                    >
                        {#if $state.showOB}<i
                                class="fas fa-check text-[8px] text-white"
                            ></i>{/if}
                    </div>
                    <span
                        class="text-[10px] text-slate-400 group-hover:text-ob transition-colors font-medium"
                        >OrderBlocks</span
                    >
                </label>
            </div>
        </div>
    </div>

    <div class="flex-1 overflow-y-auto custom-scroll p-2">
        {#if $state.activeZoneTab === "active"}
            {#each activeZones as zone}
                <div
                    class="bg-panel border border-border/50 p-3 rounded mb-2 hover:border-accent transition-all group"
                >
                    <div class="flex justify-between items-center mb-1">
                        <div class="flex items-center gap-2">
                            <span
                                class="text-[10px] font-bold {zone.type ===
                                'BULL'
                                    ? 'text-bull'
                                    : 'text-bear'}"
                                >{zone.label} {zone.type}</span
                            >
                            {#if zone.bos}
                                <span
                                    class="text-[8px] bg-white/10 text-white px-1 rounded font-bold"
                                    >BOS</span
                                >
                            {/if}
                            {#if zone.score}
                                <span class="text-[9px] text-slate-500"
                                    >Q:{zone.score.toFixed(0)}</span
                                >
                            {/if}
                        </div>
                        <span class="text-[9px] text-slate-500 font-mono"
                            >{new Date(
                                zone.time * 1000,
                            ).toLocaleTimeString()}</span
                        >
                    </div>
                    <div
                        class="text-xs text-white font-mono flex justify-between items-center"
                    >
                        <span
                            >${zone.bottom.toFixed(1)} - ${zone.top.toFixed(
                                1,
                            )}</span
                        >
                        <span class="text-[9px] text-slate-600"
                            >{(
                                (Math.abs(zone.top - zone.bottom) /
                                    zone.bottom) *
                                100
                            ).toFixed(2)}%</span
                        >
                    </div>
                </div>
            {:else}
                <div class="p-8 text-center text-xs text-slate-500 italic">
                    No active zones found.
                </div>
            {/each}
        {:else}
            {#each mitigatedZones as zone}
                <div
                    class="bg-panel/40 border border-border/50 p-3 rounded mb-2 opacity-60"
                >
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-[10px] font-bold text-slate-400"
                            >{zone.label} {zone.type}</span
                        >
                        <span class="text-[9px] text-slate-500 font-mono"
                            >{new Date(
                                zone.time * 1000,
                            ).toLocaleTimeString()}</span
                        >
                    </div>
                    <div class="text-xs text-slate-400 font-mono">
                        ${zone.bottom.toFixed(1)} - ${zone.top.toFixed(1)}
                    </div>
                </div>
            {:else}
                <div class="p-8 text-center text-xs text-slate-500 italic">
                    No mitigated zones.
                </div>
            {/each}
        {/if}
    </div>
</div>
