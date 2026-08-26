# Backtest baseline — before/after the causality and accounting fixes

Reference measurement for the CryptoPRO engine. Regenerate with:

```bash
cargo run --release --example baseline -- path/to/candles.json
```

## Dataset

| | |
|---|---|
| Symbol / timeframe | BTCUSDT 15m (Binance spot klines) |
| Range | 2026-04-21 → 2026-08-24 (125 days, 12,000 candles) |
| Price range | 57,800 → 82,850 |
| Initial capital | $1,000 |

The window contains both a sustained downtrend and ranging phases, so the trend and
regime filters are genuinely exercised.

## Results

The old engine was recovered from git (`f650053`) and run unmodified on the same candles.

| Engine / assumption | Trades | Win % | PnL $ | PnL R | PF | maxDD % | Costs $ |
|---|---:|---:|---:|---:|---:|---:|---:|
| **OLD engine** (look-ahead, TP-before-SL, no costs) | 344 | 51.7 | −122.80 | −27.25 | 0.84 | n/a | 0.00 |
| causal indicators + causal S/R, TP-first, no costs | 231 | 49.4 | +1.79 | −2.50 | 1.00 | 8.6 | 0.00 |
| causal, **SL-first**, no costs | 232 | 48.7 | −14.06 | −5.75 | 0.98 | 8.6 | 0.00 |
| causal, SL-first, flat 5 bps/side | 232 | 44.0 | −342.13 | −94.37 | 0.55 | 36.9 | 325.16 |
| **Shipping default** (SL-first, realistic costs) | 232 | 44.4 | −343.59 | −94.79 | 0.56 | 37.2 | 326.52 |

Exposure (time in position): **21.0%** of bars.

## What each row shows

**Removing the look-ahead cut the trade count by a third — 344 → 231.** Those 113 missing
trades were signals that only existed because the S/R confluence component was allowed to
match pivots from the future and because the EMA-200 trend filter was seeded with a mean
of bars it had not seen yet. Win rate fell 51.7% → 49.4% at the same time.

**The old accounting cut the other way.** In R terms the old engine looked *worse* than it
should have (−0.079 R/trade vs −0.011 R/trade), because the 25% tranche that exits at the
trailing stop was never credited and because a TP2-then-stop outcome was hardcoded to
1.00 R when it is really 1.25 R. So the engine had bias in both directions: optimistic on
signal quality, pessimistic on realised R. Neither was measurable before, since the money
ledger and the R ledger disagreed with each other.

**The intrabar assumption is worth about 16 R over this sample.** TP-first vs SL-first on
the same signals: +1.79 vs −14.06. That is the size of the "we assumed the target filled
before the stop" freebie, and it is the honest cost of not having sub-bar data.

**Costs are the finding that matters.** Going from gross to a flat 5 bps per side takes the
result from roughly break-even to −$343, with $325 of that being fees. The mechanism:

- Risk budget is 1% of equity ≈ $8/trade.
- Notional is capped by `capital_per_trade × leverage` = $150 × 10 = **$1,500**.
- Round-trip cost is ~10 bps of $1,500 ≈ **$1.40**, i.e. roughly **18% of the risk budget
  on every single trade**.
- At 232 trades over 125 days that compounds into a third of the account.

Max drawdown goes from 8.6% to 37% and win rate drops 4.7 points, because marginal winners
flip to losers once they have to clear the spread and fees.

## The conclusion to draw

On this sample the strategy has **no edge before costs** (PF 0.98–1.00, expectancy ≈ 0) and
is **decisively unprofitable after them**. The previous −$122.80 was not a mild loss that
tuning could fix; it was a number produced by three sources of look-ahead and a ledger that
did not reconcile with itself.

The engine is now measuring the right thing. The strategy itself needs work, and the
leverage between notional and risk budget is the first place to look: carrying $1,500 of
notional to risk $8 means the cost structure dominates the signal. Either the risk budget
goes up relative to notional, or the trade frequency comes down, or the entries have to
clear a much higher bar.

## Regression guard

`cargo test` in `src-rust/` enforces the properties behind these numbers:

- `backtest_is_prefix_stable` — running on `candles[..k]` reproduces the full run's trades
  exactly. This cannot pass if look-ahead returns.
- `every_indicator_is_prefix_stable` — same property, per indicator.
- `equity_reconciles_with_the_sum_of_trade_pnl` — one ledger, in dollars.
- `sl_first_is_never_more_profitable_than_tp_first` — the intrabar policy does what it says.
- `costs_reduce_pnl_monotonically` — the cost model is wired into every fill.
