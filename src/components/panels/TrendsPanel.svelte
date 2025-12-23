<script>
    import { state } from "../../lib/stores/app.js";
    import { manualRefresh } from "../../lib/logic/app_controller.js";

    $: hurstVal = $state.pnlMetrics?.hurst || 0.5;
    $: hurstType = $state.pnlMetrics?.hurstType || "RUIDO (RANDOM WALK)";

    $: hurstColor =
        hurstVal > 0.55 ? "#e879f9" : hurstVal < 0.45 ? "#3b82f6" : "#94a3b8";
</script>

<div class="flex-1 flex flex-col p-4 space-y-6">
    <div class="flex justify-between items-center">
        <h2 class="text-white font-bold text-xs uppercase tracking-widest">
            Trend Analysis
        </h2>
        <span class="text-[9px] text-slate-500 font-mono">Mode: Fractal</span>
    </div>

    <div class="bg-black/20 p-4 rounded-xl border border-border/40 space-y-4">
        <div class="flex items-center justify-between">
            <span class="text-[10px] text-slate-400 font-bold"
                >Hurst Exponent</span
            >
            <div
                class="font-mono text-xs font-bold"
                style="color: {hurstColor}"
            >
                {hurstVal.toFixed(3)}
            </div>
        </div>
        <div class="h-1 bg-border rounded-full overflow-hidden">
            <div
                class="h-full transition-all duration-500"
                style="width: {hurstVal * 100}%; background-color: {hurstColor}"
            ></div>
        </div>
        <div
            class="text-center text-[9px] font-bold text-slate-500 uppercase tracking-widest italic"
        >
            {hurstType}
        </div>
    </div>

    <div class="space-y-4">
        <div class="flex items-center justify-between">
            <label class="text-[10px] text-slate-400 font-bold uppercase"
                >Fractal Strength</label
            >
            <span class="text-xs text-white font-mono"
                >{$state.fractalStrength}</span
            >
        </div>
        <input
            type="range"
            class="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
            min="2"
            max="30"
            bind:value={$state.fractalStrength}
            on:change={manualRefresh}
        />

        <div class="flex items-center justify-between">
            <label class="text-[10px] text-slate-400 font-bold uppercase"
                >Angle Max</label
            >
            <span class="text-xs text-white font-mono">{$state.angleMax}</span>
        </div>
        <input
            type="range"
            class="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
            min="5"
            max="100"
            bind:value={$state.angleMax}
            on:change={manualRefresh}
        />

        <div class="space-y-3 pt-2">
            <label
                class="flex items-center justify-between group cursor-pointer"
            >
                <span
                    class="text-[10px] text-slate-400 group-hover:text-white transition-colors uppercase font-bold"
                    >Angle Filter</span
                >
                <div class="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        class="sr-only peer"
                        bind:checked={$state.angleFilter}
                        on:change={manualRefresh}
                    />
                    <div
                        class="w-7 h-4 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-accent"
                    ></div>
                </div>
            </label>

            <label
                class="flex items-center justify-between group cursor-pointer"
            >
                <span
                    class="text-[10px] text-slate-400 group-hover:text-white transition-colors uppercase font-bold"
                    >Show Broken Lines</span
                >
                <div class="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        class="sr-only peer"
                        bind:checked={$state.showBrokenLines}
                    />
                    <div
                        class="w-7 h-4 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-bull"
                    ></div>
                </div>
            </label>

            <button
                on:click={manualRefresh}
                class="w-full py-2 bg-accent/10 border border-accent/30 rounded text-accent text-[10px] font-bold uppercase hover:bg-accent/20 transition-all"
            >
                Recalculate Lines
            </button>
        </div>
    </div>

    <div class="p-3 bg-white/5 rounded-lg border border-border/50">
        <div class="text-[9px] text-slate-500 font-bold text-center uppercase">
            {$state.lines.filter((l) => l.status === "ACTIVE").length} Active / {$state.lines.filter(
                (l) => l.status === "BROKEN",
            ).length} Broken
        </div>
    </div>
</div>
