<script>
    import { state } from "../lib/stores/app.js";
    import { switchMainTab } from "../lib/logic/app_controller.js";

    const tabs = [
        { id: "zones", icon: "fas fa-layer-group", title: "SMC Explorer" },
        { id: "trades", icon: "fas fa-exchange-alt", title: "Operations" },
        { id: "lines", icon: "fas fa-chart-line", title: "Trend Analysis" },
        {
            id: "reglin",
            icon: "fas fa-grip-lines",
            title: "Regression Channels",
        },
        { id: "strat", icon: "fas fa-flask", title: "Strategy Lab" },
        {
            id: "pnl",
            icon: "fas fa-chart-pie",
            title: "Performance Monitoring",
        },
    ];
</script>

<nav
    class="w-14 border-r border-border bg-panel flex flex-col py-4 items-center space-y-6"
>
    {#each tabs as tab}
        <button
            on:click={() => switchMainTab(tab.id)}
            class="main-tab {$state.activeMode === tab.id ? 'active' : ''}"
            title={tab.title}
        >
            <i class="{tab.icon} text-lg"></i>
        </button>
    {/each}
    <div class="flex-1"></div>
    <button
        on:click={() => switchMainTab("log")}
        class="text-slate-600 hover:text-white transition-colors p-3"
        title="System Logs"
    >
        <i class="fas fa-terminal"></i>
    </button>
</nav>

<style>
    /* Tabs styles in app.css */
</style>
