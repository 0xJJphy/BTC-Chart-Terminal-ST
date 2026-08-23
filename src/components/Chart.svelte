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
    import { getTradeMarkers } from "../lib/logic/replay.js";
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
    let subVolDeltaHist, subVolSmaSeries;
    let isTradeSummaryCollapsed = false;

    // Multi-Sub-Pane Engine
    let activeSubPanes = ["CVD"];
    const paneInstances = new Map(); // key -> { chart, series, unsubs, node }

    const SUB_PANE_DEFS = {
        CVD: { label: "⚡ CVD OSCILLATOR & FLOW BANDS (±2σ)", color: "bg-accent", title: "CVD FLOW", icon: "fa-bolt" },
        Z_SCORE: { label: "🌊 CVD Z-SCORE (±2σ BREAKOUT BANDS)", color: "bg-cyan-600", title: "Z-SCORE", icon: "fa-water" },
        DER: { label: "⚡ DELTA EFFICIENCY RATIO (DER NORM)", color: "bg-indigo-600", title: "DER", icon: "fa-chart-line" },
        FRAGILITY: { label: "🛡️ LIQUIDITY FRAGILITY INDEX (Ψ NORM)", color: "bg-rose-600", title: "FRAGILITY", icon: "fa-shield-halved" },
        RSI: { label: "📊 RELATIVE STRENGTH INDEX (RSI 14)", color: "bg-purple-600", title: "RSI (14)", icon: "fa-chart-area" },
        MACD: { label: "🌊 MACD (12, 26, 9) [MACD, SIGNAL, HIST]", color: "bg-sky-600", title: "MACD", icon: "fa-wave-square" },
        ADX: { label: "📈 ADX & DMI [ADX, +DI, -DI]", color: "bg-amber-600", title: "ADX / DMI", icon: "fa-arrow-trend-up" }
    };

    function toggleSubPane(key) {
        let nextPanes;
        if (activeSubPanes.includes(key)) {
            nextPanes = activeSubPanes.filter(k => k !== key);
            const inst = paneInstances.get(key);
            if (inst) {
                inst.chart.remove();
                paneInstances.delete(key);
            }
        } else {
            nextPanes = [...activeSubPanes, key];
        }
        activeSubPanes = nextPanes;
        state.update(s => ({ ...s, activeSubPanes: nextPanes }));
    }

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
    }

    let boxPrimitive = new BoxPrimitive();
    let trendPrimitive = new TrendLinePrimitive();
    let regPrimitive = new LinearRegressionPrimitive();
    let tradeExecPrimitive = new TradeExecutionPrimitive();

    let isSyncingRange = false;
    function broadcastLogicalRange(sourceChart, range) {
        if (!range || isSyncingRange) return;
        isSyncingRange = true;
        try {
            if (chart && chart !== sourceChart) {
                chart.timeScale().setVisibleLogicalRange(range);
            }
            paneInstances.forEach((inst) => {
                if (inst.chart && inst.chart !== sourceChart) {
                    inst.chart.timeScale().setVisibleLogicalRange(range);
                }
            });
        } catch (e) {
            // Ignore during disposal
        } finally {
            isSyncingRange = false;
        }
    }

    function initSubPaneAction(node, paneKey) {
        const subChart = createChart(node, {
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

        // ResizeObserver for subchart
        const subRo = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0 && subChart) {
                    subChart.applyOptions({ width, height });
                }
            }
        });
        subRo.observe(node);

        const subListener = (range) => {
            broadcastLogicalRange(subChart, range);
        };
        subChart.timeScale().subscribeVisibleLogicalRangeChange(subListener);

        const inst = { chart: subChart, series: {}, node, ro: subRo, subListener };
        paneInstances.set(paneKey, inst);

        renderPaneSeries(paneKey, inst);
        updateSinglePaneData(paneKey, inst, get(state));

        // Sync initial range immediately
        if (chart) {
            const mainRange = chart.timeScale().getVisibleLogicalRange();
            if (mainRange) {
                try { subChart.timeScale().setVisibleLogicalRange(mainRange); } catch (e) {}
            }
        }

        return {
            destroy() {
                subRo.disconnect();
                try { subChart.timeScale().unsubscribeVisibleLogicalRangeChange(subListener); } catch (e) {}
                try { subChart.remove(); } catch (e) {}
                paneInstances.delete(paneKey);
                if (chartContainer && chart) {
                    setTimeout(() => {
                        chart.applyOptions({
                            width: chartContainer.clientWidth,
                            height: chartContainer.clientHeight
                        });
                    }, 30);
                }
            }
        };
    }

    function renderPaneSeries(paneKey, inst) {
        const sc = inst.chart;
        if (paneKey === "CVD") {
            inst.series.cvd = sc.addAreaSeries({
                topColor: "rgba(59, 130, 246, 0.4)",
                bottomColor: "rgba(59, 130, 246, 0.0)",
                lineColor: "#3b82f6",
                lineWidth: 2,
                title: "CVD",
            });
            inst.series.sma = sc.addLineSeries({
                color: "#f59e0b",
                lineWidth: 1.5,
                title: "SMA 20",
            });
        } else if (paneKey === "Z_SCORE") {
            inst.series.hist = sc.addHistogramSeries({ title: "CVD Z-Score" });
        } else if (paneKey === "DER") {
            inst.series.hist = sc.addHistogramSeries({ title: "DER Norm" });
        } else if (paneKey === "FRAGILITY") {
            inst.series.hist = sc.addHistogramSeries({ title: "Fragilidad (Ψ)" });
        } else if (paneKey === "RSI") {
            inst.series.rsi = sc.addLineSeries({
                color: "#a855f7",
                lineWidth: 2,
                title: "RSI 14",
            });
        } else if (paneKey === "MACD") {
            inst.series.macd = sc.addLineSeries({ color: "#38bdf8", lineWidth: 1.5, title: "MACD" });
            inst.series.signal = sc.addLineSeries({ color: "#fb923c", lineWidth: 1.5, title: "Signal" });
            inst.series.hist = sc.addHistogramSeries({ title: "Hist" });
        } else if (paneKey === "ADX") {
            inst.series.adx = sc.addLineSeries({ color: "#eab308", lineWidth: 2, title: "ADX" });
            inst.series.diPlus = sc.addLineSeries({ color: "#10b981", lineWidth: 1.5, title: "+DI" });
            inst.series.diMinus = sc.addLineSeries({ color: "#f43f5e", lineWidth: 1.5, title: "-DI" });
        }
    }

    function updateSinglePaneData(paneKey, inst, s) {
        const candles = s?.candles || [];
        if (candles.length === 0 || !inst.series) return;

        const isReplay = s.isReplayMode && s.selectedTrade;
        const t = s.selectedTrade;
        const tTime = t ? (t.entryTime || t.signalTime || t.time) : null;

        if (paneKey === "CVD" && inst.series.cvd) {
            const cvdRes = calculateAnchoredCVD(candles, s.cvdAnchor || 'daily', 20);
            if (cvdRes.cvd.length > 0) {
                inst.series.cvd.setData(cvdRes.cvd);
                inst.series.sma.setData(cvdRes.sma);

                if (isReplay && tTime) {
                    const volRatio = t.dashboardSnapshot?.volumeRatio ? `${t.dashboardSnapshot.volumeRatio}x` : '';
                    const volState = t.dashboardSnapshot?.volumeState || 'CONFIRMADO';
                    inst.series.cvd.setMarkers([
                        {
                            time: tTime,
                            position: 'inBar',
                            color: '#3b82f6',
                            shape: 'circle',
                            text: `● CVD ${volRatio} (${volState}) ✓`
                        }
                    ]);
                } else {
                    inst.series.cvd.setMarkers([]);
                }
            }
        } else if (paneKey === "Z_SCORE" && inst.series.hist) {
            const cvdRes = calculateAnchoredCVD(candles, s.cvdAnchor || 'daily', 20);
            if (cvdRes.zScore.length > 0) {
                inst.series.hist.setData(cvdRes.zScore);

                if (isReplay && tTime) {
                    const pt = cvdRes.zScore.find(d => d.time === tTime);
                    const zVal = pt ? pt.value.toFixed(2) : '0.00';
                    inst.series.hist.setMarkers([
                        {
                            time: tTime,
                            position: 'inBar',
                            color: '#06b6d4',
                            shape: 'circle',
                            text: `● Z-Score: ${zVal}σ ✓`
                        }
                    ]);
                } else {
                    inst.series.hist.setMarkers([]);
                }
            }
        } else if (paneKey === "DER" && inst.series.hist) {
            const derData = calculateDER(candles, 14);
            if (derData.length > 0) {
                inst.series.hist.setData(derData);

                if (isReplay && tTime) {
                    const pt = derData.find(d => d.time === tTime);
                    const derVal = pt ? pt.value.toFixed(2) : '1.00';
                    inst.series.hist.setMarkers([
                        {
                            time: tTime,
                            position: 'inBar',
                            color: '#6366f1',
                            shape: 'circle',
                            text: `● DER: ${derVal} ✓`
                        }
                    ]);
                } else {
                    inst.series.hist.setMarkers([]);
                }
            }
        } else if (paneKey === "FRAGILITY" && inst.series.hist) {
            const fragData = calculateFragility(candles, 20);
            if (fragData.length > 0) {
                inst.series.hist.setData(fragData);

                if (isReplay && tTime) {
                    const pt = fragData.find(d => d.time === tTime);
                    const fragVal = pt ? pt.value.toFixed(2) : '1.00';
                    inst.series.hist.setMarkers([
                        {
                            time: tTime,
                            position: 'inBar',
                            color: '#f43f5e',
                            shape: 'circle',
                            text: `● Fragilidad: ${fragVal}Ψ ✓`
                        }
                    ]);
                } else {
                    inst.series.hist.setMarkers([]);
                }
            }
        } else if (paneKey === "RSI" && inst.series.rsi) {
            const rsiData = calculateRSI(candles, 14);
            if (rsiData.length > 0) {
                inst.series.rsi.setData(rsiData);

                if (isReplay && tTime) {
                    const pt = rsiData.find(d => d.time === tTime);
                    const rsiVal = t.dashboardSnapshot?.rsiValue ?? (pt ? pt.value.toFixed(1) : '');
                    const rsiState = t.dashboardSnapshot?.rsiState || (rsiVal >= 70 ? 'OB' : rsiVal <= 30 ? 'OS' : 'MOM');
                    inst.series.rsi.setMarkers([
                        {
                            time: tTime,
                            position: 'inBar',
                            color: '#a855f7',
                            shape: 'circle',
                            text: `● RSI: ${rsiVal} (${rsiState}) ✓`
                        }
                    ]);
                } else {
                    inst.series.rsi.setMarkers([]);
                }
            }
        } else if (paneKey === "MACD" && inst.series.macd) {
            const macdRes = calculateMACD(candles, 12, 26, 9);
            if (macdRes.macd.length > 0) {
                inst.series.macd.setData(macdRes.macd);
                inst.series.signal.setData(macdRes.signal);
                inst.series.hist.setData(macdRes.hist);

                if (isReplay && tTime) {
                    const pt = macdRes.hist.find(d => d.time === tTime);
                    const macdState = t.dashboardSnapshot?.macdState || (pt && pt.value >= 0 ? 'ALCISTA' : 'BAJISTA');
                    inst.series.macd.setMarkers([
                        {
                            time: tTime,
                            position: 'inBar',
                            color: '#38bdf8',
                            shape: 'circle',
                            text: `● MACD: ${macdState} ✓`
                        }
                    ]);
                } else {
                    inst.series.macd.setMarkers([]);
                }
            }
        } else if (paneKey === "ADX" && inst.series.adx) {
            const dmiRes = calculateDMI_ADX(candles, 14);
            if (dmiRes.adx.length > 0) {
                inst.series.adx.setData(dmiRes.adx);
                inst.series.diPlus.setData(dmiRes.diPlus);
                inst.series.diMinus.setData(dmiRes.diMinus);

                if (isReplay && tTime) {
                    const pt = dmiRes.adx.find(d => d.time === tTime);
                    const adxVal = t.dashboardSnapshot?.adxValue ?? (pt ? pt.value.toFixed(1) : '');
                    const adxRegime = t.dashboardSnapshot?.adxRegime || (adxVal >= 25 ? 'FUERTE' : 'RANGO');
                    inst.series.adx.setMarkers([
                        {
                            time: tTime,
                            position: 'inBar',
                            color: '#eab308',
                            shape: 'circle',
                            text: `● ADX: ${adxVal} (${adxRegime}) ✓`
                        }
                    ]);
                } else {
                    inst.series.adx.setMarkers([]);
                }
            }
        }
    }

    function updateAllSubPanes(passedState = null) {
        const s = passedState || get(state);
        paneInstances.forEach((inst, key) => {
            updateSinglePaneData(key, inst, s);
        });
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

        const mainRo = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0 && chart) {
                    chart.applyOptions({ width, height });
                }
            }
        });
        if (chartContainer) mainRo.observe(chartContainer);

        const handleResize = () => {
            if (chartContainer && chart) {
                chart.applyOptions({
                    width: chartContainer.clientWidth,
                    height: chartContainer.clientHeight,
                });
            }
            paneInstances.forEach((inst) => {
                if (inst.node && inst.chart) {
                    inst.chart.applyOptions({
                        width: inst.node.clientWidth,
                        height: inst.node.clientHeight,
                    });
                }
            });
        };
        window.addEventListener("resize", handleResize);

        // Infinite scroll / pagination subscription & broadcast
        let rangeDebounce = null;
        chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange) => {
            if (!logicalRange) return;
            broadcastLogicalRange(chart, logicalRange);
            if (logicalRange.from < 50) {
                if (rangeDebounce) clearTimeout(rangeDebounce);
                rangeDebounce = setTimeout(() => {
                    import("../lib/logic/app_controller.js").then((m) => {
                        m.loadOlderCandles();
                    });
                }, 120);
            }
        });

        // Track previous candle and timeframe state
        let initialDataLoaded = false;
        let prevCandlesCount = 0;
        let prevEarliestTime = null;
        let currentActiveInterval = APP.interval;
        let prevIsReplayMode = false;
        let prevSelectedTrade = null;

        // Subscribe to state changes
        const unsubscribe = state.subscribe((s) => {
            if (s.activeSubPanes && Array.isArray(s.activeSubPanes) && JSON.stringify(s.activeSubPanes) !== JSON.stringify(activeSubPanes)) {
                activeSubPanes = [...s.activeSubPanes];
            }

            if (!candleSeries) return;

            if (s.candles.length === 0) {
                initialDataLoaded = false;
                prevCandlesCount = 0;
                prevEarliestTime = null;
                return;
            }

            const enteringReplay = s.isReplayMode && s.selectedTrade && (!prevIsReplayMode || s.selectedTrade !== prevSelectedTrade);
            const exitingReplay = prevIsReplayMode && !s.isReplayMode;
            prevIsReplayMode = s.isReplayMode;
            prevSelectedTrade = s.selectedTrade;

            if (enteringReplay) {
                candleSeries.setData(s.candles);
                volumeSeries.setData(
                    s.candles.map((c) => ({
                        time: c.time,
                        value: c.volume,
                        color: c.close >= c.open ? "rgba(8, 153, 129, 0.25)" : "rgba(242, 54, 69, 0.25)",
                    })),
                );
                deltaSeries.setData(
                    s.candles.map((c) => ({
                        time: c.time,
                        value: Math.abs(c.delta || 0),
                        color: (c.delta || 0) >= 0 ? "rgba(34, 197, 94, 0.8)" : "rgba(248, 113, 113, 0.8)",
                    })),
                );
                updateAllSubPanes(s);

                const tTime = Number(s.selectedTrade.entryTime || s.selectedTrade.entry_time || s.selectedTrade.time);
                let tradeIdx = s.candles.findIndex((c) => c.time >= tTime);
                if (tradeIdx === -1) tradeIdx = Math.floor(s.candles.length / 2);

                const replayRange = {
                    from: Math.max(0, tradeIdx - 35),
                    to: Math.min(s.candles.length - 1, tradeIdx + 45),
                };
                chart.timeScale().setVisibleLogicalRange(replayRange);
                paneInstances.forEach((inst) => {
                    try { inst.chart.timeScale().setVisibleLogicalRange(replayRange); } catch (e) {}
                });
            } else if (exitingReplay) {
                candleSeries.setData(s.candles);
                volumeSeries.setData(
                    s.candles.map((c) => ({
                        time: c.time,
                        value: c.volume,
                        color: c.close >= c.open ? "rgba(8, 153, 129, 0.25)" : "rgba(242, 54, 69, 0.25)",
                    })),
                );
                deltaSeries.setData(
                    s.candles.map((c) => ({
                        time: c.time,
                        value: Math.abs(c.delta || 0),
                        color: (c.delta || 0) >= 0 ? "rgba(34, 197, 94, 0.8)" : "rgba(248, 113, 113, 0.8)",
                    })),
                );
                updateAllSubPanes(s);

                const n = s.candles.length;
                const liveRange = {
                    from: Math.max(0, n - 130),
                    to: n + 8,
                };
                chart.timeScale().setVisibleLogicalRange(liveRange);
                paneInstances.forEach((inst) => {
                    try { inst.chart.timeScale().setVisibleLogicalRange(liveRange); } catch (e) {}
                });
            } else if (APP.interval !== currentActiveInterval || !initialDataLoaded) {
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
                const n = s.candles.length;
                if (n > 0) {
                    const targetRange = {
                        from: Math.max(0, n - 130),
                        to: n + 8,
                    };
                    chart.timeScale().setVisibleLogicalRange(targetRange);
                    paneInstances.forEach((inst) => {
                        try { inst.chart.timeScale().setVisibleLogicalRange(targetRange); } catch (e) {}
                    });
                }
                updateAllSubPanes(s);
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
                updateAllSubPanes(s);
            } else {
                candleSeries.setData(s.candles);
                updateAllSubPanes(s);
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
            mainRo.disconnect();
            window.removeEventListener("resize", handleResize);
            unsubscribe();
            unsubscribePriceLines();
            paneInstances.forEach((inst) => {
                if (inst.ro) inst.ro.disconnect();
                try { inst.chart.remove(); } catch (e) {}
            });
            paneInstances.clear();
            chart.remove();
        };
    });
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-bg relative min-w-0">
    <!-- Top Floating Toolbar: Multi-Indicator Sub-Pane Toggles -->
    <div class="absolute top-3 left-4 z-30 flex items-center gap-1.5 bg-black/75 backdrop-blur-md p-1 rounded-lg border border-border/50 shadow-2xl">
        {#each Object.entries(SUB_PANE_DEFS) as [key, def]}
            <button 
                on:click={() => toggleSubPane(key)}
                class="px-2.5 py-1 text-[9px] font-bold rounded transition-all flex items-center gap-1.5 {activeSubPanes.includes(key) ? `${def.color} text-white shadow-lg ring-1 ring-white/30` : 'text-slate-400 hover:text-white bg-white/5'}"
                title={def.label}
            >
                <i class="fas {def.icon} text-[8.5px]"></i>
                <span>{def.title}</span>
            </button>
        {/each}
    </div>

    <!-- Main Candlestick Chart (Flexible Height) -->
    <div bind:this={chartContainer} class="flex-1 w-full min-h-0 relative">
        {#if $state.isReplayMode && $state.selectedTrade}
            {@const t = $state.selectedTrade}
            <div
                class="absolute top-3 left-1/2 -translate-x-1/2 bg-black/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-accent/50 shadow-2xl flex items-center gap-3 z-50 text-[9.5px] font-mono transition-all"
            >
                <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full {t.status === 'WIN' ? 'bg-bull' : 'bg-bear'} animate-pulse"></span>
                    <span class="font-bold {t.type === 'LONG' ? 'text-bull' : 'text-bear'} text-[10px] uppercase">
                        {t.type} {t.outcome || t.status}
                    </span>
                    <span class="text-slate-400 font-bold">
                        ({t.pnl >= 0 ? '+' : ''}{t.pnl?.toFixed(2)}R)
                    </span>
                </div>

                {#if !isTradeSummaryCollapsed}
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

                    <!-- Multi-Indicator Confluence Audit Matrix -->
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="bg-blue-900/50 text-blue-300 border border-blue-500/30 px-1.5 py-0.5 rounded text-[8px] font-bold">
                            Score: {t.setupScore?.toFixed(0) || t.score || 70}
                        </span>
                        {#if t.dashboardSnapshot?.rsiValue}
                            <span class="bg-purple-950/80 text-purple-200 border border-purple-500/40 px-1.5 py-0.5 rounded text-[8px] font-bold flex items-center gap-1">
                                <span class="w-1.5 h-1.5 rounded-full bg-purple-400"></span> RSI: {t.dashboardSnapshot.rsiValue}
                            </span>
                        {/if}
                        {#if t.dashboardSnapshot?.macdState}
                            <span class="bg-sky-950/80 text-sky-200 border border-sky-500/40 px-1.5 py-0.5 rounded text-[8px] font-bold flex items-center gap-1">
                                <span class="w-1.5 h-1.5 rounded-full bg-sky-400"></span> MACD: {t.dashboardSnapshot.macdState}
                            </span>
                        {/if}
                        {#if t.dashboardSnapshot?.adxValue}
                            <span class="bg-amber-950/80 text-amber-200 border border-amber-500/40 px-1.5 py-0.5 rounded text-[8px] font-bold flex items-center gap-1">
                                <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> ADX: {t.dashboardSnapshot.adxValue}
                            </span>
                        {/if}
                        {#if t.dashboardSnapshot?.volumeRatio}
                            <span class="bg-blue-950/80 text-blue-200 border border-blue-500/40 px-1.5 py-0.5 rounded text-[8px] font-bold flex items-center gap-1">
                                <span class="w-1.5 h-1.5 rounded-full bg-blue-400"></span> Vol: {t.dashboardSnapshot.volumeRatio}x
                            </span>
                        {/if}
                        {#if t.srLevel}
                            <span class="bg-cyan-950/80 text-cyan-200 border border-cyan-500/40 px-1.5 py-0.5 rounded text-[8px] font-bold flex items-center gap-1">
                                <span class="w-1.5 h-1.5 rounded-full bg-cyan-400"></span> S/R: ${t.srLevel.toFixed(1)}
                            </span>
                        {/if}
                        {#if t.desc}
                            <span class="text-slate-400 font-sans text-[8.5px] max-w-[140px] truncate" title={t.desc}>
                                {t.desc}
                            </span>
                        {/if}
                    </div>
                {/if}

                <div class="flex items-center gap-1.5">
                    <button
                        on:click={() => isTradeSummaryCollapsed = !isTradeSummaryCollapsed}
                        class="text-slate-400 hover:text-white px-1.5 py-0.5 rounded text-[9px] transition-colors"
                        title={isTradeSummaryCollapsed ? "Expand Summary" : "Collapse Summary"}
                    >
                        <i class="fas {isTradeSummaryCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'}"></i>
                    </button>

                    <button
                        on:click={() => import("../lib/logic/app_controller.js").then(m => m.exitReplay())}
                        class="bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded text-[8.5px] font-bold uppercase transition-colors"
                    >
                        Exit
                    </button>
                </div>
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

    <!-- Synchronized Multi-Indicator Panes Area -->
    {#if activeSubPanes.length > 0}
        <div class="flex flex-col border-t border-border/60 bg-[#080b0e] overflow-y-auto max-h-[46vh] custom-scroll divide-y divide-border/30 shrink-0">
            {#each activeSubPanes as paneKey (paneKey)}
                {@const def = SUB_PANE_DEFS[paneKey]}
                <div class="w-full relative flex flex-col shrink-0 {activeSubPanes.length === 1 ? 'h-40' : activeSubPanes.length === 2 ? 'h-32' : 'h-28'}">
                    <div class="absolute top-1 left-3 right-3 text-[9px] font-mono text-slate-400 flex justify-between items-center z-10 pointer-events-none">
                        <span class="font-bold text-white uppercase tracking-wider flex items-center gap-2">
                            {def ? def.label : paneKey}
                        </span>
                        <button
                            on:click={() => toggleSubPane(paneKey)}
                            class="text-slate-500 hover:text-rose-400 p-1 transition-colors pointer-events-auto cursor-pointer"
                            title="Close indicator pane"
                        >
                            <i class="fas fa-times text-xs"></i>
                        </button>
                    </div>
                    <div use:initSubPaneAction={paneKey} class="flex-1 w-full min-h-0"></div>
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    /* Chart container responsive styling */
</style>
