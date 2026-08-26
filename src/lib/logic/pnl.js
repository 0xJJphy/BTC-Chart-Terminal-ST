/**
 * PnL and performance metrics — thin wrapper over the Rust engine.
 *
 * The previous implementation lived entirely here and had four problems that made its
 * output unusable for judging a strategy:
 *
 *  - Sharpe annualized *per-trade* returns with `sqrt(252)`. With ~2 trades/day that
 *    overstated the ratio by roughly 2x, and 252 is the equity-market trading-day count,
 *    not the 365 days a perpetual actually trades.
 *  - Sortino divided by the count of losing days instead of the full sample.
 *  - Calmar used total return over max drawdown; Calmar is annualized by definition.
 *  - Breakeven trades were counted as wins, and max drawdown was measured only at trade
 *    closes, so intra-trade and open-position drawdown were invisible.
 *
 * All of that now lives in src-rust/src/metrics.rs, computed off the bar-by-bar
 * mark-to-market equity curve. This module exists so older call sites keep working.
 *
 * Prefer calling `updatePnL()` / `callEngine('metrics', ...)` directly; this helper is
 * async because the engine runs in a worker.
 */

import { callEngine } from './engine_client.js';
import { resolveMetricsConfig } from '../config/strategies.js';

/**
 * @param {Array} trades
 * @param {Array} equityCurve bar-level curve from the strategy; `[]` falls back to a
 *   trade-close approximation inside the engine.
 * @param {object} config overrides merged over the metrics defaults.
 * @returns {Promise<{metrics: object, equityCurve: Array}>}
 */
export async function calculatePnLMetrics(trades = [], equityCurve = [], config = {}) {
    const metricsConfig = resolveMetricsConfig(
        {},
        {
            ...(config.initialBalance ? { initialCapital: config.initialBalance } : {}),
            ...config,
        },
    );

    const metrics = await callEngine('metrics', {
        trades,
        equityCurve,
        config: metricsConfig,
    });

    return { metrics, equityCurve: metrics?.equityCurve || [] };
}
