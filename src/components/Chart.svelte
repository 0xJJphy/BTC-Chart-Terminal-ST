<script>
    import { onMount, onDestroy } from "svelte";
    import { get } from "svelte/store";
    import { createChart, CrosshairMode } from "lightweight-charts";
    import { state, APP } from "../lib/stores/app.js";
    import {
        BoxPrimitive,
        TrendLinePrimitive,
        LinearRegressionPrimitive,
        TradeExecutionPrimitive,
    } from "../lib/logic/chart_utils.js";
    import {
        calculateRSI,
        calculateMACD,
        calculateDMI_ADX,
        calculateAnchoredCVD,
        calculateDER,
        calculateFragility,
        calculateVolumeDelta,
    } from "../lib/logic/indicators.js";

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
    let subZScoreHist, subZScoreUpper, subZScoreLower;
    let subDerHist, subDerHighThresh, subDerLowThresh;
    let subFragilityHist, subFragilityWarning;
    let subRsiSeries, subRsiOb, subRsiOs, subRsiMid;
    let subMacdSeries, subSigSeries, subHistSeries;
    let subAdxSeries, subDiPlusSeries, subDiMinusSeries, subAdxThreshold;
    let subVolDeltaHist, subVolSmaSeries;

    let activeSubPane = "CVD"; // "CVD", "Z_SCORE", "DER", "FRAGILITY", "VOL", "RSI", "MACD", "ADX"

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
        // Infinite full-chart lines disabled: bounded lines are now drawn strictly between entry and exit candles by TradeExecutionPrimitive
    }

    let boxPrimitive = new BoxPrimitive();
    let trendPrimitive = new TrendLinePrimitive();
    let regPrimitive = new LinearRegressionPrimitive();
    let tradeExecPrimitive = new TradeExecutionPrimitive();

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

        // TimeScale 1-to-1 sync with recursion guard
        let isSyncing = false;
        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (subChart && range && !isSyncing) {
                isSyncing = true;
                try {
                    subChart.timeScale().setVisibleLogicalRange(range);
                } finally {
                    isSyncing = false;
                }
            }
        });
        subChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (chart && range && !isSyncing) {
                isSyncing = true;
                try {
                    chart.timeScale().setVisibleLogicalRange(range);
                } finally {
                    isSyncing = false;
                }
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
            subZScoreHist = null;
            subZScoreUpper = null;
            subZScoreLower = null;
            subDerHist = null;
            subDerHighThresh = null;
            subDerLowThresh = null;
            subFragilityHist = null;
            subFragilityWarning = null;
            subRsiSeries = null;
            subRsiOb = null;
            subRsiOs = null;
            subRsiMid = null;
            subMacdSeries = null;
            subSigSeries = null;
            subHistSeries = null;
            subAdxSeries = null;
            subDiPlusSeries = null;
            subDiMinusSeries = null;
            subAdxThreshold = null;
            subVolDeltaHist = null;
            subVolSmaSeries = null;
        }
    }

    function switchSubPane(mode) {
        activeSubPane = mode;
        destroySubChart();
        setTimeout(initSubChart, 50);
    }

    function updateSubChartData(passedState = null) {
        if (!subChart) return;
        const s = passedState || get(state);
        const candles = s.candles || [];
        if (candles.length === 0) return;

        if (activeSubPane === "CVD") {
            const cvdRes = calculateAnchoredCVD(candles, s.cvdAnchor || 'daily', 20);
            if (cvdRes.cvd.length > 0) {
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
                        color: "rgba(239, 68, 68, 0.6)",
                        lineWidth: 1,
                        lineStyle: 2,
                        title: "+2σ",
                    });
                    subLowerBand = subChart.addLineSeries({
                        color: "rgba(34, 197, 94, 0.6)",
                        lineWidth: 1,
                        lineStyle: 2,
                        title: "-2σ",
                    });
                }
                subCvdSeries.setData(cvdRes.cvd);
                subSmaSeries.setData(cvdRes.sma);
                subUpperBand.setData(cvdRes.upper);
                subLowerBand.setData(cvdRes.lower);
            }
        } else if (activeSubPane === "Z_SCORE") {
            const cvdRes = calculateAnchoredCVD(candles, s.cvdAnchor || 'daily', 20);
            if (cvdRes.zScore.length > 0) {
                if (!subZScoreHist) {
                    subZScoreHist = subChart.addHistogramSeries({
                        title: "CVD Z-Score",
                    });
                    subZScoreUpper = subChart.addLineSeries({
                        color: "rgba(239, 68, 68, 0.7)",
                        lineWidth: 1,
                        lineStyle: 2,
                        title: "+2σ Exp",
                    });
                    subZScoreLower = subChart.addLineSeries({
                        color: "rgba(34, 197, 94, 0.7)",
                        lineWidth: 1,
                        lineStyle: 2,
                        title: "-2σ Comp",
                    });
                }
                subZScoreHist.setData(cvdRes.zScore);
                subZScoreUpper.setData(cvdRes.zScore.map(z => ({ time: z.time, value: 2.0 })));
                subZScoreLower.setData(cvdRes.zScore.map(z => ({ time: z.time, value: -2.0 })));
            }
        } else if (activeSubPane === "DER") {
            const derData = calculateDER(candles, 14);
            if (derData.length > 0) {
                if (!subDerHist) {
                    subDerHist = subChart.addHistogramSeries({
                        title: "DER ($/Δ)",
                    });
                    subDerHighThresh = subChart.addLineSeries({
                        color: "rgba(16, 185, 129, 0.7)",
                        lineWidth: 1,
                        lineStyle: 2,
                        title: "Alta Eficiencia (5.0)",
                    });
                    subDerLowThresh = subChart.addLineSeries({
                        color: "rgba(244, 63, 94, 0.7)",
                        lineWidth: 1,
                        lineStyle: 2,
                        title: "Absorción Pasiva (1.0)",
                    });
                }
                subDerHist.setData(derData);
                subDerHighThresh.setData(derData.map(d => ({ time: d.time, value: 5.0 })));
                subDerLowThresh.setData(derData.map(d => ({ time: d.time, value: 1.0 })));
            }
        } else if (activeSubPane === "FRAGILITY") {
            const fragData = calculateFragility(candles, 20);
            if (fragData.length > 0) {
                if (!subFragilityHist) {
                    subFragilityHist = subChart.addHistogramSeries({
                        title: "Fragilidad (Ψ)",
                    });
                    subFragilityWarning = subChart.addLineSeries({
                        color: "rgba(239, 68, 68, 0.7)",
                        lineWidth: 1,
                        lineStyle: 2,
                        title: "Alerta Vacío (100)",
                    });
                }
                subFragilityHist.setData(fragData);
                subFragilityWarning.setData(fragData.map(f => ({ time: f.time, value: 100 })));
            }
        } else if (activeSubPane === "VOL") {
            const volData = calculateVolumeDelta(candles, 20);
            if (volData.delta.length > 0) {
                if (!subVolDeltaHist) {
                    subVolDeltaHist = subChart.addHistogramSeries({
                        title: "Delta",
                    });
                    subVolSmaSeries = subChart.addLineSeries({
                        color: "#f59e0b",
                        lineWidth: 1.5,
                        title: "Vol SMA 20",
                    });
                }
                subVolDeltaHist.setData(volData.delta);
                subVolSmaSeries.setData(volData.sma);
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
        } else if (activeSubPane === "ADX") {
            const dmiRes = calculateDMI_ADX(candles, 14);
            if (dmiRes.adx.length > 0) {
                if (!subAdxSeries) {
                    subAdxSeries = subChart.addLineSeries({
                        color: "#eab308",
                        lineWidth: 2,
                        title: "ADX (14)",
                    });
                    subDiPlusSeries = subChart.addLineSeries({
                        color: "#10b981",
                        lineWidth: 1.5,
                        title: "+DI",
                    });
                    subDiMinusSeries = subChart.addLineSeries({
                        color: "#f43f5e",
                        lineWidth: 1.5,
                        title: "-DI",
                    });
                    subAdxThreshold = subChart.addLineSeries({
                        color: "rgba(255, 255, 255, 0.4)",
                        lineWidth: 1,
                        lineStyle: 2,
                        title: "Trend (25)",
                    });
                }
                subAdxSeries.setData(dmiRes.adx);
                subDiPlusSeries.setData(dmiRes.diPlus);
                subDiMinusSeries.setData(dmiRes.diMinus);
                subAdxThreshold.setData(dmiRes.adx.map(a => ({ time: a.time, value: 25 })));
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
        candleSeries.attachPrimitive(tradeExecPrimitive);

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
                tradeExecPrimitive.setData(t);
            } else {
                tradeExecPrimitive.setData(null);
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
            on:click={() => switchSubPane("Z_SCORE")}
            class="px-2.5 py-1 text-[9px] font-bold rounded transition-all {activeSubPane === 'Z_SCORE' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'}"
            title="Anchored CVD Z-Score Series (±2σ Breakout Bands)"
        >
            🌊 Z-SCORE
        </button>
        <button 
            on:click={() => switchSubPane("DER")}
            class="px-2.5 py-1 text-[9px] font-bold rounded transition-all {activeSubPane === 'DER' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}"
            title="Delta Efficiency Ratio ($ Price Delta / Delta Volume)"
        >
            ⚡ DER
        </button>
        <button 
            on:click={() => switchSubPane("FRAGILITY")}
            class="px-2.5 py-1 text-[9px] font-bold rounded transition-all {activeSubPane === 'FRAGILITY' ? 'bg-rose-600 text-white shadow' : 'text-slate-400 hover:text-white'}"
            title="Liquidity Fragility Index (Ψ = Price Impact / Vol)"
        >
            🛡️ FRAGILITY
        </button>
        <button 
            on:click={() => switchSubPane("VOL")}
            class="px-2.5 py-1 text-[9px] font-bold rounded transition-all {activeSubPane === 'VOL' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'}"
            title="Volume Delta & SMA Histogram"
        >
            📦 VOL/DELTA
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
            class="px-2.5 py-1 text-[9px] font-bold rounded transition-all {activeSubPane === 'MACD' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'}"
            title="Moving Average Convergence Divergence (MACD 12,26,9)"
        >
            🌊 MACD
        </button>
        <button 
            on:click={() => switchSubPane("ADX")}
            class="px-2.5 py-1 text-[9px] font-bold rounded transition-all {activeSubPane === 'ADX' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}"
            title="Average Directional Index & DMI (+DI / -DI)"
        >
            📈 ADX / DMI
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
