<script>
    import { state } from "../lib/stores/app.js";
    import SMCPanel from "./panels/SMCPanel.svelte";
    import TradesPanel from "./panels/TradesPanel.svelte";
    import TrendsPanel from "./panels/TrendsPanel.svelte";
    import RegLinPanel from "./panels/RegLinPanel.svelte";
    import StratPanel from "./panels/StratPanel.svelte";
    import PnLPanel from "./panels/PnLPanel.svelte";
    import LogPanel from "./panels/LogPanel.svelte";
</script>

<aside
    id="right-panel"
    class="w-80 border-l border-border bg-panel flex flex-col shadow-2xl z-40"
>
    {#if $state.activeMode === "zones"}
        <SMCPanel />
    {:else if $state.activeMode === "trades"}
        <TradesPanel />
    {:else if $state.activeMode === "lines"}
        <TrendsPanel />
    {:else if $state.activeMode === "reglin"}
        <RegLinPanel />
    {:else if $state.activeMode === "strat"}
        <StratPanel />
    {:else if $state.activeMode === "pnl"}
        <PnLPanel />
    {:else if $state.activeMode === "log"}
        <LogPanel />
    {/if}
</aside>
