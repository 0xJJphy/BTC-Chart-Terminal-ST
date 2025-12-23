<script>
    import { onMount } from "svelte";
    import Header from "./components/Header.svelte";
    import Sidebar from "./components/Sidebar.svelte";
    import Chart from "./components/Chart.svelte";
    import RightPanel from "./components/RightPanel.svelte";
    import { state, APP } from "./lib/stores/app.js";
    import { runFullLoadPipeline } from "./lib/logic/app_controller.js";

    onMount(() => {
        runFullLoadPipeline();
    });
</script>

<div class="h-screen flex flex-col overflow-hidden bg-bg text-text font-sans">
    <Header />

    <main class="flex-1 flex overflow-hidden">
        <Sidebar />

        <section class="flex-1 flex flex-col bg-bg relative min-w-0">
            <Chart />

            {#if $state.loading}
                <div
                    class="absolute inset-0 bg-bg/80 backdrop-blur-sm z-[100] flex flex-col items-center justify-center space-y-4"
                >
                    <div class="relative">
                        <div
                            class="w-16 h-16 border-4 border-accent/20 border-t-accent rounded-full animate-spin"
                        ></div>
                        <div
                            class="absolute inset-0 flex items-center justify-center"
                        >
                            <i class="fas fa-terminal text-accent text-xl"></i>
                        </div>
                    </div>
                    <div class="flex flex-col items-center">
                        <span
                            class="text-white font-bold text-xs uppercase tracking-[0.2em] mb-1"
                            >Downloading Historical Data</span
                        >
                        <span class="text-slate-500 font-mono text-[9px]"
                            >Analyzing {APP.historyTarget.toLocaleString()} Candles
                            in Real-Time</span
                        >
                    </div>
                </div>
            {/if}
        </section>

        <RightPanel />
    </main>
</div>

<style>
    /* Global styles already in app.css */
</style>
