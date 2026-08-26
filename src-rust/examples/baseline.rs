//! Backtest baseline reporter.
//!
//! Runs the engine over a candle file under several execution assumptions so the effect
//! of each correctness fix is measurable rather than asserted.
//!
//! Usage:
//!   cargo run --release --example baseline -- path/to/candles.json [--json]
//!
//! The candle file is a JSON array of camelCase candles:
//!   [{"time":1700000000,"open":1.0,"high":2.0,"low":0.5,"close":1.5,"volume":10.0}, ...]

use btc_engine::costs::CostConfig;
use btc_engine::crypto_pro::{analyze_crypto_pro, CryptoProConfig, CryptoProResult};
use btc_engine::models::Candle;

struct Row {
    label: &'static str,
    trades: usize,
    wins: usize,
    losses: usize,
    breakeven: usize,
    win_rate: f64,
    pnl_usd: f64,
    pnl_r: f64,
    profit_factor: f64,
    max_dd_pct: f64,
    costs: f64,
    exposure_pct: f64,
}

fn summarize(label: &'static str, res: &CryptoProResult, initial: f64) -> Row {
    let d = &res.dashboard;

    let gross_profit: f64 = res.trades.iter().filter(|t| t.pnl_usd > 0.0).map(|t| t.pnl_usd).sum();
    let gross_loss: f64 = res
        .trades
        .iter()
        .filter(|t| t.pnl_usd < 0.0)
        .map(|t| t.pnl_usd.abs())
        .sum();
    let profit_factor = if gross_loss > 0.0 {
        gross_profit / gross_loss
    } else if gross_profit > 0.0 {
        f64::INFINITY
    } else {
        0.0
    };

    // Max drawdown from the bar-by-bar mark-to-market curve, not from trade closes.
    let mut peak = initial;
    let mut max_dd = 0.0f64;
    let mut bars_in_position = 0usize;
    for p in &res.equity_curve {
        if p.value > peak {
            peak = p.value;
        }
        if peak > 0.0 {
            let dd = (peak - p.value) / peak;
            if dd > max_dd {
                max_dd = dd;
            }
        }
        if p.in_position {
            bars_in_position += 1;
        }
    }

    Row {
        label,
        trades: d.total_trades,
        wins: d.winning_trades,
        losses: d.losing_trades,
        breakeven: d.breakeven_trades,
        win_rate: d.win_rate,
        pnl_usd: d.total_pnl,
        pnl_r: res.trades.iter().map(|t| t.pnl).sum(),
        profit_factor,
        max_dd_pct: max_dd * 100.0,
        costs: d.total_costs,
        exposure_pct: if res.equity_curve.is_empty() {
            0.0
        } else {
            bars_in_position as f64 / res.equity_curve.len() as f64 * 100.0
        },
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let path = match args.next() {
        Some(p) => p,
        None => {
            eprintln!("usage: baseline <candles.json> [--json]");
            std::process::exit(2);
        }
    };
    let as_json = args.any(|a| a == "--json");

    let raw = std::fs::read_to_string(&path).expect("read candle file");
    let candles: Vec<Candle> = serde_json::from_str(&raw).expect("parse candle file");
    assert!(!candles.is_empty(), "candle file is empty");

    let span_days =
        (candles[candles.len() - 1].time - candles[0].time) as f64 / 86_400.0;

    let base = CryptoProConfig::default();
    let initial = base.initial_capital;

    // Each row adds one correction on top of the previous, so the deltas attribute the
    // change in reported performance to a specific fix.
    let variants: Vec<(&'static str, CryptoProConfig)> = vec![
        (
            "causal + TP-first + no costs",
            CryptoProConfig {
                intrabar_policy: "tp_first".into(),
                costs: CostConfig { mode: "none".into(), ..Default::default() },
                ..CryptoProConfig::default()
            },
        ),
        (
            "causal + SL-first + no costs",
            CryptoProConfig {
                intrabar_policy: "sl_first".into(),
                costs: CostConfig { mode: "none".into(), ..Default::default() },
                ..CryptoProConfig::default()
            },
        ),
        (
            "causal + SL-first + flat 5bps",
            CryptoProConfig {
                intrabar_policy: "sl_first".into(),
                costs: CostConfig {
                    mode: "flat".into(),
                    per_side_bps: 5.0,
                    ..Default::default()
                },
                ..CryptoProConfig::default()
            },
        ),
        (
            "SHIPPING DEFAULT (realistic)",
            CryptoProConfig::default(),
        ),
    ];

    let rows: Vec<Row> = variants
        .iter()
        .map(|(label, cfg)| summarize(label, &analyze_crypto_pro(&candles, cfg), initial))
        .collect();

    if as_json {
        println!("[");
        for (i, r) in rows.iter().enumerate() {
            println!(
                "  {{\"label\":\"{}\",\"trades\":{},\"winRate\":{:.2},\"pnlUsd\":{:.2},\"pnlR\":{:.2},\"profitFactor\":{:.3},\"maxDdPct\":{:.2},\"costs\":{:.2},\"exposurePct\":{:.1}}}{}",
                r.label, r.trades, r.win_rate, r.pnl_usd, r.pnl_r, r.profit_factor,
                r.max_dd_pct, r.costs, r.exposure_pct,
                if i + 1 < rows.len() { "," } else { "" }
            );
        }
        println!("]");
        return;
    }

    println!();
    println!(
        "CryptoPRO baseline  |  {} candles  |  {:.1} days  |  initial capital ${:.0}",
        candles.len(),
        span_days,
        initial
    );
    println!("{}", "-".repeat(118));
    println!(
        "{:<32} {:>7} {:>6} {:>6} {:>5} {:>8} {:>11} {:>9} {:>8} {:>9} {:>8}",
        "assumption", "trades", "W", "L", "BE", "win%", "PnL $", "PnL R", "PF", "maxDD%", "costs $"
    );
    println!("{}", "-".repeat(118));
    for r in &rows {
        println!(
            "{:<32} {:>7} {:>6} {:>6} {:>5} {:>7.1}% {:>11.2} {:>9.2} {:>8.2} {:>8.1}% {:>8.2}",
            r.label,
            r.trades,
            r.wins,
            r.losses,
            r.breakeven,
            r.win_rate,
            r.pnl_usd,
            r.pnl_r,
            r.profit_factor,
            r.max_dd_pct,
            r.costs
        );
    }
    println!("{}", "-".repeat(118));
    println!("exposure (time in position): {:.1}%", rows[0].exposure_pct);
    println!();
}
