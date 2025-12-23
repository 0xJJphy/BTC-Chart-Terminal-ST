<script>
    import { state, APP } from "../lib/stores/app.js";
    import {
        runFullLoadPipeline,
        manualRefresh,
        exitReplay,
    } from "../lib/logic/app_controller.js";

    function setTF(tf) {
        if (APP.interval === tf) return;
        APP.interval = tf;
        runFullLoadPipeline();
    }
</script>

<header
    class="h-12 border-b border-border bg-panel flex items-center justify-between px-4 z-50"
>
    <div class="flex items-center space-x-4">
        <div class="flex items-center space-x-2">
            <div
                class="w-8 h-8 bg-accent rounded-lg flex items-center justify-center shadow-lg shadow-accent/20"
            >
                <i class="fas fa-bolt text-white text-xs"></i>
            </div>
            <div>
                <h1
                    class="text-white font-bold text-sm tracking-tight leading-none"
                >
                    ST TERMINAL
                </h1>
                <span
                    class="text-[9px] text-slate-500 font-mono uppercase tracking-widest"
                    >BTC-USDT-QUANT</span
                >
            </div>
        </div>
        <div class="h-4 w-[1px] bg-border mx-2"></div>
        <div class="flex space-x-1">
            {#each ["1m", "5m", "15m", "1h", "4h"] as tf}
                <button
                    on:click={() => setTF(tf)}
                    class="tf-btn {APP.interval === tf ? 'active' : ''}"
                >
                    {tf.toUpperCase()}
                </button>
            {/each}
        </div>
    </div>

    <div class="flex items-center space-x-6">
        {#if $state.isReplayMode}
            <button
                on:click={() => exitReplay()}
                class="flex items-center space-x-2 bg-bear hover:bg-red-600 px-4 py-1.5 rounded-lg text-white font-bold text-[10px] shadow-lg shadow-bear/20 animate-pulse transition-all"
            >
                <i class="fas fa-times"></i>
                <span>EXIT REPLAY</span>
            </button>
        {/if}

        <div class="flex flex-col items-end">
            <span class="text-[9px] text-slate-500 font-bold uppercase"
                >Live Price</span
            >
            <span class="text-white font-mono text-xs font-bold"
                >${$state.livePrice}</span
            >
        </div>
        <div
            class="flex items-center space-x-2 bg-black/20 px-3 py-1.5 rounded-full border border-border/50"
        >
            <div
                class="w-2 h-2 rounded-full {$state.wsStatus === 'Live'
                    ? 'bg-bull'
                    : 'bg-bear'}"
            ></div>
            <span class="text-[10px] font-mono text-slate-400"
                >{$state.wsStatus}</span
            >
        </div>
        <button
            on:click={() => manualRefresh()}
            class="w-8 h-8 rounded-full border border-border hover:bg-white/5 transition-colors group"
            title="Manual Analysis Refresh"
        >
            <i
                class="fas fa-sync-alt text-xs text-slate-400 group-hover:text-accent transition-colors"
            ></i>
        </button>
    </div>
</header>
