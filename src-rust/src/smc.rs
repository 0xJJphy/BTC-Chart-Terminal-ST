use crate::models::{Candle, Zone, Trade};
use crate::indicators::{calculate_atr, calculate_avg_volume};
use std::collections::HashSet;

pub fn analyze_smc(candles: &[Candle], sensitivity: f64, history_target: usize, risk_reward: f64) -> (Vec<Zone>, Vec<Trade>) {
    if candles.len() < 50 {
        return (vec![], vec![]);
    }

    let mut zones = Vec::new();
    let mut trades = Vec::new();
    
    let start_index = if candles.len() > history_target {
        candles.len() - history_target
    } else {
        20
    };

    let atr_values = calculate_atr(candles, 14);
    let avg_volumes = calculate_avg_volume(candles, 20);

    let mut processed_obs = HashSet::new();

    for i in start_index.max(2)..candles.len() {
        let curr = &candles[i];
        let prev2 = &candles[i - 2];
        let atr = atr_values[i];
        let avg_vol = avg_volumes[i];

        // FVG Bullish
        if curr.low > prev2.high {
            let gap = curr.low - prev2.high;
            if is_valid_fvg(curr, prev2, gap, atr, sensitivity) {
                let fvg_score = calculate_fvg_score(gap, atr, avg_vol, curr.close);
                let mut zone = Zone {
                    id: format!("fvg-l-{}", i),
                    label: "FVG".to_string(),
                    zone_type: "BULL".to_string(),
                    top: curr.low,
                    bottom: prev2.high,
                    time: candles[i - 1].time,
                    end_time: None,
                    status: "ACTIVE".to_string(),
                    color: "rgba(168, 85, 247, 0.4)".to_string(),
                    score: fvg_score,
                    quality: fvg_score,
                };

                for j in (i + 1)..candles.len() {
                    if bar_touches_zone(&candles[j], zone.top, zone.bottom) {
                        zone.status = "MITIGATED".to_string();
                        zone.end_time = Some(candles[j].time);
                        break;
                    }
                }
                zones.push(zone);

                if let Some(ob_idx) = find_ob_candle(candles, i, true) {
                    if !processed_obs.contains(&ob_idx) {
                        let ob_candle = &candles[ob_idx];
                        let ob_score = calculate_ob_score(ob_candle, atr, avg_vol);
                        let mut ob_zone = Zone {
                            id: format!("ob-l-{}", ob_idx),
                            label: "OB".to_string(),
                            zone_type: "BULL".to_string(),
                            top: ob_candle.high,
                            bottom: ob_candle.low,
                            time: ob_candle.time,
                            end_time: None,
                            status: "ACTIVE".to_string(),
                            color: "rgba(234, 179, 8, 0.4)".to_string(),
                            score: ob_score,
                            quality: ob_score,
                        };
                        for j in (i + 1)..candles.len() {
                            if bar_touches_zone(&candles[j], ob_zone.top, ob_zone.bottom) {
                                ob_zone.status = "MITIGATED".to_string();
                                ob_zone.end_time = Some(candles[j].time);
                                break;
                            }
                        }
                        zones.push(ob_zone);
                        processed_obs.insert(ob_idx);

                        // GENERAR TRADE EN RUST
                        if let Some(t) = create_trade(i, "LONG", curr.low, ob_candle.low, candles, risk_reward) {
                            trades.push(t);
                        }
                    }
                }
            }
        }

        // FVG Bearish
        if curr.high < prev2.low {
            let gap = prev2.low - curr.high;
            if is_valid_fvg(curr, prev2, gap, atr, sensitivity) {
                let fvg_score = calculate_fvg_score(gap, atr, avg_vol, curr.close);
                let mut zone = Zone {
                    id: format!("fvg-s-{}", i),
                    label: "FVG".to_string(),
                    zone_type: "BEAR".to_string(),
                    top: prev2.low,
                    bottom: curr.high,
                    time: candles[i - 1].time,
                    end_time: None,
                    status: "ACTIVE".to_string(),
                    color: "rgba(168, 85, 247, 0.4)".to_string(),
                    score: fvg_score,
                    quality: fvg_score,
                };

                for j in (i + 1)..candles.len() {
                    if bar_touches_zone(&candles[j], zone.top, zone.bottom) {
                        zone.status = "MITIGATED".to_string();
                        zone.end_time = Some(candles[j].time);
                        break;
                    }
                }
                zones.push(zone);

                if let Some(ob_idx) = find_ob_candle(candles, i, false) {
                    if !processed_obs.contains(&ob_idx) {
                        let ob_candle = &candles[ob_idx];
                        let ob_score = calculate_ob_score(ob_candle, atr, avg_vol);
                        let mut ob_zone = Zone {
                            id: format!("ob-s-{}", ob_idx),
                            label: "OB".to_string(),
                            zone_type: "BEAR".to_string(),
                            top: ob_candle.high,
                            bottom: ob_candle.low,
                            time: ob_candle.time,
                            end_time: None,
                            status: "ACTIVE".to_string(),
                            color: "rgba(234, 179, 8, 0.4)".to_string(),
                            score: ob_score,
                            quality: ob_score,
                        };
                        for j in (i + 1)..candles.len() {
                            if bar_touches_zone(&candles[j], ob_zone.top, ob_zone.bottom) {
                                ob_zone.status = "MITIGATED".to_string();
                                ob_zone.end_time = Some(candles[j].time);
                                break;
                            }
                        }
                        zones.push(ob_zone);
                        processed_obs.insert(ob_idx);

                        // GENERAR TRADE EN RUST
                        if let Some(t) = create_trade(i, "SHORT", curr.high, ob_candle.high, candles, risk_reward) {
                            trades.push(t);
                        }
                    }
                }
            }
        }
    }

    zones.sort_by_key(|z| z.time);
    (zones, trades)
}

fn is_valid_fvg(curr: &Candle, prev2: &Candle, gap: f64, atr: f64, sensitivity: f64) -> bool {
    let min_gap = curr.close * sensitivity;
    if gap < min_gap || gap < atr * 0.2 {
        return false;
    }
    let impulse_percent = (curr.close - prev2.close).abs() / prev2.close;
    if impulse_percent < 0.003 {
        return false;
    }
    true
}

fn calculate_fvg_score(gap: f64, atr: f64, _avg_vol: f64, _price: f64) -> f64 {
    let mut score = 0.0;
    let gap_ratio = if atr > 0.0 { gap / atr } else { 0.0 };
    if gap_ratio > 1.0 { score += 30.0; }
    else if gap_ratio > 0.7 { score += 20.0; }
    else if gap_ratio > 0.5 { score += 12.0; }
    score
}

fn find_ob_candle(candles: &[Candle], idx: usize, is_bullish: bool) -> Option<usize> {
    for k in (idx.saturating_sub(10)..idx).rev() {
        if is_bullish {
            if candles[k].close < candles[k].open { return Some(k); }
        } else {
            if candles[k].close > candles[k].open { return Some(k); }
        }
    }
    None
}

fn calculate_ob_score(ob: &Candle, atr: f64, avg_vol: f64) -> f64 {
    let mut score = 0.0;
    let vol = ob.volume.unwrap_or(0.0);
    let vol_ratio = if avg_vol > 0.0 { vol / avg_vol } else { 1.0 };
    if vol_ratio > 2.0 { score += 30.0; }
    else if vol_ratio > 1.5 { score += 20.0; }

    let ob_size = ob.high - ob.low;
    let size_ratio = if atr > 0.0 { ob_size / atr } else { 1.0 };
    if size_ratio > 1.5 { score += 25.0; }
    else if size_ratio > 1.0 { score += 15.0; }
    score
}

fn bar_touches_zone(bar: &Candle, top: f64, bottom: f64) -> bool {
    let z_top = top.max(bottom);
    let z_bottom = top.min(bottom);
    bar.low <= z_top && bar.high >= z_bottom
}

pub fn create_trade(idx: usize, trade_type: &str, entry: f64, sl: f64, candles: &[Candle], risk_reward: f64) -> Option<Trade> {
    let mut trade = Trade {
        id: format!("smc-{}", idx),
        trade_type: trade_type.to_string(),
        status: "PENDING".to_string(),
        entry,
        sl,
        tp: if trade_type == "LONG" {
            entry + ((entry - sl).abs() * risk_reward)
        } else {
            entry - ((entry - sl).abs() * risk_reward)
        },
        tp1: None,
        tp2: None,
        tp3: None,
        signal_time: candles[idx].time,
        time: candles[idx].time,
        pnl: 0.0,
        pnl_percent: 0.0,
        desc: "SMC Setup (Rust)".to_string(),
        entry_time: None,
        exit_time: None,
        setup_score: None,
        dashboard_snapshot: None,
        sr_level: None,
        sr_time: None,
        sr_type: None,
    };

    process_trade_lifecycle(&mut trade, idx, candles, risk_reward);

    if trade.status != "CANCELLED" {
        Some(trade)
    } else {
        None
    }
}

fn process_trade_lifecycle(trade: &mut Trade, idx: usize, candles: &[Candle], risk_reward: f64) {
    for j in (idx + 1)..candles.len() {
        let bar = &candles[j];
        if trade.status == "PENDING" {
            if trade.trade_type == "LONG" {
                if bar.low <= trade.entry {
                    trade.status = "OPEN".to_string();
                    trade.entry_time = Some(bar.time);
                } else if bar.low <= trade.sl {
                    trade.status = "CANCELLED".to_string();
                    return;
                }
            } else { // SHORT
                if bar.high >= trade.entry {
                    trade.status = "OPEN".to_string();
                    trade.entry_time = Some(bar.time);
                } else if bar.high >= trade.sl {
                    trade.status = "CANCELLED".to_string();
                    return;
                }
            }
        } else if trade.status == "OPEN" {
            if trade.trade_type == "LONG" {
                if bar.low <= trade.sl {
                    trade.status = "LOSS".to_string();
                    trade.exit_time = Some(bar.time);
                    trade.pnl = -1.0;
                    trade.pnl_percent = -1.0;
                    return;
                }
                if bar.high >= trade.tp {
                    trade.status = "WIN".to_string();
                    trade.exit_time = Some(bar.time);
                    trade.pnl = risk_reward;
                    trade.pnl_percent = risk_reward;
                    return;
                }
            } else { // SHORT
                if bar.high >= trade.sl {
                    trade.status = "LOSS".to_string();
                    trade.exit_time = Some(bar.time);
                    trade.pnl = -1.0;
                    trade.pnl_percent = -1.0;
                    return;
                }
                if bar.low <= trade.tp {
                    trade.status = "WIN".to_string();
                    trade.exit_time = Some(bar.time);
                    trade.pnl = risk_reward;
                    trade.pnl_percent = risk_reward;
                    return;
                }
            }
        }
    }

    if trade.status == "OPEN" {
        let last_price = candles[candles.len() - 1].close;
        let risk = (trade.entry - trade.sl).abs();
        if risk > 0.0 {
            let r_multiple = if trade.trade_type == "LONG" {
                (last_price - trade.entry) / risk
            } else {
                (trade.entry - last_price) / risk
            };
            trade.pnl = r_multiple;
            trade.pnl_percent = r_multiple;
        }
    }
}
