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
    import { calculateRSI, calculateMACD } from "../lib/logic/indicators.js";

    let chartContainer;
    let subChartContainer;
    let chart;
    let subChart;
    let candleSeries;
    let volumeSeries;
    let deltaSeries;
    let entryLine, tpLine, tp1Line, tp2Line, tp3Line, slLine, beLine;

    // Sub-pane series
    let subCvdSeries, subSmaSeries, subUpperBand, subLowerBand;
    let subRsiSeries, subRsiOb, subRsiOs, subRsiMid;
    let subMacdSeries, subSigSeries, subHistSeries;

    let activeSubPane = "CVD"; // "CVD", "RSI", "MACD", "VOL"

    function clearPriceLines() {
        if (!candleSeries) return;
        if (entryLine) { candleSeries.removePriceLine(entryLine); entryLine = null; }
        if (tpLine) { candleSeries.removePriceLine(tpLine); tpLine = null; }
        if (tp1Line) { candleSeries.removePriceLine(tp1Line); tp1Line = null; }
        if (tp2Line) { candleSeries.removePriceLine(tp2Line); tp2Line = null; }
        if (tp3Line) { candleSeries.removePriceLine(tp3Line); tp3Line = null; }
        if (slLine) { candleSeries.removePriceLine(slLine); slLine = null; }
        if (beLine) { candleSeries.removePriceLine(beLine); beLine = null; }
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

        slLine = candleSeries.createPriceLine({
            price: trade.sl,
            color: "#f23645",
            lineWidth: 2,
            lineStyle: 0,
            axisLabelVisible: true,
            title: "SL",
        });

        if (trade.tp1 || trade.tp) {
            tp1Line = candleSeries.createPriceLine({
                price: trade.tp1 || trade.tp,
                color: "#089981",
                lineWidth: 2,
                lineStyle: 0,
                axisLabelVisible: true,
                title: trade.tp2 ? "TP1 (50%)" : "TP",
            });
        }

        if (trade.tp2) {
            tp2Line = candleSeries.createPriceLine({
                price: trade.tp2,
                color: "#10b981",
                lineWidth: 2,
                lineStyle: 2,
                axisLabelVisible: true,
                title: "TP2 (25%)",
            });
        }

        if (trade.tp3) {
            tp3Line = candleSeries.createPriceLine({
                price: trade.tp3,
                color: "#34d399",
                lineWidth: 2,
                lineStyle: 2,
                axisLabelVisible: true,
                title: "TP3 (25%)",
            });
        }

        if (trade.status === 'WIN' && trade.tp1) {
            beLine = candleSeries.createPriceLine({
                price: trade.entry,
                color: "#eab308",
                lineWidth: 1,
                lineStyle: 1,
                axisLabelVisible: true,
                title: "BE (TRAIL)",
            });
        }
    }

    let boxPrimitive = new BoxPrimitive();
    let trendPrimitive = new TrendLinePrimitive();
    let regPrimitive = new LinearRegressionPrimitive();

    function initSubChart() {
        if (!subChartContainer || subChart) return;

        subChart = createChart(subChartContainer, {
            layout: {
                background: { type: "solid", color: "#080b0e" },
                textColor: "#94a3b8",
                fontFamily: "JetBrains Mono",
            },
            grid: {
                vertLines: { color: "#131722" },
                horzLines: { color: "#131722" },
            },
            crosshair: { mode: CrosshairMode.Normal },
            timeScale: {
                borderColor: "#242b3b",
                timeVisible: true,
                secondsVisible: false,
                visible: true,
            },
            rightPriceScale: { 
                borderColor: "#242b3b",
                scaleMargins: { top: 0.15, bottom: 0.15 }
            },
        });

        // TimeScale 1-to-1 sync
        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (subChart && range) {
                subChart.timeScale().setVisibleLogicalRange(range);
            }
        });
        subChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (chart && range) {
                chart.timeScale().setVisibleLogicalRange(range);
            }
        });

        updateSubChartData();
    }

    function destroySubChart() {
        if (subChart) {
            subChart.remove();
            subChart = null;
            subCvdSeries = null;
            subSmaSeries = null;
            subUpperBand = null;
            subLowerBand = null;
            subRsiSeries = null;
            subMacdSeries = null;
            subSigSeries = null;
            subHistSeries = null;
        }
    }

    function switchSubPane(mode) {
        activeSubPane = mode;
        destroySubChart();
        if (mode !== "VOL") {
            setTimeout(initSubChart, 50);
        }
    }

    function updateSubChartData() {
        if (!subChart) return;
        let s = {};
        state.update(curr => { s = curr; return curr; });
        const candles = s.candles || [];
        if (candles.length === 0) return;

        if (activeSubPane === "CVD") {
            const cvdPoints = s.cvdData?.points || [];
            if (cvdPoints.length > 0) {
                if (!subCvdSeries) {
                    subCvdSeries = subChart.addAreaSeries({
                        topColor: "rgba(59, 130, 246, 0.4)",
                        bottomColor: "rgba(59, 130, 246, 0.0)",
                        lineColor: "#3b82f6",
                        lineWidth: 2,
                        title: "CVD",
                    });
                    subSmaSeries = subChart.addLineSeries({
                        color: "#f59e0b",
                        lineWidth: 1.5,
                        title: "SMA 20",
                    });
                    subUpperBand = subChart.addLineSeries({
                        color: "rgba(239, 68, 68, 0.5)",
                        lineWidth: 1,
                        lineStyle: 2,
                        title: "+2σ",
                    });
                    subLowerBand = subChart.addLineSeries({
                        color: "rgba(34, 197, 94, 0.5)",
                        lineWidth: 1,
                        lineStyle: 2,
                        title: "-2σ",
                    });
                }
                subCvdSeries.setData(cvdPoints.map(p => ({ time: p.time, value: p.cvd })));
                subSmaSeries.setData(cvdPoints.map(p => ({ time: p.time, value: p.cvd_sma })));
                subUpperBand.setData(cvdPoints.map(p => ({ time: p.time, value: p.upper_band })));
                subLowerBand.setData(cvdPoints.map(p => ({ time: p.time, value: p.lower_band })));
            }
        } else if (activeSubPane === "RSI") {
            const rsiData = calculateRSI(candles, 14);
            if (rsiData.length > 0) {
                if (!subRsiSeries) {
                    subRsiSeries = subChart.addLineSeries({
                        color: "#a855f7",
                        lineWidth: 2,
                        title: "RSI 14",
                    });
                    subRsiOb = subChart.addLineSeries({
                        color: "rgba(244, 63, 94, 0.6)",
                        lineWidth: 1,
                        lineStyle: 2,
                        title: "OB (70)",
                    });
                    subRsiOs = subChart.addLineSeries({
                        color: "rgba(16, 185, 129, 0.6)",
                        lineWidth: 1,
                        lineStyle: 2,
                        title: "OS (30)",
                    });
                    subRsiMid = subChart.addLineSeries({
                        color: "rgba(148, 163, 184, 0.3)",
                        lineWidth: 1,
                        lineStyle: 1,
                    });
                }
                subRsiSeries.setData(rsiData);
                subRsiOb.setData(rsiData.map(r => ({ time: r.time, value: 70 })));
                subRsiOs.setData(rsiData.map(r => ({ time: r.time, value: 30 })));
                subRsiMid.setData(rsiData.map(r => ({ time: r.time, value: 50 })));
            }
        } else if (activeSubPane === "MACD") {
            const macdRes = calculateMACD(candles, 12, 26, 9);
            if (macdRes.macd.length > 0) {
                if (!subMacdSeries) {
                    subMacdSeries = subChart.addLineSeries({
                        color: "#38bdf8",
                        lineWidth: 1.5,
                        title: "MACD",
                    });
                    subSigSeries = subChart.addLineSeries({
                        color: "#fb923c",
                        lineWidth: 1.5,
                        title: "Signal",
                    });
                    subHistSeries = subChart.addHistogramSeries({
                        title: "Hist",
                    });
                }
                subMacdSeries.setData(macdRes.macd);
                subSigSeries.setData(macdRes.signal);
                subHistSeries.setData(macdRes.hist);
            }
        }
    }

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
            if (chartContainer && chart) {
                chart.applyOptions({
                    width: chartContainer.clientWidth,
                    height: chartContainer.clientHeight,
                });
            }
            if (subChartContainer && subChart) {
                subChart.applyOptions({
                    width: subChartContainer.clientWidth,
                    height: subChartContainer.clientHeight,
                });
            }
        };
        window.addEventListener("resize", handleResize);

        // Infinite scroll / pagination subscription
        let rangeDebounce = null;
        chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange) => {
            if (!logicalRange) return;
            if (logicalRange.from < 50) {
                if (rangeDebounce) clearTimeout(rangeDebounce);
                rangeDebounce = setTimeout(() => {
                    import("../lib/logic/app_controller.js").then((m) => {
                        m.loadOlderCandles();
                    });
                }, 120);
            }
        });

        // Initialize sub-chart pane
        setTimeout(initSubChart, 100);

        // Track previous candle and timeframe state
        let initialDataLoaded = false;
        let prevCandlesCount = 0;
        let prevEarliestTime = null;
        let currentActiveInterval = APP.interval;

        // Subscribe to state changes
        const unsubscribe = state.subscribe((s) => {
            if (!candleSeries) return;

            if (s.candles.length === 0) {
                initialDataLoaded = false;
                prevCandlesCount = 0;
                prevEarliestTime = null;
                return;
            }

            // Check if timeframe switched or first load
            if (APP.interval !== currentActiveInterval || !initialDataLoaded) {
                currentActiveInterval = APP.interval;
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
                prevCandlesCount = s.candles.length;
                prevEarliestTime = s.candles[0].time;
                chart.timeScale().fitContent();
                updateSubChartData();
            } else if (prevEarliestTime !== null && s.candles[0].time < prevEarliestTime) {
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
                prevCandlesCount = s.candles.length;
                prevEarliestTime = s.candles[0].time;
                updateSubChartData();
            } else {
                candleSeries.setData(s.candles);
                updateSubChartData();
            }

            // Visual primitives
            if (s.activeMode === "zones") {
                boxPrimitive.setData(s.zones || []);
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
                s.activeMode === "pnl" ||
                s.activeMode === "orderflow"
            ) {
                if (s.isReplayMode && s.selectedTrade) {
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
                const markers = getTradeMarkers(s.selectedTrade);
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
            destroySubChart();
            chart.remove();
        };
    });
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-bg relative min-w-0">
    <!-- Top Floating Toolbar: Indicator Sub-Pane Toggles -->
    <div class="absolute top-3 left-4 z-30 flex items-center gap-1.5 bg-black/70 backdrop-blur-md p-1 rounded-lg border border-border/50 shadow-2xl">
        <button 
            on:click={() => switchSubPane("CVD")}
            class="px-2.5 py-1 text-[9px] font-bold rounded transition-all {activeSubPane === 'CVD' ? 'bg-accent text-white shadow' : 'text-slate-400 hover:text-white'}"
            title="Cumulative Volume Delta (CVD Flow & 2σ Bands)"
        >
            ⚡ CVD FLOW
        </button>
        <button 
            on:click={() => switchSubPane("RSI")}
            class="px-2.5 py-1 text-[9px] font-bold rounded transition-all {activeSubPane === 'RSI' ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-white'}"
            title="Relative Strength Index (RSI 14)"
        >
            📊 RSI (14)
        </button>
        <button 
            on:click={() => switchSubPane("MACD")}
            class="px-2.5 py-1 text-[9px] font-bold rounded transition-all {activeSubPane === 'MACD' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'}"
            title="Moving Average Convergence Divergence (MACD 12,26,9)"
        >
            🌊 MACD
        </button>
        <button 
            on:click={() => switchSubPane("VOL")}
            class="px-2.5 py-1 text-[9px] font-bold rounded transition-all {activeSubPane === 'VOL' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'}"
            title="Standard Volume Histogram"
        >
            📦 VOL/DELTA
        </button>
    </div>

    <!-- Main Candlestick Chart (Flexible Height) -->
    <div bind:this={chartContainer} class="flex-1 w-full min-h-0 relative">
        {#if $state.isReplayMode && $state.selectedTrade}
            {@const t = $state.selectedTrade}
            <div
                class="absolute top-3 left-1/2 -translate-x-1/2 bg-black/85 backdrop-blur-md px-4 py-2 rounded-xl border border-accent/50 shadow-2xl flex items-center gap-4 z-50 text-[9.5px] font-mono"
            >
                <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full {t.status === 'WIN' ? 'bg-bull' : 'bg-bear'} animate-pulse"></span>
                    <span class="font-bold {t.type === 'LONG' ? 'text-bull' : 'text-bear'} text-[10px] uppercase">
                        {t.type} {t.outcome || t.status}
                    </span>
                    <span class="text-slate-400">
                        ({t.pnl >= 0 ? '+' : ''}{t.pnl?.toFixed(2)}R)
                    </span>
                </div>

                <div class="h-4 w-[1px] bg-border/60"></div>

                <!-- Price Levels -->
                <div class="flex items-center gap-2.5 text-slate-300">
                    <span>Entry: <strong class="text-white">${t.entry?.toFixed(2)}</strong></span>
                    <span>SL: <strong class="text-bear">${t.sl?.toFixed(2)}</strong></span>
                    <span>
                        {#if t.tp1}
                            TP1: <strong class="text-bull">${t.tp1?.toFixed(2)}</strong>
                            {#if t.tp2} | TP2: <strong class="text-bull">${t.tp2?.toFixed(2)}</strong>{/if}
                            {#if t.tp3} | TP3: <strong class="text-bull">${t.tp3?.toFixed(2)}</strong>{/if}
                        {:else}
                            TP: <strong class="text-bull">${t.tp?.toFixed(2)}</strong>
                        {/if}
                    </span>
                </div>

                <div class="h-4 w-[1px] bg-border/60"></div>

                <!-- Indicator Confluence -->
                <div class="flex items-center gap-2 text-slate-400">
                    <span class="bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded text-[8.5px] font-bold">
                        Score: {t.setupScore?.toFixed(0) || t.score || 70}
                    </span>
                    {#if t.desc}
                        <span class="text-slate-300 font-sans text-[9px] max-w-[200px] truncate" title={t.desc}>
                            {t.desc}
                        </span>
                    {/if}
                </div>

                <button
                    on:click={() => state.update((s) => ({ ...s, isReplayMode: false }))}
                    class="bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded text-[8.5px] font-bold uppercase transition-colors"
                >
                    Exit
                </button>
            </div>
        {/if}

        {#if $state.isLoadingMore}
            <div
                class="absolute top-4 right-4 bg-black/80 backdrop-blur px-3 py-1.5 rounded-lg border border-accent/40 shadow-xl flex items-center space-x-2 z-40 text-accent text-[10px] font-mono animate-pulse"
            >
                <i class="fas fa-spinner fa-spin text-xs"></i>
                <span>Loading older history...</span>
            </div>
        {/if}
    </div>

    <!-- Synchronized Sub-Indicator Pane -->
    {#if activeSubPane !== "VOL"}
        <div class="h-44 w-full border-t border-border/60 bg-[#080b0e] relative flex flex-col">
            <div class="absolute top-1.5 left-3 text-[9px] font-mono text-slate-400 pointer-events-none flex items-center gap-3 z-10">
                <span class="font-bold text-white uppercase tracking-wider">
                    {#if activeSubPane === 'CVD'}
                        ⚡ CVD OSCILLATOR & FLOW BANDS (±2σ)
                    {:else if activeSubPane === 'RSI'}
                        📊 RSI (14) OSCILLATOR [OB: 70 | OS: 30]
                    {:else if activeSubPane === 'MACD'}
                        🌊 MACD (12, 26, 9) [MACD, SIGNAL, HISTOGRAM]
                    {/if}
                </span>
            </div>
            <div bind:this={subChartContainer} class="flex-1 w-full"></div>
        </div>
    {/if}
</div>

<style>
    /* Chart container responsive styling */
</style>
