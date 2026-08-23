use serde::{Deserialize, Serialize};
use crate::models::{Candle, Trade};
use crate::indicators::{
    calculate_ema, calculate_atr, calculate_avg_volume, 
    calculate_rsi, calculate_macd, calculate_dmi_adx, calculate_pivots
};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CryptoProConfig {
    pub show_ema: bool,
    pub pivot_left: usize,
    pub pivot_right: usize,
    pub max_levels: usize,
    pub fvg_min_pct: f64,
    pub ob_lookback: usize,
    pub volume_length: usize,
    pub high_volume: f64,
    pub very_high_volume: f64,
    pub minimum_score: f64,
    pub wait_for_retest: bool,
    pub min_pullback_atr: f64,
    pub max_pullback_atr: f64,
    pub min_pullback_pct: f64,
    pub max_wait_bars: usize,
    pub require_recovery_candle: bool,
    pub atr_length: usize,
    pub atr_multiplier: f64,
    pub max_sl_atr: f64,
    pub rr_tp1: f64,
    pub rr_tp2: f64,
    pub rr_tp3: f64,
    pub initial_capital: f64,
    pub capital_per_trade: f64,
    pub leverage: f64,
    pub risk_percent: f64,
    pub compound_capital: bool,
    pub compound_percent: f64,
    pub analysis_days: usize,
}

impl Default for CryptoProConfig {
    fn default() -> Self {
        CryptoProConfig {
            show_ema: true,
            pivot_left: 6,
            pivot_right: 6,
            max_levels: 3,
            fvg_min_pct: 0.08,
            ob_lookback: 8,
            volume_length: 20,
            high_volume: 1.50,
            very_high_volume: 2.00,
            minimum_score: 65.0,
            wait_for_retest: true,
            min_pullback_atr: 0.30,
            max_pullback_atr: 1.50,
            min_pullback_pct: 0.15,
            max_wait_bars: 8,
            require_recovery_candle: true,
            atr_length: 14,
            atr_multiplier: 1.50,
            max_sl_atr: 2.50,
            rr_tp1: 1.0,
            rr_tp2: 2.0,
            rr_tp3: 3.0,
            initial_capital: 1000.0,
            capital_per_trade: 150.0,
            leverage: 10.0,
            risk_percent: 2.0,
            compound_capital: false,
            compound_percent: 15.0,
            analysis_days: 15,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CryptoProDashboard {
    pub signal: String,
    pub strength_long: f64,
    pub strength_short: f64,
    pub prob_up: f64,
    pub prob_dn: f64,
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
    pub trade_progress: String,
    // Global Statistics
    pub total_trades: usize,
    pub winning_trades: usize,
    pub losing_trades: usize,
    pub tp1_count: usize,
    pub tp2_count: usize,
    pub tp3_count: usize,
    pub sl_no_tp_count: usize,
    pub win_rate: f64,
    // Capital & PnL
    pub initial_capital: f64,
    pub capital_per_trade: f64,
    pub current_capital: f64,
    pub total_pnl: f64,
    pub pnl_tp1: f64,
    pub pnl_tp2: f64,
    pub pnl_tp3: f64,
    pub pnl_sl_total: f64,
    pub leverage: f64,
    pub risk_per_trade_pct: f64,
    // Analysis Period (15 Days)
    pub analysis_days: usize,
    pub pnl_per_day: f64,
    pub period_pnl: f64,
    pub period_trades: usize,
    pub period_win_rate: f64,
    pub limit_status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CryptoProResult {
    pub dashboard: CryptoProDashboard,
    pub trades: Vec<Trade>,
}

pub fn analyze_crypto_pro(candles: &[Candle], config: &CryptoProConfig) -> CryptoProResult {
    let n = candles.len();
    if n < 50 {
        return CryptoProResult {
            dashboard: CryptoProDashboard {
                signal: "NEUTRAL".to_string(),
                strength_long: 0.0,
                strength_short: 0.0,
                prob_up: 50.0,
                prob_dn: 50.0,
                adx_value: 0.0,
                adx_regime: "RANGO".to_string(),
                di_bias: "NEUTRAL".to_string(),
                macd_state: "NEUTRAL".to_string(),
                rsi_value: 50.0,
                rsi_state: "NEUTRAL".to_string(),
                volume_ratio: 1.0,
                volume_state: "NORMAL".to_string(),
                trap_state: "NINGUNA".to_string(),
                zone_state: "—".to_string(),
                current_entry: 0.0,
                current_sl: 0.0,
                current_tp1: 0.0,
                current_tp2: 0.0,
                current_tp3: 0.0,
                risk_reward: "1 : 3".to_string(),
                trade_progress: "SIN DATOS".to_string(),
                total_trades: 0,
                winning_trades: 0,
                losing_trades: 0,
                tp1_count: 0,
                tp2_count: 0,
                tp3_count: 0,
                sl_no_tp_count: 0,
                win_rate: 0.0,
                initial_capital: config.initial_capital,
                capital_per_trade: config.capital_per_trade,
                current_capital: config.initial_capital,
                total_pnl: 0.0,
                pnl_tp1: 0.0,
                pnl_tp2: 0.0,
                pnl_tp3: 0.0,
                pnl_sl_total: 0.0,
                leverage: config.leverage,
                risk_per_trade_pct: config.risk_percent,
                analysis_days: config.analysis_days,
                pnl_per_day: 0.0,
                period_pnl: 0.0,
                period_trades: 0,
                period_win_rate: 0.0,
                limit_status: "—".to_string(),
            },
            trades: vec![],
        };
    }

    // 1. Calculate Core Modular Indicators (Strictly Causal)
    let ema_50 = calculate_ema(candles, 50);
    let ema_200 = calculate_ema(candles, 200);
    let atr = calculate_atr(candles, config.atr_length);
    let avg_vol = calculate_avg_volume(candles, config.volume_length);
    let rsi = calculate_rsi(candles, 14);
    let macd = calculate_macd(candles, 12, 26, 9);
    let dmi = calculate_dmi_adx(candles, 14);
    let pivots = calculate_pivots(candles, config.pivot_left, config.pivot_right);

    // 2. State Machine for Retest & Trade Execution Simulation
    #[derive(PartialEq)]
    enum RetestState {
        Idle,
        ArmedLong { pivot_price: f64, bar_idx: usize, score: f64 },
        ArmedShort { pivot_price: f64, bar_idx: usize, score: f64 },
    }

    let mut retest_state = RetestState::Idle;
    let mut trades: Vec<Trade> = Vec::new();
    let mut current_capital = config.initial_capital;

    let mut tp1_hits = 0;
    let mut tp2_hits = 0;
    let mut tp3_hits = 0;
    let mut sl_hits = 0;
    let mut pnl_tp1_acc = 0.0;
    let mut pnl_tp2_acc = 0.0;
    let mut pnl_tp3_acc = 0.0;
    let mut pnl_sl_acc = 0.0;

    let mut trade_id_counter = 1;
    let mut in_active_trade = false;
    let mut active_trade_side = "";
    let mut active_entry = 0.0;
    let mut active_sl = 0.0;
    let mut active_initial_sl = 0.0;
    let mut active_tp1 = 0.0;
    let mut active_tp2 = 0.0;
    let mut active_tp3 = 0.0;
    let mut active_tp1_reached = false;
    let mut active_tp2_reached = false;
    let mut active_pos_size = 0.0;
    let mut active_entry_time = 0;
    let mut active_signal_time = 0;
    let mut active_score = 0.0;
    let mut active_snapshot: Option<serde_json::Value> = None;
    let mut active_sr_level: Option<f64> = None;
    let mut active_sr_time: Option<u64> = None;
    let mut active_sr_type: Option<String> = None;

    let mut cooldown_until_bar: usize = 0;
    let mut current_day_id: u64 = 0;
    let mut daily_trade_count: usize = 0;
    let max_trades_per_day: usize = 3;
    let cooldown_bars: usize = 6;

    let start_idx = 50.max(config.pivot_left + config.pivot_right + 1);

    for i in start_idx..n {
        let c = &candles[i];
        let day_id = c.time / 86400;
        if day_id != current_day_id {
            current_day_id = day_id;
            daily_trade_count = 0;
        }

        let curr_atr = atr[i].max(0.01);
        let curr_vol = c.volume.unwrap_or(1.0);
        let curr_avg_vol = avg_vol[i].max(0.01);
        let vol_ratio = curr_vol / curr_avg_vol;

        // Active Trade Simulation Step
        if in_active_trade {
            let mut trade_closed = false;
            let mut exit_reason = "";
            let mut exit_price = c.close;

            if active_trade_side == "LONG" {
                if !active_tp1_reached && c.high >= active_tp1 {
                    active_tp1_reached = true;
                    tp1_hits += 1;
                    let pnl_chunk = (active_pos_size * 0.50) * ((active_tp1 - active_entry) / active_entry) * config.leverage;
                    pnl_tp1_acc += pnl_chunk;
                    current_capital += pnl_chunk;
                    active_sl = active_entry; // Break-even
                }
                if active_tp1_reached && !active_tp2_reached && c.high >= active_tp2 {
                    active_tp2_reached = true;
                    tp2_hits += 1;
                    let pnl_chunk = (active_pos_size * 0.25) * ((active_tp2 - active_entry) / active_entry) * config.leverage;
                    pnl_tp2_acc += pnl_chunk;
                    current_capital += pnl_chunk;
                }
                if active_tp2_reached && c.high >= active_tp3 {
                    tp3_hits += 1;
                    let pnl_chunk = (active_pos_size * 0.25) * ((active_tp3 - active_entry) / active_entry) * config.leverage;
                    pnl_tp3_acc += pnl_chunk;
                    current_capital += pnl_chunk;
                    trade_closed = true;
                    exit_reason = "TP3";
                    exit_price = active_tp3;
                }
                if c.low <= active_sl {
                    trade_closed = true;
                    exit_price = active_sl;
                    if !active_tp1_reached {
                        sl_hits += 1;
                        let loss = active_pos_size * ((active_entry - active_sl) / active_entry) * config.leverage;
                        pnl_sl_acc += loss;
                        current_capital -= loss;
                        exit_reason = "SL";
                    } else {
                        exit_reason = "BE (SL After TP)";
                    }
                }
            } else if active_trade_side == "SHORT" {
                if !active_tp1_reached && c.low <= active_tp1 {
                    active_tp1_reached = true;
                    tp1_hits += 1;
                    let pnl_chunk = (active_pos_size * 0.50) * ((active_entry - active_tp1) / active_entry) * config.leverage;
                    pnl_tp1_acc += pnl_chunk;
                    current_capital += pnl_chunk;
                    active_sl = active_entry;
                }
                if active_tp1_reached && !active_tp2_reached && c.low <= active_tp2 {
                    active_tp2_reached = true;
                    tp2_hits += 1;
                    let pnl_chunk = (active_pos_size * 0.25) * ((active_entry - active_tp2) / active_entry) * config.leverage;
                    pnl_tp2_acc += pnl_chunk;
                    current_capital += pnl_chunk;
                }
                if active_tp2_reached && c.low <= active_tp3 {
                    tp3_hits += 1;
                    let pnl_chunk = (active_pos_size * 0.25) * ((active_entry - active_tp3) / active_entry) * config.leverage;
                    pnl_tp3_acc += pnl_chunk;
                    current_capital += pnl_chunk;
                    trade_closed = true;
                    exit_reason = "TP3";
                    exit_price = active_tp3;
                }
                if c.high >= active_sl {
                    trade_closed = true;
                    exit_price = active_sl;
                    if !active_tp1_reached {
                        sl_hits += 1;
                        let loss = active_pos_size * ((active_sl - active_entry) / active_entry) * config.leverage;
                        pnl_sl_acc += loss;
                        current_capital -= loss;
                        exit_reason = "SL";
                    } else {
                        exit_reason = "BE (SL After TP)";
                    }
                }
            }

            if trade_closed {
                let (is_win, pnl_r) = if exit_reason == "TP3" {
                    (true, 1.75)
                } else if exit_reason == "BE (SL After TP)" {
                    if active_tp2_reached { (true, 1.00) } else { (true, 0.50) }
                } else {
                    (false, -1.00)
                };

                trades.push(Trade {
                    id: format!("PRO-{}", trade_id_counter),
                    trade_type: active_trade_side.to_string(),
                    status: if is_win { "WIN".to_string() } else { "LOSS".to_string() },
                    entry: active_entry,
                    sl: active_initial_sl,
                    tp: active_tp2,
                    tp1: Some(active_tp1),
                    tp2: Some(active_tp2),
                    tp3: Some(active_tp3),
                    signal_time: active_signal_time as u64,
                    time: active_entry_time as u64,
                    pnl: pnl_r,
                    pnl_percent: pnl_r * config.risk_percent,
                    desc: format!("CryptoPRO {}: {} @ ${:.2}", active_trade_side, exit_reason, exit_price),
                    entry_time: Some(active_entry_time as u64),
                    exit_time: Some(c.time as u64),
                    setup_score: Some(active_score),
                    dashboard_snapshot: active_snapshot.clone(),
                    sr_level: active_sr_level,
                    sr_time: active_sr_time,
                    sr_type: active_sr_type.clone(),
                });
                trade_id_counter += 1;
                in_active_trade = false;
                cooldown_until_bar = i + cooldown_bars;
                retest_state = RetestState::Idle;
            }
        }

        // --- CONFLUENCE SCORING SYSTEM (0-100) ---
        let mut score_long = 0.0;
        let mut score_short = 0.0;

        // 1. Trend Filter (EMA 50 / 200)
        if c.close > ema_50[i] && ema_50[i] > ema_200[i] { score_long += 25.0; }
        if c.close < ema_50[i] && ema_50[i] < ema_200[i] { score_short += 25.0; }

        // 2. DMI & ADX Regime
        if dmi.adx[i] > 25.0 {
            if dmi.di_plus[i] > dmi.di_minus[i] { score_long += 20.0; }
            if dmi.di_minus[i] > dmi.di_plus[i] { score_short += 20.0; }
        }

        // 3. MACD Momentum
        if macd.hist[i] > 0.0 && macd.macd[i] > macd.signal[i] { score_long += 15.0; }
        if macd.hist[i] < 0.0 && macd.macd[i] < macd.signal[i] { score_short += 15.0; }

        // 4. RSI Pullback / Momentum Filter
        if rsi[i] >= 45.0 && rsi[i] <= 70.0 { score_long += 15.0; }
        if rsi[i] >= 30.0 && rsi[i] <= 55.0 { score_short += 15.0; }

        // 5. Volume Confirmation
        if vol_ratio >= config.high_volume {
            if c.close >= c.open { score_long += 15.0; } else { score_short += 15.0; }
        }

        // 6. S/R Confluence
        let supp_pivot = pivots.iter().filter(|p| !p.is_high && (c.low - p.price).abs() <= curr_atr * 1.5).last().cloned();
        let res_pivot = pivots.iter().filter(|p| p.is_high && (c.high - p.price).abs() <= curr_atr * 1.5).last().cloned();
        let near_support = supp_pivot.is_some();
        let near_resistance = res_pivot.is_some();
        if near_support { score_long += 10.0; }
        if near_resistance { score_short += 10.0; }

        // Retest State Transition Logic with Cooldown and Daily Trade Limit
        if !in_active_trade && i >= cooldown_until_bar && daily_trade_count < max_trades_per_day {
            match retest_state {
                RetestState::Idle => {
                    if score_long >= config.minimum_score {
                        if config.wait_for_retest {
                            retest_state = RetestState::ArmedLong { pivot_price: c.close, bar_idx: i, score: score_long };
                        } else {
                            daily_trade_count += 1;
                            in_active_trade = true;
                            active_trade_side = "LONG";
                            active_entry = c.close;
                            active_sl = (c.close - curr_atr * config.atr_multiplier).max(c.close - curr_atr * config.max_sl_atr);
                            active_initial_sl = active_sl;
                            let risk_dist = (active_entry - active_sl).max(0.01);
                            active_tp1 = active_entry + risk_dist * config.rr_tp1;
                            active_tp2 = active_entry + risk_dist * config.rr_tp2;
                            active_tp3 = active_entry + risk_dist * config.rr_tp3;
                            active_pos_size = if config.compound_capital { current_capital * (config.compound_percent / 100.0) } else { config.capital_per_trade };
                            active_tp1_reached = false;
                            active_tp2_reached = false;
                            active_entry_time = c.time;
                            active_signal_time = c.time;
                            active_score = score_long;
                            active_sr_level = supp_pivot.as_ref().map(|p| p.price);
                            active_sr_time = supp_pivot.as_ref().map(|p| p.time as u64);
                            active_sr_type = Some("SUPPORT".to_string());
                            active_snapshot = Some(serde_json::json!({
                                "signal": "LONG",
                                "strengthLong": score_long,
                                "strengthShort": score_short,
                                "probUp": 75.0,
                                "probDn": 25.0,
                                "adxValue": (dmi.adx[i] * 10.0).round() / 10.0,
                                "adxRegime": if dmi.adx[i] >= 35.0 { "TENDENCIA MUY FUERTE" } else if dmi.adx[i] >= 25.0 { "TENDENCIA FUERTE" } else { "RANGO" },
                                "diBias": format!("ALCISTA (+{:.0} / -{:.0})", dmi.di_plus[i], dmi.di_minus[i]),
                                "macdState": if macd.hist[i] > 0.0 { "ALCISTA" } else { "BAJISTA" },
                                "rsiValue": (rsi[i] * 10.0).round() / 10.0,
                                "rsiState": if rsi[i] >= 70.0 { "SOBRECOMPRA" } else if rsi[i] <= 30.0 { "SOBREVENTA" } else { "NEUTRAL" },
                                "volumeRatio": (vol_ratio * 10.0).round() / 10.0,
                                "volumeState": if vol_ratio >= config.very_high_volume { "MUY ALTO" } else if vol_ratio >= config.high_volume { "ALTO" } else { "NORMAL" },
                                "trapState": "NINGUNA",
                                "zoneState": "DIRECTO (CONFLUENCIA)",
                                "currentEntry": active_entry,
                                "currentSl": active_initial_sl,
                                "currentTp1": active_tp1,
                                "currentTp2": active_tp2,
                                "currentTp3": active_tp3,
                                "riskReward": "1 : 2.0 (DINÁMICO)",
                                "tradeProgress": "EJECUTADO ✓",
                                "totalTrades": trades.len() + 1,
                                "winningTrades": tp1_hits,
                                "losingTrades": sl_hits,
                                "tp1Count": tp1_hits,
                                "tp2Count": tp2_hits,
                                "tp3Count": tp3_hits,
                                "slNoTpCount": sl_hits,
                                "winRate": if (tp1_hits + sl_hits) > 0 { ((tp1_hits as f64 / (tp1_hits + sl_hits) as f64) * 100.0).round() } else { 50.0 },
                                "initialCapital": config.initial_capital,
                                "capitalPerTrade": config.capital_per_trade,
                                "currentCapital": current_capital,
                                "totalPnl": current_capital - config.initial_capital,
                                "pnlTp1": pnl_tp1_acc,
                                "pnlTp2": pnl_tp2_acc,
                                "pnlTp3": pnl_tp3_acc,
                                "pnlSlTotal": pnl_sl_acc,
                                "leverage": config.leverage,
                                "riskPerTradePct": config.risk_percent,
                                "analysisDays": config.analysis_days,
                                "pnlPerDay": (current_capital - config.initial_capital) / (config.analysis_days as f64).max(1.0),
                                "periodPnl": current_capital - config.initial_capital,
                                "periodTrades": trades.len() + 1,
                                "periodWinRate": if (tp1_hits + sl_hits) > 0 { ((tp1_hits as f64 / (tp1_hits + sl_hits) as f64) * 100.0).round() } else { 50.0 },
                                "limitStatus": "ORDEN EJECUTADA ✓"
                            }));
                        }
                    } else if score_short >= config.minimum_score {
                        if config.wait_for_retest {
                            retest_state = RetestState::ArmedShort { pivot_price: c.close, bar_idx: i, score: score_short };
                        } else {
                            daily_trade_count += 1;
                            in_active_trade = true;
                            active_trade_side = "SHORT";
                            active_entry = c.close;
                            active_sl = (c.close + curr_atr * config.atr_multiplier).min(c.close + curr_atr * config.max_sl_atr);
                            active_initial_sl = active_sl;
                            let risk_dist = (active_sl - active_entry).max(0.01);
                            active_tp1 = active_entry - risk_dist * config.rr_tp1;
                            active_tp2 = active_entry - risk_dist * config.rr_tp2;
                            active_tp3 = active_entry - risk_dist * config.rr_tp3;
                            active_pos_size = if config.compound_capital { current_capital * (config.compound_percent / 100.0) } else { config.capital_per_trade };
                            active_tp1_reached = false;
                            active_tp2_reached = false;
                            active_entry_time = c.time;
                            active_signal_time = c.time;
                            active_score = score_short;
                            active_sr_level = res_pivot.as_ref().map(|p| p.price);
                            active_sr_time = res_pivot.as_ref().map(|p| p.time as u64);
                            active_sr_type = Some("RESISTANCE".to_string());
                            active_snapshot = Some(serde_json::json!({
                                "signal": "SHORT",
                                "strengthLong": score_long,
                                "strengthShort": score_short,
                                "probUp": 25.0,
                                "probDn": 75.0,
                                "adxValue": (dmi.adx[i] * 10.0).round() / 10.0,
                                "adxRegime": if dmi.adx[i] >= 35.0 { "TENDENCIA MUY FUERTE" } else if dmi.adx[i] >= 25.0 { "TENDENCIA FUERTE" } else { "RANGO" },
                                "diBias": format!("BAJISTA (+{:.0} / -{:.0})", dmi.di_plus[i], dmi.di_minus[i]),
                                "macdState": if macd.hist[i] < 0.0 { "BAJISTA" } else { "ALCISTA" },
                                "rsiValue": (rsi[i] * 10.0).round() / 10.0,
                                "rsiState": if rsi[i] <= 30.0 { "SOBREVENTA" } else if rsi[i] >= 70.0 { "SOBRECOMPRA" } else { "NEUTRAL" },
                                "volumeRatio": (vol_ratio * 10.0).round() / 10.0,
                                "volumeState": if vol_ratio >= config.very_high_volume { "MUY ALTO" } else if vol_ratio >= config.high_volume { "ALTO" } else { "NORMAL" },
                                "trapState": "NINGUNA",
                                "zoneState": "DIRECTO (CONFLUENCIA)",
                                "currentEntry": active_entry,
                                "currentSl": active_initial_sl,
                                "currentTp1": active_tp1,
                                "currentTp2": active_tp2,
                                "currentTp3": active_tp3,
                                "riskReward": "1 : 2.0 (DINÁMICO)",
                                "tradeProgress": "EJECUTADO ✓",
                                "totalTrades": trades.len() + 1,
                                "winningTrades": tp1_hits,
                                "losingTrades": sl_hits,
                                "tp1Count": tp1_hits,
                                "tp2Count": tp2_hits,
                                "tp3Count": tp3_hits,
                                "slNoTpCount": sl_hits,
                                "winRate": if (tp1_hits + sl_hits) > 0 { ((tp1_hits as f64 / (tp1_hits + sl_hits) as f64) * 100.0).round() } else { 50.0 },
                                "initialCapital": config.initial_capital,
                                "capitalPerTrade": config.capital_per_trade,
                                "currentCapital": current_capital,
                                "totalPnl": current_capital - config.initial_capital,
                                "pnlTp1": pnl_tp1_acc,
                                "pnlTp2": pnl_tp2_acc,
                                "pnlTp3": pnl_tp3_acc,
                                "pnlSlTotal": pnl_sl_acc,
                                "leverage": config.leverage,
                                "riskPerTradePct": config.risk_percent,
                                "analysisDays": config.analysis_days,
                                "pnlPerDay": (current_capital - config.initial_capital) / (config.analysis_days as f64).max(1.0),
                                "periodPnl": current_capital - config.initial_capital,
                                "periodTrades": trades.len() + 1,
                                "periodWinRate": if (tp1_hits + sl_hits) > 0 { ((tp1_hits as f64 / (tp1_hits + sl_hits) as f64) * 100.0).round() } else { 50.0 },
                                "limitStatus": "ORDEN EJECUTADA ✓"
                            }));
                        }
                    }
                }
                RetestState::ArmedLong { pivot_price, bar_idx, score } => {
                    if i - bar_idx > config.max_wait_bars {
                        retest_state = RetestState::Idle;
                    } else {
                        let pullback_dist = pivot_price - c.low;
                        let is_pullback = pullback_dist >= (curr_atr * config.min_pullback_atr) && pullback_dist <= (curr_atr * config.max_pullback_atr);
                        let recovery_confirmed = if config.require_recovery_candle { c.close > c.open && c.close > candles[i - 1].high * 0.998 } else { true };

                        if is_pullback && recovery_confirmed {
                            daily_trade_count += 1;
                            in_active_trade = true;
                            active_trade_side = "LONG";
                            active_entry = c.close;
                            active_sl = (c.low - curr_atr * 0.5).max(c.close - curr_atr * config.max_sl_atr);
                            active_initial_sl = active_sl;
                            let risk_dist = (active_entry - active_sl).max(0.01);
                            active_tp1 = active_entry + risk_dist * config.rr_tp1;
                            active_tp2 = active_entry + risk_dist * config.rr_tp2;
                            active_tp3 = active_entry + risk_dist * config.rr_tp3;
                            active_pos_size = if config.compound_capital { current_capital * (config.compound_percent / 100.0) } else { config.capital_per_trade };
                            active_tp1_reached = false;
                            active_tp2_reached = false;
                            active_entry_time = c.time;
                            active_signal_time = candles[bar_idx].time;
                            active_score = score;
                            active_sr_level = supp_pivot.as_ref().map(|p| p.price);
                            active_sr_time = supp_pivot.as_ref().map(|p| p.time as u64);
                            active_sr_type = Some("SUPPORT".to_string());
                            active_snapshot = Some(serde_json::json!({
                                "signal": "LONG",
                                "strengthLong": score,
                                "strengthShort": 0.0,
                                "probUp": 80.0,
                                "probDn": 20.0,
                                "adxValue": (dmi.adx[i] * 10.0).round() / 10.0,
                                "adxRegime": if dmi.adx[i] >= 35.0 { "TENDENCIA MUY FUERTE" } else if dmi.adx[i] >= 25.0 { "TENDENCIA FUERTE" } else { "RANGO" },
                                "diBias": format!("ALCISTA (+{:.0} / -{:.0})", dmi.di_plus[i], dmi.di_minus[i]),
                                "macdState": if macd.hist[i] > 0.0 { "ALCISTA" } else { "BAJISTA" },
                                "rsiValue": (rsi[i] * 10.0).round() / 10.0,
                                "rsiState": if rsi[i] >= 70.0 { "SOBRECOMPRA" } else if rsi[i] <= 30.0 { "SOBREVENTA" } else { "NEUTRAL" },
                                "volumeRatio": (vol_ratio * 10.0).round() / 10.0,
                                "volumeState": if vol_ratio >= config.very_high_volume { "MUY ALTO" } else if vol_ratio >= config.high_volume { "ALTO" } else { "NORMAL" },
                                "trapState": "NINGUNA",
                                "zoneState": "RETEST CONFIRMADO ✓",
                                "currentEntry": active_entry,
                                "currentSl": active_initial_sl,
                                "currentTp1": active_tp1,
                                "currentTp2": active_tp2,
                                "currentTp3": active_tp3,
                                "riskReward": "1 : 2.0 (DINÁMICO)",
                                "tradeProgress": "EJECUTADO ✓",
                                "totalTrades": trades.len() + 1,
                                "winningTrades": tp1_hits,
                                "losingTrades": sl_hits,
                                "tp1Count": tp1_hits,
                                "tp2Count": tp2_hits,
                                "tp3Count": tp3_hits,
                                "slNoTpCount": sl_hits,
                                "winRate": if (tp1_hits + sl_hits) > 0 { ((tp1_hits as f64 / (tp1_hits + sl_hits) as f64) * 100.0).round() } else { 50.0 },
                                "initialCapital": config.initial_capital,
                                "capitalPerTrade": config.capital_per_trade,
                                "currentCapital": current_capital,
                                "totalPnl": current_capital - config.initial_capital,
                                "pnlTp1": pnl_tp1_acc,
                                "pnlTp2": pnl_tp2_acc,
                                "pnlTp3": pnl_tp3_acc,
                                "pnlSlTotal": pnl_sl_acc,
                                "leverage": config.leverage,
                                "riskPerTradePct": config.risk_percent,
                                "analysisDays": config.analysis_days,
                                "pnlPerDay": (current_capital - config.initial_capital) / (config.analysis_days as f64).max(1.0),
                                "periodPnl": current_capital - config.initial_capital,
                                "periodTrades": trades.len() + 1,
                                "periodWinRate": if (tp1_hits + sl_hits) > 0 { ((tp1_hits as f64 / (tp1_hits + sl_hits) as f64) * 100.0).round() } else { 50.0 },
                                "limitStatus": "ORDEN EJECUTADA ✓"
                            }));
                            retest_state = RetestState::Idle;
                        }
                    }
                }
                RetestState::ArmedShort { pivot_price, bar_idx, score } => {
                    if i - bar_idx > config.max_wait_bars {
                        retest_state = RetestState::Idle;
                    } else {
                        let pullback_dist = c.high - pivot_price;
                        let is_pullback = pullback_dist >= (curr_atr * config.min_pullback_atr) && pullback_dist <= (curr_atr * config.max_pullback_atr);
                        let recovery_confirmed = if config.require_recovery_candle { c.close < c.open && c.close < candles[i - 1].low * 1.002 } else { true };

                        if is_pullback && recovery_confirmed {
                            daily_trade_count += 1;
                            in_active_trade = true;
                            active_trade_side = "SHORT";
                            active_entry = c.close;
                            active_sl = (c.high + curr_atr * 0.5).min(c.close + curr_atr * config.max_sl_atr);
                            active_initial_sl = active_sl;
                            let risk_dist = (active_sl - active_entry).max(0.01);
                            active_tp1 = active_entry - risk_dist * config.rr_tp1;
                            active_tp2 = active_entry - risk_dist * config.rr_tp2;
                            active_tp3 = active_entry - risk_dist * config.rr_tp3;
                            active_pos_size = if config.compound_capital { current_capital * (config.compound_percent / 100.0) } else { config.capital_per_trade };
                            active_tp1_reached = false;
                            active_tp2_reached = false;
                            active_entry_time = c.time;
                            active_signal_time = candles[bar_idx].time;
                            active_score = score;
                            active_sr_level = res_pivot.as_ref().map(|p| p.price);
                            active_sr_time = res_pivot.as_ref().map(|p| p.time as u64);
                            active_sr_type = Some("RESISTANCE".to_string());
                            active_snapshot = Some(serde_json::json!({
                                "signal": "SHORT",
                                "strengthLong": 0.0,
                                "strengthShort": score,
                                "probUp": 20.0,
                                "probDn": 80.0,
                                "adxValue": (dmi.adx[i] * 10.0).round() / 10.0,
                                "adxRegime": if dmi.adx[i] >= 35.0 { "TENDENCIA MUY FUERTE" } else if dmi.adx[i] >= 25.0 { "TENDENCIA FUERTE" } else { "RANGO" },
                                "diBias": format!("BAJISTA (+{:.0} / -{:.0})", dmi.di_plus[i], dmi.di_minus[i]),
                                "macdState": if macd.hist[i] < 0.0 { "BAJISTA" } else { "ALCISTA" },
                                "rsiValue": (rsi[i] * 10.0).round() / 10.0,
                                "rsiState": if rsi[i] <= 30.0 { "SOBREVENTA" } else if rsi[i] >= 70.0 { "SOBRECOMPRA" } else { "NEUTRAL" },
                                "volumeRatio": (vol_ratio * 10.0).round() / 10.0,
                                "volumeState": if vol_ratio >= config.very_high_volume { "MUY ALTO" } else if vol_ratio >= config.high_volume { "ALTO" } else { "NORMAL" },
                                "trapState": "NINGUNA",
                                "zoneState": "RETEST CONFIRMADO ✓",
                                "currentEntry": active_entry,
                                "currentSl": active_initial_sl,
                                "currentTp1": active_tp1,
                                "currentTp2": active_tp2,
                                "currentTp3": active_tp3,
                                "riskReward": "1 : 2.0 (DINÁMICO)",
                                "tradeProgress": "EJECUTADO ✓",
                                "totalTrades": trades.len() + 1,
                                "winningTrades": tp1_hits,
                                "losingTrades": sl_hits,
                                "tp1Count": tp1_hits,
                                "tp2Count": tp2_hits,
                                "tp3Count": tp3_hits,
                                "slNoTpCount": sl_hits,
                                "winRate": if (tp1_hits + sl_hits) > 0 { ((tp1_hits as f64 / (tp1_hits + sl_hits) as f64) * 100.0).round() } else { 50.0 },
                                "initialCapital": config.initial_capital,
                                "capitalPerTrade": config.capital_per_trade,
                                "currentCapital": current_capital,
                                "totalPnl": current_capital - config.initial_capital,
                                "pnlTp1": pnl_tp1_acc,
                                "pnlTp2": pnl_tp2_acc,
                                "pnlTp3": pnl_tp3_acc,
                                "pnlSlTotal": pnl_sl_acc,
                                "leverage": config.leverage,
                                "riskPerTradePct": config.risk_percent,
                                "analysisDays": config.analysis_days,
                                "pnlPerDay": (current_capital - config.initial_capital) / (config.analysis_days as f64).max(1.0),
                                "periodPnl": current_capital - config.initial_capital,
                                "periodTrades": trades.len() + 1,
                                "periodWinRate": if (tp1_hits + sl_hits) > 0 { ((tp1_hits as f64 / (tp1_hits + sl_hits) as f64) * 100.0).round() } else { 50.0 },
                                "limitStatus": "ORDEN EJECUTADA ✓"
                            }));
                            retest_state = RetestState::Idle;
                        }
                    }
                }
            }
        }
    }

    // 3. Build Live Real-Time Dashboard Snapshot for Latest Candle
    let last_i = n - 1;
    let last_c = &candles[last_i];
    let last_atr = atr[last_i].max(0.01);
    let last_vol_ratio = last_c.volume.unwrap_or(1.0) / avg_vol[last_i].max(0.01);

    let mut live_score_long = 0.0;
    let mut live_score_short = 0.0;
    if last_c.close > ema_50[last_i] && ema_50[last_i] > ema_200[last_i] { live_score_long += 25.0; }
    if last_c.close < ema_50[last_i] && ema_50[last_i] < ema_200[last_i] { live_score_short += 25.0; }
    if dmi.adx[last_i] > 25.0 {
        if dmi.di_plus[last_i] > dmi.di_minus[last_i] { live_score_long += 20.0; }
        if dmi.di_minus[last_i] > dmi.di_plus[last_i] { live_score_short += 20.0; }
    }
    if macd.hist[last_i] > 0.0 { live_score_long += 15.0; } else { live_score_short += 15.0; }
    if rsi[last_i] >= 45.0 && rsi[last_i] <= 70.0 { live_score_long += 15.0; }
    if rsi[last_i] >= 30.0 && rsi[last_i] <= 55.0 { live_score_short += 15.0; }
    if last_vol_ratio >= config.high_volume {
        if last_c.close >= last_c.open { live_score_long += 15.0; } else { live_score_short += 15.0; }
    }

    let total_strength = live_score_long + live_score_short;
    let prob_up: f64 = if total_strength > 0.0 { ((live_score_long / total_strength) * 100.0f64).round() } else { 50.0 };
    let prob_dn: f64 = 100.0f64 - prob_up;

    let signal = if live_score_long >= config.minimum_score { "LONG".to_string() }
                 else if live_score_short >= config.minimum_score { "SHORT".to_string() }
                 else { "NEUTRAL".to_string() };

    let adx_val = dmi.adx[last_i];
    let adx_regime = if adx_val >= 35.0 { "TENDENCIA MUY FUERTE".to_string() }
                     else if adx_val >= 25.0 { "TENDENCIA FUERTE".to_string() }
                     else { "RANGO / CONSOLIDACIÓN".to_string() };

    let di_bias = format!("{} (+{:.0} / -{:.0})", 
        if dmi.di_plus[last_i] >= dmi.di_minus[last_i] { "ALCISTA" } else { "BAJISTA" },
        dmi.di_plus[last_i], dmi.di_minus[last_i]);

    let macd_state = if macd.macd[last_i] >= macd.signal[last_i] {
        if macd.hist[last_i] > macd.hist[last_i - 1] { "ALCISTA+".to_string() } else { "ALCISTA".to_string() }
    } else {
        if macd.hist[last_i] < macd.hist[last_i - 1] { "BAJISTA+".to_string() } else { "BAJISTA".to_string() }
    };

    let rsi_val = rsi[last_i];
    let rsi_state = if rsi_val >= 70.0 { "SOBRECOMPRA".to_string() }
                    else if rsi_val <= 30.0 { "SOBREVENTA".to_string() }
                    else { "NEUTRAL".to_string() };

    let volume_state = if last_vol_ratio >= config.very_high_volume { "MUY ALTO".to_string() }
                       else if last_vol_ratio >= config.high_volume { "ALTO".to_string() }
                       else { "NORMAL".to_string() };

    let trap_state = if last_vol_ratio >= 1.8 && (last_c.high - last_c.close.max(last_c.open)) > last_atr * 0.6 {
        "TRAMPA ALCISTA (Bull Trap)".to_string()
    } else if last_vol_ratio >= 1.8 && (last_c.close.min(last_c.open) - last_c.low) > last_atr * 0.6 {
        "TRAMPA BAJISTA (Bear Trap)".to_string()
    } else {
        "NINGUNA".to_string()
    };

    let zone_state = "RETEST / S&R".to_string();

    // Calculate Global Win Rate and Period PnL
    let total_trades_count = trades.len();
    let winning_trades_count = trades.iter().filter(|t| t.status == "WIN").count();
    let losing_trades_count = total_trades_count - winning_trades_count;
    let win_rate = if total_trades_count > 0 { (winning_trades_count as f64 / total_trades_count as f64) * 100.0 } else { 0.0 };

    let total_pnl = current_capital - config.initial_capital;

    // Period slice (e.g. 15 days)
    let period_seconds = (config.analysis_days as u64) * 86400;
    let cutoff_time = last_c.time.saturating_sub(period_seconds);
    let recent_trades: Vec<&Trade> = trades.iter().filter(|t| t.time >= cutoff_time).collect();
    let period_trades_count = recent_trades.len();
    let period_wins = recent_trades.iter().filter(|t| t.status == "WIN").count();
    let period_win_rate = if period_trades_count > 0 { (period_wins as f64 / period_trades_count as f64) * 100.0 } else { 0.0 };
    let period_pnl: f64 = recent_trades.iter().map(|t| t.pnl).sum();
    let pnl_per_day = period_pnl / (config.analysis_days.max(1) as f64);

    let (current_entry, current_sl, current_tp1, current_tp2, current_tp3, limit_status) = if in_active_trade {
        (active_entry, active_sl, active_tp1, active_tp2, active_tp3, "PRECIO TOCADO ✓".to_string())
    } else {
        match retest_state {
            RetestState::ArmedLong { pivot_price, bar_idx: _, score: _ } => {
                let sl = pivot_price - last_atr * config.atr_multiplier;
                let risk = (pivot_price - sl).max(0.01);
                (pivot_price, sl, pivot_price + risk * config.rr_tp1, pivot_price + risk * config.rr_tp2, pivot_price + risk * config.rr_tp3, "BUSCANDO PRECIO (LIMIT)".to_string())
            }
            RetestState::ArmedShort { pivot_price, bar_idx: _, score: _ } => {
                let sl = pivot_price + last_atr * config.atr_multiplier;
                let risk = (sl - pivot_price).max(0.01);
                (pivot_price, sl, pivot_price - risk * config.rr_tp1, pivot_price - risk * config.rr_tp2, pivot_price - risk * config.rr_tp3, "BUSCANDO PRECIO (LIMIT)".to_string())
            }
            RetestState::Idle => (0.0, 0.0, 0.0, 0.0, 0.0, "—".to_string())
        }
    };

    let dashboard = CryptoProDashboard {
        signal,
        strength_long: live_score_long,
        strength_short: live_score_short,
        prob_up,
        prob_dn,
        adx_value: (adx_val * 10.0).round() / 10.0,
        adx_regime,
        di_bias,
        macd_state,
        rsi_value: (rsi_val * 10.0).round() / 10.0,
        rsi_state,
        volume_ratio: (last_vol_ratio * 10.0).round() / 10.0,
        volume_state,
        trap_state,
        zone_state,
        current_entry,
        current_sl,
        current_tp1,
        current_tp2,
        current_tp3,
        risk_reward: format!("1 : {:.0}", config.rr_tp3),
        trade_progress: if in_active_trade { "EN CURSO".to_string() } else { "BUSCANDO ENTRADA".to_string() },
        total_trades: total_trades_count,
        winning_trades: winning_trades_count,
        losing_trades: losing_trades_count,
        tp1_count: tp1_hits,
        tp2_count: tp2_hits,
        tp3_count: tp3_hits,
        sl_no_tp_count: sl_hits,
        win_rate: (win_rate * 10.0).round() / 10.0,
        initial_capital: config.initial_capital,
        capital_per_trade: config.capital_per_trade,
        current_capital: (current_capital * 100.0).round() / 100.0,
        total_pnl: (total_pnl * 100.0).round() / 100.0,
        pnl_tp1: (pnl_tp1_acc * 100.0).round() / 100.0,
        pnl_tp2: (pnl_tp2_acc * 100.0).round() / 100.0,
        pnl_tp3: (pnl_tp3_acc * 100.0).round() / 100.0,
        pnl_sl_total: (pnl_sl_acc * 100.0).round() / 100.0,
        leverage: config.leverage,
        risk_per_trade_pct: config.risk_percent,
        analysis_days: config.analysis_days,
        pnl_per_day: (pnl_per_day * 100.0).round() / 100.0,
        period_pnl: (period_pnl * 100.0).round() / 100.0,
        period_trades: period_trades_count,
        period_win_rate: (period_win_rate * 10.0).round() / 10.0,
        limit_status,
    };

    CryptoProResult {
        dashboard,
        trades,
    }
}
