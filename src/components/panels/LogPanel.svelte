<script>
    import { logs } from "../../lib/stores/app.js";
</script>

<div class="flex-1 flex flex-col">
    <div class="p-4 border-b border-border flex justify-between items-center">
        <h2
            class="text-white font-bold text-xs uppercase tracking-widest flex items-center gap-2"
        >
            <i class="fas fa-terminal text-accent"></i> System Diagnostics
        </h2>
        <button
            on:click={() => logs.set(["Terminal cleared."])}
            class="text-[9px] text-slate-500 hover:text-white uppercase font-bold"
            >Clear</button
        >
    </div>
    <div
        class="flex-1 overflow-y-auto p-4 font-mono text-[10px] text-slate-400 space-y-1 bg-[#0b0e11]"
    >
        {#each $logs as log}
            <div>{log}</div>
        {/each}
    </div>
</div>
