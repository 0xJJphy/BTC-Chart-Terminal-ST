use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

use crate::costs::{CostBreakdown, CostConfig, CostModel, FillKind};
use crate::indicators::{
    calculate_atr, calculate_avg_volume, calculate_dmi_adx, calculate_ema, calculate_macd,
    calculate_pivots, calculate_rsi, DmiAdxResult, MacdResult, PivotLevel, Series,
};
use crate::models::{Candle, EquityPoint, Trade};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct CryptoProConfig {
    // --- Signal ---
    pub ema_fast: usize,
    pub ema_slow: usize,
    pub rsi_length: usize,
    pub adx_length: usize,
    pub pivot_left: usize,
    pub pivot_right: usize,
    /// How many recently-confirmed pivots stay in the S/R book. Bounds the per-bar scan.
    pub sr_lookback_pivots: usize,
    pub volume_length: usize,
    pub high_volume: f64,
    pub very_high_volume: f64,
    pub minimum_score: f64,

    // --- Retest ---
    pub wait_for_retest: bool,
    pub min_pullback_atr: f64,
    pub max_pullback_atr: f64,
    pub max_wait_bars: usize,
    pub require_recovery_candle: bool,

    // --- Risk / targets ---
    pub atr_length: usize,
    pub atr_multiplier: f64,
    pub max_sl_atr: f64,
    pub rr_tp1: f64,
    pub rr_tp2: f64,
    pub rr_tp3: f64,
    pub tp1_fraction: f64,
    pub tp2_fraction: f64,

    // --- Capital ---
    pub initial_capital: f64,
    pub capital_per_trade: f64,
    pub leverage: f64,
    /// Percent of equity risked per trade. This now actually sizes the position.
    pub risk_percent: f64,
    pub compound_capital: bool,
    pub compound_percent: f64,
    /// Exchange maintenance margin, percent. Used for the liquidation guard.
    pub maintenance_margin_pct: f64,

    // --- Execution ---
    /// "sl_first" (default, conservative) | "tp_first" | "nearest_open".
    pub intrabar_policy: String,
    pub max_trades_per_day: usize,
    pub cooldown_bars: usize,
    pub costs: CostConfig,

    // --- Reporting ---
    pub analysis_days: usize,
}

impl Default for CryptoProConfig {
    fn default() -> Self {
        CryptoProConfig {
            ema_fast: 50,
            ema_slow: 200,
            rsi_length: 14,
            adx_length: 14,
            pivot_left: 6,
            pivot_right: 6,
            sr_lookback_pivots: 20,
            volume_length: 20,
            high_volume: 1.50,
            very_high_volume: 2.00,
            minimum_score: 65.0,

            wait_for_retest: true,
            min_pullback_atr: 0.30,
            max_pullback_atr: 1.50,
            max_wait_bars: 8,
            require_recovery_candle: true,

            atr_length: 14,
            atr_multiplier: 1.50,
            max_sl_atr: 2.50,
            rr_tp1: 1.0,
            rr_tp2: 2.0,
            rr_tp3: 3.0,
            tp1_fraction: 0.50,
            tp2_fraction: 0.25,

            initial_capital: 1000.0,
            capital_per_trade: 150.0,
            leverage: 10.0,
            risk_percent: 1.0,
            compound_capital: false,
            compound_percent: 15.0,
            maintenance_margin_pct: 0.5,

            intrabar_policy: "sl_first".to_string(),
            max_trades_per_day: 3,
            cooldown_bars: 6,
            costs: CostConfig::default(),

            analysis_days: 15,
        }
    }
}

/// How to resolve a candle that touches both a target and the stop.
///
/// The backtest never knows the intrabar path from OHLC alone, so this is an explicit,
/// auditable assumption rather than a silent one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntrabarPolicy {
    /// Assume the stop filled first. Conservative; the default.
    SlFirst,
    /// Assume the target filled first. Optimistic - this is what the old engine did
    /// implicitly, and it is what inflated the reported win rate.
    TpFirst,
    /// Assume whichever level sits closer to the open was reached first.
    NearestOpen,
}

impl IntrabarPolicy {
    fn parse(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "tp_first" | "tpfirst" | "optimistic" => IntrabarPolicy::TpFirst,
            "nearest_open" | "nearestopen" | "proportional" => IntrabarPolicy::NearestOpen,
            _ => IntrabarPolicy::SlFirst,
        }
    }
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/// The market read at a single bar. Used both for the live panel and, frozen, as the
/// per-trade audit snapshot. Replaces four hand-written `serde_json::json!` blocks that
/// had drifted out of sync with each other.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MarketSnapshot {
    pub signal: String,
    pub strength_long: f64,
    pub strength_short: f64,
    /// Empirically calibrated probability that a setup at this score wins, in percent.
    /// `None` when there is not enough backtest history to calibrate - the UI must show
    /// a dash rather than invent a number.
    pub prob_up: Option<f64>,
    pub adx_value: f64,
    pub adx_regime: String,
    pub di_bias: String,
    pub macd_state: String,
    pub rsi_value: f64,
    pub rsi_state: String,
    pub volume_ratio: f64,
    pub volume_state: String,
    pub trap_state: String,
    pub zone_state: String,
    pub current_entry: f64,
    pub current_sl: f64,
    pub current_tp1: f64,
    pub current_tp2: f64,
    pub current_tp3: f64,
    pub risk_reward: String,
    // Book state at the moment this snapshot was taken.
    pub equity_at_entry: f64,
    pub trades_before: usize,
    pub position_qty: f64,
    pub position_notional: f64,
    pub risk_usd: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CryptoProDashboard {
    #[serde(flatten)]
    pub snapshot: MarketSnapshot,

    pub trade_progress: String,
    pub limit_status: String,

    // Global statistics (all in account currency, net of costs).
    pub total_trades: usize,
    pub winning_trades: usize,
    pub losing_trades: usize,
    pub breakeven_trades: usize,
    pub tp1_count: usize,
    pub tp2_count: usize,
    pub tp3_count: usize,
    pub sl_no_tp_count: usize,
    pub win_rate: f64,

    pub initial_capital: f64,
    pub capital_per_trade: f64,
    pub current_capital: f64,
    pub total_pnl: f64,
    pub total_pnl_r: f64,
    pub total_costs: f64,
    pub cost_breakdown: CostBreakdown,
    pub leverage: f64,
    pub risk_per_trade_pct: f64,
    pub ruined: bool,

    // Trailing-window analysis.
    pub analysis_days: usize,
    pub pnl_per_day: f64,
    pub period_pnl: f64,
    pub period_trades: usize,
    pub period_win_rate: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CryptoProResult {
    pub dashboard: CryptoProDashboard,
    pub trades: Vec<Trade>,
    /// Bar-by-bar mark-to-market equity, the input to every drawdown-based metric.
    pub equity_curve: Vec<EquityPoint>,
}


// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq)]
enum Side {
    Long,
    Short,
}

impl Side {
    #[inline]
    fn dir(self) -> f64 {
        match self {
            Side::Long => 1.0,
            Side::Short => -1.0,
        }
    }
    fn as_str(self) -> &'static str {
        match self {
            Side::Long => "LONG",
            Side::Short => "SHORT",
        }
    }
}

struct Position {
    side: Side,
    entry: f64,
    initial_sl: f64,
    sl: f64,
    tp: [f64; 3],
    tp_hit: [bool; 3],
    tp_time: [u64; 3],
    qty_total: f64,
    qty_open: f64,
    risk_usd: f64,
    realized_usd: f64,
    costs: CostBreakdown,
    entry_index: usize,
    entry_time: u64,
    signal_time: u64,
    score: f64,
    equity_at_entry: f64,
    mae_r: f64,
    mfe_r: f64,
    snapshot: MarketSnapshot,
    sr_level: Option<f64>,
    sr_time: Option<u64>,
    sr_type: Option<String>,
}

enum RetestState {
    Idle,
    Armed { side: Side, anchor_price: f64, bar_idx: usize, score: f64 },
}

struct Indicators {
    ema_fast: Series,
    ema_slow: Series,
    atr: Series,
    avg_vol: Series,
    rsi: Series,
    macd: MacdResult,
    dmi: DmiAdxResult,
}

/// Everything `score_bar` needs that is not per-bar.
struct ScoreInputs {
    near_support: bool,
    near_resistance: bool,
    vol_ratio: f64,
}

// ---------------------------------------------------------------------------
// Scoring - one implementation, used by both the backtest loop and the live panel
// ---------------------------------------------------------------------------

/// Confluence score for bar `i`, returning `(long, short)` out of 100.
///
/// Returns `None` while any input indicator is still in its warm-up window, so the
/// strategy simply does not trade there instead of scoring against undefined values.
fn score_bar(
    candles: &[Candle],
    i: usize,
    ind: &Indicators,
    cfg: &CryptoProConfig,
    inputs: &ScoreInputs,
) -> Option<(f64, f64)> {
    let c = &candles[i];
    let ema_fast = ind.ema_fast[i]?;
    let ema_slow = ind.ema_slow[i]?;
    let adx = ind.dmi.adx[i]?;
    let di_plus = ind.dmi.di_plus[i]?;
    let di_minus = ind.dmi.di_minus[i]?;
    let macd = ind.macd.macd[i]?;
    let signal = ind.macd.signal[i]?;
    let hist = ind.macd.hist[i]?;
    let rsi = ind.rsi[i]?;

    let mut long = 0.0;
    let mut short = 0.0;

    // 1. Trend structure (EMA fast / slow).
    if c.close > ema_fast && ema_fast > ema_slow {
        long += 25.0;
    }
    if c.close < ema_fast && ema_fast < ema_slow {
        short += 25.0;
    }

    // 2. Directional regime.
    if adx > 25.0 {
        if di_plus > di_minus {
            long += 20.0;
        }
        if di_minus > di_plus {
            short += 20.0;
        }
    }

    // 3. Momentum.
    if hist > 0.0 && macd > signal {
        long += 15.0;
    }
    if hist < 0.0 && macd < signal {
        short += 15.0;
    }

    // 4. RSI band.
    if (45.0..=70.0).contains(&rsi) {
        long += 15.0;
    }
    if (30.0..=55.0).contains(&rsi) {
        short += 15.0;
    }

    // 5. Volume confirmation.
    if inputs.vol_ratio >= cfg.high_volume {
        if c.close >= c.open {
            long += 15.0;
        } else {
            short += 15.0;
        }
    }

    // 6. S/R confluence (confirmed pivots only).
    if inputs.near_support {
        long += 10.0;
    }
    if inputs.near_resistance {
        short += 10.0;
    }

    Some((long, short))
}

// ---------------------------------------------------------------------------
// Score -> win-probability calibration
// ---------------------------------------------------------------------------

const CALIB_BIN_WIDTH: f64 = 5.0;
const CALIB_MIN_BIN: usize = 10;
const CALIB_MIN_TOTAL: usize = 30;

struct Calibration {
    bins: Vec<(usize, usize)>, // (wins, total) indexed by score / CALIB_BIN_WIDTH
    total_wins: usize,
    total: usize,
}

impl Calibration {
    fn build(trades: &[Trade]) -> Self {
        let n_bins = (100.0 / CALIB_BIN_WIDTH) as usize + 1;
        let mut bins = vec![(0usize, 0usize); n_bins];
        let mut total_wins = 0;
        let mut total = 0;

        for t in trades {
            let score = t.setup_score.unwrap_or(0.0).clamp(0.0, 100.0);
            let idx = (score / CALIB_BIN_WIDTH) as usize;
            let is_win = t.pnl_usd > 0.0;
            bins[idx].1 += 1;
            if is_win {
                bins[idx].0 += 1;
            }
            total += 1;
            if is_win {
                total_wins += 1;
            }
        }

        Calibration { bins, total_wins, total }
    }

    /// Empirical win frequency for a setup scoring `score`, in percent.
    fn probability(&self, score: f64) -> Option<f64> {
        if self.total < CALIB_MIN_TOTAL {
            return None;
        }
        let idx = ((score.clamp(0.0, 100.0)) / CALIB_BIN_WIDTH) as usize;
        let (wins, count) = self.bins[idx];
        if count >= CALIB_MIN_BIN {
            Some((wins as f64 / count as f64) * 100.0)
        } else {
            // Not enough samples in this bucket: fall back to the base rate rather than
            // extrapolating from a handful of trades.
            Some((self.total_wins as f64 / self.total as f64) * 100.0)
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Infer the bar interval from candle spacing, for funding proration.
fn infer_timeframe_seconds(candles: &[Candle]) -> u64 {
    let mut smallest = u64::MAX;
    for w in candles.windows(2).take(200) {
        let d = w[1].time.saturating_sub(w[0].time);
        if d > 0 && d < smallest {
            smallest = d;
        }
    }
    if smallest == u64::MAX {
        900
    } else {
        smallest
    }
}

fn adx_regime(adx: f64) -> String {
    if adx >= 35.0 {
        "TENDENCIA MUY FUERTE".to_string()
    } else if adx >= 25.0 {
        "TENDENCIA FUERTE".to_string()
    } else {
        "RANGO / CONSOLIDACION".to_string()
    }
}

fn rsi_state(rsi: f64) -> String {
    if rsi >= 70.0 {
        "SOBRECOMPRA".to_string()
    } else if rsi <= 30.0 {
        "SOBREVENTA".to_string()
    } else {
        "NEUTRAL".to_string()
    }
}

fn volume_state(ratio: f64, cfg: &CryptoProConfig) -> String {
    if ratio >= cfg.very_high_volume {
        "MUY ALTO".to_string()
    } else if ratio >= cfg.high_volume {
        "ALTO".to_string()
    } else {
        "NORMAL".to_string()
    }
}

fn trap_state(c: &Candle, atr: f64, vol_ratio: f64) -> String {
    if vol_ratio >= 1.8 && (c.high - c.close.max(c.open)) > atr * 0.6 {
        "TRAMPA ALCISTA (Bull Trap)".to_string()
    } else if vol_ratio >= 1.8 && (c.close.min(c.open) - c.low) > atr * 0.6 {
        "TRAMPA BAJISTA (Bear Trap)".to_string()
    } else {
        "NINGUNA".to_string()
    }
}

#[allow(clippy::too_many_arguments)]
fn build_snapshot(
    candles: &[Candle],
    i: usize,
    ind: &Indicators,
    cfg: &CryptoProConfig,
    inputs: &ScoreInputs,
    scores: (f64, f64),
    signal: &str,
    zone_state: &str,
    levels: (f64, f64, f64, f64, f64),
    book: (f64, usize, f64, f64, f64),
    calibration: Option<&Calibration>,
) -> MarketSnapshot {
    let c = &candles[i];
    let atr = ind.atr[i].unwrap_or(0.0);
    let adx = ind.dmi.adx[i].unwrap_or(0.0);
    let di_plus = ind.dmi.di_plus[i].unwrap_or(0.0);
    let di_minus = ind.dmi.di_minus[i].unwrap_or(0.0);
    let hist = ind.macd.hist[i].unwrap_or(0.0);
    let rsi = ind.rsi[i].unwrap_or(50.0);

    let directional_score = if signal == "SHORT" { scores.1 } else { scores.0 };
    let prob_up = calibration.and_then(|cal| cal.probability(directional_score));

    MarketSnapshot {
        signal: signal.to_string(),
        strength_long: scores.0,
        strength_short: scores.1,
        prob_up,
        adx_value: (adx * 10.0).round() / 10.0,
        adx_regime: adx_regime(adx),
        di_bias: format!(
            "{} (+{:.0} / -{:.0})",
            if di_plus >= di_minus { "ALCISTA" } else { "BAJISTA" },
            di_plus,
            di_minus
        ),
        macd_state: if hist > 0.0 { "ALCISTA".to_string() } else { "BAJISTA".to_string() },
        rsi_value: (rsi * 10.0).round() / 10.0,
        rsi_state: rsi_state(rsi),
        volume_ratio: (inputs.vol_ratio * 100.0).round() / 100.0,
        volume_state: volume_state(inputs.vol_ratio, cfg),
        trap_state: trap_state(c, atr, inputs.vol_ratio),
        zone_state: zone_state.to_string(),
        current_entry: levels.0,
        current_sl: levels.1,
        current_tp1: levels.2,
        current_tp2: levels.3,
        current_tp3: levels.4,
        risk_reward: format!("1 : {:.1}", cfg.rr_tp3),
        equity_at_entry: book.0,
        trades_before: book.1,
        position_qty: book.2,
        position_notional: book.3,
        risk_usd: book.4,
    }
}

/// Result of sizing a candidate setup. `None` means the setup was rejected.
struct Sizing {
    qty: f64,
    risk_usd: f64,
}

/// Position sizing by risk, capped by the notional the account is willing to carry, and
/// rejected outright if the stop sits beyond the liquidation price.
fn size_position(entry: f64, sl: f64, equity: f64, cfg: &CryptoProConfig) -> Option<Sizing> {
    let sl_dist = (entry - sl).abs();
    if sl_dist <= 0.0 || entry <= 0.0 || equity <= 0.0 {
        return None;
    }

    // Liquidation guard: at `leverage`x, an adverse move of roughly `1/leverage` wipes the
    // margin. A stop further away than that would never actually be reached - the
    // exchange closes the position first - so the setup is not tradeable as configured.
    let sl_dist_pct = sl_dist / entry;
    let liquidation_pct = (1.0 / cfg.leverage.max(1.0)) - (cfg.maintenance_margin_pct / 100.0);
    if sl_dist_pct >= liquidation_pct {
        return None;
    }

    let risk_budget = equity * (cfg.risk_percent / 100.0);
    let mut qty = risk_budget / sl_dist;

    // Cap by the margin the account allocates to a trade.
    let margin = if cfg.compound_capital {
        equity * (cfg.compound_percent / 100.0)
    } else {
        cfg.capital_per_trade
    };
    let max_notional = margin.max(0.0) * cfg.leverage.max(1.0);
    let max_qty = max_notional / entry;
    if qty > max_qty {
        qty = max_qty;
    }

    if qty <= 0.0 || !qty.is_finite() {
        return None;
    }

    Some(Sizing { qty, risk_usd: qty * sl_dist })
}

/// A single event resolved for one bar. At most one per bar, which is what structurally
/// prevents the old engine's cascade of TP1+TP2+TP3 inside one candle.
enum BarEvent {
    Target(usize),
    Stop,
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

pub fn analyze_crypto_pro(candles: &[Candle], config: &CryptoProConfig) -> CryptoProResult {
    let n = candles.len();
    let cost_model = CostModel::new(&config.costs);
    let policy = IntrabarPolicy::parse(&config.intrabar_policy);
    let tf_seconds = infer_timeframe_seconds(candles);

    let ind = Indicators {
        ema_fast: calculate_ema(candles, config.ema_fast),
        ema_slow: calculate_ema(candles, config.ema_slow),
        atr: calculate_atr(candles, config.atr_length),
        avg_vol: calculate_avg_volume(candles, config.volume_length),
        rsi: calculate_rsi(candles, config.rsi_length),
        macd: calculate_macd(candles, 12, 26, 9),
        dmi: calculate_dmi_adx(candles, config.adx_length),
    };
    let pivots = calculate_pivots(candles, config.pivot_left, config.pivot_right);

    let mut trades: Vec<Trade> = Vec::new();
    let mut equity_curve: Vec<EquityPoint> = Vec::with_capacity(n);
    let mut realized_equity = config.initial_capital;
    let mut totals = CostBreakdown::default();

    let mut tp_counts = [0usize; 3];
    let mut sl_no_tp = 0usize;
    let mut ruined = false;

    let mut position: Option<Position> = None;
    let mut retest = RetestState::Idle;
    let mut trade_id = 1usize;
    let mut cooldown_until = 0usize;
    let mut current_day: Option<u64> = None;
    let mut trades_today = 0usize;

    // Confirmed-pivot book. A pivot only enters once `confirmed_at_index <= i`, which is
    // what makes the S/R component causal; the old code scanned the whole vector and took
    // `.last()`, happily selecting pivots thousands of bars in the future.
    let mut pivot_cursor = 0usize;
    let mut sr_book: VecDeque<PivotLevel> = VecDeque::new();
    let sr_capacity = config.sr_lookback_pivots.max(1);

    // Warm-up: no bar is evaluated until every indicator the score needs is defined.
    let warmup = [
        config.ema_slow,
        config.ema_fast,
        config.atr_length + 1,
        config.volume_length,
        config.rsi_length + 1,
        config.adx_length * 2,
        26 + 9,
        config.pivot_left + config.pivot_right + 1,
    ]
    .into_iter()
    .max()
    .unwrap_or(200);

    for i in 0..n {
        let c = &candles[i];

        // Admit pivots that have become knowable as of this bar.
        while pivot_cursor < pivots.len() && pivots[pivot_cursor].confirmed_at_index <= i {
            sr_book.push_back(pivots[pivot_cursor].clone());
            if sr_book.len() > sr_capacity {
                sr_book.pop_front();
            }
            pivot_cursor += 1;
        }

        // --- Manage the open position first, so a position entered on bar i is never
        // --- also resolved on bar i.
        if let Some(pos) = position.as_mut() {
            let dir = pos.side.dir();
            let favorable = if pos.side == Side::Long { c.high } else { c.low };
            let adverse = if pos.side == Side::Long { c.low } else { c.high };

            // Excursions, in R, measured on the full initial size.
            if pos.risk_usd > 0.0 {
                let fav_r = dir * (favorable - pos.entry) * pos.qty_total / pos.risk_usd;
                let adv_r = dir * (adverse - pos.entry) * pos.qty_total / pos.risk_usd;
                if fav_r > pos.mfe_r {
                    pos.mfe_r = fav_r;
                }
                if adv_r < pos.mae_r {
                    pos.mae_r = adv_r;
                }
            }

            // Funding accrues on the notional actually still open.
            let funding = cost_model.funding_cost(pos.qty_open * c.close, tf_seconds);
            pos.costs.add(&funding);
            pos.realized_usd -= funding.total;

            // Which levels did this bar touch?
            let next_tp = pos.tp_hit.iter().position(|hit| !hit);
            let tp_touched = next_tp.filter(|&k| dir * (favorable - pos.tp[k]) >= 0.0);
            let sl_touched = dir * (adverse - pos.sl) <= 0.0;

            let event = match (tp_touched, sl_touched) {
                (Some(k), true) => Some(match policy {
                    IntrabarPolicy::SlFirst => BarEvent::Stop,
                    IntrabarPolicy::TpFirst => BarEvent::Target(k),
                    IntrabarPolicy::NearestOpen => {
                        if (pos.tp[k] - c.open).abs() <= (pos.sl - c.open).abs() {
                            BarEvent::Target(k)
                        } else {
                            BarEvent::Stop
                        }
                    }
                }),
                (Some(k), false) => Some(BarEvent::Target(k)),
                (None, true) => Some(BarEvent::Stop),
                (None, false) => None,
            };

            let mut closed_now: Option<(String, f64)> = None;

            match event {
                Some(BarEvent::Target(k)) => {
                    let fraction = match k {
                        0 => config.tp1_fraction,
                        1 => config.tp2_fraction,
                        _ => 1.0,
                    };
                    // The last tranche always takes whatever remains, so rounding never
                    // strands a sliver of position.
                    let qty_chunk = if k == 2 {
                        pos.qty_open
                    } else {
                        (pos.qty_total * fraction).min(pos.qty_open)
                    };

                    let price = pos.tp[k];
                    let gross = dir * (price - pos.entry) * qty_chunk;
                    // Targets rest in the book, so they fill as maker.
                    let cost = cost_model.fill_cost(qty_chunk * price, FillKind::Limit);

                    pos.realized_usd += gross - cost.total;
                    pos.costs.add(&cost);
                    pos.qty_open -= qty_chunk;
                    pos.tp_hit[k] = true;
                    pos.tp_time[k] = c.time;
                    tp_counts[k] += 1;

                    // Stepped stop: breakeven after TP1, up to TP1 after TP2.
                    if k == 0 {
                        pos.sl = pos.entry;
                    } else if k == 1 {
                        pos.sl = pos.tp[0];
                    }

                    if pos.qty_open <= pos.qty_total * 1e-9 || k == 2 {
                        closed_now = Some(("TP3".to_string(), price));
                    }
                }
                Some(BarEvent::Stop) => {
                    let qty_chunk = pos.qty_open;
                    let price = pos.sl;
                    let gross = dir * (price - pos.entry) * qty_chunk;
                    // Stops are market orders: taker fee plus slippage.
                    let cost = cost_model.fill_cost(qty_chunk * price, FillKind::Market);

                    pos.realized_usd += gross - cost.total;
                    pos.costs.add(&cost);
                    pos.qty_open = 0.0;

                    let reason = if !pos.tp_hit[0] {
                        sl_no_tp += 1;
                        "SL".to_string()
                    } else if pos.tp_hit[1] {
                        "TRAIL TP1".to_string()
                    } else {
                        "BE".to_string()
                    };
                    closed_now = Some((reason, price));
                }
                None => {}
            }

            if let Some((reason, exit_price)) = closed_now {
                let pos = position.take().expect("position present");
                realized_equity += pos.realized_usd;
                totals.add(&pos.costs);
                if realized_equity <= 0.0 {
                    ruined = true;
                }
                trades.push(finalize_trade(
                    &pos, trade_id, &reason, exit_price, c.time, i, realized_equity,
                ));
                trade_id += 1;
                cooldown_until = i + config.cooldown_bars;
                retest = RetestState::Idle;
            }
        }

        // Mark-to-market equity for this bar.
        let (mtm, in_position) = match position.as_ref() {
            Some(p) => (
                realized_equity
                    + p.realized_usd
                    + p.side.dir() * (c.close - p.entry) * p.qty_open,
                true,
            ),
            None => (realized_equity, false),
        };
        equity_curve.push(EquityPoint { time: c.time, value: mtm, in_position });

        if ruined {
            continue;
        }

        // --- Signal generation ---
        if i < warmup {
            continue;
        }

        let day_id = c.time / 86_400;
        if current_day != Some(day_id) {
            current_day = Some(day_id);
            trades_today = 0;
        }

        let (atr_now, avg_vol_now) = match (ind.atr[i], ind.avg_vol[i]) {
            (Some(a), Some(v)) if a > 0.0 && v > 0.0 => (a, v),
            _ => continue,
        };
        let vol_ratio = c.volume.unwrap_or(0.0) / avg_vol_now;

        let (near_support, nearest_support) = nearest_pivot(&sr_book, false, c.close, atr_now);
        let (near_resistance, nearest_resistance) =
            nearest_pivot(&sr_book, true, c.close, atr_now);

        let inputs = ScoreInputs { near_support, near_resistance, vol_ratio };
        let scores = match score_bar(candles, i, &ind, config, &inputs) {
            Some(s) => s,
            None => continue,
        };

        if position.is_some() || i < cooldown_until || trades_today >= config.max_trades_per_day {
            continue;
        }

        // Resolve the retest state machine into a concrete entry decision.
        let entry_decision: Option<(Side, f64, f64, f64, u64, &str)> = match retest {
            RetestState::Idle => {
                let candidate = if scores.0 >= config.minimum_score {
                    Some((Side::Long, scores.0))
                } else if scores.1 >= config.minimum_score {
                    Some((Side::Short, scores.1))
                } else {
                    None
                };

                match candidate {
                    Some((side, score)) if config.wait_for_retest => {
                        retest = RetestState::Armed {
                            side,
                            anchor_price: c.close,
                            bar_idx: i,
                            score,
                        };
                        None
                    }
                    Some((side, score)) => {
                        let sl = stop_for_direct_entry(c.close, side, atr_now, config);
                        Some((side, c.close, sl, score, c.time, "DIRECTO (CONFLUENCIA)"))
                    }
                    None => None,
                }
            }
            RetestState::Armed { side, anchor_price, bar_idx, score } => {
                if i.saturating_sub(bar_idx) > config.max_wait_bars {
                    retest = RetestState::Idle;
                    None
                } else {
                    let dir = side.dir();
                    let extreme = if side == Side::Long { c.low } else { c.high };
                    let pullback = dir * (anchor_price - extreme);
                    let in_band = pullback >= atr_now * config.min_pullback_atr
                        && pullback <= atr_now * config.max_pullback_atr;

                    let recovered = if config.require_recovery_candle {
                        match side {
                            Side::Long => c.close > c.open && c.close > candles[i - 1].high,
                            Side::Short => c.close < c.open && c.close < candles[i - 1].low,
                        }
                    } else {
                        true
                    };

                    if in_band && recovered {
                        let sl = stop_for_retest_entry(c, side, atr_now, config);
                        let signal_time = candles[bar_idx].time;
                        retest = RetestState::Idle;
                        Some((side, c.close, sl, score, signal_time, "RETEST CONFIRMADO"))
                    } else {
                        None
                    }
                }
            }
        };

        let Some((side, entry, sl, score, signal_time, zone)) = entry_decision else {
            continue;
        };

        let Some(sizing) = size_position(entry, sl, realized_equity, config) else {
            continue;
        };

        let dir = side.dir();
        let risk_dist = (entry - sl).abs();
        let tp = [
            entry + dir * risk_dist * config.rr_tp1,
            entry + dir * risk_dist * config.rr_tp2,
            entry + dir * risk_dist * config.rr_tp3,
        ];

        // Entry is a market order at the close of the signal bar.
        let entry_cost = cost_model.fill_cost(sizing.qty * entry, FillKind::Market);
        let mut costs = CostBreakdown::default();
        costs.add(&entry_cost);

        let (sr_level, sr_time, sr_type) = match side {
            Side::Long => (
                nearest_support.as_ref().map(|p| p.price),
                nearest_support.as_ref().map(|p| p.time),
                Some("SUPPORT".to_string()),
            ),
            Side::Short => (
                nearest_resistance.as_ref().map(|p| p.price),
                nearest_resistance.as_ref().map(|p| p.time),
                Some("RESISTANCE".to_string()),
            ),
        };

        let snapshot = build_snapshot(
            candles,
            i,
            &ind,
            config,
            &inputs,
            scores,
            side.as_str(),
            zone,
            (entry, sl, tp[0], tp[1], tp[2]),
            (
                realized_equity,
                trades.len(),
                sizing.qty,
                sizing.qty * entry,
                sizing.risk_usd,
            ),
            None, // calibration needs the finished backtest; filled in post-hoc below
        );

        trades_today += 1;
        position = Some(Position {
            side,
            entry,
            initial_sl: sl,
            sl,
            tp,
            tp_hit: [false; 3],
            tp_time: [0; 3],
            qty_total: sizing.qty,
            qty_open: sizing.qty,
            risk_usd: sizing.risk_usd,
            realized_usd: -entry_cost.total,
            costs,
            entry_index: i,
            entry_time: c.time,
            signal_time,
            score,
            equity_at_entry: realized_equity,
            mae_r: 0.0,
            mfe_r: 0.0,
            snapshot,
            sr_level,
            sr_time,
            sr_type,
        });
    }

    // A position still open when the data ends is closed at the last close and marked
    // OPEN_MTM. The old engine dropped it entirely while keeping its partial profits,
    // which quietly censored the losers.
    if let Some(pos) = position.take() {
        if n > 0 {
            let last = &candles[n - 1];
            let dir = pos.side.dir();
            let qty_chunk = pos.qty_open;
            let gross = dir * (last.close - pos.entry) * qty_chunk;
            let cost = cost_model.fill_cost(qty_chunk * last.close, FillKind::Market);

            let mut pos = pos;
            pos.realized_usd += gross - cost.total;
            pos.costs.add(&cost);
            pos.qty_open = 0.0;

            realized_equity += pos.realized_usd;
            totals.add(&pos.costs);

            let mut trade = finalize_trade(
                &pos,
                trade_id,
                "END_OF_DATA",
                last.close,
                last.time,
                n - 1,
                realized_equity,
            );
            trade.status = "OPEN_MTM".to_string();
            trades.push(trade);

            if let Some(point) = equity_curve.last_mut() {
                point.value = realized_equity;
            }
        }
    }

    // Calibration is only knowable once the run is finished, so per-trade snapshots get
    // their probability filled in here rather than being invented at entry time.
    let calibration = Calibration::build(&trades);
    for t in trades.iter_mut() {
        if let Some(raw) = t.dashboard_snapshot.take() {
            if let Ok(mut snap) = serde_json::from_value::<MarketSnapshot>(raw) {
                let directional = if snap.signal == "SHORT" {
                    snap.strength_short
                } else {
                    snap.strength_long
                };
                snap.prob_up = calibration.probability(directional);
                t.dashboard_snapshot = serde_json::to_value(&snap).ok();
            }
        }
    }

    let dashboard = build_dashboard(
        candles,
        &ind,
        config,
        &trades,
        &equity_curve,
        realized_equity,
        &totals,
        &tp_counts,
        sl_no_tp,
        ruined,
        &sr_book,
        &calibration,
    );

    CryptoProResult { dashboard, trades, equity_curve }
}

/// Nearest confirmed pivot on the requested side, plus whether it sits within 1.5 ATR.
fn nearest_pivot(
    book: &VecDeque<PivotLevel>,
    want_high: bool,
    price: f64,
    atr: f64,
) -> (bool, Option<PivotLevel>) {
    let mut best: Option<&PivotLevel> = None;
    let mut best_dist = f64::MAX;

    for p in book.iter() {
        if p.is_high != want_high {
            continue;
        }
        // Support sits at or below price, resistance at or above.
        if want_high && p.price < price {
            continue;
        }
        if !want_high && p.price > price {
            continue;
        }
        let dist = (p.price - price).abs();
        if dist < best_dist {
            best_dist = dist;
            best = Some(p);
        }
    }

    let near = best.is_some() && best_dist <= atr * 1.5;
    (near, best.cloned())
}

fn stop_for_direct_entry(entry: f64, side: Side, atr: f64, cfg: &CryptoProConfig) -> f64 {
    let dist = (atr * cfg.atr_multiplier).min(atr * cfg.max_sl_atr);
    entry - side.dir() * dist
}

fn stop_for_retest_entry(c: &Candle, side: Side, atr: f64, cfg: &CryptoProConfig) -> f64 {
    let cap = atr * cfg.max_sl_atr;
    match side {
        Side::Long => {
            let structural = c.low - atr * 0.5;
            structural.max(c.close - cap)
        }
        Side::Short => {
            let structural = c.high + atr * 0.5;
            structural.min(c.close + cap)
        }
    }
}

fn finalize_trade(
    pos: &Position,
    id: usize,
    reason: &str,
    exit_price: f64,
    exit_time: u64,
    exit_index: usize,
    _equity_after: f64,
) -> Trade {
    let pnl_usd = pos.realized_usd;
    let pnl_r = if pos.risk_usd > 0.0 { pnl_usd / pos.risk_usd } else { 0.0 };
    let status = if pnl_usd > 0.0 {
        "WIN"
    } else if pnl_usd < 0.0 {
        "LOSS"
    } else {
        "BE"
    };

    Trade {
        id: format!("PRO-{}", id),
        trade_type: pos.side.as_str().to_string(),
        status: status.to_string(),
        entry: pos.entry,
        sl: pos.initial_sl,
        tp: pos.tp[1],
        tp1: Some(pos.tp[0]),
        tp2: Some(pos.tp[1]),
        tp3: Some(pos.tp[2]),
        signal_time: pos.signal_time,
        time: pos.entry_time,

        pnl: pnl_r,
        pnl_usd,
        pnl_percent: if pos.equity_at_entry > 0.0 {
            pnl_usd / pos.equity_at_entry * 100.0
        } else {
            0.0
        },
        risk_usd: pos.risk_usd,
        qty: pos.qty_total,
        cost_usd: pos.costs.total,
        mae_r: pos.mae_r,
        mfe_r: pos.mfe_r,
        bars_held: exit_index.saturating_sub(pos.entry_index),
        equity_at_entry: pos.equity_at_entry,

        desc: format!(
            "CryptoPRO {}: {} @ ${:.2} ({:+.2}R)",
            pos.side.as_str(),
            reason,
            exit_price,
            pnl_r
        ),
        entry_time: Some(pos.entry_time),
        exit_time: Some(exit_time),
        setup_score: Some(pos.score),
        dashboard_snapshot: serde_json::to_value(&pos.snapshot).ok(),
        sr_level: pos.sr_level,
        sr_time: pos.sr_time,
        sr_type: pos.sr_type.clone(),
        initial_sl: Some(pos.initial_sl),
        trailing_sl: if pos.tp_hit[0] { Some(pos.sl) } else { None },
        tp1_time: if pos.tp_hit[0] { Some(pos.tp_time[0]) } else { None },
        tp2_time: if pos.tp_hit[1] { Some(pos.tp_time[1]) } else { None },
        tp3_time: if pos.tp_hit[2] { Some(pos.tp_time[2]) } else { None },
        exit_reason: Some(reason.to_string()),
    }
}

#[allow(clippy::too_many_arguments)]
fn build_dashboard(
    candles: &[Candle],
    ind: &Indicators,
    cfg: &CryptoProConfig,
    trades: &[Trade],
    equity_curve: &[EquityPoint],
    equity: f64,
    totals: &CostBreakdown,
    tp_counts: &[usize; 3],
    sl_no_tp: usize,
    ruined: bool,
    sr_book: &VecDeque<PivotLevel>,
    calibration: &Calibration,
) -> CryptoProDashboard {
    let n = candles.len();
    if n == 0 {
        return CryptoProDashboard {
            initial_capital: cfg.initial_capital,
            current_capital: cfg.initial_capital,
            leverage: cfg.leverage,
            risk_per_trade_pct: cfg.risk_percent,
            analysis_days: cfg.analysis_days,
            limit_status: "SIN DATOS".to_string(),
            trade_progress: "SIN DATOS".to_string(),
            ..Default::default()
        };
    }

    let i = n - 1;
    let c = &candles[i];
    let atr_now = ind.atr[i].unwrap_or(0.0);
    let avg_vol_now = ind.avg_vol[i].unwrap_or(0.0);
    let vol_ratio = if avg_vol_now > 0.0 { c.volume.unwrap_or(0.0) / avg_vol_now } else { 0.0 };

    let (near_support, _) = nearest_pivot(sr_book, false, c.close, atr_now.max(f64::EPSILON));
    let (near_resistance, _) = nearest_pivot(sr_book, true, c.close, atr_now.max(f64::EPSILON));
    let inputs = ScoreInputs { near_support, near_resistance, vol_ratio };

    // Identical scoring path to the backtest, so the panel can no longer disagree with
    // the trades the engine would actually have taken.
    let scores = score_bar(candles, i, ind, cfg, &inputs).unwrap_or((0.0, 0.0));
    let signal = if scores.0 >= cfg.minimum_score {
        "LONG"
    } else if scores.1 >= cfg.minimum_score {
        "SHORT"
    } else {
        "NEUTRAL"
    };

    let (entry, sl, tp1, tp2, tp3) = if signal == "NEUTRAL" || atr_now <= 0.0 {
        (0.0, 0.0, 0.0, 0.0, 0.0)
    } else {
        let side = if signal == "LONG" { Side::Long } else { Side::Short };
        let dir = side.dir();
        let sl = stop_for_direct_entry(c.close, side, atr_now, cfg);
        let risk = (c.close - sl).abs();
        (
            c.close,
            sl,
            c.close + dir * risk * cfg.rr_tp1,
            c.close + dir * risk * cfg.rr_tp2,
            c.close + dir * risk * cfg.rr_tp3,
        )
    };

    let snapshot = build_snapshot(
        candles,
        i,
        ind,
        cfg,
        &inputs,
        scores,
        signal,
        "RETEST / S&R",
        (entry, sl, tp1, tp2, tp3),
        (equity, trades.len(), 0.0, 0.0, 0.0),
        Some(calibration),
    );

    let wins = trades.iter().filter(|t| t.pnl_usd > 0.0).count();
    let losses = trades.iter().filter(|t| t.pnl_usd < 0.0).count();
    let breakeven = trades.len() - wins - losses;
    // Breakeven trades are their own category. Counting them as wins is what inflated the
    // old win rate; the denominator here is every trade the engine took.
    let win_rate = if !trades.is_empty() {
        (wins as f64 / trades.len() as f64) * 100.0
    } else {
        0.0
    };

    let total_pnl = equity - cfg.initial_capital;
    let total_pnl_r: f64 = trades.iter().map(|t| t.pnl).sum();

    // Trailing window, in the same units as everything else: account currency.
    let period_seconds = (cfg.analysis_days as u64).saturating_mul(86_400);
    let cutoff = c.time.saturating_sub(period_seconds);
    let recent: Vec<&Trade> = trades.iter().filter(|t| t.time >= cutoff).collect();
    let period_pnl: f64 = recent.iter().map(|t| t.pnl_usd).sum();
    let period_wins = recent.iter().filter(|t| t.pnl_usd > 0.0).count();
    let period_win_rate = if !recent.is_empty() {
        (period_wins as f64 / recent.len() as f64) * 100.0
    } else {
        0.0
    };

    // Divide by the days actually covered, not by a fixed constant.
    let span_days = equity_curve
        .first()
        .zip(equity_curve.last())
        .map(|(a, b)| (b.time.saturating_sub(a.time) as f64) / 86_400.0)
        .unwrap_or(0.0);
    let effective_days = span_days.min(cfg.analysis_days as f64).max(1.0);

    CryptoProDashboard {
        snapshot,
        trade_progress: "BUSCANDO ENTRADA".to_string(),
        limit_status: if ruined {
            "CUENTA LIQUIDADA".to_string()
        } else if signal == "NEUTRAL" {
            "SIN SETUP".to_string()
        } else {
            "SETUP ACTIVO".to_string()
        },

        total_trades: trades.len(),
        winning_trades: wins,
        losing_trades: losses,
        breakeven_trades: breakeven,
        tp1_count: tp_counts[0],
        tp2_count: tp_counts[1],
        tp3_count: tp_counts[2],
        sl_no_tp_count: sl_no_tp,
        win_rate: (win_rate * 10.0).round() / 10.0,

        initial_capital: cfg.initial_capital,
        capital_per_trade: cfg.capital_per_trade,
        current_capital: (equity * 100.0).round() / 100.0,
        total_pnl: (total_pnl * 100.0).round() / 100.0,
        total_pnl_r: (total_pnl_r * 100.0).round() / 100.0,
        total_costs: (totals.total * 100.0).round() / 100.0,
        cost_breakdown: totals.clone(),
        leverage: cfg.leverage,
        risk_per_trade_pct: cfg.risk_percent,
        ruined,

        analysis_days: cfg.analysis_days,
        pnl_per_day: ((period_pnl / effective_days) * 100.0).round() / 100.0,
        period_pnl: (period_pnl * 100.0).round() / 100.0,
        period_trades: recent.len(),
        period_win_rate: (period_win_rate * 10.0).round() / 10.0,
    }
}
