#![recursion_limit = "512"]

pub mod models;
pub mod indicators;
pub mod costs;
pub mod metrics;
pub mod smc;
pub mod liquidity;
pub mod trendlines;
pub mod cvd;
pub mod volume_profile;
pub mod resampler;
pub mod crypto_pro;

use wasm_bindgen::prelude::*;

use costs::CostConfig;
use crypto_pro::{analyze_crypto_pro, CryptoProConfig};
use cvd::analyze_anchored_cvd;
use liquidity::run_optimizer_rust;
use metrics::{compute_metrics, MetricsConfig};
use models::{Candle, EquityPoint, Trade, Zone};
use resampler::resample_candles;
use serde::Serialize;
use serde::Serializer as _;
use smc::analyze_smc;
use volume_profile::calculate_volume_profile;

#[derive(Serialize)]
pub struct AnalysisResult {
    pub zones: Vec<Zone>,
    pub trades: Vec<Trade>,
}

/// Install a panic hook that surfaces Rust panics in the browser console.
///
/// Without it a panic unwinds into a JS exception that the caller's `catch` swallows, and
/// the UI shows an empty result as if the market were simply quiet. Call once at startup.
#[wasm_bindgen]
pub fn init_panic_hook() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Deserialize candles or fail loudly. The previous `unwrap_or_default()` turned a schema
/// mismatch into "no data", which is indistinguishable from a quiet market.
fn parse_candles(js: JsValue) -> Result<Vec<Candle>, JsValue> {
    serde_wasm_bindgen::from_value(js)
        .map_err(|e| JsValue::from_str(&format!("invalid candle payload: {e}")))
}

/// Serialize to a plain JS object graph.
///
/// `serde_wasm_bindgen::to_value` emits a JS `Map` for anything serde routes through
/// `serialize_map` - which includes every `#[serde(flatten)]` struct and every
/// `serde_json::Value::Object`. A `Map` has no named properties, so the whole dashboard
/// read back as `undefined` in Svelte. `serialize_maps_as_objects` is what makes flatten
/// and the per-trade snapshot usable from JS.
fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    value
        .serialize(&serializer)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn analyze_market_wasm(
    js_candles: JsValue,
    sensitivity: f64,
    history_target: usize,
    risk_reward: f64,
) -> Result<JsValue, JsValue> {
    let candles = parse_candles(js_candles)?;
    let (zones, trades) = analyze_smc(&candles, sensitivity, history_target, risk_reward);
    to_js(&AnalysisResult { zones, trades })
}

#[wasm_bindgen]
pub fn run_optimizer_wasm(js_candles: JsValue, sensitivity: f64) -> Result<JsValue, JsValue> {
    let candles = parse_candles(js_candles)?;
    to_js(&run_optimizer_rust(&candles, sensitivity))
}

#[wasm_bindgen]
pub fn analyze_cvd_wasm(
    js_candles: JsValue,
    sma_period: usize,
    div_lookback: usize,
) -> Result<JsValue, JsValue> {
    let candles = parse_candles(js_candles)?;
    to_js(&analyze_anchored_cvd(&candles, "daily", sma_period, div_lookback))
}

#[wasm_bindgen]
pub fn analyze_anchored_cvd_wasm(
    js_candles: JsValue,
    anchor: &str,
    sma_period: usize,
    div_lookback: usize,
) -> Result<JsValue, JsValue> {
    let candles = parse_candles(js_candles)?;
    to_js(&analyze_anchored_cvd(&candles, anchor, sma_period, div_lookback))
}

#[wasm_bindgen]
pub fn calculate_volume_profile_wasm(
    js_candles: JsValue,
    num_bins: usize,
) -> Result<JsValue, JsValue> {
    let candles = parse_candles(js_candles)?;
    to_js(&calculate_volume_profile(&candles, num_bins))
}

#[wasm_bindgen]
pub fn resample_candles_wasm(js_candles: JsValue, target_seconds: u64) -> Result<JsValue, JsValue> {
    let candles = parse_candles(js_candles)?;
    to_js(&resample_candles(&candles, target_seconds))
}

fn parse_pro_config(js: JsValue) -> Result<CryptoProConfig, JsValue> {
    if js.is_undefined() || js.is_null() {
        return Ok(CryptoProConfig::default());
    }
    serde_wasm_bindgen::from_value(js)
        .map_err(|e| JsValue::from_str(&format!("invalid strategy config: {e}")))
}

#[wasm_bindgen]
pub fn analyze_crypto_pro_wasm(js_candles: JsValue, js_config: JsValue) -> Result<JsValue, JsValue> {
    let candles = parse_candles(js_candles)?;
    let config = parse_pro_config(js_config)?;
    to_js(&analyze_crypto_pro(&candles, &config))
}

/// Full performance and risk report for a set of trades.
///
/// `js_equity_curve` should be the bar-level curve the strategy returned. Pass an empty
/// array for engines that do not produce one; the metrics that need bar granularity then
/// fall back to a trade-close approximation instead of reporting a number they cannot see.
#[wasm_bindgen]
pub fn compute_metrics_wasm(
    js_trades: JsValue,
    js_equity_curve: JsValue,
    js_config: JsValue,
) -> Result<JsValue, JsValue> {
    let trades: Vec<Trade> = serde_wasm_bindgen::from_value(js_trades)
        .map_err(|e| JsValue::from_str(&format!("invalid trades payload: {e}")))?;

    let curve: Vec<EquityPoint> = if js_equity_curve.is_undefined() || js_equity_curve.is_null() {
        Vec::new()
    } else {
        serde_wasm_bindgen::from_value(js_equity_curve)
            .map_err(|e| JsValue::from_str(&format!("invalid equity curve payload: {e}")))?
    };

    let config: MetricsConfig = if js_config.is_undefined() || js_config.is_null() {
        MetricsConfig::default()
    } else {
        serde_wasm_bindgen::from_value(js_config)
            .map_err(|e| JsValue::from_str(&format!("invalid metrics config: {e}")))?
    };

    to_js(&compute_metrics(&trades, &curve, &config))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SensitivityPoint {
    pub per_side_bps: f64,
    pub trades: usize,
    pub win_rate: f64,
    pub pnl_usd: f64,
    pub pnl_r: f64,
    pub profit_factor: f64,
    pub sharpe: f64,
    pub max_dd_pct: f64,
    pub total_costs: f64,
}

/// Re-run the backtest across a sweep of per-side costs.
///
/// Answers what a single backtest number cannot: how much margin the edge has, and at
/// what cost level the strategy stops working. Feeds the "Sharpe vs cost" curve.
#[wasm_bindgen]
pub fn cost_sensitivity_wasm(
    js_candles: JsValue,
    js_config: JsValue,
    js_bps_list: JsValue,
) -> Result<JsValue, JsValue> {
    let candles = parse_candles(js_candles)?;
    let base = parse_pro_config(js_config)?;
    let bps_list: Vec<f64> = serde_wasm_bindgen::from_value(js_bps_list)
        .map_err(|e| JsValue::from_str(&format!("invalid bps list: {e}")))?;

    let metrics_cfg = MetricsConfig {
        initial_capital: base.initial_capital,
        // The sweep measures cost sensitivity; skip resampling on every point.
        bootstrap_iterations: 0,
        monte_carlo_iterations: 0,
        ..MetricsConfig::default()
    };

    let points: Vec<SensitivityPoint> = bps_list
        .into_iter()
        .map(|bps| {
            let cfg = CryptoProConfig {
                costs: CostConfig {
                    mode: if bps <= 0.0 { "none".to_string() } else { "flat".to_string() },
                    per_side_bps: bps,
                    ..CostConfig::default()
                },
                ..base.clone()
            };
            let run = analyze_crypto_pro(&candles, &cfg);
            let m = compute_metrics(&run.trades, &run.equity_curve, &metrics_cfg);
            SensitivityPoint {
                per_side_bps: bps,
                trades: m.total_trades,
                win_rate: m.win_rate,
                pnl_usd: m.total_pnl,
                pnl_r: m.total_pnl_r,
                profit_factor: if m.profit_factor.is_finite() { m.profit_factor } else { 999.0 },
                sharpe: m.sharpe,
                max_dd_pct: m.drawdown.max_pct,
                total_costs: m.total_costs,
            }
        })
        .collect();

    to_js(&points)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesPoint {
    pub time: u64,
    pub value: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndicatorBundle {
    pub rsi: Vec<SeriesPoint>,
    pub macd: Vec<SeriesPoint>,
    pub signal: Vec<SeriesPoint>,
    pub hist: Vec<SeriesPoint>,
    pub adx: Vec<SeriesPoint>,
    pub di_plus: Vec<SeriesPoint>,
    pub di_minus: Vec<SeriesPoint>,
}

/// Convert a causal series into chart points, dropping warm-up bars entirely rather than
/// plotting a placeholder value at them.
fn to_points(candles: &[Candle], series: &indicators::Series) -> Vec<SeriesPoint> {
    series
        .iter()
        .enumerate()
        .filter_map(|(i, v)| v.map(|value| SeriesPoint { time: candles[i].time, value }))
        .collect()
}

/// RSI / MACD / ADX for the chart subpanes.
///
/// These come from the same code path the strategy scores with, so the indicator the user
/// reads off the chart is by construction the one the engine traded on. The JS
/// reimplementations these replace seeded their EMAs differently and silently disagreed.
#[wasm_bindgen]
pub fn compute_indicators_wasm(
    js_candles: JsValue,
    rsi_length: usize,
    adx_length: usize,
) -> Result<JsValue, JsValue> {
    let candles = parse_candles(js_candles)?;
    let rsi = indicators::calculate_rsi(&candles, if rsi_length == 0 { 14 } else { rsi_length });
    let macd = indicators::calculate_macd(&candles, 12, 26, 9);
    let dmi = indicators::calculate_dmi_adx(&candles, if adx_length == 0 { 14 } else { adx_length });

    to_js(&IndicatorBundle {
        rsi: to_points(&candles, &rsi),
        macd: to_points(&candles, &macd.macd),
        signal: to_points(&candles, &macd.signal),
        hist: to_points(&candles, &macd.hist),
        adx: to_points(&candles, &dmi.adx),
        di_plus: to_points(&candles, &dmi.di_plus),
        di_minus: to_points(&candles, &dmi.di_minus),
    })
}

#[wasm_bindgen]
pub fn greet() -> String {
    "BTC Engine Rust Wasm v3.0 (causal indicators + cost-aware backtest + quant metrics)"
        .to_string()
}
