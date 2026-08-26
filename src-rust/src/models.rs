use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
// `default` matters on the way *in*: trades produced by the JS fallback strategies carry
// only the legacy fields, and the metrics engine must still accept them.
#[serde(rename_all = "camelCase", default)]
pub struct Trade {
    pub id: String,
    #[serde(rename = "type")]
    pub trade_type: String, // "LONG", "SHORT"
    /// "WIN" | "LOSS" | "BE" | "PENDING" | "OPEN" | "OPEN_MTM" | "CANCELLED".
    /// `OPEN_MTM` is a position still open when the data ran out, marked to the last
    /// close so it cannot be silently dropped from the statistics.
    pub status: String,
    pub entry: f64,
    pub sl: f64,
    pub tp: f64,
    pub tp1: Option<f64>,
    pub tp2: Option<f64>,
    pub tp3: Option<f64>,
    pub signal_time: u64,
    pub time: u64,

    /// Realized R multiple, **net of costs**: `pnl_usd / risk_usd`. Always computed from
    /// the fills, never a hardcoded constant.
    pub pnl: f64,
    /// Realized PnL in account currency, net of fees, slippage and funding.
    pub pnl_usd: f64,
    /// Return on the equity that was at risk when the trade opened, in percent.
    pub pnl_percent: f64,
    /// `|entry - initial_sl| * qty`: the denominator behind `pnl`.
    pub risk_usd: f64,
    /// Position size in base units at entry.
    pub qty: f64,
    /// Total costs paid across every fill of this trade.
    pub cost_usd: f64,
    /// Maximum adverse excursion, in R. Always <= 0.
    pub mae_r: f64,
    /// Maximum favourable excursion, in R. Always >= 0.
    pub mfe_r: f64,
    /// Number of candles the position was open.
    pub bars_held: usize,
    /// Account equity immediately before this trade opened.
    pub equity_at_entry: f64,

    pub desc: String,
    pub entry_time: Option<u64>,
    pub exit_time: Option<u64>,
    pub setup_score: Option<f64>,
    pub dashboard_snapshot: Option<serde_json::Value>,
    pub sr_level: Option<f64>,
    pub sr_time: Option<u64>,
    pub sr_type: Option<String>,
    pub initial_sl: Option<f64>,
    pub trailing_sl: Option<f64>,
    pub tp1_time: Option<u64>,
    pub tp2_time: Option<u64>,
    pub tp3_time: Option<u64>,
    pub exit_reason: Option<String>,
}

/// One point on the bar-by-bar mark-to-market equity curve. This, rather than a
/// trade-close series, is the input to every drawdown- and return-based metric.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EquityPoint {
    pub time: u64,
    /// Realized equity plus any open position marked to this bar's close.
    pub value: f64,
    /// True while a position is open, so exposure / time-in-market is computable.
    pub in_position: bool,
}
