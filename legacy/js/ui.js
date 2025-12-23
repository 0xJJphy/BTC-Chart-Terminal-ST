/**
 * UI Module
 * Handles DOM rendering, tab switching, and user interaction event handlers.
 */

/**
 * Generic renderer for lists in the UI.
 * @param {string} id - The DOM ID of the container.
 * @param {Array} data - The data array to render.
 * @param {Function} fn - The rendering function for each item.
 */
function renderList(id, data, fn) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = data.length === 0
        ? '<div class="p-4 text-center text-xs text-slate-600 italic">Empty</div>'
        : data.map(fn).join('');
}

/**
 * Renders a single zone card (FVG/OB) for the SMC panel.
 */
function renderZoneCard(z) {
    const color = z.type === 'FVG' ? 'text-fvg' : 'text-ob';
    const statusLabel = z.status === 'MITIGATED' ? '<span class="text-[9px] text-bull font-bold">FILLED</span>' : '';
    return `
        <div class="p-3 border-b border-border hover:bg-[#1e293b] cursor-pointer flex justify-between items-center group" onclick="goToZone('${z.id}')">
            <div>
                <span class="${color} font-bold text-[10px]">${z.type}</span> 
                <span class="text-[9px] text-slate-500">${new Date(z.time * 1000).toLocaleTimeString()}</span>
            </div>
            <div class="text-right">
                <div class="text-white font-mono text-xs">$${z.top.toFixed(2)}</div>
                ${statusLabel}
            </div>
        </div>`;
}

/**
 * Renders a single trade card for the Operations/Strategy panels.
 */
function renderTradeCard(t) {
    let color = 'text-slate-400';
    if (t.status === 'PENDING') color = 'text-pending';
    if (t.status === 'OPEN') color = 'text-ob animate-pulse';
    if (t.status === 'WIN') color = 'text-bull';
    if (t.status === 'LOSS') color = 'text-bear';

    const pnlDisplay = (t.pnl !== undefined && t.pnl !== null)
        ? t.pnl.toFixed(2) + 'R'
        : '0.00R';

    const pnlClass = t.pnl > 0 ? 'text-bull'
        : t.pnl < 0 ? 'text-bear'
            : 'text-slate-500';

    const typeColor = t.type === 'LONG' ? 'text-bull' : 'text-bear';

    const refTime = t.signalTime || t.entryTime || t.time || null;
    const timeLabel = refTime
        ? new Date(refTime * 1000).toLocaleTimeString()
        : '---';

    const clickHandler = t.desc
        ? `replayStratTrade('${t.id}')`
        : `replayTrade(${t.id})`;

    return `
        <div class="p-3 border-b border-border hover:bg-[#1e293b] cursor-pointer"
             onclick="${clickHandler}">
            <div class="flex justify-between items-center mb-1">
                <span class="text-[10px] ${typeColor} font-bold">${t.type}</span>
                <span class="text-[9px] font-bold ${color}">${t.status}</span>
            </div>
            <div class="flex justify-between text-[10px] font-mono">
                <span>E: $${t.entry.toFixed(0)}</span>
                <span class="${pnlClass}">${pnlDisplay}</span>
            </div>
            <div class="text-[9px] text-slate-500 mt-1 flex justify-between">
                <span>${timeLabel}</span>
                <span>TP: $${t.tp.toFixed(0)}</span>
            </div>
        </div>`;
}

/**
 * Switches the active main tab (SMC, Op, TL, etc.).
 */
function switchMainTab(tab) {
    state.activeMode = tab;
    const tabs = ['zones', 'trades', 'lines', 'reglin', 'strat', 'log', 'pnl'];

    tabs.forEach(id => {
        const el = document.getElementById(`view-${id}`);
        const btn = document.getElementById(`mtab-${id}`);
        if (el) el.style.display = (id === tab) ? 'flex' : 'none';
        if (btn) btn.classList.toggle('active', id === tab);
    });

    const indicator = document.getElementById('mode-indicator');
    if (indicator) indicator.innerText = `Mode: ${tab.toUpperCase()}`;

    if (tab === 'pnl') {
        if (typeof updatePnLMetrics === 'function') updatePnLMetrics();
        if (typeof pnlChart !== 'undefined' && pnlChart) pnlChart.timeScale().fitContent();
    }
    if (tab === 'lines') {
        if (typeof calculateTrendLines === 'function') calculateTrendLines();
        if (typeof calculateHurst === 'function') calculateHurst();
    }
    if (tab === 'reglin') {
        if (typeof calculateRegLin === 'function') calculateRegLin();
    }
    if (tab === 'strat') {
        if (typeof addOptimizerToSelector === 'function') addOptimizerToSelector();
    } else if (tab === 'trades') {
        if (typeof updateTradeStrategy === 'function') updateTradeStrategy();
    } else {
        if (typeof renderVisuals === 'function') renderVisuals();
    }
}

/**
 * Switches sub-tabs in the SMC (Zones) panel.
 */
function switchZoneSubTab(tab) {
    state.activeZoneTab = tab;
    const activeList = document.getElementById('list-zones-active');
    const historyList = document.getElementById('list-zones-history');
    const activeBtn = document.getElementById('ztab-active');
    const historyBtn = document.getElementById('ztab-history');

    if (activeList) activeList.style.display = tab === 'active' ? 'block' : 'none';
    if (historyList) historyList.style.display = tab === 'history' ? 'block' : 'none';
    if (activeBtn) activeBtn.classList.toggle('active', tab === 'active');
    if (historyBtn) historyBtn.classList.toggle('active', tab === 'history');

    if (typeof renderVisuals === 'function') renderVisuals();
}

/**
 * Switches sub-tabs in the Operations (Trades) panel.
 */
function switchTradeSubTab(tab) {
    state.activeTradeTab = tab;
    ['ideas', 'active', 'history'].forEach(t => {
        const list = document.getElementById(`list-trades-${t}`);
        const btn = document.getElementById(`ttab-${t}`);
        if (list) list.style.display = (t === tab) ? 'block' : 'none';
        if (btn) btn.classList.toggle('active', t === tab);
    });
    if (typeof renderVisuals === 'function') renderVisuals();
}

/**
 * Enters replay mode for specific trades or zones.
 */
function enterReplay() {
    state.isReplayMode = true;
    const btn = document.getElementById('btn-back-live');
    if (btn) {
        btn.classList.remove('hidden');
        btn.classList.add('flex');
    }
    if (typeof clearLines === 'function') clearLines();
    if (typeof candleSeries !== 'undefined' && candleSeries) {
        candleSeries.setMarkers([]);
    }
}

/**
 * Exits replay mode and returns to live view.
 */
function exitReplay() {
    state.isReplayMode = false;
    const btn = document.getElementById('btn-back-live');
    if (btn) {
        btn.classList.add('hidden');
        btn.classList.remove('flex');
    }
    if (typeof clearLines === 'function') clearLines();
    if (typeof candleSeries !== 'undefined' && candleSeries) {
        candleSeries.setMarkers([]);
    }

    // Clean up highlights
    document.querySelectorAll('.strat-card').forEach(el => {
        el.classList.remove('border-white', 'border-2');
        el.classList.add('border-border/50');
    });

    if (typeof renderVisuals === 'function') renderVisuals();

    if (state.candles.length > 0 && typeof chart !== 'undefined' && chart) {
        chart.timeScale().scrollToRealTime();
    }
}

/**
 * Replays a specific trade on the chart.
 */
function replayTrade(tradeId) {
    const t = state.trades.find(tr => tr.id === tradeId);
    if (!t) return;

    enterReplay();

    if (typeof boxPrimitive !== 'undefined') boxPrimitive.setData([]);
    if (typeof trendPrimitive !== 'undefined') trendPrimitive.setData([]);

    if (typeof createLine === 'function') {
        createLine(t.entry, '#2962ff', 'ENTRY');
        createLine(t.tp, '#089981', 'TP');
        createLine(t.sl, '#f23645', 'SL');
    }

    const markers = [];
    if (t.signalTime) {
        markers.push({
            time: t.signalTime,
            position: t.type === 'LONG' ? 'belowBar' : 'aboveBar',
            color: '#3b82f6',
            shape: t.type === 'LONG' ? 'arrowUp' : 'arrowDown',
            text: 'IDEA'
        });
    }

    if (t.entryTime) {
        markers.push({
            time: t.entryTime,
            position: t.type === 'LONG' ? 'belowBar' : 'aboveBar',
            color: '#2962ff',
            shape: t.type === 'LONG' ? 'arrowUp' : 'arrowDown',
            text: 'ENTRY'
        });
    }

    if (t.exitTime && (t.status === 'WIN' || t.status === 'LOSS')) {
        markers.push({
            time: t.exitTime,
            position: t.type === 'LONG' ? 'aboveBar' : 'belowBar',
            color: t.status === 'WIN' ? '#089981' : '#f23645',
            shape: 'circle',
            text: t.status
        });
    }

    if (typeof candleSeries !== 'undefined') candleSeries.setMarkers(markers);

    const from = t.entryTime || t.signalTime || state.candles[0]?.time;
    const to = t.exitTime || (from ? from + 3600 * 2 : state.candles[state.candles.length - 1]?.time);

    if (from && to) {
        if (typeof zoomRange === 'function') zoomRange(from, to);
    }
}

/**
 * Replays a strategy-specific trade on the chart with extra context.
 */
function replayStratTrade(tradeId) {
    const t = state.trades.find(tr => tr.id === tradeId);
    if (!t) return;

    enterReplay();

    // Highlight the card in the list
    document.querySelectorAll('.strat-card').forEach(el => {
        el.classList.remove('border-white', 'border-2');
        el.classList.add('border-border/50');
    });
    const activeCard = document.getElementById(`strat-card-${tradeId}`);
    if (activeCard) {
        activeCard.classList.remove('border-border/50');
        activeCard.classList.add('border-white', 'border-2');
        activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const boxes = [];
    if (t.savedOB) boxes.push(t.savedOB);
    if (t.savedFVG) boxes.push(t.savedFVG);
    if (typeof boxPrimitive !== 'undefined') boxPrimitive.setData(boxes);
    if (t.savedLine && typeof trendPrimitive !== 'undefined') trendPrimitive.setData([t.savedLine]);

    if (typeof clearLines === 'function') clearLines();
    if (typeof createLine === 'function') {
        createLine(t.entry, '#2962ff', 'ENTRY');
        createLine(t.tp, '#089981', 'TP');
        createLine(t.sl, '#f23645', 'SL');
    }

    const markers = [];
    if (t.entryTime) {
        markers.push({
            time: t.entryTime,
            position: t.type === 'LONG' ? 'belowBar' : 'aboveBar',
            color: '#2962ff',
            shape: t.type === 'LONG' ? 'arrowUp' : 'arrowDown',
            text: 'ENTRY'
        });
    }
    if (t.exitTime && (t.status === 'WIN' || t.status === 'LOSS')) {
        markers.push({
            time: t.exitTime,
            position: t.type === 'LONG' ? 'aboveBar' : 'belowBar',
            color: t.status === 'WIN' ? '#089981' : '#f23645',
            shape: 'circle',
            text: t.status
        });
    }
    if (typeof candleSeries !== 'undefined') candleSeries.setMarkers(markers);

    const lineStart = t.savedLine?.t1 || t.entryTime;
    const from = Math.min(lineStart || t.entryTime, t.entryTime) - 3600;
    const to = t.exitTime || t.entryTime + 7200;
    if (typeof zoomRange === 'function') zoomRange(from, to);
}

/**
 * Synchronizes the entire UI with the current application state.
 */
function updateUI() {
    const zoneCountEl = document.getElementById('zone-count-display');
    const zoneLimitEl = document.getElementById('zone-limit');
    if (zoneCountEl && zoneLimitEl) zoneCountEl.innerText = zoneLimitEl.value;

    const activeZones = state.zones.filter(z => z.status === 'ACTIVE');
    const historyZones = state.zones.filter(z => z.status === 'MITIGATED');

    renderList('list-zones-active', activeZones.slice(-20).reverse(), renderZoneCard);
    renderList('list-zones-history', historyZones.slice(-20).reverse(), renderZoneCard);

    renderList('list-trades-ideas', state.trades.filter(t => t.status === 'PENDING').reverse(), renderTradeCard);
    renderList('list-trades-active', state.trades.filter(t => t.status === 'OPEN').reverse(), renderTradeCard);
    renderList('list-trades-history', state.trades.filter(t => t.status === 'WIN' || t.status === 'LOSS').reverse().slice(0, 20), renderTradeCard);
}

/**
 * Navigates the chart to a specific zone.
 */
function goToZone(zoneId) {
    const z = state.zones.find(zone => zone.id === zoneId);
    if (z) {
        enterReplay();
        if (typeof boxPrimitive !== 'undefined') boxPrimitive.setData([z]);
        const duration = z.endTime ? (z.endTime - z.time) : 3600;
        const pad = Math.max(duration * 2, 7200);
        if (typeof chart !== 'undefined' && chart) {
            chart.timeScale().setVisibleRange({ from: z.time - pad / 2, to: (z.endTime || z.time) + pad / 2 });
        }
    }
}

/**
 * Logs a system message to the log panel.
 */
function addToLog(msg) {
    const logEl = document.getElementById('system-log');
    if (logEl) logEl.insertAdjacentHTML('afterbegin', `<div>> ${msg}</div>`);
}
