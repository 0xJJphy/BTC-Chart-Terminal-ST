use crate::models::Candle;

/// All indicator series in this module are **strictly causal**: the value at index `i`
/// is derived only from candles `0..=i`. Bars inside an indicator warm-up window are
/// `None` rather than being back-filled with a seed computed from future data (which is
/// what the previous implementation did, leaking look-ahead into the EMA-200 trend
/// filter for every bar before index 199).
pub type Series = Vec<Option<f64>>;

/// Exponential Moving Average (EMA).
///
/// Seeded with the SMA of the first `period` closes, published at index `period - 1`.
/// Everything before that is `None`.
pub fn calculate_ema(candles: &[Candle], period: usize) -> Series {
    let n = candles.len();
    let mut ema: Series = vec![None; n];
    if period == 0 || n < period {
        return ema;
    }

    let seed: f64 = candles.iter().take(period).map(|c| c.close).sum::<f64>() / period as f64;
    ema[period - 1] = Some(seed);

    let k = 2.0 / (period as f64 + 1.0);
    let mut prev = seed;
    for i in period..n {
        prev = candles[i].close * k + prev * (1.0 - k);
        ema[i] = Some(prev);
    }

    ema
}

/// True Range for bar `i` (requires `i >= 1`).
#[inline]
fn true_range(candles: &[Candle], i: usize) -> f64 {
    let h = candles[i].high;
    let l = candles[i].low;
    let prev_close = candles[i - 1].close;
    (h - l).max((h - prev_close).abs()).max((l - prev_close).abs())
}

/// Average True Range (ATR), Wilder smoothing.
///
/// TR is undefined at index 0, so the seed (mean of TR over `1..=period`) is published
/// at index `period`. Everything before that is `None`.
pub fn calculate_atr(candles: &[Candle], period: usize) -> Series {
    let n = candles.len();
    let mut atr: Series = vec![None; n];
    if period == 0 || n <= period {
        return atr;
    }

    let mut tr_sum = 0.0;
    for i in 1..=period {
        tr_sum += true_range(candles, i);
    }
    let mut prev = tr_sum / period as f64;
    atr[period] = Some(prev);

    for i in (period + 1)..n {
        prev = (prev * (period - 1) as f64 + true_range(candles, i)) / period as f64;
        atr[i] = Some(prev);
    }

    atr
}

/// Rolling simple moving average of volume over the window `[i - period + 1 ..= i]`.
///
/// Includes the current bar, which is legitimate because every decision in the strategy
/// is taken at bar close (where the bar's own volume is already known) and keeps volume
/// consistent with the OHLC of the same bar. The previous implementation held a
/// non-contiguous window that never dropped `v[0]`.
pub fn calculate_avg_volume(candles: &[Candle], period: usize) -> Series {
    let n = candles.len();
    let mut avg: Series = vec![None; n];
    if period == 0 || n < period {
        return avg;
    }

    let mut sum = 0.0;
    for i in 0..n {
        sum += candles[i].volume.unwrap_or(0.0);
        if i >= period {
            sum -= candles[i - period].volume.unwrap_or(0.0);
        }
        if i >= period - 1 {
            avg[i] = Some(sum / period as f64);
        }
    }

    avg
}

#[inline]
fn rsi_from(avg_gain: f64, avg_loss: f64) -> f64 {
    if avg_loss == 0.0 {
        if avg_gain == 0.0 { 50.0 } else { 100.0 }
    } else {
        let rs = avg_gain / avg_loss;
        100.0 - (100.0 / (1.0 + rs))
    }
}

/// Relative Strength Index (RSI), Wilder smoothing.
///
/// First value is published at index `period`.
pub fn calculate_rsi(candles: &[Candle], period: usize) -> Series {
    let n = candles.len();
    let mut rsi: Series = vec![None; n];
    if period == 0 || n <= period {
        return rsi;
    }

    let mut gains = 0.0;
    let mut losses = 0.0;
    for i in 1..=period {
        let change = candles[i].close - candles[i - 1].close;
        if change >= 0.0 {
            gains += change;
        } else {
            losses += -change;
        }
    }

    let mut avg_gain = gains / period as f64;
    let mut avg_loss = losses / period as f64;
    rsi[period] = Some(rsi_from(avg_gain, avg_loss));

    for i in (period + 1)..n {
        let change = candles[i].close - candles[i - 1].close;
        let gain = if change > 0.0 { change } else { 0.0 };
        let loss = if change < 0.0 { -change } else { 0.0 };

        avg_gain = (avg_gain * (period - 1) as f64 + gain) / period as f64;
        avg_loss = (avg_loss * (period - 1) as f64 + loss) / period as f64;
        rsi[i] = Some(rsi_from(avg_gain, avg_loss));
    }

    rsi
}

/// MACD indicator.
#[derive(Debug, Clone)]
pub struct MacdResult {
    pub macd: Series,
    pub signal: Series,
    pub hist: Series,
}

/// MACD (fast, slow, signal).
///
/// The MACD line starts at `slow_period - 1` (where both EMAs exist). The signal line is
/// an EMA of the MACD line seeded with its SMA, so it starts `signal_period - 1` bars
/// later. The histogram is only defined where the signal line is.
pub fn calculate_macd(
    candles: &[Candle],
    fast_period: usize,
    slow_period: usize,
    signal_period: usize,
) -> MacdResult {
    let n = candles.len();
    let fast_ema = calculate_ema(candles, fast_period);
    let slow_ema = calculate_ema(candles, slow_period);

    let mut macd_line: Series = vec![None; n];
    for i in 0..n {
        if let (Some(f), Some(s)) = (fast_ema[i], slow_ema[i]) {
            macd_line[i] = Some(f - s);
        }
    }

    let mut signal_line: Series = vec![None; n];
    let mut hist: Series = vec![None; n];

    let macd_start = match macd_line.iter().position(|v| v.is_some()) {
        Some(idx) => idx,
        None => return MacdResult { macd: macd_line, signal: signal_line, hist },
    };

    if signal_period == 0 || n < macd_start + signal_period {
        return MacdResult { macd: macd_line, signal: signal_line, hist };
    }

    let seed_end = macd_start + signal_period; // exclusive
    let seed: f64 = macd_line[macd_start..seed_end]
        .iter()
        .map(|v| v.unwrap_or(0.0))
        .sum::<f64>()
        / signal_period as f64;

    let signal_seed_idx = seed_end - 1;
    signal_line[signal_seed_idx] = Some(seed);
    hist[signal_seed_idx] = Some(macd_line[signal_seed_idx].unwrap_or(0.0) - seed);

    let k = 2.0 / (signal_period as f64 + 1.0);
    let mut prev = seed;
    for i in seed_end..n {
        let m = macd_line[i].unwrap_or(0.0);
        prev = m * k + prev * (1.0 - k);
        signal_line[i] = Some(prev);
        hist[i] = Some(m - prev);
    }

    MacdResult { macd: macd_line, signal: signal_line, hist }
}

/// DMI and ADX (Directional Movement Index).
#[derive(Debug, Clone)]
pub struct DmiAdxResult {
    pub adx: Series,
    pub di_plus: Series,
    pub di_minus: Series,
}

/// Wilder DMI/ADX. +DI/-DI start at index `period`; ADX starts at `period * 2 - 1`.
pub fn calculate_dmi_adx(candles: &[Candle], period: usize) -> DmiAdxResult {
    let n = candles.len();
    let mut di_plus: Series = vec![None; n];
    let mut di_minus: Series = vec![None; n];
    let mut adx: Series = vec![None; n];

    if period == 0 || n <= period * 2 {
        return DmiAdxResult { adx, di_plus, di_minus };
    }

    let mut tr = vec![0.0; n];
    let mut plus_dm = vec![0.0; n];
    let mut minus_dm = vec![0.0; n];

    for i in 1..n {
        tr[i] = true_range(candles, i);

        let up_move = candles[i].high - candles[i - 1].high;
        let down_move = candles[i - 1].low - candles[i].low;

        if up_move > down_move && up_move > 0.0 {
            plus_dm[i] = up_move;
        }
        if down_move > up_move && down_move > 0.0 {
            minus_dm[i] = down_move;
        }
    }

    let mut smooth_tr: f64 = tr[1..=period].iter().sum();
    let mut smooth_plus: f64 = plus_dm[1..=period].iter().sum();
    let mut smooth_minus: f64 = minus_dm[1..=period].iter().sum();

    let mut dx = vec![0.0; n];

    for i in period..n {
        if i > period {
            smooth_tr = smooth_tr - (smooth_tr / period as f64) + tr[i];
            smooth_plus = smooth_plus - (smooth_plus / period as f64) + plus_dm[i];
            smooth_minus = smooth_minus - (smooth_minus / period as f64) + minus_dm[i];
        }

        let p_di = if smooth_tr > 0.0 { (smooth_plus / smooth_tr) * 100.0 } else { 0.0 };
        let m_di = if smooth_tr > 0.0 { (smooth_minus / smooth_tr) * 100.0 } else { 0.0 };

        di_plus[i] = Some(p_di);
        di_minus[i] = Some(m_di);

        let di_sum = p_di + m_di;
        dx[i] = if di_sum > 0.0 { ((p_di - m_di).abs() / di_sum) * 100.0 } else { 0.0 };
    }

    // ADX seeds with the mean of the first `period` DX values (indices `period..=period*2-1`),
    // published at index `period * 2 - 1`.
    let adx_seed_idx = period * 2 - 1;
    let mut smooth_adx: f64 = dx[period..=adx_seed_idx].iter().sum::<f64>() / period as f64;
    adx[adx_seed_idx] = Some(smooth_adx);

    for i in (adx_seed_idx + 1)..n {
        smooth_adx = (smooth_adx * (period - 1) as f64 + dx[i]) / period as f64;
        adx[i] = Some(smooth_adx);
    }

    DmiAdxResult { adx, di_plus, di_minus }
}

/// A confirmed swing high or low.
#[derive(Debug, Clone)]
pub struct PivotLevel {
    pub time: u64,
    pub price: f64,
    pub is_high: bool,
    /// Index of the candle at which this pivot first becomes knowable (`bar_index + right`).
    /// A pivot at bar `i` needs `right` bars to its right before it can be confirmed, so no
    /// decision taken before this index may consult it.
    pub confirmed_at_index: usize,
    /// Index of the candle that forms the pivot.
    pub bar_index: usize,
}

/// S/R pivot highs and lows, in ascending order of `confirmed_at_index`.
pub fn calculate_pivots(candles: &[Candle], left: usize, right: usize) -> Vec<PivotLevel> {
    let mut pivots = Vec::new();
    if candles.len() < left + right + 1 {
        return pivots;
    }

    for i in left..(candles.len() - right) {
        let curr_h = candles[i].high;
        let curr_l = candles[i].low;

        let mut is_pivot_high = true;
        let mut is_pivot_low = true;

        for k in 1..=left {
            if candles[i - k].high >= curr_h { is_pivot_high = false; }
            if candles[i - k].low <= curr_l { is_pivot_low = false; }
        }
        for k in 1..=right {
            if candles[i + k].high > curr_h { is_pivot_high = false; }
            if candles[i + k].low < curr_l { is_pivot_low = false; }
        }

        if is_pivot_high {
            pivots.push(PivotLevel {
                time: candles[i].time,
                price: curr_h,
                is_high: true,
                confirmed_at_index: i + right,
                bar_index: i,
            });
        }
        if is_pivot_low {
            pivots.push(PivotLevel {
                time: candles[i].time,
                price: curr_l,
                is_high: false,
                confirmed_at_index: i + right,
                bar_index: i,
            });
        }
    }

    // `bar_index` is ascending and `right` is constant, so `confirmed_at_index` is ascending
    // too. The incremental pivot cursor in crypto_pro relies on this ordering.
    pivots
}
