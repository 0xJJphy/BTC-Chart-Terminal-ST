<script>
    import { onMount, onDestroy } from "svelte";
    import { createChart, CrosshairMode } from "lightweight-charts";
    import { state, APP } from "../lib/stores/app.js";
    import {
        BoxPrimitive,
        TrendLinePrimitive,
        LinearRegressionPrimitive,
    } from "../lib/logic/chart_utils.js";
    import { getTradeMarkers } from "../lib/logic/replay.js";

    let chartContainer;
    let chart;
    let candleSeries;
    let volumeSeries;
    let deltaSeries;
    let entryLine, tpLine, slLine;

    function clearPriceLines() {
        if (entryLine) {
            candleSeries.removePriceLine(entryLine);
            entryLine = null;
        }
        if (tpLine) {
            candleSeries.removePriceLine(tpLine);
            tpLine = null;
        }
        if (slLine) {
            candleSeries.removePriceLine(slLine);
            slLine = null;
        }
    }

    function updatePriceLines(trade) {
        clearPriceLines();
        if (!trade || !candleSeries) return;

        entryLine = candleSeries.createPriceLine({
            price: trade.entry,
            color: "#2962ff",
            lineWidth: 2,
            lineStyle: 0,
            axisLabelVisible: true,
            title: "ENTRY",
        });

        tpLine = candleSeries.createPriceLine({
            price: trade.tp,
            color: "#089981",
            lineWidth: 2,
            lineStyle: 0,
            axisLabelVisible: true,
            title: "TP",
        });

        slLine = candleSeries.createPriceLine({
            price: trade.sl,
            color: "#f23645",
            lineWidth: 2,
            lineStyle: 0,
            axisLabelVisible: true,
            title: "SL",
        });
    }

    let boxPrimitive = new BoxPrimitive();
    let trendPrimitive = new TrendLinePrimitive();
    let regPrimitive = new LinearRegressionPrimitive();

    onMount(() => {
        chart = createChart(chartContainer, {
            layout: {
                background: { type: "solid", color: "#0b0e11" },
                textColor: "#94a3b8",
                fontFamily: "JetBrains Mono",
            },
            grid: {
                vertLines: { color: "#151a23" },
                horzLines: { color: "#151a23" },
            },
            crosshair: { mode: CrosshairMode.Normal },
            timeScale: {
                borderColor: "#242b3b",
                timeVisible: true,
                secondsVisible: false,
            },
            rightPriceScale: { borderColor: "#242b3b" },
        });

        candleSeries = chart.addCandlestickSeries({
            upColor: "#089981",
            downColor: "#f23645",
            borderDownColor: "#f23645",
            borderUpColor: "#089981",
            wickDownColor: "#f23645",
            wickUpColor: "#089981",
        });

        volumeSeries = chart.addHistogramSeries({
            priceFormat: { type: "volume" },
            priceScaleId: "volume",
        });

        deltaSeries = chart.addHistogramSeries({
            priceFormat: { type: "volume" },
            priceScaleId: "volume",
        });

        chart.priceScale("volume").applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
            borderVisible: false,
        });

        candleSeries.attachPrimitive(boxPrimitive);
        candleSeries.attachPrimitive(trendPrimitive);
        candleSeries.attachPrimitive(regPrimitive);

        const handleResize = () => {
            chart.applyOptions({
                width: chartContainer.clientWidth,
                height: chartContainer.clientHeight,
            });
        };
        window.addEventListener("resize", handleResize);

        // Local variable to track if we've done initial set
        let initialDataLoaded = false;

        // Subscribe to state changes
        const unsubscribe = state.subscribe((s) => {
            if (!candleSeries) return;

            if (s.candles.length > 0) {
                if (!initialDataLoaded) {
                    candleSeries.setData(s.candles);
                    volumeSeries.setData(
                        s.candles.map((c) => ({
                            time: c.time,
                            value: c.volume,
                            color:
                                c.close >= c.open
                                    ? "rgba(8, 153, 129, 0.25)"
                                    : "rgba(242, 54, 69, 0.25)",
                        })),
                    );
                    deltaSeries.setData(
                        s.candles.map((c) => ({
                            time: c.time,
                            value: Math.abs(c.delta || 0),
                            color:
                                (c.delta || 0) >= 0
                                    ? "rgba(34, 197, 94, 0.8)"
                                    : "rgba(248, 113, 113, 0.8)",
                        })),
                    );
                    initialDataLoaded = true;
                } else {
                    const lastCandle = s.candles[s.candles.length - 1];
                    candleSeries.update(lastCandle);
                    volumeSeries.update({
                        time: lastCandle.time,
                        value: lastCandle.volume,
                        color:
                            lastCandle.close >= lastCandle.open
                                ? "rgba(8, 153, 129, 0.25)"
                                : "rgba(242, 54, 69, 0.25)",
                    });
                    deltaSeries.update({
                        time: lastCandle.time,
                        value: Math.abs(lastCandle.delta || 0),
                        color:
                            (lastCandle.delta || 0) >= 0
                                ? "rgba(34, 197, 94, 0.8)"
                                : "rgba(248, 113, 113, 0.8)",
                    });
                }
            }

            // Update primitives based on active mode
            if (s.isReplayMode) {
                // We'll calculate replay visuals if needed, but for now we just show what's relevant to the trade
                // Actually replay.js provides markers, but we should also show the OB/FVG/Lines of that trade
            }

            if (s.activeMode === "zones") {
                const filterStatus =
                    s.activeZoneTab === "active" ? "ACTIVE" : "MITIGATED";
                boxPrimitive.setData(
                    (s.zones || [])
                        .filter(
                            (z) =>
                                z.status === filterStatus &&
                                ((s.showFVG && z.label === "FVG") ||
                                    (s.showOB && z.label === "OB")),
                        )
                        .slice(-s.zoneLimit),
                );
                trendPrimitive.setData([]);
                regPrimitive.setData(null);
            } else if (s.activeMode === "lines") {
                boxPrimitive.setData([]);
                const visibleLines = s.showBrokenLines
                    ? s.lines || []
                    : (s.lines || []).filter((l) => l.status === "ACTIVE");
                trendPrimitive.setData(visibleLines);
                regPrimitive.setData(null);
            } else if (s.activeMode === "reglin") {
                boxPrimitive.setData([]);
                trendPrimitive.setData([]);
                regPrimitive.setData(s.channel);
            } else if (
                s.activeMode === "strat" ||
                s.activeMode === "trades" ||
                s.activeMode === "pnl"
            ) {
                if (s.isReplayMode && s.selectedTrade) {
                    // Show zones associated with this specific trade
                    const t = s.selectedTrade;
                    const boxes = [];
                    if (t.savedOB) boxes.push(t.savedOB);
                    if (t.savedFVG) boxes.push(t.savedFVG);
                    boxPrimitive.setData(boxes);

                    if (t.savedLine) {
                        trendPrimitive.setData([t.savedLine]);
                    } else {
                        trendPrimitive.setData([]);
                    }
                    regPrimitive.setData(null);
                } else {
                    boxPrimitive.setData([]);
                    trendPrimitive.setData([]);
                    regPrimitive.setData(null);
                }
            }

            // Replay Markers
            if (s.isReplayMode && s.selectedTrade) {
                const markers = getTradeMarkers(s.selectedTrade); // Fixed to use top-level import
                candleSeries.setMarkers(markers);
            } else if (candleSeries) {
                candleSeries.setMarkers([]);
            }
        });

        // Price Lines Reactivity
        const unsubscribePriceLines = state.subscribe((s) => {
            if (s.selectedTrade && s.isReplayMode) {
                updatePriceLines(s.selectedTrade);
            } else {
                clearPriceLines();
            }
        });

        import("../lib/logic/app_controller.js").then((m) =>
            m.setChartReference(chart),
        );

        return () => {
            window.removeEventListener("resize", handleResize);
            unsubscribe();
            unsubscribePriceLines();
            chart.remove();
        };
    });
</script>

<div bind:this={chartContainer} class="chart-container relative">
    {#if $state.isReplayMode}
        <div
            class="absolute top-4 left-1/2 -translate-x-1/2 bg-accent/90 backdrop-blur px-4 py-2 rounded-full border border-white/20 shadow-2xl flex items-center space-x-3 group cursor-pointer z-50"
        >
            <div class="flex items-center space-x-2">
                <span class="w-2 h-2 rounded-full bg-white animate-pulse"
                ></span>
                <span
                    class="text-[10px] font-bold text-white uppercase tracking-wider"
                    >Historical Replay Mode</span
                >
            </div>
            <div class="h-3 w-[1px] bg-white/30"></div>
            <button
                on:click={() =>
                    state.update((s) => ({ ...s, isReplayMode: false }))}
                class="text-[9px] text-white/80 font-bold uppercase hover:text-white"
                >Exit View</button
            >
        </div>
    {/if}
</div>

<style>
    .chart-container {
        width: 100%;
        height: 100%;
    }
</style>
