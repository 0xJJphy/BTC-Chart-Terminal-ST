pub mod models;
pub mod indicators;
pub mod smc;
pub mod liquidity;
pub mod trendlines;
pub mod cvd;
pub mod volume_profile;
pub mod resampler;
pub mod crypto_pro;

use wasm_bindgen::prelude::*;
use models::{Candle, Zone, Trade};
use smc::analyze_smc;
use liquidity::run_optimizer_rust;
use cvd::analyze_anchored_cvd;
use volume_profile::calculate_volume_profile;
use resampler::resample_candles;
use crypto_pro::{analyze_crypto_pro, CryptoProConfig};
use serde::{Serialize};

#[derive(Serialize)]
pub struct AnalysisResult {
    pub zones: Vec<Zone>,
    pub trades: Vec<Trade>,
}

#[wasm_bindgen]
pub fn analyze_market_wasm(js_candles: JsValue, sensitivity: f64, history_target: usize, risk_reward: f64) -> JsValue {
    let candles: Vec<Candle> = serde_wasm_bindgen::from_value(js_candles).unwrap_or_default();
    let (zones, trades) = analyze_smc(&candles, sensitivity, history_target, risk_reward);
    
    let result = AnalysisResult {
        zones,
        trades,
    };
    
    serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn run_optimizer_wasm(js_candles: JsValue, sensitivity: f64) -> JsValue {
    let candles: Vec<Candle> = serde_wasm_bindgen::from_value(js_candles).unwrap_or_default();
    let results = run_optimizer_rust(&candles, sensitivity);
    serde_wasm_bindgen::to_value(&results).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn analyze_cvd_wasm(js_candles: JsValue, sma_period: usize, div_lookback: usize) -> JsValue {
    let candles: Vec<Candle> = serde_wasm_bindgen::from_value(js_candles).unwrap_or_default();
    let result = analyze_anchored_cvd(&candles, "daily", sma_period, div_lookback);
    serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn analyze_anchored_cvd_wasm(js_candles: JsValue, anchor: &str, sma_period: usize, div_lookback: usize) -> JsValue {
    let candles: Vec<Candle> = serde_wasm_bindgen::from_value(js_candles).unwrap_or_default();
    let result = analyze_anchored_cvd(&candles, anchor, sma_period, div_lookback);
    serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn calculate_volume_profile_wasm(js_candles: JsValue, num_bins: usize) -> JsValue {
    let candles: Vec<Candle> = serde_wasm_bindgen::from_value(js_candles).unwrap_or_default();
    let result = calculate_volume_profile(&candles, num_bins);
    serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn resample_candles_wasm(js_candles: JsValue, target_seconds: u64) -> JsValue {
    let candles: Vec<Candle> = serde_wasm_bindgen::from_value(js_candles).unwrap_or_default();
    let result = resample_candles(&candles, target_seconds);
    serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn analyze_crypto_pro_wasm(js_candles: JsValue, js_config: JsValue) -> JsValue {
    let candles: Vec<Candle> = serde_wasm_bindgen::from_value(js_candles).unwrap_or_default();
    let config: CryptoProConfig = serde_wasm_bindgen::from_value(js_config).unwrap_or_default();
    let result = analyze_crypto_pro(&candles, &config);
    serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn greet() -> String {
    "BTC Engine Rust Wasm v2.1 (SMC + CVD + Volume Profile + Resampler + CryptoPro) Ready!".to_string()
}
