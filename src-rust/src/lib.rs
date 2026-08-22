pub mod models;
pub mod indicators;
pub mod smc;
pub mod liquidity;
pub mod trendlines;

use wasm_bindgen::prelude::*;
use models::{Candle, Zone, Trade};
use smc::analyze_smc;
use liquidity::run_optimizer_rust;
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
pub fn greet() -> String {
    "BTC Engine Rust Wasm Ready!".to_string()
}
