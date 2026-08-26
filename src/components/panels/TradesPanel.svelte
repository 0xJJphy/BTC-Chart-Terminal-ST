<script>
    import { state } from "../../lib/stores/app.js";
    import { replayTrade } from "../../lib/logic/app_controller.js";

    let sortKey = "time";
    let sortDir = -1;
    let sideFilter = "ALL"; // ALL | LONG | SHORT
    let resultFilter = "ALL"; // ALL | WIN | LOSS | BE

    const COLUMNS = [
        { key: "time", label: "Fecha", align: "left" },
        { key: "type", label: "Lado", align: "left" },
        { key: "pnl", label: "R", align: "right" },
        { key: "pnlUsd", label: "PnL", align: "right" },
        { key: "maeR", label: "MAE", align: "right", hint: "Máxima excursión adversa, en R" },
        { key: "mfeR", label: "MFE", align: "right", hint: "Máxima excursión favorable, en R" },
        { key: "costUsd", label: "Coste", align: "right", hint: "Fees + slippage + funding de este trade" },
        { key: "barsHeld", label: "Velas", align: "right" },
        { key: "setupScore", label: "Score", align: "right" },
        { key: "exitReason", label: "Salida", align: "left" },
    ];

    function toggleSort(key) {
        if (sortKey === key) sortDir = -sortDir;
        else {
            sortKey = key;
            sortDir = -1;
        }
    }

    function classify(t) {
        if (t.pnlUsd > 0 || (t.pnlUsd == null && t.pnl > 0)) return "WIN";
        if (t.pnlUsd < 0 || (t.pnlUsd == null && t.pnl < 0)) return "LOSS";
        return "BE";
    }

    $: rows = ($state.trades || [])
        .filter((t) => sideFilter === "ALL" || t.type === sideFilter)
        .filter((t) => resultFilter === "ALL" || classify(t) === resultFilter)
        .slice()
        .sort((a, b) => {
            const av = a[sortKey], bv = b[sortKey];
            if (typeof av === "string" || typeof bv === "string") {
                return String(av ?? "").localeCompare(String(bv ?? "")) * sortDir;
            }
            return ((av ?? 0) - (bv ?? 0)) * sortDir;
        });

    $: totals = rows.reduce(
        (acc, t) => {
            acc.r += t.pnl || 0;
            acc.usd += t.pnlUsd || 0;
            acc.cost += t.costUsd || 0;
            return acc;
        },
        { r: 0, usd: 0, cost: 0 },
    );

    const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
    const money = (v, d = 2) =>
        Number.isFinite(v) ? `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(d)}` : "—";
    const date = (t) =>
        Number.isFinite(t) ? new Date(t * 1000).toISOString().slice(2, 16).replace("T", " ") : "—";

    /**
     * CSV of the currently filtered and sorted rows. Built as a data URL and clicked from
     * the user's own gesture, so no server round trip is involved.
     */
    function exportCsv() {
        const header = [
            "id", "type", "status", "exit_reason", "entry_time", "exit_time",
            "entry", "initial_sl", "tp1", "tp2", "tp3",
            "qty", "risk_usd", "pnl_r", "pnl_usd", "pnl_percent",
            "cost_usd", "mae_r", "mfe_r", "bars_held", "setup_score", "equity_at_entry",
        ];
        const lines = [header.join(",")];
        for (const t of rows) {
            lines.push([
                t.id, t.type, t.status, t.exitReason ?? "",
                t.entryTime ?? t.time, t.exitTime ?? "",
                t.entry, t.initialSl ?? t.sl, t.tp1 ?? "", t.tp2 ?? "", t.tp3 ?? "",
                t.qty ?? "", t.riskUsd ?? "", t.pnl ?? "", t.pnlUsd ?? "", t.pnlPercent ?? "",
                t.costUsd ?? "", t.maeR ?? "", t.mfeR ?? "", t.barsHeld ?? "",
                t.setupScore ?? "", t.equityAtEntry ?? "",
            ]
                .map((v) => (typeof v === "string" && v.includes(",") ? `"${v}"` : v))
                .join(","));
        }

        const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `trades_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
</script>

<div class="flex-1 flex flex-col overflow-hidden">
    <div class="p-3 border-b border-border bg-black/10 space-y-2.5">
        <div class="flex justify-between items-center">
            <h2 class="text-white font-bold text-xs uppercase tracking-widest">Operaciones</h2>
            <button
                on:click={exportCsv}
                disabled={rows.length === 0}
                class="text-[9px] text-accent hover:text-white disabled:opacity-30 uppercase font-bold transition-colors flex items-center gap-1"
                title="Exportar las filas filtradas a CSV"
            >
                <i class="fas fa-file-csv text-[9px]"></i> CSV
            </button>
        </div>

        <div class="flex gap-1.5">
            <div class="flex rounded overflow-hidden border border-border/60">
                {#each ["ALL", "LONG", "SHORT"] as f}
                    <button
                        on:click={() => (sideFilter = f)}
                        class="px-2 py-1 text-[8px] font-bold uppercase transition-colors {sideFilter === f ? 'bg-accent text-white' : 'text-slate-500 hover:text-white'}"
                    >{f === "ALL" ? "Todo" : f}</button>
                {/each}
            </div>
            <div class="flex rounded overflow-hidden border border-border/60">
                {#each ["ALL", "WIN", "LOSS", "BE"] as f}
                    <button
                        on:click={() => (resultFilter = f)}
                        class="px-2 py-1 text-[8px] font-bold uppercase transition-colors {resultFilter === f ? 'bg-accent text-white' : 'text-slate-500 hover:text-white'}"
                    >{f === "ALL" ? "Todo" : f}</button>
                {/each}
            </div>
        </div>

        <div class="flex justify-between text-[9px] font-mono bg-black/25 rounded px-2 py-1.5 border border-border/40">
            <span class="text-slate-500">{rows.length} ops</span>
            <span class="{totals.r >= 0 ? 'text-bull' : 'text-bear'}">{fmt(totals.r)}R</span>
            <span class="{totals.usd >= 0 ? 'text-bull' : 'text-bear'}">{money(totals.usd)}</span>
            <span class="text-amber-400" title="Costes totales de las filas mostradas">{money(totals.cost)}</span>
        </div>
    </div>

    <div class="flex-1 overflow-auto custom-scroll">
        <table class="w-full text-[9px] font-mono">
            <thead class="bg-panel/95 text-slate-500 uppercase sticky top-0 z-10">
                <tr class="border-b border-border/50">
                    {#each COLUMNS as col}
                        <th
                            on:click={() => toggleSort(col.key)}
                            title={col.hint || `Ordenar por ${col.label}`}
                            class="px-1.5 py-1.5 text-[7.5px] font-bold cursor-pointer hover:text-white transition-colors whitespace-nowrap {col.align === 'right' ? 'text-right' : 'text-left'}"
                        >
                            {col.label}
                            {#if sortKey === col.key}<i class="fas fa-caret-{sortDir === 1 ? 'up' : 'down'} ml-0.5 text-accent"></i>{/if}
                        </th>
                    {/each}
                </tr>
            </thead>
            <tbody class="divide-y divide-border/20">
                {#each rows as t}
                    <tr
                        on:click={() => replayTrade(t)}
                        class="hover:bg-white/5 cursor-pointer transition-colors"
                        title={t.desc}
                    >
                        <td class="px-1.5 py-1 text-slate-500 whitespace-nowrap">{date(t.entryTime ?? t.time)}</td>
                        <td class="px-1.5 py-1 font-bold {t.type === 'LONG' ? 'text-bull' : 'text-bear'}">{t.type}</td>
                        <td class="px-1.5 py-1 text-right font-bold {t.pnl > 0 ? 'text-bull' : t.pnl < 0 ? 'text-bear' : 'text-amber-400'}">{fmt(t.pnl)}</td>
                        <td class="px-1.5 py-1 text-right {t.pnlUsd > 0 ? 'text-bull' : t.pnlUsd < 0 ? 'text-bear' : 'text-amber-400'}">{money(t.pnlUsd)}</td>
                        <td class="px-1.5 py-1 text-right text-bear/70">{fmt(t.maeR)}</td>
                        <td class="px-1.5 py-1 text-right text-bull/70">{fmt(t.mfeR)}</td>
                        <td class="px-1.5 py-1 text-right text-amber-400/80">{money(t.costUsd)}</td>
                        <td class="px-1.5 py-1 text-right text-slate-400">{t.barsHeld ?? "—"}</td>
                        <td class="px-1.5 py-1 text-right text-slate-400">{fmt(t.setupScore, 0)}</td>
                        <td class="px-1.5 py-1 text-slate-400 whitespace-nowrap">{t.exitReason ?? t.status}</td>
                    </tr>
                {:else}
                    <tr>
                        <td colspan={COLUMNS.length} class="p-8 text-center text-[9px] text-slate-600 uppercase font-bold tracking-widest">
                            Sin operaciones para los filtros actuales.
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
</div>
