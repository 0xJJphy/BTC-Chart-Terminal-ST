/**
 * Chart Module
 * Handles chart initialization, custom primitives (renderers), and visual updates.
 */

/**
 * Initializes the main TradingView chart.
 */
function initChart() {
    chart = LightweightCharts.createChart(document.getElementById('tv-chart'), {
        layout: {
            background: { type: 'solid', color: '#0b0e11' },
            textColor: '#94a3b8',
            fontFamily: 'JetBrains Mono'
        },
        grid: {
            vertLines: { color: '#151a23' },
            horzLines: { color: '#151a23' }
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        timeScale: { borderColor: '#242b3b', timeVisible: true, secondsVisible: false },
        rightPriceScale: { borderColor: '#242b3b' }
    });

    candleSeries = chart.addCandlestickSeries({
        upColor: '#089981', downColor: '#f23645',
        borderDownColor: '#f23645', borderUpColor: '#089981',
        wickDownColor: '#f23645', wickUpColor: '#089981'
    });

    // Base volume with low opacity
    volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume'
    });

    // Overlaid delta (same scale as volume)
    deltaSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume'
    });

    chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
        borderVisible: false
    });

    // Attach custom primitives
    boxPrimitive = new BoxPrimitive();
    candleSeries.attachPrimitive(boxPrimitive);

    trendPrimitive = new TrendLinePrimitive();
    candleSeries.attachPrimitive(trendPrimitive);

    regPrimitive = new LinearRegressionPrimitive();
    candleSeries.attachPrimitive(regPrimitive);

    window.addEventListener('resize', () => {
        const container = document.getElementById('tv-chart');
        if (container) {
            chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
        }
    });
}

/**
 * Initializes the PnL equity curve chart.
 */
function initPnLChart() {
    const container = document.getElementById('pnl-chart');
    if (!container) return;

    pnlChart = LightweightCharts.createChart(container, {
        layout: {
            background: { type: 'solid', color: '#0b0e11' },
            textColor: '#94a3b8',
            fontFamily: 'JetBrains Mono',
            fontSize: 10
        },
        grid: {
            vertLines: { color: '#151a23' },
            horzLines: { color: '#151a23' }
        },
        timeScale: { borderColor: '#242b3b', timeVisible: true, secondsVisible: false },
        rightPriceScale: { borderColor: '#242b3b', scaleMargins: { top: 0.1, bottom: 0.1 } },
        handleScroll: { mouseWheel: false, pressedMouseMove: false },
        handleScale: { axisPressedMouseMove: false, mouseWheel: false, pinch: false }
    });

    pnlSeries = pnlChart.addAreaSeries({
        lineColor: '#2962ff',
        topColor: 'rgba(41, 98, 255, 0.4)',
        bottomColor: 'rgba(41, 98, 255, 0.0)',
        lineWidth: 2
    });

    new ResizeObserver(entries => {
        if (entries.length && entries[0].target === container) {
            pnlChart.applyOptions({ width: entries[0].contentRect.width, height: entries[0].contentRect.height });
        }
    }).observe(container);
}

/**
 * Updates the volume and delta histogram data on the chart.
 */
function updateVolumeData() {
    if (!volumeSeries || !deltaSeries || state.candles.length === 0) return;

    // Total volume with low opacity
    const volumeData = state.candles.map(c => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(8, 153, 129, 0.25)' : 'rgba(242, 54, 69, 0.25)'
    }));

    // Overlaid Delta: absolute value, color based on sign
    const deltaData = state.candles.map(c => {
        const delta = c.delta || 0;
        const absDelta = Math.abs(delta);
        // Light green if positive delta (more buys), light red if negative (more sells)
        const color = delta >= 0 ? 'rgba(34, 197, 94, 0.8)' : 'rgba(248, 113, 113, 0.8)';
        return {
            time: c.time,
            value: absDelta,
            color: color
        };
    });

    volumeSeries.setData(volumeData);
    deltaSeries.setData(deltaData);
}

// --- Custom Renderers (Primitives) ---

/**
 * Box Renderer for Drawing Zones (FVG, OB)
 */
class BoxRenderer {
    constructor() { this._data = null; }
    update(data) { this._data = data; }
    draw(target) {
        target.useBitmapCoordinateSpace(scope => {
            if (!this._data || this._data.boxes.length === 0) return;
            const ctx = scope.context;
            const timeScale = this._data.timeScale;
            const series = this._data.series;
            const pixelRatio = scope.horizontalPixelRatio;

            this._data.boxes.forEach(box => {
                const x1 = timeScale.timeToCoordinate(box.time);
                let x2;

                if (box.endTime) {
                    x2 = timeScale.timeToCoordinate(box.endTime);
                    if (x2 !== null && x2 < 0 && (x1 === null || x1 < 0)) return;
                } else {
                    x2 = scope.mediaSize.width;
                }

                if (x1 !== null && x1 > scope.mediaSize.width) return;

                const effX1 = x1 ?? 0;
                const effX2 = x2 ?? scope.mediaSize.width;

                if (effX2 < 0 || effX1 > scope.mediaSize.width) return;

                const y1 = series.priceToCoordinate(box.top);
                const y2 = series.priceToCoordinate(box.bottom);
                if (y1 === null || y2 === null) return;

                ctx.fillStyle = box.status === 'MITIGATED'
                    ? box.color.replace('0.4)', '0.15)')
                    : box.color;

                const startX = Math.max(0, effX1);
                const endX = Math.min(scope.mediaSize.width, effX2);

                const x = Math.round(startX * pixelRatio);
                const y = Math.round(Math.min(y1, y2) * pixelRatio);
                const w = Math.round((endX - startX) * pixelRatio);
                const h = Math.round(Math.abs(y2 - y1) * pixelRatio);

                if (w <= 0) return;

                ctx.fillRect(x, y, w, h);

                if (box.status === 'MITIGATED') {
                    ctx.strokeStyle = box.color.replace('0.4)', '0.5)');
                    ctx.lineWidth = 1 * pixelRatio;
                    ctx.strokeRect(x, y, w, h);
                }
            });
        });
    }
}

class BoxPrimitive {
    constructor() { this._renderer = new BoxRenderer(); this._boxes = []; }
    setData(boxes) { this._boxes = boxes; this._requestUpdate(); }
    attached({ chart, series, requestUpdate }) { this._chart = chart; this._series = series; this._requestUpdate = requestUpdate; }
    detached() { this._chart = null; this._series = null; }
    updateAllViews() { this._requestUpdate(); }
    paneViews() { return [{ renderer: () => ({ draw: (target) => { this._renderer.update({ boxes: this._boxes, timeScale: this._chart.timeScale(), series: this._series }); this._renderer.draw(target); } }) }]; }
    priceAxisViews() { return []; }
    timeAxisViews() { return []; }
    autoscaleInfo() { return null; }
}

/**
 * TrendLine Renderer for Drawing Trends
 */
class TrendLineRenderer {
    constructor() { this._data = null; }
    update(data) { this._data = data; }
    draw(target) {
        target.useBitmapCoordinateSpace(scope => {
            if (!this._data || this._data.lines.length === 0) return;
            const ctx = scope.context;
            const timeScale = this._data.timeScale;
            const series = this._data.series;
            const pixelRatio = scope.horizontalPixelRatio;
            ctx.lineCap = 'round';

            this._data.lines.forEach(l => {
                const x1Raw = timeScale.timeToCoordinate(l.t1);
                const x2Raw = timeScale.timeToCoordinate(l.t2);
                const y1 = series.priceToCoordinate(l.p1);
                const y2 = series.priceToCoordinate(l.p2);

                if ((x1Raw === null && x2Raw === null) || y1 === null || y2 === null) return;

                let x1 = x1Raw;
                let x2 = x2Raw;

                if (x1 === null) x1 = 0;
                if (x2 === null) x2 = scope.mediaSize.width;

                ctx.beginPath();
                if (l.status === 'BROKEN') {
                    let color = l.color;
                    if (color.startsWith('#')) color = l.color === '#f23645' ? 'rgba(242, 54, 69, 0.6)' : 'rgba(8, 153, 129, 0.6)';
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2 * pixelRatio;
                    ctx.setLineDash([6, 4]);
                } else {
                    ctx.strokeStyle = l.color;
                    ctx.lineWidth = Math.min(4, Math.max(2, l.score / 4)) * pixelRatio;
                    ctx.setLineDash([]);
                }

                const drawX1 = x1 * pixelRatio;
                const drawY1 = y1 * pixelRatio;
                const drawX2 = x2 * pixelRatio;
                const drawY2 = y2 * pixelRatio;

                ctx.moveTo(drawX1, drawY1);
                ctx.lineTo(drawX2, drawY2);
                ctx.stroke();
                ctx.setLineDash([]);
            });
        });
    }
}

class TrendLinePrimitive {
    constructor() { this._renderer = new TrendLineRenderer(); this._lines = []; }
    setData(lines) { this._lines = lines; this._requestUpdate(); }
    attached({ chart, series, requestUpdate }) { this._chart = chart; this._series = series; this._requestUpdate = requestUpdate; }
    detached() { this._chart = null; this._series = null; }
    updateAllViews() { this._requestUpdate(); }
    paneViews() { return [{ renderer: () => ({ draw: (target) => { this._renderer.update({ lines: this._lines, timeScale: this._chart.timeScale(), series: this._series }); this._renderer.draw(target); } }) }]; }
    priceAxisViews() { return []; }
    timeAxisViews() { return []; }
    autoscaleInfo() { return null; }
}

/**
 * Linear Regression Renderer for Drawing Channels
 */
class LinearRegressionRenderer {
    constructor() { this._data = null; }
    update(data) { this._data = data; }
    draw(target) {
        target.useBitmapCoordinateSpace(scope => {
            if (!this._data || !this._data.channel) return;
            const c = this._data.channel;
            const ctx = scope.context;
            const timeScale = this._data.timeScale;
            const series = this._data.series;
            const pixelRatio = scope.horizontalPixelRatio;
            const x1 = timeScale.timeToCoordinate(c.t1);
            const x2 = timeScale.timeToCoordinate(c.t2);
            if (x1 === null && x2 === null) return;
            const effX1 = (x1 !== null ? x1 : -10000) * pixelRatio;
            const effX2 = (x2 !== null ? x2 : scope.mediaSize.width + 10000) * pixelRatio;
            const yMid1 = series.priceToCoordinate(c.mid1);
            const yMid2 = series.priceToCoordinate(c.mid2);
            const yUp1 = series.priceToCoordinate(c.up1);
            const yUp2 = series.priceToCoordinate(c.up2);
            const yLow1 = series.priceToCoordinate(c.low1);
            const yLow2 = series.priceToCoordinate(c.low2);
            if (yMid1 === null || yMid2 === null) return;
            const pyMid1 = yMid1 * pixelRatio;
            const pyMid2 = yMid2 * pixelRatio;
            const pyUp1 = yUp1 * pixelRatio;
            const pyUp2 = yUp2 * pixelRatio;
            const pyLow1 = yLow1 * pixelRatio;
            const pyLow2 = yLow2 * pixelRatio;
            ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
            ctx.beginPath();
            ctx.moveTo(effX1, pyUp1);
            ctx.lineTo(effX2, pyUp2);
            ctx.lineTo(effX2, pyLow2);
            ctx.lineTo(effX1, pyLow1);
            ctx.closePath();
            ctx.fill();
            ctx.lineWidth = 1 * pixelRatio;
            ctx.strokeStyle = '#3b82f6';
            ctx.beginPath();
            ctx.moveTo(effX1, pyMid1);
            ctx.lineTo(effX2, pyMid2);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
            ctx.beginPath();
            ctx.moveTo(effX1, pyUp1);
            ctx.lineTo(effX2, pyUp2);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
            ctx.beginPath();
            ctx.moveTo(effX1, pyLow1);
            ctx.lineTo(effX2, pyLow2);
            ctx.stroke();
        });
    }
}

class LinearRegressionPrimitive {
    constructor() { this._renderer = new LinearRegressionRenderer(); this._channel = null; }
    setData(channel) { this._channel = channel; this._requestUpdate(); }
    attached({ chart, series, requestUpdate }) { this._chart = chart; this._series = series; this._requestUpdate = requestUpdate; }
    detached() { this._chart = null; this._series = null; }
    updateAllViews() { this._requestUpdate(); }
    paneViews() { return [{ renderer: () => ({ draw: (target) => { this._renderer.update({ channel: this._channel, timeScale: this._chart.timeScale(), series: this._series }); this._renderer.draw(target); } }) }]; }
    priceAxisViews() { return []; }
    timeAxisViews() { return []; }
    autoscaleInfo() { return null; }
}

/**
 * Renders active visual elements on the chart based on the current mode.
 */
function renderVisuals() {
    const zoneLimitEl = document.getElementById('zone-limit');
    const limit = zoneLimitEl ? parseInt(zoneLimitEl.value) : 50;

    const fvgTgl = document.getElementById('toggle-fvg');
    const showFVG = fvgTgl ? fvgTgl.checked : true;

    const obTgl = document.getElementById('toggle-ob');
    const showOB = obTgl ? obTgl.checked : true;

    if (boxPrimitive) boxPrimitive.setData([]);
    if (trendPrimitive) trendPrimitive.setData([]);
    if (regPrimitive) regPrimitive.setData(null);

    if (state.activeMode !== 'strat') {
        if (candleSeries) candleSeries.setMarkers([]);
    }

    if (typeof clearLines === 'function') clearLines();

    if (state.activeMode === 'zones') {
        let list = state.activeZoneTab === 'active'
            ? state.zones.filter(z => z.status === 'ACTIVE').slice(-limit)
            : state.zones.filter(z => z.status === 'MITIGATED').slice(-limit);
        list = list.filter(z => (z.type === 'FVG' && showFVG) || (z.type === 'OB' && showOB));
        if (boxPrimitive) boxPrimitive.setData(list);
    }
    else if (state.activeMode === 'trades') {
        let markers = [];
        state.trades.slice(-50).forEach(t => {
            if (state.activeTradeTab === 'ideas' && t.status === 'PENDING') {
                markers.push({
                    time: t.signalTime,
                    position: 'aboveBar',
                    color: '#3b82f6',
                    shape: 'arrowDown',
                    text: 'IDEA'
                });
            }
            if (state.activeTradeTab === 'active' && t.status === 'OPEN') {
                markers.push({
                    time: t.entryTime,
                    position: 'belowBar',
                    color: '#fbbf24',
                    shape: 'arrowUp',
                    text: 'LIVE'
                });
            }
            if (state.activeTradeTab === 'history' && (t.status === 'WIN' || t.status === 'LOSS')) {
                markers.push({
                    time: t.exitTime,
                    position: 'aboveBar',
                    color: t.status === 'WIN' ? '#089981' : '#f23645',
                    shape: 'circle',
                    text: t.status
                });
            }
        });
        if (candleSeries) candleSeries.setMarkers(markers);
    }
    else if (state.activeMode === 'lines') {
        if (trendPrimitive) trendPrimitive.setData(state.lines);
    }
    else if (state.activeMode === 'reglin') {
        if (regPrimitive) regPrimitive.setData(state.channel);
    }
}
