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
