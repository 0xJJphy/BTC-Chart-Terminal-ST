//! The tests that keep look-ahead out of the engine.
//!
//! The headline property is **prefix stability**: computing anything on `candles[..k]`
//! must produce exactly the prefix of computing it on the full series. An indicator or a
//! strategy that peeks at future bars cannot satisfy this, so these tests fail loudly if
//! the look-ahead ever comes back.

use btc_engine::costs::CostConfig;
use btc_engine::crypto_pro::{analyze_crypto_pro, CryptoProConfig};
use btc_engine::indicators::*;
use btc_engine::models::Candle;

// ---------------------------------------------------------------------------
// Deterministic synthetic market
// ---------------------------------------------------------------------------

/// xorshift64* - deterministic across platforms, unlike hashing or `rand`.
struct Rng(u64);

impl Rng {
    fn next_f64(&mut self) -> f64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        let v = x.wrapping_mul(0x2545_F491_4F6C_DD1D);
        (v >> 11) as f64 / (1u64 << 53) as f64
    }
    /// Roughly standard normal via Irwin-Hall.
    fn normal(&mut self) -> f64 {
        let s: f64 = (0..12).map(|_| self.next_f64()).sum();
        s - 6.0
    }
}

/// A random walk with drift regimes, so the trend/range filters actually get exercised.
fn synthetic_candles(n: usize, seed: u64) -> Vec<Candle> {
    let mut rng = Rng(seed);
    let mut price = 30_000.0f64;
    let mut out = Vec::with_capacity(n);
    let start_time = 1_600_000_000u64;

    for i in 0..n {
        // Slow regime oscillation gives sustained trends and chop.
        let drift = ((i as f64) / 240.0).sin() * 6.0;
        let shock = rng.normal() * 45.0;
        let open = price;
        let close = (open + drift + shock).max(1.0);
        let wick_up = rng.next_f64() * 40.0;
        let wick_dn = rng.next_f64() * 40.0;
        let high = open.max(close) + wick_up;
        let low = (open.min(close) - wick_dn).max(0.5);
        let volume = 100.0 + rng.next_f64() * 900.0;
        let buy = volume * (0.3 + rng.next_f64() * 0.4);

        out.push(Candle {
            time: start_time + (i as u64) * 900, // 15m bars
            open,
            high,
            low,
            close,
            volume: Some(volume),
            delta: Some(buy - (volume - buy)),
            buy_volume: Some(buy),
            sell_volume: Some(volume - buy),
            txn_count: Some(50),
        });
        price = close;
    }
    out
}

fn assert_series_prefix_stable(name: &str, full: &Series, prefix: &Series) {
    assert!(
        prefix.len() <= full.len(),
        "{name}: prefix longer than full series"
    );
    for i in 0..prefix.len() {
        match (full[i], prefix[i]) {
            (None, None) => {}
            (Some(a), Some(b)) => assert!(
                (a - b).abs() < 1e-9,
                "{name}: value at {i} changed when future bars were added ({a} vs {b}) - look-ahead"
            ),
            (a, b) => panic!(
                "{name}: definedness at {i} changed when future bars were added ({a:?} vs {b:?}) - look-ahead"
            ),
        }
    }
}

// ---------------------------------------------------------------------------
// Indicator warm-up boundaries
// ---------------------------------------------------------------------------

fn first_defined(s: &Series) -> Option<usize> {
    s.iter().position(|v| v.is_some())
}

#[test]
fn indicator_warmups_start_at_the_right_bar() {
    let c = synthetic_candles(500, 1);

    assert_eq!(first_defined(&calculate_ema(&c, 50)), Some(49));
    assert_eq!(first_defined(&calculate_ema(&c, 200)), Some(199));
    assert_eq!(first_defined(&calculate_atr(&c, 14)), Some(14));
    assert_eq!(first_defined(&calculate_avg_volume(&c, 20)), Some(19));
    assert_eq!(first_defined(&calculate_rsi(&c, 14)), Some(14));

    let macd = calculate_macd(&c, 12, 26, 9);
    assert_eq!(first_defined(&macd.macd), Some(25));
    assert_eq!(first_defined(&macd.signal), Some(33));
    assert_eq!(first_defined(&macd.hist), Some(33));

    let dmi = calculate_dmi_adx(&c, 14);
    assert_eq!(first_defined(&dmi.di_plus), Some(14));
    assert_eq!(first_defined(&dmi.adx), Some(27));
}

#[test]
fn warmup_bars_are_none_not_backfilled() {
    let c = synthetic_candles(500, 7);
    let ema = calculate_ema(&c, 200);
    // The old implementation wrote the SMA of the first 200 closes into bars 0..198,
    // which is precisely the look-ahead that fed the EMA-200 trend filter.
    for (i, v) in ema.iter().enumerate().take(199) {
        assert!(v.is_none(), "EMA-200 leaked a value at warm-up bar {i}");
    }
}

// ---------------------------------------------------------------------------
// Indicator invariants
// ---------------------------------------------------------------------------

fn flat_candles(n: usize, price: f64, volume: f64) -> Vec<Candle> {
    (0..n)
        .map(|i| Candle {
            time: 1_600_000_000 + (i as u64) * 900,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: Some(volume),
            ..Default::default()
        })
        .collect()
}

#[test]
fn ema_of_a_constant_series_is_that_constant() {
    let c = flat_candles(100, 250.0, 10.0);
    for v in calculate_ema(&c, 20).iter().flatten() {
        assert!((v - 250.0).abs() < 1e-9);
    }
}

#[test]
fn avg_volume_of_a_constant_series_is_that_constant() {
    let c = flat_candles(100, 250.0, 42.0);
    let avg = calculate_avg_volume(&c, 20);
    for v in avg.iter().flatten() {
        assert!(
            (v - 42.0).abs() < 1e-9,
            "rolling window drifted: got {v}, expected 42"
        );
    }
}

#[test]
fn avg_volume_window_drops_the_oldest_bar() {
    // The old implementation never released v[0] from the window, so a single huge first
    // bar contaminated every later average forever.
    let mut c = flat_candles(100, 250.0, 10.0);
    c[0].volume = Some(100_000.0);

    let avg = calculate_avg_volume(&c, 20);
    // By bar 20 the spike is out of the window and the average must be exactly 10.
    for (i, v) in avg.iter().enumerate() {
        if i >= 20 {
            let v = v.expect("defined after warm-up");
            assert!(
                (v - 10.0).abs() < 1e-9,
                "bar {i}: stale first-bar volume still in the window ({v})"
            );
        }
    }
}

#[test]
fn rsi_saturates_on_monotonic_series() {
    let up: Vec<Candle> = (0..80)
        .map(|i| Candle {
            time: 1_600_000_000 + (i as u64) * 900,
            open: 100.0 + i as f64,
            high: 100.0 + i as f64,
            low: 100.0 + i as f64,
            close: 100.0 + i as f64,
            volume: Some(1.0),
            ..Default::default()
        })
        .collect();
    let rsi = calculate_rsi(&up, 14);
    assert!((rsi[70].unwrap() - 100.0).abs() < 1e-9);

    let down: Vec<Candle> = (0..80)
        .map(|i| Candle {
            time: 1_600_000_000 + (i as u64) * 900,
            open: 200.0 - i as f64,
            high: 200.0 - i as f64,
            low: 200.0 - i as f64,
            close: 200.0 - i as f64,
            volume: Some(1.0),
            ..Default::default()
        })
        .collect();
    let rsi = calculate_rsi(&down, 14);
    assert!(rsi[70].unwrap().abs() < 1e-9);
}

#[test]
fn atr_of_constant_range_candles_equals_that_range() {
    let c: Vec<Candle> = (0..100)
        .map(|i| Candle {
            time: 1_600_000_000 + (i as u64) * 900,
            open: 100.0,
            high: 105.0,
            low: 95.0,
            close: 100.0,
            volume: Some(1.0),
            ..Default::default()
        })
        .collect();
    let atr = calculate_atr(&c, 14);
    assert!((atr[50].unwrap() - 10.0).abs() < 1e-9);
}

#[test]
fn macd_of_a_constant_series_is_zero() {
    let c = flat_candles(200, 250.0, 10.0);
    let macd = calculate_macd(&c, 12, 26, 9);
    assert!(macd.macd[150].unwrap().abs() < 1e-9);
    assert!(macd.hist[150].unwrap().abs() < 1e-9);
}

#[test]
fn dmi_points_up_in_an_uptrend() {
    let c: Vec<Candle> = (0..200)
        .map(|i| {
            let base = 100.0 + i as f64 * 2.0;
            Candle {
                time: 1_600_000_000 + (i as u64) * 900,
                open: base,
                high: base + 1.0,
                low: base - 1.0,
                close: base + 0.5,
                volume: Some(1.0),
                ..Default::default()
            }
        })
        .collect();
    let dmi = calculate_dmi_adx(&c, 14);
    assert!(dmi.di_plus[150].unwrap() > dmi.di_minus[150].unwrap());
    assert!(dmi.adx[150].unwrap() > 25.0, "a clean trend should register as trending");
}

// ---------------------------------------------------------------------------
// Prefix stability
// ---------------------------------------------------------------------------

#[test]
fn every_indicator_is_prefix_stable() {
    let full = synthetic_candles(1200, 99);
    let k = 800;
    let prefix = &full[..k];

    assert_series_prefix_stable("ema50", &calculate_ema(&full, 50), &calculate_ema(prefix, 50));
    assert_series_prefix_stable("ema200", &calculate_ema(&full, 200), &calculate_ema(prefix, 200));
    assert_series_prefix_stable("atr14", &calculate_atr(&full, 14), &calculate_atr(prefix, 14));
    assert_series_prefix_stable(
        "avgvol20",
        &calculate_avg_volume(&full, 20),
        &calculate_avg_volume(prefix, 20),
    );
    assert_series_prefix_stable("rsi14", &calculate_rsi(&full, 14), &calculate_rsi(prefix, 14));

    let m_full = calculate_macd(&full, 12, 26, 9);
    let m_pre = calculate_macd(prefix, 12, 26, 9);
    assert_series_prefix_stable("macd", &m_full.macd, &m_pre.macd);
    assert_series_prefix_stable("macd.signal", &m_full.signal, &m_pre.signal);
    assert_series_prefix_stable("macd.hist", &m_full.hist, &m_pre.hist);

    let d_full = calculate_dmi_adx(&full, 14);
    let d_pre = calculate_dmi_adx(prefix, 14);
    assert_series_prefix_stable("adx", &d_full.adx, &d_pre.adx);
    assert_series_prefix_stable("di+", &d_full.di_plus, &d_pre.di_plus);
    assert_series_prefix_stable("di-", &d_full.di_minus, &d_pre.di_minus);
}

#[test]
fn pivots_are_only_confirmed_after_their_right_window() {
    let c = synthetic_candles(600, 5);
    let right = 6;
    let pivots = calculate_pivots(&c, 6, right);
    assert!(!pivots.is_empty(), "expected some pivots in a random walk");

    for p in &pivots {
        assert_eq!(p.confirmed_at_index, p.bar_index + right);
    }

    // Confirmation indices must be non-decreasing: the incremental cursor in the strategy
    // consumes them in order and would silently drop pivots otherwise.
    for w in pivots.windows(2) {
        assert!(w[0].confirmed_at_index <= w[1].confirmed_at_index);
    }

    // A pivot knowable at bar i must also be present, identically, when the series is
    // truncated just past it.
    let k = 400;
    let truncated = calculate_pivots(&c[..k], 6, right);
    for p in truncated.iter() {
        let matching = pivots
            .iter()
            .find(|q| q.bar_index == p.bar_index && q.is_high == p.is_high)
            .expect("pivot present in the truncated run vanished in the full run");
        assert!((matching.price - p.price).abs() < 1e-12);
    }
}

// ---------------------------------------------------------------------------
// Strategy-level causality and accounting
// ---------------------------------------------------------------------------

fn test_config() -> CryptoProConfig {
    CryptoProConfig {
        // Loosen the gate so the synthetic series actually produces trades.
        minimum_score: 55.0,
        wait_for_retest: false,
        costs: CostConfig { mode: "realistic".into(), ..Default::default() },
        ..Default::default()
    }
}

#[test]
fn strategy_produces_trades_on_the_fixture() {
    let c = synthetic_candles(4000, 2024);
    let res = analyze_crypto_pro(&c, &test_config());
    assert!(
        res.trades.len() >= 5,
        "fixture produced {} trades; the causality test needs a meaningful sample",
        res.trades.len()
    );
}

#[test]
fn backtest_is_prefix_stable() {
    let full_candles = synthetic_candles(4000, 2024);
    let k = 2600;

    let full = analyze_crypto_pro(&full_candles, &test_config());
    let prefix = analyze_crypto_pro(&full_candles[..k], &test_config());

    // A position still open at the cut is marked to market; it has no counterpart in the
    // full run yet, so it is excluded from the comparison.
    let settled: Vec<_> = prefix
        .trades
        .iter()
        .filter(|t| t.status != "OPEN_MTM")
        .collect();

    assert!(
        !settled.is_empty(),
        "no settled trades before the cut - test would be vacuous"
    );

    for t in &settled {
        let counterpart = full
            .trades
            .iter()
            .find(|f| f.id == t.id)
            .unwrap_or_else(|| panic!("trade {} disappeared when future bars were added", t.id));

        assert_eq!(counterpart.trade_type, t.trade_type, "trade {} flipped side", t.id);
        assert_eq!(counterpart.time, t.time, "trade {} moved its entry bar", t.id);
        assert!(
            (counterpart.entry - t.entry).abs() < 1e-9,
            "trade {} changed entry price - look-ahead",
            t.id
        );
        assert!(
            (counterpart.sl - t.sl).abs() < 1e-9,
            "trade {} changed its stop - look-ahead",
            t.id
        );
        assert!(
            (counterpart.pnl - t.pnl).abs() < 1e-9,
            "trade {} changed PnL ({} vs {}) - look-ahead",
            t.id,
            t.pnl,
            counterpart.pnl
        );
        assert_eq!(
            counterpart.exit_reason, t.exit_reason,
            "trade {} changed how it exited",
            t.id
        );
    }
}

#[test]
fn equity_reconciles_with_the_sum_of_trade_pnl() {
    let c = synthetic_candles(4000, 77);
    let cfg = test_config();
    let res = analyze_crypto_pro(&c, &cfg);

    let sum: f64 = res.trades.iter().map(|t| t.pnl_usd).sum();
    let reported = res.dashboard.current_capital - cfg.initial_capital;

    assert!(
        (sum - reported).abs() < 0.02,
        "ledger does not reconcile: trades sum to {sum} but equity moved {reported}"
    );

    // The mark-to-market curve must land on the same number.
    let last = res.equity_curve.last().expect("equity curve is populated");
    assert!(
        (last.value - res.dashboard.current_capital).abs() < 0.02,
        "equity curve ends at {} but the dashboard reports {}",
        last.value,
        res.dashboard.current_capital
    );
}

#[test]
fn no_trade_is_left_open_and_unreported() {
    let c = synthetic_candles(4000, 31337);
    let res = analyze_crypto_pro(&c, &test_config());

    // Any open position at the end must appear as OPEN_MTM rather than vanish.
    let open = res.trades.iter().filter(|t| t.status == "OPEN_MTM").count();
    assert!(open <= 1, "at most one position can be open at the end, found {open}");

    for t in &res.trades {
        assert!(t.exit_time.is_some(), "trade {} has no exit time", t.id);
        assert!(t.risk_usd > 0.0, "trade {} has no risk basis for its R", t.id);
    }
}

#[test]
fn sl_first_is_never_more_profitable_than_tp_first() {
    // The whole point of the conservative default: on candles that touch both levels,
    // assuming the stop filled first cannot produce a better result than assuming the
    // target did.
    let c = synthetic_candles(4000, 4242);

    let mut optimistic = test_config();
    optimistic.intrabar_policy = "tp_first".into();
    let mut conservative = test_config();
    conservative.intrabar_policy = "sl_first".into();

    let opt = analyze_crypto_pro(&c, &optimistic);
    let con = analyze_crypto_pro(&c, &conservative);

    assert!(
        con.dashboard.total_pnl <= opt.dashboard.total_pnl + 1e-6,
        "sl_first ({}) beat tp_first ({}) - the intrabar policy is not doing what it says",
        con.dashboard.total_pnl,
        opt.dashboard.total_pnl
    );
}

#[test]
fn costs_reduce_pnl_monotonically() {
    let c = synthetic_candles(4000, 909);

    let mut free = test_config();
    free.costs = CostConfig { mode: "none".into(), ..Default::default() };
    let mut cheap = test_config();
    cheap.costs = CostConfig { mode: "flat".into(), per_side_bps: 2.0, ..Default::default() };
    let mut dear = test_config();
    dear.costs = CostConfig { mode: "flat".into(), per_side_bps: 20.0, ..Default::default() };

    let a = analyze_crypto_pro(&c, &free).dashboard.total_pnl;
    let b = analyze_crypto_pro(&c, &cheap).dashboard.total_pnl;
    let d = analyze_crypto_pro(&c, &dear).dashboard.total_pnl;

    assert!(a >= b, "gross PnL {a} should beat 2bps {b}");
    assert!(b >= d, "2bps {b} should beat 20bps {d}");
}

#[test]
fn position_sizing_respects_the_risk_budget() {
    let c = synthetic_candles(4000, 12345);
    let mut cfg = test_config();
    cfg.risk_percent = 1.0;
    // Give the notional cap enough headroom that the risk budget is the binding limit.
    cfg.capital_per_trade = 100_000.0;

    let res = analyze_crypto_pro(&c, &cfg);
    for t in &res.trades {
        let budget = t.equity_at_entry * 0.01;
        assert!(
            t.risk_usd <= budget * 1.0001,
            "trade {} risked {} on {} equity, above the 1% budget",
            t.id,
            t.risk_usd,
            t.equity_at_entry
        );
    }
}

#[test]
fn stops_beyond_the_liquidation_price_are_rejected() {
    let c = synthetic_candles(3000, 5150);
    let mut cfg = test_config();
    // 50x with a wide ATR stop: most setups should now be untradeable rather than
    // silently backtested at a stop the exchange would never let you reach.
    cfg.leverage = 50.0;
    cfg.atr_multiplier = 5.0;
    cfg.max_sl_atr = 5.0;

    let res = analyze_crypto_pro(&c, &cfg);
    for t in &res.trades {
        let sl_pct = (t.entry - t.sl).abs() / t.entry;
        let liq = 1.0 / cfg.leverage - cfg.maintenance_margin_pct / 100.0;
        assert!(
            sl_pct < liq,
            "trade {} has a stop {:.4} beyond the liquidation threshold {:.4}",
            t.id,
            sl_pct,
            liq
        );
    }
}
