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

            const toSec = (val) => {
                if (!val) return null;
                const num = Number(val);
                if (isNaN(num) || num <= 0) return null;
                return num > 1e11 ? Math.floor(num / 1000) : Math.floor(num);
            };

            const tSignal = toSec(t.signalTime || t.signal_time || t.time);
            const tEntry = toSec(t.entryTime || t.entry_time || t.time);
            const tExit = toSec(t.exitTime || t.exit_time || (tEntry ? tEntry + 3600 * 4 : null));

            const entryVal = t.entry !== undefined ? Number(t.entry) : null;
            const slVal = t.sl !== undefined ? Number(t.sl) : null;
            const tp1Val = (t.tp1 !== undefined && t.tp1 !== null) ? Number(t.tp1) : ((t.tp !== undefined && t.tp !== null) ? Number(t.tp) : null);
            const tp2Val = (t.tp2 !== undefined && t.tp2 !== null) ? Number(t.tp2) : null;
            const tp3Val = (t.tp3 !== undefined && t.tp3 !== null) ? Number(t.tp3) : null;

            const yEntry = entryVal !== null ? series.priceToCoordinate(entryVal) : null;
            const ySL = slVal !== null ? series.priceToCoordinate(slVal) : null;
            const yTP1 = tp1Val !== null ? series.priceToCoordinate(tp1Val) : null;
            const yTP2 = tp2Val !== null ? series.priceToCoordinate(tp2Val) : null;
            const yTP3 = tp3Val !== null ? series.priceToCoordinate(tp3Val) : null;

            if (yEntry === null && ySL === null) return;

            const getCoord = (timeSec) => {
                if (!timeSec) return null;
                const c = timeScale.timeToCoordinate(timeSec);
                return (c !== null && !isNaN(c)) ? c : null;
            };

            const rawXSignal = getCoord(tSignal);
            const rawXEntry = getCoord(tEntry);
            const rawXExit = getCoord(tExit);

            // 1. S/R Confluence Line (if present for this setup)
            const srLevel = t.srLevel !== undefined && t.srLevel !== null ? Number(t.srLevel) : (t.sr_level !== undefined && t.sr_level !== null ? Number(t.sr_level) : null);
            const srTime = toSec(t.srTime || t.sr_time);
            const srType = t.srType || t.sr_type || (t.type === 'LONG' ? 'SUPPORT' : 'RESISTANCE');
            if (srLevel !== null && !isNaN(srLevel)) {
                const ySR = series.priceToCoordinate(srLevel);
                if (ySR !== null) {
                    const rawXSR = getCoord(srTime);
                    const defaultStart = rawXSignal !== null ? rawXSignal - 80 : (rawXEntry !== null ? rawXEntry - 80 : scope.mediaSize.width * 0.1);
                    const startSR = Math.max(0, rawXSR !== null ? rawXSR : defaultStart) * pixelRatio;
                    const endSR = Math.min(scope.mediaSize.width, rawXExit !== null ? rawXExit : (rawXEntry !== null ? rawXEntry + 180 : scope.mediaSize.width * 0.9)) * pixelRatio;
                    const effYSR = ySR * pixelRatio;

                    if (endSR > startSR) {
                        ctx.save();
                        ctx.setLineDash([6 * pixelRatio, 4 * pixelRatio]);
                        ctx.strokeStyle = srType === 'SUPPORT' ? 'rgba(6, 182, 212, 0.9)' : 'rgba(244, 63, 94, 0.9)';
                        ctx.lineWidth = 2 * pixelRatio;
                        ctx.beginPath();
                        ctx.moveTo(startSR, effYSR);
                        ctx.lineTo(endSR, effYSR);
                        ctx.stroke();

                        // Label
                        ctx.fillStyle = srType === 'SUPPORT' ? '#06b6d4' : '#f43f5e';
                        ctx.font = `bold ${Math.round(9.5 * pixelRatio)}px "JetBrains Mono", monospace`;
                        ctx.fillText(`${srType} CONFLUENCE: $${srLevel.toFixed(1)}`, startSR + 6 * pixelRatio, effYSR - 5 * pixelRatio);
                        ctx.restore();
                    }
                }
            }

            // 2. Order Pending / Retest Phase (from signal to entry)
            if (rawXSignal !== null && rawXEntry !== null && rawXEntry > rawXSignal) {
                const effXSig = Math.max(0, rawXSignal) * pixelRatio;
                const effXEnt = Math.min(scope.mediaSize.width, rawXEntry) * pixelRatio;
                const effYEnt = (yEntry !== null ? yEntry : 0) * pixelRatio;

                if (effXEnt > effXSig) {
                    ctx.save();
                    ctx.setLineDash([4 * pixelRatio, 4 * pixelRatio]);
                    ctx.strokeStyle = '#eab308';
                    ctx.lineWidth = 1.5 * pixelRatio;
                    ctx.beginPath();
                    ctx.moveTo(effXSig, effYEnt);
                    ctx.lineTo(effXEnt, effYEnt);
                    ctx.stroke();

                    if (ySL !== null) {
                        ctx.fillStyle = 'rgba(234, 179, 8, 0.08)';
                        const topY = Math.min(yEntry, ySL) * pixelRatio;
                        const botY = Math.max(yEntry, ySL) * pixelRatio;
                        ctx.fillRect(effXSig, topY, effXEnt - effXSig, botY - topY);
                    }

                    ctx.fillStyle = '#eab308';
                    ctx.font = `bold ${Math.round(8.5 * pixelRatio)}px "JetBrains Mono", monospace`;
                    ctx.fillText(`ORDER PENDING RETEST`, effXSig + 4 * pixelRatio, effYEnt - 4 * pixelRatio);
                    ctx.restore();
                }
            }

            // 3. Active Trade Execution Phase (from entry to exit)
            const fallbackX1 = rawXSignal !== null ? rawXSignal : scope.mediaSize.width * 0.25;
            const effX1 = rawXEntry !== null ? rawXEntry : fallbackX1;
            const effX2 = rawXExit !== null ? rawXExit : (effX1 + 160);

            const startX = Math.max(0, effX1) * pixelRatio;
            const endX = Math.min(scope.mediaSize.width, effX2) * pixelRatio;
            const w = endX - startX;

            if (w > 0 && yEntry !== null) {
                const effYEnt = yEntry * pixelRatio;
                const effYSL = ySL !== null ? ySL * pixelRatio : effYEnt;
                const effYTP = yTP1 !== null ? yTP1 * pixelRatio : effYEnt;

                const initialSL = (t.initial_sl !== undefined && t.initial_sl !== null)
                    ? Number(t.initial_sl)
                    : ((t.initialSl !== undefined && t.initialSl !== null)
                        ? Number(t.initialSl)
                        : slVal);
                const yInitSL = initialSL !== null ? series.priceToCoordinate(initialSL) : ySL;
                const effYInitSL = yInitSL !== null ? yInitSL * pixelRatio : effYSL;

                const tp1Time = toSec(t.tp1_time || t.tp1Time);
                const rawXTP1 = getCoord(tp1Time);
                const effXTP1 = rawXTP1 !== null ? rawXTP1 * pixelRatio : null;
                const hasTrailingBE = effXTP1 !== null && effXTP1 > startX && effXTP1 < endX;

                // Green Profit Area
                if (yTP1 !== null) {
                    ctx.fillStyle = 'rgba(8, 153, 129, 0.16)';
                    const topP = Math.min(effYEnt, effYTP);
                    const botP = Math.max(effYEnt, effYTP);
                    ctx.fillRect(startX, topP, w, botP - topP);
                }

                // Red Risk Area (Initial Risk)
                if (yInitSL !== null) {
                    ctx.fillStyle = 'rgba(242, 54, 69, 0.16)';
                    const topR = Math.min(effYEnt, effYInitSL);
                    const botR = Math.max(effYEnt, effYInitSL);
                    const riskW = hasTrailingBE ? (effXTP1 - startX) : w;
                    ctx.fillRect(startX, topR, riskW, botR - topR);
                }

                // Solid bounded Entry Line (Blue)
                ctx.strokeStyle = '#2962ff';
                ctx.lineWidth = 2.4 * pixelRatio;
                ctx.beginPath();
                ctx.moveTo(startX, effYEnt);
                ctx.lineTo(endX, effYEnt);
                ctx.stroke();

                // Stop Loss Handling (Initial SL + Trailing BE)
                if (hasTrailingBE) {
                    // 1. Initial SL segment before TP1
                    ctx.strokeStyle = '#f23645';
                    ctx.lineWidth = 2.4 * pixelRatio;
                    ctx.beginPath();
                    ctx.moveTo(startX, effYInitSL);
                    ctx.lineTo(effXTP1, effYInitSL);
                    ctx.stroke();

                    // 2. Trailing step transition to Break-Even at TP1
                    ctx.save();
                    ctx.setLineDash([4 * pixelRatio, 4 * pixelRatio]);
                    ctx.strokeStyle = '#f59e0b';
                    ctx.lineWidth = 1.8 * pixelRatio;
                    ctx.beginPath();
                    ctx.moveTo(effXTP1, effYInitSL);
                    ctx.lineTo(effXTP1, effYEnt);
                    ctx.lineTo(endX, effYEnt);
                    ctx.stroke();
                    ctx.restore();
                } else if (yInitSL !== null) {
                    // Standard SL line
                    ctx.strokeStyle = '#f23645';
                    ctx.lineWidth = 2.4 * pixelRatio;
                    ctx.beginPath();
                    ctx.moveTo(startX, effYInitSL);
                    ctx.lineTo(endX, effYInitSL);
                    ctx.stroke();
                }

                // Solid bounded TP1 Line (50% Close - Green)
                if (yTP1 !== null) {
                    ctx.strokeStyle = '#089981';
                    ctx.lineWidth = 2.4 * pixelRatio;
                    ctx.beginPath();
                    ctx.moveTo(startX, effYTP);
                    ctx.lineTo(endX, effYTP);
                    ctx.stroke();
                }

                // TP2 Line (25% Close - Teal)
                if (yTP2 !== null) {
                    ctx.strokeStyle = '#10b981';
                    ctx.lineWidth = 1.8 * pixelRatio;
                    ctx.beginPath();
                    ctx.moveTo(startX, yTP2 * pixelRatio);
                    ctx.lineTo(endX, yTP2 * pixelRatio);
                    ctx.stroke();
                }

                // TP3 Line (25% Close - Emerald)
                if (yTP3 !== null) {
                    ctx.strokeStyle = '#34d399';
                    ctx.lineWidth = 1.8 * pixelRatio;
                    ctx.beginPath();
                    ctx.moveTo(startX, yTP3 * pixelRatio);
                    ctx.lineTo(endX, yTP3 * pixelRatio);
                    ctx.stroke();
                }

                // Crisp Price Badge Labels on the Right
                ctx.font = `bold ${Math.round(9.5 * pixelRatio)}px "JetBrains Mono", monospace`;
                
                ctx.fillStyle = '#60a5fa';
                ctx.fillText(`ENTRY $${entryVal?.toFixed(1)}`, endX + 5 * pixelRatio, effYEnt + 3 * pixelRatio);

                if (initialSL !== null && !isNaN(initialSL)) {
                    ctx.fillStyle = '#f87171';
                    ctx.fillText(`INIT SL $${initialSL.toFixed(1)}`, endX + 5 * pixelRatio, effYInitSL + 3 * pixelRatio);
                }

                if (hasTrailingBE) {
                    ctx.fillStyle = '#fbbf24';
                    ctx.fillText(`BE (SL→ENTRY) $${entryVal?.toFixed(1)}`, endX + 5 * pixelRatio, effYEnt - 10 * pixelRatio);
                }

                if (yTP1 !== null && tp1Val !== null) {
                    ctx.fillStyle = '#34d399';
                    ctx.fillText(`TP1 (50%) $${tp1Val.toFixed(1)}`, endX + 5 * pixelRatio, effYTP + 3 * pixelRatio);
                }
                if (yTP2 !== null && tp2Val !== null) {
                    ctx.fillStyle = '#10b981';
                    ctx.fillText(`TP2 (25%) $${tp2Val.toFixed(1)}`, endX + 5 * pixelRatio, yTP2 * pixelRatio + 3 * pixelRatio);
                }
                if (yTP3 !== null && tp3Val !== null) {
                    ctx.fillStyle = '#059669';
                    ctx.fillText(`TP3 (25%) $${tp3Val.toFixed(1)}`, endX + 5 * pixelRatio, yTP3 * pixelRatio + 3 * pixelRatio);
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

