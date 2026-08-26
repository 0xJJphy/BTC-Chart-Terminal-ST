<script>
    import { state } from "../../lib/stores/app.js";

    $: m = $state.pnlMetrics || {};
    $: hasData = (m.totalTrades || 0) > 0;

    const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
    const pct = (v, d = 1) => (Number.isFinite(v) ? `${v.toFixed(d)}%` : "—");
    const money = (v, d = 2) =>
        Number.isFinite(v) ? `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(d)}` : "—";
    const days = (secs) => (Number.isFinite(secs) ? `${(secs / 86400).toFixed(1)}d` : "—");

    const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

    // --- Equity + underwater, downsampled so a 240k-bar curve stays cheap to draw ---
    const W = 300, H = 70, DH = 34;

    function downsample(arr, target = 400) {
        if (!arr || arr.length <= target) return arr || [];
        const step = arr.length / target;
        const out = [];
        for (let i = 0; i < target; i++) out.push(arr[Math.floor(i * step)]);
        out.push(arr[arr.length - 1]);
        return out;
    }

    $: equity = downsample(m.equityCurve || []);
    $: ddCurve = downsample(m.drawdownCurve || []);

    $: equityPath = (() => {
        if (equity.length < 2) return "";
        const vals = equity.map((p) => p.value);
        const min = Math.min(...vals), max = Math.max(...vals);
        const range = max - min || 1;
        return equity
            .map((p, i) => `${i === 0 ? "M" : "L"}${((i / (equity.length - 1)) * W).toFixed(1)},${(H - ((p.value - min) / range) * H).toFixed(1)}`)
            .join(" ");
    })();

    $: initialY = (() => {
        if (equity.length < 2) return H;
        const vals = equity.map((p) => p.value);
        const min = Math.min(...vals), max = Math.max(...vals);
        const range = max - min || 1;
        const base = m.initialCapital ?? vals[0];
        return H - ((base - min) / range) * H;
    })();

    $: ddPath = (() => {
        if (ddCurve.length < 2) return "";
        const maxDd = Math.max(...ddCurve, 1);
        const pts = ddCurve.map((v, i) => `${((i / (ddCurve.length - 1)) * W).toFixed(1)},${((v / maxDd) * DH).toFixed(1)}`);
        return `M0,0 L${pts.join(" L")} L${W},0 Z`;
    })();

    // --- R distribution ---
    $: hist = (m.rDistribution?.histogram || []).filter(([, c]) => c > 0);
    $: histMax = Math.max(1, ...hist.map(([, c]) => c));

    // --- Monthly returns pivot ---
    $: monthlyByYear = (() => {
        const rows = new Map();
        for (const r of m.monthlyReturns || []) {
            if (!rows.has(r.year)) rows.set(r.year, new Array(12).fill(null));
            rows.get(r.year)[r.month - 1] = r.returnPct;
        }
        return [...rows.entries()].sort((a, b) => a[0] - b[0]);
    })();

    const heat = (v) => {
        if (v == null) return "text-slate-700";
        if (v > 5) return "text-bull font-bold";
        if (v > 0) return "text-bull/70";
        if (v > -5) return "text-bear/70";
        return "text-bear font-bold";
    };

    $: wf = m.walkForward || {};
    $: mc = m.monteCarlo || {};
    $: dd = m.drawdown || {};
</script>

<div class="flex-1 flex flex-col overflow-y-auto custom-scroll p-4 space-y-4">
    <div class="flex justify-between items-center">
        <h2 class="text-white font-bold text-xs uppercase tracking-widest">Analytics</h2>
        <span class="text-[9px] text-slate-500 font-mono">
            {hasData ? `${m.totalTrades} trades · ${fmt(m.spanDays, 0)}d` : "sin datos"}
        </span>
    </div>

    {#if !hasData}
        <div class="p-8 text-center space-y-3">
            <div class="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mx-auto border border-border/30">
                <i class="fas fa-chart-area text-slate-600 text-xs"></i>
            </div>
            <div class="text-[9px] text-slate-600 uppercase font-bold tracking-widest leading-relaxed">
                Ejecuta un backtest en Strategy Lab para poblar este panel.
            </div>
        </div>
    {:else}
        <!-- HEADLINE -->
        <div class="grid grid-cols-3 gap-1.5 text-center">
            <div class="bg-black/25 p-2 rounded-lg border border-border/40">
                <div class="text-[7.5px] text-slate-500 uppercase">Equity final</div>
                <div class="text-[11px] font-bold {m.finalEquity >= m.initialCapital ? 'text-bull' : 'text-bear'}">{money(m.finalEquity, 0)}</div>
            </div>
            <div class="bg-black/25 p-2 rounded-lg border border-border/40">
                <div class="text-[7.5px] text-slate-500 uppercase">Retorno total</div>
                <div class="text-[11px] font-bold {m.totalReturnPct >= 0 ? 'text-bull' : 'text-bear'}">{pct(m.totalReturnPct)}</div>
            </div>
            <div class="bg-black/25 p-2 rounded-lg border border-border/40">
                <div class="text-[7.5px] text-slate-500 uppercase" title="Anualizado sobre el span real">CAGR</div>
                <div class="text-[11px] font-bold {m.cagrPct >= 0 ? 'text-bull' : 'text-bear'}">{pct(m.cagrPct)}</div>
            </div>
        </div>

        <!-- EQUITY + UNDERWATER -->
        <div class="bg-black/25 rounded-xl border border-border/40 p-3 space-y-1">
            <div class="text-[8px] font-bold text-slate-400 uppercase tracking-wider">
                Equity mark-to-market · underwater
            </div>
            <svg viewBox="0 0 {W} {H}" class="w-full" style="height:80px">
                <line x1="0" y1={initialY} x2={W} y2={initialY} stroke="#475569" stroke-width="0.8" stroke-dasharray="4 3" />
                <path d={equityPath} fill="none" stroke="#22d3ee" stroke-width="1.4" />
            </svg>
            <svg viewBox="0 0 {W} {DH}" class="w-full" style="height:40px">
                <path d={ddPath} fill="rgba(248,113,113,0.25)" stroke="#f87171" stroke-width="0.8" />
            </svg>
            <div class="flex justify-between text-[8px] text-slate-500 font-mono pt-0.5">
                <span>Max DD -{fmt(dd.maxPct, 1)}%</span>
                <span>Ulcer {fmt(dd.ulcerIndex, 1)}</span>
                <span>Bajo agua máx. {fmt(dd.longestDays, 0)}d</span>
            </div>
        </div>

        <!-- RISK GRID -->
        <div class="bg-black/25 rounded-xl border border-border/40 p-2.5 space-y-1.5">
            <div class="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Riesgo</div>
            <div class="grid grid-cols-4 gap-1.5 text-center">
                {#each [["VaR 95%", pct(m.var95Pct), "Pérdida diaria en el peor 5% de los días"],
                        ["CVaR 95%", pct(m.cvar95Pct), "Pérdida media más allá del VaR"],
                        ["Vol anual", pct(m.annualVolatilityPct, 0), "Volatilidad anualizada de los retornos diarios"],
                        ["Exposición", pct(m.exposurePct, 0), "Barras con posición abierta"]] as [label, value, hint]}
                    <div class="bg-panel/80 p-1.5 rounded border border-border/30" title={hint}>
                        <div class="text-[7.5px] text-slate-500 uppercase leading-tight">{label}</div>
                        <div class="text-[9.5px] font-bold text-slate-200">{value}</div>
                    </div>
                {/each}
            </div>
            <div class="grid grid-cols-4 gap-1.5 text-center">
                {#each [["Racha W", m.maxConsecutiveWins ?? "—", ""],
                        ["Racha L", m.maxConsecutiveLosses ?? "—", ""],
                        ["Dur. media", days(m.avgDurationSecs), "Duración media de una operación"],
                        ["Dur. máx.", days(m.maxDurationSecs), ""]] as [label, value, hint]}
                    <div class="bg-panel/80 p-1.5 rounded border border-border/30" title={hint}>
                        <div class="text-[7.5px] text-slate-500 uppercase leading-tight">{label}</div>
                        <div class="text-[9.5px] font-bold text-slate-200">{value}</div>
                    </div>
                {/each}
            </div>
        </div>

        <!-- MAE / MFE -->
        <div class="bg-black/25 rounded-xl border border-border/40 p-2.5 space-y-1.5">
            <div class="text-[8px] font-bold text-slate-400 uppercase tracking-wider" title="Excursión adversa y favorable máximas, en R">
                Excursiones (MAE / MFE)
            </div>
            <div class="grid grid-cols-3 gap-1.5 text-center">
                <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                    <div class="text-[7.5px] text-slate-500 uppercase">MAE medio</div>
                    <div class="text-[9.5px] font-bold text-bear">{fmt(m.avgMaeR)}R</div>
                </div>
                <div class="bg-panel/80 p-1.5 rounded border border-border/30">
                    <div class="text-[7.5px] text-slate-500 uppercase">MFE medio</div>
                    <div class="text-[9.5px] font-bold text-bull">{fmt(m.avgMfeR)}R</div>
                </div>
                <div class="bg-panel/80 p-1.5 rounded border border-border/30" title="Expectancy / MFE medio: cuánto del movimiento a favor se captura">
                    <div class="text-[7.5px] text-slate-500 uppercase">Captura</div>
                    <div class="text-[9.5px] font-bold text-slate-200">{fmt(m.captureRatio)}</div>
                </div>
            </div>
        </div>

        <!-- R DISTRIBUTION -->
        {#if hist.length}
            <div class="bg-black/25 rounded-xl border border-border/40 p-2.5 space-y-1.5">
                <div class="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Distribución de R</div>
                <div class="flex items-end gap-px h-16">
                    {#each hist as [edge, count]}
                        <div
                            class="flex-1 {edge >= 0 ? 'bg-bull/70' : 'bg-bear/70'} rounded-t-sm min-w-[2px]"
                            style="height:{(count / histMax) * 100}%"
                            title="{edge.toFixed(2)}R a {(edge + 0.25).toFixed(2)}R: {count} trades"
                        ></div>
                    {/each}
                </div>
                <div class="grid grid-cols-5 gap-1 text-center text-[8px] font-mono pt-1 border-t border-border/20">
                    {#each [["p05", m.rDistribution?.p05], ["p25", m.rDistribution?.p25], ["mediana", m.rDistribution?.median], ["p75", m.rDistribution?.p75], ["p95", m.rDistribution?.p95]] as [label, v]}
                        <div>
                            <div class="text-slate-600 uppercase">{label}</div>
                            <div class="{v >= 0 ? 'text-bull' : 'text-bear'}">{fmt(v)}</div>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}

        <!-- LONG / SHORT -->
        <div class="bg-black/25 rounded-xl border border-border/40 p-2.5 space-y-1.5">
            <div class="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Por lado</div>
            <table class="w-full text-[9px] font-mono">
                <thead class="text-slate-600 uppercase text-[8px]">
                    <tr><th class="text-left font-bold">Lado</th><th class="text-right font-bold">Ops</th><th class="text-right font-bold">WR</th><th class="text-right font-bold">Exp.</th><th class="text-right font-bold">PnL</th></tr>
                </thead>
                <tbody class="divide-y divide-border/20">
                    {#each [["LONG", m.longSide], ["SHORT", m.shortSide]] as [label, side]}
                        <tr>
                            <td class="py-1 {label === 'LONG' ? 'text-bull' : 'text-bear'} font-bold">{label}</td>
                            <td class="py-1 text-right text-slate-300">{side?.trades ?? 0}</td>
                            <td class="py-1 text-right text-slate-300">{fmt(side?.winRate, 1)}%</td>
                            <td class="py-1 text-right {side?.expectancyR >= 0 ? 'text-bull' : 'text-bear'}">{fmt(side?.expectancyR)}R</td>
                            <td class="py-1 text-right {side?.pnlUsd >= 0 ? 'text-bull' : 'text-bear'}">{money(side?.pnlUsd, 0)}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>

        <!-- MONTHLY RETURNS -->
        {#if monthlyByYear.length}
            <div class="bg-black/25 rounded-xl border border-border/40 p-2.5 space-y-1.5 overflow-x-auto">
                <div class="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Retornos mensuales (%)</div>
                <table class="w-full text-[8px] font-mono">
                    <thead class="text-slate-600">
                        <tr><th class="text-left"></th>{#each MONTHS as mo}<th class="text-right px-0.5">{mo}</th>{/each}</tr>
                    </thead>
                    <tbody>
                        {#each monthlyByYear as [year, months]}
                            <tr>
                                <td class="text-slate-400 font-bold pr-1">{year}</td>
                                {#each months as v}
                                    <td class="text-right px-0.5 {heat(v)}">{v == null ? "·" : v.toFixed(0)}</td>
                                {/each}
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        {/if}

        <!-- VALIDATION -->
        <div class="bg-black/25 rounded-xl border border-amber-500/30 p-2.5 space-y-2">
            <div class="text-[8px] font-bold text-amber-400 uppercase tracking-wider">
                <i class="fas fa-vial text-[8px] mr-1"></i>Validación estadística
            </div>

            <div class="grid grid-cols-2 gap-1.5 text-center">
                <div class="bg-panel/80 p-1.5 rounded border border-border/30" title="Probabilidad de que el Sharpe real sea > 0, corrigiendo por asimetría y colas gruesas">
                    <div class="text-[7.5px] text-slate-500 uppercase">Sharpe probabilístico</div>
                    <div class="text-[9.5px] font-bold {m.probabilisticSharpe >= 95 ? 'text-bull' : m.probabilisticSharpe >= 80 ? 'text-amber-400' : 'text-bear'}">{pct(m.probabilisticSharpe, 0)}</div>
                </div>
                <div class="bg-panel/80 p-1.5 rounded border border-border/30" title="Igual, pero penalizado por el número de configuraciones probadas (multiple testing)">
                    <div class="text-[7.5px] text-slate-500 uppercase">Sharpe deflactado</div>
                    <div class="text-[9.5px] font-bold {m.deflatedSharpe >= 95 ? 'text-bull' : m.deflatedSharpe >= 80 ? 'text-amber-400' : 'text-bear'}">{pct(m.deflatedSharpe, 0)}</div>
                </div>
            </div>

            <div class="space-y-1 pt-1 border-t border-border/20">
                <div class="text-[8px] text-slate-500 uppercase font-bold">Walk-forward (IS → OOS)</div>
                <div class="grid grid-cols-3 gap-1.5 text-center text-[9px] font-mono">
                    <div><div class="text-[7.5px] text-slate-600 uppercase">Exp. IS</div><div class="{wf.isExpectancyR >= 0 ? 'text-bull' : 'text-bear'}">{fmt(wf.isExpectancyR)}R</div></div>
                    <div><div class="text-[7.5px] text-slate-600 uppercase">Exp. OOS</div><div class="{wf.oosExpectancyR >= 0 ? 'text-bull' : 'text-bear'}">{fmt(wf.oosExpectancyR)}R</div></div>
                    <div title="OOS / IS. Por debajo de 0.5 el edge no sobrevive fuera de muestra. Solo tiene sentido si el periodo in-sample fue rentable."><div class="text-[7.5px] text-slate-600 uppercase">Degradación</div><div class="{!Number.isFinite(wf.degradationRatio) ? 'text-slate-500' : wf.degradationRatio >= 0.5 ? 'text-bull' : 'text-bear'}">{Number.isFinite(wf.degradationRatio) ? fmt(wf.degradationRatio) : "n/a"}</div></div>
                </div>
            </div>

            <div class="space-y-1 pt-1 border-t border-border/20">
                <div class="text-[8px] text-slate-500 uppercase font-bold" title="Remuestreo con reemplazo de la distribución de trades observada">Monte Carlo (remuestreo)</div>
                <div class="grid grid-cols-4 gap-1.5 text-center text-[9px] font-mono">
                    <div><div class="text-[7.5px] text-slate-600 uppercase">DD mediano</div><div class="text-slate-300">{fmt(mc.medianMaxDdPct, 0)}%</div></div>
                    <div><div class="text-[7.5px] text-slate-600 uppercase">DD p95</div><div class="text-amber-400">{fmt(mc.p95MaxDdPct, 0)}%</div></div>
                    <div title="Fracción de reordenaciones que tocan el umbral de ruina"><div class="text-[7.5px] text-slate-600 uppercase">P(ruina)</div><div class="{mc.probabilityOfRuin > 5 ? 'text-bear' : 'text-slate-300'}">{fmt(mc.probabilityOfRuin, 1)}%</div></div>
                    <div><div class="text-[7.5px] text-slate-600 uppercase">P(gana)</div><div class="{mc.probabilityOfProfit >= 50 ? 'text-bull' : 'text-bear'}">{fmt(mc.probabilityOfProfit, 0)}%</div></div>
                </div>
            </div>
        </div>
    {/if}
</div>
