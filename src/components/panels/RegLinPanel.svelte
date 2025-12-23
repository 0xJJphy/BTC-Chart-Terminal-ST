<script>
    import { state, APP } from "../../lib/stores/app.js";
    import { manualRefresh } from "../../lib/logic/app_controller.js";

    $: channel = $state.channel || { slope: 0 };
    $: regPeriod = $state.regPeriod || 200;
    $: regStd = $state.regStd || 2.0;
</script>

<div class="flex-1 flex flex-col p-4 space-y-6">
    <div class="flex justify-between items-center">
        <h2 class="text-white font-bold text-xs uppercase tracking-widest">
            RegLin Channels
        </h2>
        <span class="text-[9px] text-slate-500 font-mono">Mode: STD DEV</span>
    </div>

    <div class="space-y-5">
        <div class="space-y-2">
            <div
                class="flex justify-between items-center text-[10px] text-slate-400 uppercase font-bold"
            >
                <span>Lookback Period</span>
                <span class="text-white font-mono">{regPeriod}</span>
            </div>
            <input
                type="range"
                class="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                min="50"
                max="1000"
                step="50"
                bind:value={$state.regPeriod}
                on:change={manualRefresh}
            />
        </div>

        <div class="space-y-2">
            <div
                class="flex justify-between items-center text-[10px] text-slate-400 uppercase font-bold"
            >
                <span>Deviation Multiplier</span>
                <span class="text-white font-mono"
                    >{(regStd || 0).toFixed(1)}</span
                >
            </div>
            <input
                type="range"
                class="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                min="0.5"
                max="5.0"
                step="0.1"
                bind:value={$state.regStd}
                on:change={manualRefresh}
            />
        </div>

        <button
            on:click={manualRefresh}
            class="w-full py-2 bg-reg/10 border border-reg/30 rounded text-reg text-[10px] font-bold uppercase hover:bg-reg/20 transition-all"
        >
            Recalculate Channel
        </button>
    </div>

    <div class="grid grid-cols-2 gap-4">
        <div
            class="bg-black/20 p-3 rounded-xl border border-border/40 text-center"
        >
            <div class="text-[9px] text-slate-500 uppercase mb-1">
                Channel Slope
            </div>
            <div
                class="text-xs font-mono font-bold {channel.slope >= 0
                    ? 'text-bull'
                    : 'text-bear'}"
            >
                {typeof channel.slope === "number"
                    ? (channel.slope * 10000).toFixed(4)
                    : "---"}
            </div>
        </div>
        <div
            class="bg-black/20 p-3 rounded-xl border border-border/40 text-center"
        >
            <div class="text-[9px] text-slate-500 uppercase mb-1">
                Indicator
            </div>
            <div class="text-xs font-mono font-bold text-accent uppercase">
                {APP.interval}
            </div>
        </div>
    </div>

    <div
        class="p-4 bg-white/5 rounded-lg border border-border/30 text-[10px] text-slate-500 text-justify leading-relaxed"
    >
        The linear regression channel identifies the core price trend and
        potential overextension zones based on statistical standard deviations.
    </div>
</div>
