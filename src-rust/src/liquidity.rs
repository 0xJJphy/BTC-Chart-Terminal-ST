use crate::models::{Candle, Trade};
use crate::smc::analyze_smc;
use crate::trendlines::calculate_trend_lines;
use serde::Serialize;

#[derive(Serialize)]
pub struct OptimizerResult {
    pub key: String,
    pub label: String,
    pub trades: Vec<Trade>,
    pub total: usize,
    pub wins: usize,
    pub losses: usize,
    #[serde(rename = "winRate")]
    pub win_rate: f64,
    #[serde(rename = "totalPnL")]
    pub total_pnl: f64,
    #[serde(rename = "profitFactor")]
    pub profit_factor: f64,
}

pub fn run_optimizer_rust(candles: &[Candle], sensitivity: f64) -> Vec<OptimizerResult> {
    let configs = vec![
        ("standard", "TL Trap 2R"),
        ("agro", "TL Trap 3R"),
        ("atr", "TL ATR 2R"),
        ("atr_agro", "TL ATR 3R"),
    ];

    let mut results = Vec::new();
    for (key, label) in configs {
        let trades = run_liquidity_strategy_logic(candles, key, sensitivity);
        
        let wins = trades.iter().filter(|t| t.status == "WIN").count();
        let losses = trades.iter().filter(|t| t.status == "LOSS").count();
        
        let gross_profit: f64 = trades.iter().filter(|t| t.pnl > 0.0).map(|t| t.pnl).sum();
        let gross_loss: f64 = trades.iter().filter(|t| t.pnl < 0.0).map(|t| t.pnl.abs()).sum();
        
        let total_pnl: f64 = trades.iter().map(|t| t.pnl).sum();
        let win_rate = if wins + losses > 0 { (wins as f64 / (wins + losses) as f64) * 100.0 } else { 0.0 };
        let profit_factor = if gross_loss > 0.0 { gross_profit / gross_loss } else if gross_profit > 0.0 { 999.0 } else { 0.0 };

        results.push(OptimizerResult {
            key: key.to_string(),
            label: label.to_string(),
            total: trades.len(),
            trades,
            wins,
            losses,
            win_rate,
            total_pnl,
            profit_factor,
        });
    }
    results
}

pub fn run_liquidity_strategy_logic(candles: &[Candle], mode: &str, sensitivity: f64) -> Vec<Trade> {
    let rr = match mode {
        "agro" | "atr_agro" => 3.0,
        _ => 2.0,
    };

    let (zones, _) = analyze_smc(candles, sensitivity, 30000, rr);
    let lines = calculate_trend_lines(candles);
    let mut strategy_trades = Vec::new();

    for line in lines {
        if line.status == "BROKEN" {
            if let Some(break_idx) = line.break_index {
                // Buscar OB bajista cerca de la línea para un Short Trap
                if line.line_type == "DOWN" {
                    let break_time = candles.get(break_idx).map(|c| c.time).unwrap_or(0);
                    for zone in &zones {
                        // `zone.status` is computed by scanning the entire future, so
                        // filtering on it here would only ever select zones we know in
                        // hindsight were never mitigated. Judge the zone as of the break
                        // bar instead: formed before it, and not yet mitigated by then.
                        let known_at_break = zone.time <= break_time;
                        let unmitigated_at_break =
                            zone.end_time.map_or(true, |end| end > break_time);
                        if zone.label == "OB"
                            && zone.zone_type == "BEAR"
                            && known_at_break
                            && unmitigated_at_break
                        {
                            // Si el OB está cerca del break, es una trampa potencial
                            if (zone.top - line.start_price).abs() / line.start_price < 0.05 {
                                if let Some(t) = crate::smc::create_trade(break_idx, "SHORT", zone.bottom, zone.top, candles, rr) {
                                    strategy_trades.push(t);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    strategy_trades
}
