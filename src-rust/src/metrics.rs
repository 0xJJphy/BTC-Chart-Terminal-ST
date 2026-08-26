//! Performance and risk metrics.
//!
//! Everything here is computed from the **bar-by-bar mark-to-market equity curve**, not
//! from a trade-close series. That distinction is what makes drawdown, exposure and the
//! risk-adjusted ratios mean what their names say: a trade-close curve cannot see
//! intra-trade drawdown, and per-trade returns cannot be annualized with a calendar
//! factor.
//!
//! Annualization uses **365** periods per year, not 252. Crypto perpetuals trade every
//! day; borrowing the equity-market trading-day count overstates every ratio by ~20%.

use serde::{Deserialize, Serialize};

use crate::models::{EquityPoint, Trade};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct MetricsConfig {
    pub initial_capital: f64,
    /// Annual risk-free rate as a decimal (0.04 = 4%).
    pub risk_free_rate: f64,
    /// Calendar periods per year for annualization. 365 for 24/7 markets.
    pub periods_per_year: f64,
    pub bootstrap_iterations: usize,
    pub monte_carlo_iterations: usize,
    /// Drawdown depth, in percent, that counts as ruin in the Monte Carlo.
    pub ruin_threshold_pct: f64,
    /// How many parameter configurations were tried before picking this one. Drives the
    /// deflated Sharpe ratio - the more you searched, the higher the bar.
    pub trials_tested: usize,
    /// Fraction of the sample held out at the end for the walk-forward split.
    pub oos_fraction: f64,
    /// Dollar risk to assume for engines that report R without a dollar basis (SMC).
    pub fallback_risk_usd: f64,
    pub seed: u64,
}

impl Default for MetricsConfig {
    fn default() -> Self {
        MetricsConfig {
            initial_capital: 1000.0,
            risk_free_rate: 0.0,
            periods_per_year: 365.0,
            bootstrap_iterations: 5000,
            monte_carlo_iterations: 5000,
            ruin_threshold_pct: 50.0,
            trials_tested: 1,
            oos_fraction: 0.3,
            fallback_risk_usd: 100.0,
            seed: 0x5EED_1234_ABCD_9876,
        }
    }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConfidenceInterval {
    pub point: f64,
    pub lower: f64,
    pub upper: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DrawdownInfo {
    /// Deepest peak-to-trough decline, percent.
    pub max_pct: f64,
    pub peak_time: u64,
    pub trough_time: u64,
    /// When equity got back above the prior peak. `None` if still under water.
    pub recovery_time: Option<u64>,
    /// Longest stretch spent below a previous peak, in days.
    pub longest_days: f64,
    /// Days currently under water at the end of the sample.
    pub current_days: f64,
    /// Root-mean-square drawdown. Penalizes long shallow pain that max-DD ignores.
    pub ulcer_index: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RDistribution {
    pub min: f64,
    pub p05: f64,
    pub p25: f64,
    pub median: f64,
    pub p75: f64,
    pub p95: f64,
    pub max: f64,
    pub mean: f64,
    pub std_dev: f64,
    /// (bucket lower edge in R, count).
    pub histogram: Vec<(f64, usize)>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyReturn {
    pub year: i32,
    pub month: u32,
    pub return_pct: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SideBreakdown {
    pub trades: usize,
    pub win_rate: f64,
    pub pnl_usd: f64,
    pub expectancy_r: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MonteCarloResult {
    /// Median max drawdown across resampled trade sequences, percent.
    pub median_max_dd_pct: f64,
    pub p95_max_dd_pct: f64,
    pub worst_max_dd_pct: f64,
    /// Share of paths that breached `ruin_threshold_pct`.
    pub probability_of_ruin: f64,
    /// Share of resampled paths that finished above the starting capital.
    pub probability_of_profit: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WalkForward {
    pub is_trades: usize,
    pub oos_trades: usize,
    pub is_expectancy_r: f64,
    pub oos_expectancy_r: f64,
    pub is_win_rate: f64,
    pub oos_win_rate: f64,
    pub is_profit_factor: f64,
    pub oos_profit_factor: f64,
    /// OOS expectancy divided by IS expectancy. Below ~0.5 means the edge did not survive.
    /// `NaN` when in-sample expectancy was not positive, where the ratio has no meaning.
    pub degradation_ratio: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    // --- Counts ---
    pub total_trades: usize,
    pub wins: usize,
    pub losses: usize,
    pub breakeven: usize,
    pub win_rate: f64,

    // --- Money ---
    pub initial_capital: f64,
    pub final_equity: f64,
    pub total_pnl: f64,
    pub total_return_pct: f64,
    pub cagr_pct: f64,
    pub total_pnl_r: f64,

    // --- Per trade ---
    pub expectancy_usd: f64,
    pub expectancy_r: f64,
    pub avg_win: f64,
    pub avg_loss: f64,
    pub payoff_ratio: f64,
    pub profit_factor: f64,
    pub largest_win: f64,
    pub largest_loss: f64,

    // --- Risk-adjusted (annualized from the daily MTM series) ---
    pub sharpe: f64,
    pub sortino: f64,
    pub calmar: f64,
    pub annual_volatility_pct: f64,
    /// Probability the true Sharpe exceeds zero, given skew and kurtosis.
    pub probabilistic_sharpe: f64,
    /// Probability the Sharpe survives the number of configurations tried.
    pub deflated_sharpe: f64,

    // --- Risk ---
    pub drawdown: DrawdownInfo,
    /// 95% daily Value at Risk, percent (positive number = loss).
    pub var_95_pct: f64,
    /// Mean loss beyond VaR, percent.
    pub cvar_95_pct: f64,
    pub max_consecutive_wins: usize,
    pub max_consecutive_losses: usize,

    // --- Behaviour ---
    /// Share of bars with an open position.
    pub exposure_pct: f64,
    pub avg_bars_held: f64,
    pub avg_duration_secs: f64,
    pub max_duration_secs: f64,
    pub trades_per_day: f64,
    /// Mean maximum adverse excursion, in R. Negative.
    pub avg_mae_r: f64,
    /// Mean maximum favourable excursion, in R.
    pub avg_mfe_r: f64,
    /// How much of the average favourable excursion was actually captured.
    pub capture_ratio: f64,

    // --- Costs ---
    pub total_costs: f64,
    pub total_turnover: f64,
    /// Costs as a share of gross profit. Above 1 means fees ate the whole edge.
    pub cost_drag_ratio: f64,

    // --- Distributions and validation ---
    pub r_distribution: RDistribution,
    pub monthly_returns: Vec<MonthlyReturn>,
    pub long_side: SideBreakdown,
    pub short_side: SideBreakdown,
    pub win_rate_ci: ConfidenceInterval,
    pub profit_factor_ci: ConfidenceInterval,
    pub expectancy_r_ci: ConfidenceInterval,
    pub monte_carlo: MonteCarloResult,
    pub walk_forward: WalkForward,

    // --- Series for charting ---
    pub equity_curve: Vec<EquityPoint>,
    /// Percent below the running peak at each bar. Drives the underwater plot.
    pub drawdown_curve: Vec<f64>,

    pub first_trade_time: Option<u64>,
    pub last_trade_time: Option<u64>,
    pub span_days: f64,
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Rng(if seed == 0 { 0x9E37_79B9_7F4A_7C15 } else { seed })
    }
    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: usize) -> usize {
        if n == 0 { 0 } else { (self.next_u64() % n as u64) as usize }
    }
}

fn mean(xs: &[f64]) -> f64 {
    if xs.is_empty() { 0.0 } else { xs.iter().sum::<f64>() / xs.len() as f64 }
}

/// Sample standard deviation (n-1).
fn std_dev(xs: &[f64]) -> f64 {
    if xs.len() < 2 {
        return 0.0;
    }
    let m = mean(xs);
    let var = xs.iter().map(|x| (x - m).powi(2)).sum::<f64>() / (xs.len() - 1) as f64;
    var.sqrt()
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    if sorted.len() == 1 {
        return sorted[0];
    }
    let rank = p.clamp(0.0, 1.0) * (sorted.len() - 1) as f64;
    let lo = rank.floor() as usize;
    let hi = rank.ceil() as usize;
    let frac = rank - lo as f64;
    sorted[lo] * (1.0 - frac) + sorted[hi] * frac
}

fn sort_f64(mut v: Vec<f64>) -> Vec<f64> {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    v
}

/// Abramowitz & Stegun 7.1.26 error function, good to ~1e-7.
fn erf(x: f64) -> f64 {
    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    let x = x.abs();
    let t = 1.0 / (1.0 + 0.327_591_1 * x);
    let y = 1.0
        - (((((1.061_405_429 * t - 1.453_152_027) * t) + 1.421_413_741) * t - 0.284_496_736) * t
            + 0.254_829_592)
            * t
            * (-x * x).exp();
    sign * y
}

/// Standard normal CDF.
fn norm_cdf(x: f64) -> f64 {
    0.5 * (1.0 + erf(x / std::f64::consts::SQRT_2))
}

/// Inverse standard normal CDF (Acklam's rational approximation).
fn norm_ppf(p: f64) -> f64 {
    if p <= 0.0 {
        return f64::NEG_INFINITY;
    }
    if p >= 1.0 {
        return f64::INFINITY;
    }

    const A: [f64; 6] = [
        -3.969_683_028_665_376e1, 2.209_460_984_245_205e2, -2.759_285_104_469_687e2,
        1.383_577_518_672_690e2, -3.066_479_806_614_716e1, 2.506_628_277_459_239e0,
    ];
    const B: [f64; 5] = [
        -5.447_609_879_822_406e1, 1.615_858_368_580_409e2, -1.556_989_798_598_866e2,
        6.680_131_188_771_972e1, -1.328_068_155_288_572e1,
    ];
    const C: [f64; 6] = [
        -7.784_894_002_430_293e-3, -3.223_964_580_411_365e-1, -2.400_758_277_161_838e0,
        -2.549_732_539_343_734e0, 4.374_664_141_464_968e0, 2.938_163_982_698_783e0,
    ];
    const D: [f64; 4] = [
        7.784_695_709_041_462e-3, 3.224_671_290_700_398e-1, 2.445_134_137_142_996e0,
        3.754_408_661_907_416e0,
    ];

    let p_low = 0.02425;
    if p < p_low {
        let q = (-2.0 * p.ln()).sqrt();
        (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    } else if p <= 1.0 - p_low {
        let q = p - 0.5;
        let r = q * q;
        (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q
            / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0)
    } else {
        let q = (-2.0 * (1.0 - p).ln()).sqrt();
        -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    }
}

fn skewness(xs: &[f64]) -> f64 {
    let n = xs.len();
    if n < 3 {
        return 0.0;
    }
    let m = mean(xs);
    let s = std_dev(xs);
    if s == 0.0 {
        return 0.0;
    }
    xs.iter().map(|x| ((x - m) / s).powi(3)).sum::<f64>() / n as f64
}

/// Non-excess (Pearson) kurtosis; 3.0 for a normal distribution.
fn kurtosis(xs: &[f64]) -> f64 {
    let n = xs.len();
    if n < 4 {
        return 3.0;
    }
    let m = mean(xs);
    let s = std_dev(xs);
    if s == 0.0 {
        return 3.0;
    }
    xs.iter().map(|x| ((x - m) / s).powi(4)).sum::<f64>() / n as f64
}

/// Civil date from a Unix timestamp (Howard Hinnant's algorithm). Avoids pulling in
/// `chrono` for what is ultimately a grouping key.
fn civil_from_timestamp(ts: u64) -> (i32, u32, u32) {
    let days = (ts / 86_400) as i64;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as i64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/// Normalized view of a trade, so SMC (R-only) and CryptoPRO (dollar ledger) can share
/// one metrics path.
struct Norm {
    pnl_usd: f64,
    pnl_r: f64,
    is_long: bool,
    exit_time: u64,
    entry_time: u64,
    bars_held: usize,
    mae_r: f64,
    mfe_r: f64,
    cost_usd: f64,
}

fn normalize(trades: &[Trade], cfg: &MetricsConfig) -> Vec<Norm> {
    let mut out: Vec<Norm> = trades
        .iter()
        .filter(|t| {
            // Only settled positions carry realized PnL. PENDING/CANCELLED never traded.
            matches!(t.status.as_str(), "WIN" | "LOSS" | "BE" | "CLOSED" | "OPEN_MTM")
        })
        .map(|t| {
            // Engines that report R without a dollar basis get a synthetic one, so their
            // equity curve is at least internally consistent.
            let (pnl_usd, pnl_r) = if t.risk_usd > 0.0 {
                (t.pnl_usd, t.pnl)
            } else {
                (t.pnl * cfg.fallback_risk_usd, t.pnl)
            };
            Norm {
                pnl_usd,
                pnl_r,
                is_long: t.trade_type == "LONG",
                exit_time: t.exit_time.unwrap_or(t.time),
                entry_time: t.entry_time.unwrap_or(t.time),
                bars_held: t.bars_held,
                mae_r: t.mae_r,
                mfe_r: t.mfe_r,
                cost_usd: t.cost_usd,
            }
        })
        .collect();
    out.sort_by_key(|t| t.exit_time);
    out
}

/// Daily equity samples: the last mark of each calendar day.
fn daily_equity(curve: &[EquityPoint]) -> Vec<(u64, f64)> {
    let mut out: Vec<(u64, f64)> = Vec::new();
    for p in curve {
        let day = p.time / 86_400;
        match out.last_mut() {
            Some(last) if last.0 == day => last.1 = p.value,
            _ => out.push((day, p.value)),
        }
    }
    out
}

fn daily_returns(daily: &[(u64, f64)]) -> Vec<f64> {
    daily
        .windows(2)
        .map(|w| {
            let prev = w[0].1;
            if prev.abs() < 1e-12 {
                0.0
            } else {
                (w[1].1 - prev) / prev
            }
        })
        .collect()
}

fn drawdown_series(curve: &[EquityPoint], initial: f64) -> (Vec<f64>, DrawdownInfo) {
    let mut dd_curve = Vec::with_capacity(curve.len());
    let mut info = DrawdownInfo::default();
    if curve.is_empty() {
        return (dd_curve, info);
    }

    let mut peak = initial.max(curve[0].value);
    let mut peak_time = curve[0].time;
    let mut sum_sq = 0.0;

    let mut best_peak_time = peak_time;
    let mut best_trough_time = peak_time;
    let mut best_dd = 0.0f64;

    // Under-water stretch tracking.
    let mut underwater_start: Option<u64> = None;
    let mut longest_underwater = 0.0f64;
    let mut recovery_time: Option<u64> = None;
    let mut current_best_dd_resolved = false;

    for p in curve {
        if p.value >= peak {
            if let Some(start) = underwater_start.take() {
                let span = (p.time.saturating_sub(start)) as f64 / 86_400.0;
                if span > longest_underwater {
                    longest_underwater = span;
                }
                // The deepest drawdown recovered here if it was the one still open.
                if !current_best_dd_resolved && best_dd > 0.0 && start <= best_trough_time {
                    recovery_time = Some(p.time);
                    current_best_dd_resolved = true;
                }
            }
            peak = p.value;
            peak_time = p.time;
        } else if underwater_start.is_none() {
            underwater_start = Some(peak_time);
        }

        let dd = if peak > 0.0 { (peak - p.value) / peak } else { 0.0 };
        dd_curve.push(dd * 100.0);
        sum_sq += (dd * 100.0).powi(2);

        if dd > best_dd {
            best_dd = dd;
            best_peak_time = peak_time;
            best_trough_time = p.time;
            current_best_dd_resolved = false;
            recovery_time = None;
        }
    }

    let last_time = curve[curve.len() - 1].time;
    if let Some(start) = underwater_start {
        let span = (last_time.saturating_sub(start)) as f64 / 86_400.0;
        if span > longest_underwater {
            longest_underwater = span;
        }
        info.current_days = span;
    }

    info.max_pct = best_dd * 100.0;
    info.peak_time = best_peak_time;
    info.trough_time = best_trough_time;
    info.recovery_time = recovery_time;
    info.longest_days = longest_underwater;
    info.ulcer_index = (sum_sq / curve.len() as f64).sqrt();

    (dd_curve, info)
}

fn profit_factor(pnls: &[f64]) -> f64 {
    let gp: f64 = pnls.iter().filter(|p| **p > 0.0).sum();
    let gl: f64 = pnls.iter().filter(|p| **p < 0.0).map(|p| p.abs()).sum();
    if gl > 0.0 {
        gp / gl
    } else if gp > 0.0 {
        f64::INFINITY
    } else {
        0.0
    }
}

fn side_breakdown(trades: &[&Norm]) -> SideBreakdown {
    if trades.is_empty() {
        return SideBreakdown::default();
    }
    let wins = trades.iter().filter(|t| t.pnl_usd > 0.0).count();
    SideBreakdown {
        trades: trades.len(),
        win_rate: wins as f64 / trades.len() as f64 * 100.0,
        pnl_usd: trades.iter().map(|t| t.pnl_usd).sum(),
        expectancy_r: mean(&trades.iter().map(|t| t.pnl_r).collect::<Vec<_>>()),
    }
}

fn r_distribution(rs: &[f64]) -> RDistribution {
    if rs.is_empty() {
        return RDistribution::default();
    }
    let sorted = sort_f64(rs.to_vec());

    // Buckets of 0.25R spanning the observed range, capped so a single outlier cannot
    // produce thousands of empty bins.
    let lo = sorted[0].floor().max(-10.0);
    let hi = sorted[sorted.len() - 1].ceil().min(10.0);
    let step = 0.25;
    let n_bins = (((hi - lo) / step).ceil() as usize).clamp(1, 160);
    let mut hist = vec![0usize; n_bins];
    for r in rs {
        let idx = (((r - lo) / step).floor() as isize).clamp(0, n_bins as isize - 1) as usize;
        hist[idx] += 1;
    }

    RDistribution {
        min: sorted[0],
        p05: percentile(&sorted, 0.05),
        p25: percentile(&sorted, 0.25),
        median: percentile(&sorted, 0.50),
        p75: percentile(&sorted, 0.75),
        p95: percentile(&sorted, 0.95),
        max: sorted[sorted.len() - 1],
        mean: mean(rs),
        std_dev: std_dev(rs),
        histogram: hist
            .into_iter()
            .enumerate()
            .map(|(i, c)| (lo + i as f64 * step, c))
            .collect(),
    }
}

fn monthly_returns(daily: &[(u64, f64)]) -> Vec<MonthlyReturn> {
    let mut out: Vec<MonthlyReturn> = Vec::new();
    if daily.len() < 2 {
        return out;
    }

    let mut current: Option<(i32, u32, f64)> = None; // (year, month, opening equity)
    let mut last_value = daily[0].1;

    for &(day, value) in daily {
        let (y, m, _) = civil_from_timestamp(day * 86_400);
        match current {
            Some((cy, cm, open)) if cy == y && cm == m => {
                last_value = value;
                let _ = open;
            }
            Some((cy, cm, open)) => {
                let ret = if open.abs() > 1e-12 { (last_value - open) / open * 100.0 } else { 0.0 };
                out.push(MonthlyReturn { year: cy, month: cm, return_pct: ret });
                current = Some((y, m, last_value));
                last_value = value;
            }
            None => {
                current = Some((y, m, value));
                last_value = value;
            }
        }
    }

    if let Some((cy, cm, open)) = current {
        let ret = if open.abs() > 1e-12 { (last_value - open) / open * 100.0 } else { 0.0 };
        out.push(MonthlyReturn { year: cy, month: cm, return_pct: ret });
    }

    out
}

fn streaks(pnls: &[f64]) -> (usize, usize) {
    let (mut max_w, mut max_l, mut cur_w, mut cur_l) = (0, 0, 0, 0);
    for p in pnls {
        if *p > 0.0 {
            cur_w += 1;
            cur_l = 0;
        } else if *p < 0.0 {
            cur_l += 1;
            cur_w = 0;
        } else {
            cur_w = 0;
            cur_l = 0;
        }
        if cur_w > max_w {
            max_w = cur_w;
        }
        if cur_l > max_l {
            max_l = cur_l;
        }
    }
    (max_w, max_l)
}

fn bootstrap(
    trades: &[Norm],
    cfg: &MetricsConfig,
) -> (ConfidenceInterval, ConfidenceInterval, ConfidenceInterval) {
    let n = trades.len();
    let point_wr = if n > 0 {
        trades.iter().filter(|t| t.pnl_usd > 0.0).count() as f64 / n as f64 * 100.0
    } else {
        0.0
    };
    let point_pf = profit_factor(&trades.iter().map(|t| t.pnl_usd).collect::<Vec<_>>());
    let point_exp = mean(&trades.iter().map(|t| t.pnl_r).collect::<Vec<_>>());

    if n < 10 || cfg.bootstrap_iterations == 0 {
        // Too few trades for a resampled interval to say anything honest.
        let wide = |p: f64| ConfidenceInterval { point: p, lower: f64::NAN, upper: f64::NAN };
        return (wide(point_wr), wide(point_pf), wide(point_exp));
    }

    let mut rng = Rng::new(cfg.seed);
    let mut wrs = Vec::with_capacity(cfg.bootstrap_iterations);
    let mut pfs = Vec::with_capacity(cfg.bootstrap_iterations);
    let mut exps = Vec::with_capacity(cfg.bootstrap_iterations);
    let mut sample_usd = vec![0.0; n];
    let mut sample_r = vec![0.0; n];

    for _ in 0..cfg.bootstrap_iterations {
        let mut wins = 0usize;
        for k in 0..n {
            let idx = rng.below(n);
            sample_usd[k] = trades[idx].pnl_usd;
            sample_r[k] = trades[idx].pnl_r;
            if trades[idx].pnl_usd > 0.0 {
                wins += 1;
            }
        }
        wrs.push(wins as f64 / n as f64 * 100.0);
        let pf = profit_factor(&sample_usd);
        pfs.push(if pf.is_finite() { pf } else { 10.0 });
        exps.push(mean(&sample_r));
    }

    let ci = |mut v: Vec<f64>, point: f64| {
        v = sort_f64(v);
        ConfidenceInterval {
            point,
            lower: percentile(&v, 0.025),
            upper: percentile(&v, 0.975),
        }
    };

    (ci(wrs, point_wr), ci(pfs, point_pf), ci(exps, point_exp))
}

fn monte_carlo(trades: &[Norm], cfg: &MetricsConfig) -> MonteCarloResult {
    let n = trades.len();
    if n < 10 || cfg.monte_carlo_iterations == 0 {
        return MonteCarloResult::default();
    }

    let pnls: Vec<f64> = trades.iter().map(|t| t.pnl_usd).collect();
    let mut rng = Rng::new(cfg.seed ^ 0xA5A5_A5A5);
    let ruin_level = cfg.initial_capital * (1.0 - cfg.ruin_threshold_pct / 100.0);

    let mut dds = Vec::with_capacity(cfg.monte_carlo_iterations);
    let mut ruined = 0usize;
    let mut profitable = 0usize;
    let mut order: Vec<f64> = pnls.clone();

    for _ in 0..cfg.monte_carlo_iterations {
        // Resample with replacement, not a reshuffle.
        //
        // Permuting the same trades leaves the sum unchanged, so a pure reshuffle can only
        // ever report P(profit) = 0% or 100% - it says nothing. Drawing `n` trades with
        // replacement from the observed distribution varies both the path *and* the
        // outcome, which is what makes P(profit) and P(ruin) meaningful.
        for slot in order.iter_mut() {
            *slot = pnls[rng.below(n)];
        }

        let mut equity = cfg.initial_capital;
        let mut peak = equity;
        let mut max_dd = 0.0f64;
        let mut hit_ruin = false;

        for p in &order {
            equity += p;
            if equity > peak {
                peak = equity;
            }
            if peak > 0.0 {
                let dd = (peak - equity) / peak;
                if dd > max_dd {
                    max_dd = dd;
                }
            }
            if equity <= ruin_level {
                hit_ruin = true;
            }
        }

        dds.push(max_dd * 100.0);
        if hit_ruin {
            ruined += 1;
        }
        if equity > cfg.initial_capital {
            profitable += 1;
        }
    }

    let sorted = sort_f64(dds);
    MonteCarloResult {
        median_max_dd_pct: percentile(&sorted, 0.5),
        p95_max_dd_pct: percentile(&sorted, 0.95),
        worst_max_dd_pct: sorted[sorted.len() - 1],
        probability_of_ruin: ruined as f64 / cfg.monte_carlo_iterations as f64 * 100.0,
        probability_of_profit: profitable as f64 / cfg.monte_carlo_iterations as f64 * 100.0,
    }
}

fn walk_forward(trades: &[Norm], cfg: &MetricsConfig) -> WalkForward {
    let n = trades.len();
    if n < 10 {
        return WalkForward::default();
    }
    let split = ((n as f64) * (1.0 - cfg.oos_fraction.clamp(0.05, 0.95))) as usize;
    let (is, oos) = trades.split_at(split.clamp(1, n - 1));

    let summarize = |set: &[Norm]| {
        let usd: Vec<f64> = set.iter().map(|t| t.pnl_usd).collect();
        let r: Vec<f64> = set.iter().map(|t| t.pnl_r).collect();
        let wins = set.iter().filter(|t| t.pnl_usd > 0.0).count();
        (
            mean(&r),
            if set.is_empty() { 0.0 } else { wins as f64 / set.len() as f64 * 100.0 },
            profit_factor(&usd),
        )
    };

    let (is_exp, is_wr, is_pf) = summarize(is);
    let (oos_exp, oos_wr, oos_pf) = summarize(oos);

    WalkForward {
        is_trades: is.len(),
        oos_trades: oos.len(),
        is_expectancy_r: is_exp,
        oos_expectancy_r: oos_exp,
        is_win_rate: is_wr,
        oos_win_rate: oos_wr,
        is_profit_factor: if is_pf.is_finite() { is_pf } else { 999.0 },
        oos_profit_factor: if oos_pf.is_finite() { oos_pf } else { 999.0 },
        // Only meaningful when the in-sample edge was positive to begin with. A ratio
        // against a losing IS period reads as "improvement" for the wrong reason.
        degradation_ratio: if is_exp > 1e-12 { oos_exp / is_exp } else { f64::NAN },
    }
}

/// Probabilistic Sharpe Ratio: P(true SR > benchmark), correcting for skew and fat tails.
///
/// Bailey & Lopez de Prado (2012). `sr` and `benchmark` are per-period, not annualized.
fn probabilistic_sharpe(sr: f64, benchmark: f64, n: usize, skew: f64, kurt: f64) -> f64 {
    if n < 3 {
        return f64::NAN;
    }
    let denom = 1.0 - skew * sr + ((kurt - 1.0) / 4.0) * sr * sr;
    if denom <= 0.0 {
        return f64::NAN;
    }
    let z = (sr - benchmark) * ((n - 1) as f64).sqrt() / denom.sqrt();
    norm_cdf(z)
}

/// Deflated Sharpe Ratio: PSR against the Sharpe you would expect the *best* of
/// `trials` random strategies to show by luck alone.
///
/// The more configurations were tried before settling on one, the higher that bar. With
/// `trials = 1` this reduces to the plain PSR against zero.
fn deflated_sharpe(sr: f64, n: usize, skew: f64, kurt: f64, trials: usize) -> f64 {
    let t = trials.max(1) as f64;
    if trials <= 1 {
        return probabilistic_sharpe(sr, 0.0, n, skew, kurt);
    }

    // Under the null the trial Sharpes are draws with sampling variance 1/(n-1).
    let var_sr = 1.0 / ((n.max(2) - 1) as f64);
    let gamma = 0.577_215_664_901_532_9_f64; // Euler-Mascheroni
    let e = std::f64::consts::E;

    let expected_max = var_sr.sqrt()
        * ((1.0 - gamma) * norm_ppf(1.0 - 1.0 / t) + gamma * norm_ppf(1.0 - 1.0 / (t * e)));

    probabilistic_sharpe(sr, expected_max, n, skew, kurt)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

pub fn compute_metrics(
    trades: &[Trade],
    equity_curve: &[EquityPoint],
    cfg: &MetricsConfig,
) -> Metrics {
    let norm = normalize(trades, cfg);
    let mut m = Metrics {
        initial_capital: cfg.initial_capital,
        ..Default::default()
    };

    // Fall back to a trade-close curve when the engine did not supply a bar-level one
    // (SMC). Metrics that need bar granularity degrade honestly rather than lying.
    let owned_curve: Vec<EquityPoint>;
    let curve: &[EquityPoint] = if equity_curve.is_empty() {
        let mut eq = cfg.initial_capital;
        owned_curve = norm
            .iter()
            .map(|t| {
                eq += t.pnl_usd;
                EquityPoint { time: t.exit_time, value: eq, in_position: false }
            })
            .collect();
        &owned_curve
    } else {
        equity_curve
    };

    if norm.is_empty() {
        m.final_equity = cfg.initial_capital;
        m.equity_curve = curve.to_vec();
        return m;
    }

    let pnls: Vec<f64> = norm.iter().map(|t| t.pnl_usd).collect();
    let rs: Vec<f64> = norm.iter().map(|t| t.pnl_r).collect();

    // --- Counts. Breakeven is its own bucket; folding it into wins is what inflated the
    // --- old win rate.
    m.total_trades = norm.len();
    m.wins = pnls.iter().filter(|p| **p > 0.0).count();
    m.losses = pnls.iter().filter(|p| **p < 0.0).count();
    m.breakeven = m.total_trades - m.wins - m.losses;
    m.win_rate = m.wins as f64 / m.total_trades as f64 * 100.0;

    // --- Money
    m.total_pnl = pnls.iter().sum();
    m.final_equity = curve.last().map(|p| p.value).unwrap_or(cfg.initial_capital);
    m.total_return_pct = if cfg.initial_capital > 0.0 {
        (m.final_equity - cfg.initial_capital) / cfg.initial_capital * 100.0
    } else {
        0.0
    };
    m.total_pnl_r = rs.iter().sum();

    let span_secs = curve
        .last()
        .zip(curve.first())
        .map(|(b, a)| b.time.saturating_sub(a.time))
        .unwrap_or(0);
    m.span_days = span_secs as f64 / 86_400.0;

    // CAGR is only meaningful with surviving capital and a real span.
    m.cagr_pct = if m.span_days >= 1.0 && cfg.initial_capital > 0.0 && m.final_equity > 0.0 {
        let years = m.span_days / cfg.periods_per_year;
        ((m.final_equity / cfg.initial_capital).powf(1.0 / years) - 1.0) * 100.0
    } else {
        0.0
    };

    // --- Per trade
    let gross_profit: f64 = pnls.iter().filter(|p| **p > 0.0).sum();
    let gross_loss: f64 = pnls.iter().filter(|p| **p < 0.0).map(|p| p.abs()).sum();
    m.avg_win = if m.wins > 0 { gross_profit / m.wins as f64 } else { 0.0 };
    m.avg_loss = if m.losses > 0 { gross_loss / m.losses as f64 } else { 0.0 };
    m.payoff_ratio = if m.avg_loss > 0.0 { m.avg_win / m.avg_loss } else { 0.0 };
    m.profit_factor = profit_factor(&pnls);
    m.expectancy_usd = mean(&pnls);
    m.expectancy_r = mean(&rs);
    m.largest_win = pnls.iter().cloned().fold(f64::NEG_INFINITY, f64::max).max(0.0);
    m.largest_loss = pnls.iter().cloned().fold(f64::INFINITY, f64::min).min(0.0);

    // --- Risk-adjusted, from the daily MTM series
    let daily = daily_equity(curve);
    let rets = daily_returns(&daily);
    let rf_daily = cfg.risk_free_rate / cfg.periods_per_year;

    if rets.len() > 1 {
        let mu = mean(&rets);
        let sd = std_dev(&rets);
        let ann = cfg.periods_per_year.sqrt();

        m.annual_volatility_pct = sd * ann * 100.0;
        if sd > 0.0 {
            m.sharpe = (mu - rf_daily) / sd * ann;
        }

        // Downside deviation over the *full* sample, not just the losing days. Dividing by
        // the count of negative days (as the old JS did) is not the Sortino denominator.
        let downside: f64 = rets
            .iter()
            .map(|r| (r - rf_daily).min(0.0).powi(2))
            .sum::<f64>()
            / rets.len() as f64;
        let dd_dev = downside.sqrt();
        if dd_dev > 0.0 {
            m.sortino = (mu - rf_daily) / dd_dev * ann;
        }

        let sorted = sort_f64(rets.clone());
        m.var_95_pct = -percentile(&sorted, 0.05) * 100.0;
        let tail: Vec<f64> = sorted.iter().cloned().filter(|r| *r <= percentile(&sorted, 0.05)).collect();
        m.cvar_95_pct = -mean(&tail) * 100.0;

        let sk = skewness(&rets);
        let ku = kurtosis(&rets);
        let sr_daily = if sd > 0.0 { (mu - rf_daily) / sd } else { 0.0 };
        m.probabilistic_sharpe = probabilistic_sharpe(sr_daily, 0.0, rets.len(), sk, ku) * 100.0;
        m.deflated_sharpe =
            deflated_sharpe(sr_daily, rets.len(), sk, ku, cfg.trials_tested) * 100.0;
    }

    // --- Drawdown, from the bar-level curve
    let (dd_curve, dd_info) = drawdown_series(curve, cfg.initial_capital);
    m.drawdown_curve = dd_curve;
    m.drawdown = dd_info;
    // Calmar is annualized return over max drawdown, not total return over max drawdown.
    m.calmar = if m.drawdown.max_pct > 0.0 { m.cagr_pct / m.drawdown.max_pct } else { 0.0 };

    let (w, l) = streaks(&pnls);
    m.max_consecutive_wins = w;
    m.max_consecutive_losses = l;

    // --- Behaviour
    let bars_in_pos = curve.iter().filter(|p| p.in_position).count();
    m.exposure_pct = if curve.is_empty() {
        0.0
    } else {
        bars_in_pos as f64 / curve.len() as f64 * 100.0
    };
    m.avg_bars_held = mean(&norm.iter().map(|t| t.bars_held as f64).collect::<Vec<_>>());
    let durations: Vec<f64> = norm
        .iter()
        .map(|t| t.exit_time.saturating_sub(t.entry_time) as f64)
        .collect();
    m.avg_duration_secs = mean(&durations);
    m.max_duration_secs = durations.iter().cloned().fold(0.0, f64::max);
    m.trades_per_day = if m.span_days > 0.0 { norm.len() as f64 / m.span_days } else { 0.0 };

    m.avg_mae_r = mean(&norm.iter().map(|t| t.mae_r).collect::<Vec<_>>());
    m.avg_mfe_r = mean(&norm.iter().map(|t| t.mfe_r).collect::<Vec<_>>());
    // How much of the move that went your way you actually kept.
    m.capture_ratio = if m.avg_mfe_r.abs() > 1e-12 { m.expectancy_r / m.avg_mfe_r } else { 0.0 };

    // --- Costs
    m.total_costs = norm.iter().map(|t| t.cost_usd).sum();
    m.total_turnover = 0.0; // supplied by the engine's cost breakdown, not per-trade
    m.cost_drag_ratio = if gross_profit > 0.0 { m.total_costs / gross_profit } else { 0.0 };

    // --- Distributions and validation
    m.r_distribution = r_distribution(&rs);
    m.monthly_returns = monthly_returns(&daily);
    m.long_side = side_breakdown(&norm.iter().filter(|t| t.is_long).collect::<Vec<_>>());
    m.short_side = side_breakdown(&norm.iter().filter(|t| !t.is_long).collect::<Vec<_>>());

    let (wr_ci, pf_ci, exp_ci) = bootstrap(&norm, cfg);
    m.win_rate_ci = wr_ci;
    m.profit_factor_ci = pf_ci;
    m.expectancy_r_ci = exp_ci;

    m.monte_carlo = monte_carlo(&norm, cfg);
    m.walk_forward = walk_forward(&norm, cfg);

    m.first_trade_time = norm.first().map(|t| t.entry_time);
    m.last_trade_time = norm.last().map(|t| t.exit_time);
    m.equity_curve = curve.to_vec();

    m
}

#[cfg(test)]
mod tests {
    use super::*;

    fn curve(values: &[f64]) -> Vec<EquityPoint> {
        values
            .iter()
            .enumerate()
            .map(|(i, v)| EquityPoint {
                time: 1_600_000_000 + i as u64 * 86_400,
                value: *v,
                in_position: false,
            })
            .collect()
    }

    #[test]
    fn norm_ppf_inverts_norm_cdf() {
        for p in [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99] {
            let x = norm_ppf(p);
            assert!(
                (norm_cdf(x) - p).abs() < 1e-4,
                "ppf/cdf mismatch at p={p}: got {}",
                norm_cdf(x)
            );
        }
    }

    #[test]
    fn norm_ppf_known_quantiles() {
        assert!((norm_ppf(0.975) - 1.959_964).abs() < 1e-4);
        assert!((norm_ppf(0.5)).abs() < 1e-9);
        assert!((norm_ppf(0.025) + 1.959_964).abs() < 1e-4);
    }

    #[test]
    fn drawdown_finds_the_deepest_decline() {
        // 100 -> 120 -> 60 -> 130: max DD is 50% from the 120 peak.
        let (_, info) = drawdown_series(&curve(&[100.0, 120.0, 60.0, 130.0]), 100.0);
        assert!((info.max_pct - 50.0).abs() < 1e-9, "got {}", info.max_pct);
        assert!(info.recovery_time.is_some(), "the drawdown did recover");
    }

    #[test]
    fn ulcer_index_is_zero_for_a_monotonic_curve() {
        let (_, info) = drawdown_series(&curve(&[100.0, 110.0, 120.0, 130.0]), 100.0);
        assert!(info.ulcer_index.abs() < 1e-9);
        assert!(info.max_pct.abs() < 1e-9);
    }

    #[test]
    fn calmar_uses_annualized_return() {
        // Two years, equity doubles, 20% max drawdown along the way.
        let mut cfg = MetricsConfig { initial_capital: 100.0, ..Default::default() };
        cfg.bootstrap_iterations = 0;
        cfg.monte_carlo_iterations = 0;

        let mut pts = Vec::new();
        for i in 0..=730 {
            let v = if i == 365 { 80.0 } else { 100.0 + i as f64 * 100.0 / 730.0 };
            pts.push(EquityPoint {
                time: 1_600_000_000 + i as u64 * 86_400,
                value: v,
                in_position: false,
            });
        }
        let trades = vec![Trade {
            status: "WIN".into(),
            trade_type: "LONG".into(),
            pnl: 1.0,
            pnl_usd: 100.0,
            risk_usd: 100.0,
            exit_time: Some(pts[730].time),
            entry_time: Some(pts[0].time),
            ..Default::default()
        }];

        let m = compute_metrics(&trades, &pts, &cfg);
        // CAGR of a 2x over 2 years is ~41.4%.
        assert!((m.cagr_pct - 41.42).abs() < 1.0, "cagr was {}", m.cagr_pct);
        assert!(m.calmar > 0.0);
        // Calmar must be CAGR/maxDD, not total-return/maxDD.
        assert!(
            (m.calmar - m.cagr_pct / m.drawdown.max_pct).abs() < 1e-9,
            "calmar is not CAGR over max drawdown"
        );
    }

    #[test]
    fn breakeven_trades_are_not_counted_as_wins() {
        let cfg = MetricsConfig {
            bootstrap_iterations: 0,
            monte_carlo_iterations: 0,
            ..Default::default()
        };
        let mk = |pnl: f64, t: u64| Trade {
            status: "WIN".into(),
            trade_type: "LONG".into(),
            pnl: pnl / 100.0,
            pnl_usd: pnl,
            risk_usd: 100.0,
            entry_time: Some(t),
            exit_time: Some(t + 3600),
            ..Default::default()
        };
        let trades = vec![mk(100.0, 1_600_000_000), mk(0.0, 1_600_100_000), mk(-100.0, 1_600_200_000)];
        let m = compute_metrics(&trades, &[], &cfg);

        assert_eq!(m.wins, 1);
        assert_eq!(m.losses, 1);
        assert_eq!(m.breakeven, 1);
        assert!((m.win_rate - 33.333).abs() < 0.01, "win rate was {}", m.win_rate);
    }

    #[test]
    fn sharpe_annualizes_with_365_not_252() {
        let cfg = MetricsConfig {
            initial_capital: 100.0,
            bootstrap_iterations: 0,
            monte_carlo_iterations: 0,
            ..Default::default()
        };
        assert_eq!(cfg.periods_per_year, 365.0);

        // Alternating +1%/-0.5% daily: mean and sd are computable by hand.
        let mut pts = Vec::new();
        let mut v = 100.0;
        for i in 0..200 {
            v *= if i % 2 == 0 { 1.01 } else { 0.995 };
            pts.push(EquityPoint {
                time: 1_600_000_000 + i as u64 * 86_400,
                value: v,
                in_position: true,
            });
        }
        let trades = vec![Trade {
            status: "WIN".into(),
            trade_type: "LONG".into(),
            pnl: 1.0,
            pnl_usd: 10.0,
            risk_usd: 10.0,
            entry_time: Some(pts[0].time),
            exit_time: Some(pts[199].time),
            ..Default::default()
        }];

        let m = compute_metrics(&trades, &pts, &cfg);
        let rets = daily_returns(&daily_equity(&pts));
        let expected = mean(&rets) / std_dev(&rets) * 365.0f64.sqrt();
        assert!((m.sharpe - expected).abs() < 1e-6, "got {} want {}", m.sharpe, expected);
    }

    #[test]
    fn deflated_sharpe_penalizes_searching_more_configurations() {
        let one = deflated_sharpe(0.1, 300, 0.0, 3.0, 1);
        let many = deflated_sharpe(0.1, 300, 0.0, 3.0, 500);
        assert!(
            many < one,
            "searching 500 configurations should lower confidence: {many} vs {one}"
        );
    }

    #[test]
    fn bootstrap_interval_brackets_the_point_estimate() {
        let cfg = MetricsConfig {
            bootstrap_iterations: 2000,
            monte_carlo_iterations: 0,
            ..Default::default()
        };
        let trades: Vec<Trade> = (0..100)
            .map(|i| Trade {
                status: "WIN".into(),
                trade_type: if i % 2 == 0 { "LONG".into() } else { "SHORT".into() },
                pnl: if i % 3 == 0 { 2.0 } else { -1.0 },
                pnl_usd: if i % 3 == 0 { 200.0 } else { -100.0 },
                risk_usd: 100.0,
                entry_time: Some(1_600_000_000 + i as u64 * 7200),
                exit_time: Some(1_600_000_000 + i as u64 * 7200 + 3600),
                ..Default::default()
            })
            .collect();

        let m = compute_metrics(&trades, &[], &cfg);
        assert!(m.win_rate_ci.lower <= m.win_rate_ci.point);
        assert!(m.win_rate_ci.point <= m.win_rate_ci.upper);
        assert!(m.win_rate_ci.upper - m.win_rate_ci.lower > 0.0);
    }
}

#[cfg(test)]
mod montecarlo_tests {
    use super::*;

    fn trades_with(pnls: &[f64]) -> Vec<Trade> {
        pnls.iter()
            .enumerate()
            .map(|(i, p)| Trade {
                status: "WIN".into(),
                trade_type: "LONG".into(),
                pnl: p / 100.0,
                pnl_usd: *p,
                risk_usd: 100.0,
                entry_time: Some(1_600_000_000 + i as u64 * 7200),
                exit_time: Some(1_600_000_000 + i as u64 * 7200 + 3600),
                ..Default::default()
            })
            .collect()
    }

    #[test]
    fn monte_carlo_probability_of_profit_is_not_degenerate() {
        // A near-coin-flip edge must not report 0% or 100% certainty of profit. A pure
        // reshuffle would, because permuting additive PnL cannot change the sum.
        let mut pnls = Vec::new();
        for i in 0..80 {
            pnls.push(if i % 2 == 0 { 105.0 } else { -100.0 });
        }
        let cfg = MetricsConfig {
            initial_capital: 1000.0,
            monte_carlo_iterations: 3000,
            bootstrap_iterations: 0,
            ..Default::default()
        };
        let m = compute_metrics(&trades_with(&pnls), &[], &cfg);
        let p = m.monte_carlo.probability_of_profit;
        assert!(
            p > 5.0 && p < 95.0,
            "P(profit) came out degenerate at {p}% - the resampling is not varying outcomes"
        );
        assert!(m.monte_carlo.p95_max_dd_pct >= m.monte_carlo.median_max_dd_pct);
    }

    #[test]
    fn walk_forward_ratio_is_nan_when_in_sample_lost_money() {
        let pnls: Vec<f64> = (0..40)
            .map(|i| if i < 28 { -100.0 } else { 50.0 })
            .collect();
        let cfg = MetricsConfig {
            monte_carlo_iterations: 0,
            bootstrap_iterations: 0,
            ..Default::default()
        };
        let m = compute_metrics(&trades_with(&pnls), &[], &cfg);
        assert!(m.walk_forward.is_expectancy_r < 0.0);
        assert!(
            m.walk_forward.degradation_ratio.is_nan(),
            "a ratio against a losing in-sample period must not read as improvement"
        );
    }
}
