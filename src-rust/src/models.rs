use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Candle {
    pub time: u64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: Option<f64>,
    pub delta: Option<f64>,
    pub buy_volume: Option<f64>,
    pub sell_volume: Option<f64>,
    pub txn_count: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Zone {
    pub id: String,
    pub label: String,      // "FVG", "OB"
    #[serde(rename = "type")]
    pub zone_type: String,  // "BULL", "BEAR"
    pub top: f64,
    pub bottom: f64,
    pub time: u64,
    pub end_time: Option<u64>,
    pub status: String,     // "ACTIVE", "MITIGATED"
    pub color: String,
    pub score: f64,
    pub quality: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Trade {
    pub id: String,
    #[serde(rename = "type")]
    pub trade_type: String, // "LONG", "SHORT"
    pub status: String,     // "PENDING", "OPEN", "WIN", "LOSS", "CANCELLED"
    pub entry: f64,
    pub sl: f64,
    pub tp: f64,
    pub tp1: Option<f64>,
    pub tp2: Option<f64>,
    pub tp3: Option<f64>,
    pub signal_time: u64,
    pub time: u64,
    pub pnl: f64,
    pub pnl_percent: f64,
    pub desc: String,
    pub entry_time: Option<u64>,
    pub exit_time: Option<u64>,
    pub setup_score: Option<f64>,
    pub dashboard_snapshot: Option<serde_json::Value>,
    pub sr_level: Option<f64>,
    pub sr_time: Option<u64>,
    pub sr_type: Option<String>,
}
