use serde::{Deserialize, Serialize};

/// Transaction-cost model for the backtest engine.
///
/// Three modes, all reachable from the UI:
///  * `none`      - gross PnL, no costs. Feeds the cost-sensitivity sweep.
///  * `flat`      - a single bps charge per side, no funding. Good enough to rank
///                  strategies against each other.
///  * `realistic` - taker on market fills, maker on resting limit fills, slippage on
///                  market fills only, plus prorated perpetual funding.
///
/// Everything is expressed in basis points of notional (1 bps = 0.01%). Slippage is in
/// bps rather than ticks so the model stays symbol-agnostic.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct CostConfig {
    /// "none" | "flat" | "realistic"
    pub mode: String,
    /// `flat` mode: charged on every fill, both sides.
    pub per_side_bps: f64,
    /// `realistic` mode: fee for liquidity-taking (market) fills.
    pub taker_bps: f64,
    /// `realistic` mode: fee for liquidity-making (resting limit) fills.
    pub maker_bps: f64,
    /// `realistic` mode: adverse fill on market orders only. A resting limit order that
    /// gets touched fills at its price, so it does not slip.
    pub slippage_bps: f64,
    /// `realistic` mode: funding rate per 8h window, prorated by holding time.
    pub funding_bps_8h: f64,
}

impl Default for CostConfig {
    fn default() -> Self {
        // Binance USD-M futures VIP0 defaults.
        CostConfig {
            mode: "realistic".to_string(),
            per_side_bps: 5.0,
            taker_bps: 4.5,
            maker_bps: 1.8,
            slippage_bps: 1.0,
            funding_bps_8h: 1.0,
        }
    }
}

/// How a fill reached the book. Determines fee tier and whether slippage applies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FillKind {
    /// Market order: crosses the spread. Taker fee + slippage.
    Market,
    /// Resting limit order that was touched. Maker fee, no slippage.
    Limit,
}

/// Running tally of everything the strategy paid, so the UI can show fees, funding and
/// slippage separately instead of a single opaque number.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CostBreakdown {
    pub fees: f64,
    pub slippage: f64,
    pub funding: f64,
    pub total: f64,
    /// Sum of notional traded across every fill, entry and exit.
    pub turnover: f64,
}

impl CostBreakdown {
    pub fn add(&mut self, other: &CostBreakdown) {
        self.fees += other.fees;
        self.slippage += other.slippage;
        self.funding += other.funding;
        self.total += other.total;
        self.turnover += other.turnover;
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Mode {
    None,
    Flat { per_side_bps: f64 },
    Realistic { taker_bps: f64, maker_bps: f64, slippage_bps: f64, funding_bps_8h: f64 },
}

/// Resolved, validated cost model. Build once per backtest with [`CostModel::new`].
#[derive(Debug, Clone, Copy)]
pub struct CostModel {
    mode: Mode,
}

const SECONDS_PER_FUNDING_WINDOW: f64 = 8.0 * 3600.0;

impl CostModel {
    pub fn new(cfg: &CostConfig) -> Self {
        let mode = match cfg.mode.to_lowercase().as_str() {
            "none" | "gross" | "off" => Mode::None,
            "flat" | "flat_bps" | "flatbps" => Mode::Flat {
                per_side_bps: cfg.per_side_bps.max(0.0),
            },
            // "realistic" and anything unrecognised: fail toward charging costs rather
            // than silently reporting gross PnL as if it were net.
            _ => Mode::Realistic {
                taker_bps: cfg.taker_bps.max(0.0),
                maker_bps: cfg.maker_bps.max(0.0),
                slippage_bps: cfg.slippage_bps.max(0.0),
                funding_bps_8h: cfg.funding_bps_8h.max(0.0),
            },
        };
        CostModel { mode }
    }

    /// Convenience constructor for the sensitivity sweep: a flat model at `bps` per side.
    pub fn flat(per_side_bps: f64) -> Self {
        CostModel { mode: Mode::Flat { per_side_bps: per_side_bps.max(0.0) } }
    }

    pub fn is_free(&self) -> bool {
        self.mode == Mode::None
    }

    /// Cost of a single fill of `notional` USD. Returns a breakdown so fees and slippage
    /// stay separable in the metrics panel.
    pub fn fill_cost(&self, notional: f64, kind: FillKind) -> CostBreakdown {
        let notional = notional.abs();
        let mut out = CostBreakdown { turnover: notional, ..Default::default() };

        match self.mode {
            Mode::None => {}
            Mode::Flat { per_side_bps } => {
                out.fees = notional * per_side_bps / 10_000.0;
            }
            Mode::Realistic { taker_bps, maker_bps, slippage_bps, .. } => {
                let (fee_bps, slip_bps) = match kind {
                    FillKind::Market => (taker_bps, slippage_bps),
                    FillKind::Limit => (maker_bps, 0.0),
                };
                out.fees = notional * fee_bps / 10_000.0;
                out.slippage = notional * slip_bps / 10_000.0;
            }
        }

        out.total = out.fees + out.slippage;
        out
    }

    /// Perpetual funding paid on `notional` held for `seconds_held`.
    ///
    /// Historical per-symbol funding is not available to the engine, so this charges the
    /// configured rate to whoever is holding, regardless of side. That is the
    /// conservative reading: it never turns funding into a source of profit.
    pub fn funding_cost(&self, notional: f64, seconds_held: u64) -> CostBreakdown {
        let mut out = CostBreakdown::default();
        if let Mode::Realistic { funding_bps_8h, .. } = self.mode {
            let windows = seconds_held as f64 / SECONDS_PER_FUNDING_WINDOW;
            out.funding = notional.abs() * (funding_bps_8h / 10_000.0) * windows;
            out.total = out.funding;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn none_mode_is_free() {
        let m = CostModel::new(&CostConfig { mode: "none".into(), ..Default::default() });
        assert_eq!(m.fill_cost(10_000.0, FillKind::Market).total, 0.0);
        assert_eq!(m.funding_cost(10_000.0, 86_400).total, 0.0);
    }

    #[test]
    fn flat_mode_charges_both_sides_equally() {
        let m = CostModel::flat(5.0);
        let market = m.fill_cost(10_000.0, FillKind::Market);
        let limit = m.fill_cost(10_000.0, FillKind::Limit);
        assert!((market.total - 5.0).abs() < 1e-9);
        assert!((limit.total - 5.0).abs() < 1e-9);
    }

    #[test]
    fn realistic_mode_separates_maker_and_taker() {
        let m = CostModel::new(&CostConfig::default());
        let market = m.fill_cost(10_000.0, FillKind::Market);
        let limit = m.fill_cost(10_000.0, FillKind::Limit);
        // taker 4.5bps + 1bps slippage on 10k = 4.5 + 1.0
        assert!((market.fees - 4.5).abs() < 1e-9);
        assert!((market.slippage - 1.0).abs() < 1e-9);
        // maker 1.8bps, no slippage
        assert!((limit.fees - 1.8).abs() < 1e-9);
        assert_eq!(limit.slippage, 0.0);
    }

    #[test]
    fn funding_is_prorated_by_holding_time() {
        let m = CostModel::new(&CostConfig::default());
        let eight_hours = m.funding_cost(10_000.0, 8 * 3600);
        let four_hours = m.funding_cost(10_000.0, 4 * 3600);
        assert!((eight_hours.funding - 1.0).abs() < 1e-9);
        assert!((four_hours.funding - 0.5).abs() < 1e-9);
    }

    #[test]
    fn unknown_mode_falls_back_to_charging_costs() {
        let m = CostModel::new(&CostConfig { mode: "typo".into(), ..Default::default() });
        assert!(!m.is_free());
    }
}
