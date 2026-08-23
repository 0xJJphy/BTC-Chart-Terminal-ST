/**
 * Chart Utilities for Lightweight Charts
 * Contains custom renderers (Primitives) and chart setup logic.
 */

export class BoxRenderer {
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

export class BoxPrimitive {
    constructor() { this._renderer = new BoxRenderer(); this._boxes = []; }
    setData(boxes) { this._boxes = boxes; this._requestUpdate?.(); }
    attached({ chart, series, requestUpdate }) { this._chart = chart; this._series = series; this._requestUpdate = requestUpdate; }
    detached() { this._chart = null; this._series = null; }
    updateAllViews() { this._requestUpdate?.(); }
    paneViews() { return [{ renderer: () => ({ draw: (target) => { this._renderer.update({ boxes: this._boxes, timeScale: this._chart.timeScale(), series: this._series }); this._renderer.draw(target); } }) }]; }
    priceAxisViews() { return []; }
    timeAxisViews() { return []; }
    autoscaleInfo() { return null; }
}

export class TrendLineRenderer {
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

                let x1 = x1Raw ?? 0;
                let x2 = x2Raw ?? scope.mediaSize.width;

                ctx.beginPath();
                if (l.status === 'BROKEN') {
                    let color = l.color;
                    if (color.startsWith('#')) color = l.color === '#f23645' ? 'rgba(242, 54, 69, 0.6)' : 'rgba(8, 153, 129, 0.6)';
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2 * pixelRatio;
                    ctx.setLineDash([6, 4]);
                } else {
                    ctx.strokeStyle = l.color;
                    ctx.lineWidth = Math.min(4, Math.max(2, (l.score || 0) / 4)) * pixelRatio;
                    ctx.setLineDash([]);
                }

                ctx.moveTo(x1 * pixelRatio, y1 * pixelRatio);
                ctx.lineTo(x2 * pixelRatio, y2 * pixelRatio);
                ctx.stroke();
                ctx.setLineDash([]);
            });
        });
    }
}

export class TrendLinePrimitive {
    constructor() { this._renderer = new TrendLineRenderer(); this._lines = []; }
    setData(lines) { this._lines = lines; this._requestUpdate?.(); }
    attached({ chart, series, requestUpdate }) { this._chart = chart; this._series = series; this._requestUpdate = requestUpdate; }
    detached() { this._chart = null; this._series = null; }
    updateAllViews() { this._requestUpdate?.(); }
    paneViews() { return [{ renderer: () => ({ draw: (target) => { this._renderer.update({ lines: this._lines, timeScale: this._chart.timeScale(), series: this._series }); this._renderer.draw(target); } }) }]; }
    priceAxisViews() { return []; }
    timeAxisViews() { return []; }
    autoscaleInfo() { return null; }
}

export class LinearRegressionRenderer {
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

            ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
            ctx.beginPath();
            ctx.moveTo(effX1, yUp1 * pixelRatio);
            ctx.lineTo(effX2, yUp2 * pixelRatio);
            ctx.lineTo(effX2, yLow2 * pixelRatio);
            ctx.lineTo(effX1, yLow1 * pixelRatio);
            ctx.closePath();
            ctx.fill();

            ctx.lineWidth = 1 * pixelRatio;
            ctx.strokeStyle = '#3b82f6';
            ctx.beginPath();
            ctx.moveTo(effX1, yMid1 * pixelRatio);
            ctx.lineTo(effX2, yMid2 * pixelRatio);
            ctx.stroke();
        });
    }
}

export class LinearRegressionPrimitive {
    constructor() { this._renderer = new LinearRegressionRenderer(); this._channel = null; }
    setData(channel) { this._channel = channel; this._requestUpdate?.(); }
    attached({ chart, series, requestUpdate }) { this._chart = chart; this._series = series; this._requestUpdate = requestUpdate; }
    detached() { this._chart = null; this._series = null; }
    updateAllViews() { this._requestUpdate?.(); }
    paneViews() { return [{ renderer: () => ({ draw: (target) => { this._renderer.update({ channel: this._channel, timeScale: this._chart.timeScale(), series: this._series }); this._renderer.draw(target); } }) }]; }
    priceAxisViews() { return []; }
    timeAxisViews() { return []; }
    autoscaleInfo() { return null; }
}

export class TradeExecutionRenderer {
    constructor() { this._data = null; }
    update(data) { this._data = data; }
    draw(target) {
        target.useBitmapCoordinateSpace(scope => {
            if (!this._data || !this._data.trade) return;
            const t = this._data.trade;
            const ctx = scope.context;
            const timeScale = this._data.timeScale;
            const series = this._data.series;
            const pixelRatio = scope.horizontalPixelRatio;

            const tSignal = t.signalTime || t.time || (t.entryTime ? t.entryTime - 900 : null);
            const tEntry = t.entryTime || t.time;
            const tExit = t.exitTime || (tEntry ? tEntry + 3600 * 2 : null);

            if (!tEntry) return;

            const xSignal = tSignal ? timeScale.timeToCoordinate(tSignal) : null;
            const xEntry = timeScale.timeToCoordinate(tEntry);
            const xExit = tExit ? timeScale.timeToCoordinate(tExit) : scope.mediaSize.width;

            const yEntry = series.priceToCoordinate(t.entry);
            const ySL = series.priceToCoordinate(t.sl);
            const yTP1 = series.priceToCoordinate(t.tp1 || t.tp);
            const yTP2 = t.tp2 ? series.priceToCoordinate(t.tp2) : null;
            const yTP3 = t.tp3 ? series.priceToCoordinate(t.tp3) : null;

            if (yEntry === null || ySL === null) return;

            // 1. S/R Confluence Line (if present for this setup)
            const srLevel = t.srLevel || t.sr_level;
            const srTime = t.srTime || t.sr_time;
            const srType = t.srType || t.sr_type || (t.type === 'LONG' ? 'SUPPORT' : 'RESISTANCE');
            if (srLevel !== undefined && srLevel !== null) {
                const ySR = series.priceToCoordinate(srLevel);
                if (ySR !== null) {
                    const xSRStart = srTime ? timeScale.timeToCoordinate(srTime) : (xSignal !== null ? xSignal - 100 : (xEntry !== null ? xEntry - 100 : null));
                    const xSREnd = xExit !== null ? xExit : scope.mediaSize.width;

                    if (xSRStart !== null && xSREnd !== null) {
                        const effSRStartX = Math.max(0, xSRStart) * pixelRatio;
                        const effSREndX = Math.min(scope.mediaSize.width, xSREnd) * pixelRatio;
                        const effYSR = ySR * pixelRatio;

                        ctx.save();
                        ctx.setLineDash([6 * pixelRatio, 3 * pixelRatio]);
                        ctx.strokeStyle = srType === 'SUPPORT' ? 'rgba(6, 182, 212, 0.85)' : 'rgba(244, 63, 94, 0.85)';
                        ctx.lineWidth = 1.8 * pixelRatio;
                        ctx.beginPath();
                        ctx.moveTo(effSRStartX, effYSR);
                        ctx.lineTo(effSREndX, effYSR);
                        ctx.stroke();

                        // Label
                        ctx.fillStyle = srType === 'SUPPORT' ? '#06b6d4' : '#f43f5e';
                        ctx.font = `bold ${Math.round(9 * pixelRatio)}px "JetBrains Mono", monospace`;
                        ctx.fillText(`${srType} CONFLUENCE: $${srLevel.toFixed(1)}`, effSRStartX + 6 * pixelRatio, effYSR - 4 * pixelRatio);
                        ctx.restore();
                    }
                }
            }

            // 2. Order Pending / Retest Phase (from signal to entry)
            if (xSignal !== null && xEntry !== null && xEntry > xSignal) {
                const effXSig = Math.max(0, xSignal) * pixelRatio;
                const effXEnt = Math.min(scope.mediaSize.width, xEntry) * pixelRatio;
                const effYEnt = yEntry * pixelRatio;

                ctx.save();
                ctx.setLineDash([4 * pixelRatio, 4 * pixelRatio]);
                ctx.strokeStyle = '#eab308';
                ctx.lineWidth = 1.5 * pixelRatio;
                ctx.beginPath();
                ctx.moveTo(effXSig, effYEnt);
                ctx.lineTo(effXEnt, effYEnt);
                ctx.stroke();

                // Fill light yellow area indicating pending order / retest zone
                ctx.fillStyle = 'rgba(234, 179, 8, 0.08)';
                const topY = Math.min(yEntry, ySL) * pixelRatio;
                const botY = Math.max(yEntry, ySL) * pixelRatio;
                ctx.fillRect(effXSig, topY, effXEnt - effXSig, botY - topY);

                ctx.fillStyle = '#eab308';
                ctx.font = `bold ${Math.round(8.5 * pixelRatio)}px "JetBrains Mono", monospace`;
                ctx.fillText(`ORDER PENDING RETEST`, effXSig + 4 * pixelRatio, effYEnt - 4 * pixelRatio);
                ctx.restore();
            }

            // 3. Active Trade Execution Phase (from entry to exit)
            if (xEntry !== null && xExit !== null) {
                const startX = Math.max(0, xEntry) * pixelRatio;
                const endX = Math.min(scope.mediaSize.width, xExit) * pixelRatio;
                const w = endX - startX;

                if (w > 0) {
                    const effYEnt = yEntry * pixelRatio;
                    const effYSL = ySL * pixelRatio;
                    const effYTP = yTP1 !== null ? yTP1 * pixelRatio : effYEnt;

                    // Green Profit Area
                    ctx.fillStyle = 'rgba(8, 153, 129, 0.14)';
                    const topP = Math.min(effYEnt, effYTP);
                    const botP = Math.max(effYEnt, effYTP);
                    ctx.fillRect(startX, topP, w, botP - topP);

                    // Red Risk Area
                    ctx.fillStyle = 'rgba(242, 54, 69, 0.14)';
                    const topR = Math.min(effYEnt, effYSL);
                    const botR = Math.max(effYEnt, effYSL);
                    ctx.fillRect(startX, topR, w, botR - topR);

                    // Solid bounded Entry Line
                    ctx.strokeStyle = '#2962ff';
                    ctx.lineWidth = 2 * pixelRatio;
                    ctx.beginPath();
                    ctx.moveTo(startX, effYEnt);
                    ctx.lineTo(endX, effYEnt);
                    ctx.stroke();

                    // Solid bounded SL Line
                    ctx.strokeStyle = '#f23645';
                    ctx.lineWidth = 2 * pixelRatio;
                    ctx.beginPath();
                    ctx.moveTo(startX, effYSL);
                    ctx.lineTo(endX, effYSL);
                    ctx.stroke();

                    // Solid bounded TP1 Line
                    if (yTP1 !== null) {
                        ctx.strokeStyle = '#089981';
                        ctx.lineWidth = 2 * pixelRatio;
                        ctx.beginPath();
                        ctx.moveTo(startX, effYTP);
                        ctx.lineTo(endX, effYTP);
                        ctx.stroke();
                    }

                    // TP2 Line
                    if (yTP2 !== null) {
                        ctx.strokeStyle = '#10b981';
                        ctx.lineWidth = 1.5 * pixelRatio;
                        ctx.beginPath();
                        ctx.moveTo(startX, yTP2 * pixelRatio);
                        ctx.lineTo(endX, yTP2 * pixelRatio);
                        ctx.stroke();
                    }

                    // TP3 Line
                    if (yTP3 !== null) {
                        ctx.strokeStyle = '#34d399';
                        ctx.lineWidth = 1.5 * pixelRatio;
                        ctx.beginPath();
                        ctx.moveTo(startX, yTP3 * pixelRatio);
                        ctx.lineTo(endX, yTP3 * pixelRatio);
                        ctx.stroke();
                    }

                    // Bounded Text Labels on the Right
                    ctx.font = `bold ${Math.round(8.5 * pixelRatio)}px "JetBrains Mono", monospace`;
                    
                    ctx.fillStyle = '#60a5fa';
                    ctx.fillText(`ENTRY $${t.entry?.toFixed(1)}`, endX + 4 * pixelRatio, effYEnt + 3 * pixelRatio);

                    ctx.fillStyle = '#f87171';
                    ctx.fillText(`SL $${t.sl?.toFixed(1)}`, endX + 4 * pixelRatio, effYSL + 3 * pixelRatio);

                    if (yTP1 !== null) {
                        ctx.fillStyle = '#34d399';
                        ctx.fillText(`TP1 $${(t.tp1 || t.tp)?.toFixed(1)}`, endX + 4 * pixelRatio, effYTP + 3 * pixelRatio);
                    }
                    if (yTP2 !== null && t.tp2) {
                        ctx.fillStyle = '#10b981';
                        ctx.fillText(`TP2 $${t.tp2.toFixed(1)}`, endX + 4 * pixelRatio, yTP2 * pixelRatio + 3 * pixelRatio);
                    }
                    if (yTP3 !== null && t.tp3) {
                        ctx.fillStyle = '#059669';
                        ctx.fillText(`TP3 $${t.tp3.toFixed(1)}`, endX + 4 * pixelRatio, yTP3 * pixelRatio + 3 * pixelRatio);
                    }
                }
            }
        });
    }
}

export class TradeExecutionPrimitive {
    constructor() { this._renderer = new TradeExecutionRenderer(); this._trade = null; }
    setData(trade) { this._trade = trade; this._requestUpdate?.(); }
    attached({ chart, series, requestUpdate }) { this._chart = chart; this._series = series; this._requestUpdate = requestUpdate; }
    detached() { this._chart = null; this._series = null; }
    updateAllViews() { this._requestUpdate?.(); }
    paneViews() { return [{ renderer: () => ({ draw: (target) => { this._renderer.update({ trade: this._trade, timeScale: this._chart.timeScale(), series: this._series }); this._renderer.draw(target); } }) }]; }
    priceAxisViews() { return []; }
    timeAxisViews() { return []; }
    autoscaleInfo() { return null; }
}

