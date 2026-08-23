use crate::models::Candle;

/// Exponential Moving Average (EMA)
pub fn calculate_ema(candles: &[Candle], period: usize) -> Vec<f64> {
    let mut ema = vec![0.0; candles.len()];
    if candles.is_empty() || period == 0 {
        return ema;
    }
    if candles.len() < period {
        let avg: f64 = candles.iter().map(|c| c.close).sum::<f64>() / candles.len() as f64;
        return vec![avg; candles.len()];
    }

    let k = 2.0 / (period as f64 + 1.0);
    let initial_sma: f64 = candles.iter().take(period).map(|c| c.close).sum::<f64>() / period as f64;
    ema[period - 1] = initial_sma;

    for i in 0..(period - 1) {
        ema[i] = initial_sma;
    }

    for i in period..candles.len() {
        ema[i] = candles[i].close * k + ema[i - 1] * (1.0 - k);
    }

    ema
}

/// Average True Range (ATR)
pub fn calculate_atr(candles: &[Candle], period: usize) -> Vec<f64> {
    let mut atr = vec![0.0; candles.len()];
    if candles.len() <= period || period == 0 {
        return atr;
    }

    let mut tr_sum = 0.0;
    for i in 1..=period {
        let high = candles[i].high;
        let low = candles[i].low;
        let prev_close = candles[i - 1].close;
        let tr = (high - low)
            .max((high - prev_close).abs())
            .max((low - prev_close).abs());
        tr_sum += tr;
    }

    atr[period] = tr_sum / period as f64;
    for i in 0..period {
        atr[i] = atr[period];
    }

    for i in (period + 1)..candles.len() {
        let high = candles[i].high;
        let low = candles[i].low;
        let prev_close = candles[i - 1].close;
        let tr = (high - low)
            .max((high - prev_close).abs())
            .max((low - prev_close).abs());
        atr[i] = (atr[i - 1] * (period - 1) as f64 + tr) / period as f64;
    }

    atr
}

/// Rolling Average Volume
pub fn calculate_avg_volume(candles: &[Candle], period: usize) -> Vec<f64> {
    let mut avg_vol = vec![0.0; candles.len()];
    if candles.len() < period || period == 0 {
        return avg_vol;
    }

    let mut vol_sum: f64 = candles.iter().take(period).filter_map(|c| c.volume).sum();

    for i in 0..period {
        avg_vol[i] = vol_sum / period as f64;
    }

    for i in period..candles.len() {
        avg_vol[i] = vol_sum / period as f64;
        if i < candles.len() - 1 {
            vol_sum -= candles[i - period + 1].volume.unwrap_or(0.0);
            vol_sum += candles[i + 1].volume.unwrap_or(0.0);
        }
    }

    avg_vol
}

/// Relative Strength Index (RSI) - Wilder's Smoothing
pub fn calculate_rsi(candles: &[Candle], period: usize) -> Vec<f64> {
    let mut rsi = vec![50.0; candles.len()];
    if candles.len() <= period || period == 0 {
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

    if avg_loss == 0.0 {
        rsi[period] = 100.0;
    } else {
        let rs = avg_gain / avg_loss;
        rsi[period] = 100.0 - (100.0 / (1.0 + rs));
    }

    for i in (period + 1)..candles.len() {
        let change = candles[i].close - candles[i - 1].close;
        let gain = if change > 0.0 { change } else { 0.0 };
        let loss = if change < 0.0 { -change } else { 0.0 };

        avg_gain = (avg_gain * (period - 1) as f64 + gain) / period as f64;
        avg_loss = (avg_loss * (period - 1) as f64 + loss) / period as f64;

        if avg_loss == 0.0 {
            rsi[i] = 100.0;
        } else {
            let rs = avg_gain / avg_loss;
            rsi[i] = 100.0 - (100.0 / (1.0 + rs));
        }
    }

    rsi
}

/// MACD Indicator (12, 26, 9)
#[derive(Debug, Clone)]
pub struct MacdResult {
    pub macd: Vec<f64>,
    pub signal: Vec<f64>,
    pub hist: Vec<f64>,
}

pub fn calculate_macd(candles: &[Candle], fast_period: usize, slow_period: usize, signal_period: usize) -> MacdResult {
    let fast_ema = calculate_ema(candles, fast_period);
    let slow_ema = calculate_ema(candles, slow_period);
    
    let mut macd_line = vec![0.0; candles.len()];
    for i in 0..candles.len() {
        macd_line[i] = fast_ema[i] - slow_ema[i];
    }

    // Signal is EMA of MACD Line
    let k = 2.0 / (signal_period as f64 + 1.0);
    let mut signal_line = vec![0.0; candles.len()];
    let mut hist = vec![0.0; candles.len()];

    if candles.len() >= slow_period + signal_period {
        let start_idx = slow_period;
        let init_slice = &macd_line[start_idx..(start_idx + signal_period)];
        let init_sma: f64 = init_slice.iter().sum::<f64>() / signal_period as f64;
        signal_line[start_idx + signal_period - 1] = init_sma;

        for i in (start_idx + signal_period)..candles.len() {
            signal_line[i] = macd_line[i] * k + signal_line[i - 1] * (1.0 - k);
            hist[i] = macd_line[i] - signal_line[i];
        }
    }

    MacdResult {
        macd: macd_line,
        signal: signal_line,
        hist,
    }
}

/// DMI and ADX (Directional Movement Index)
#[derive(Debug, Clone)]
pub struct DmiAdxResult {
    pub adx: Vec<f64>,
    pub di_plus: Vec<f64>,
    pub di_minus: Vec<f64>,
}

pub fn calculate_dmi_adx(candles: &[Candle], period: usize) -> DmiAdxResult {
    let n = candles.len();
    let mut di_plus = vec![0.0; n];
    let mut di_minus = vec![0.0; n];
    let mut adx = vec![0.0; n];

    if n <= period * 2 || period == 0 {
        return DmiAdxResult { adx, di_plus, di_minus };
    }

    let mut tr = vec![0.0; n];
    let mut plus_dm = vec![0.0; n];
    let mut minus_dm = vec![0.0; n];

    for i in 1..n {
        let h = candles[i].high;
        let l = candles[i].low;
        let prev_h = candles[i - 1].high;
        let prev_l = candles[i - 1].low;
        let prev_c = candles[i - 1].close;

        tr[i] = (h - l).max((h - prev_c).abs()).max((l - prev_c).abs());

        let up_move = h - prev_h;
        let down_move = prev_l - l;

        if up_move > down_move && up_move > 0.0 {
            plus_dm[i] = up_move;
        }
        if down_move > up_move && down_move > 0.0 {
            minus_dm[i] = down_move;
        }
    }

    let mut smooth_tr: f64 = tr[1..=period].iter().sum();
    let mut smooth_plus_dm: f64 = plus_dm[1..=period].iter().sum();
    let mut smooth_minus_dm: f64 = minus_dm[1..=period].iter().sum();

    let mut dx = vec![0.0; n];

    for i in period..n {
        if i > period {
            smooth_tr = smooth_tr - (smooth_tr / period as f64) + tr[i];
            smooth_plus_dm = smooth_plus_dm - (smooth_plus_dm / period as f64) + plus_dm[i];
            smooth_minus_dm = smooth_minus_dm - (smooth_minus_dm / period as f64) + minus_dm[i];
        }

        let p_di = if smooth_tr > 0.0 { (smooth_plus_dm / smooth_tr) * 100.0 } else { 0.0 };
        let m_di = if smooth_tr > 0.0 { (smooth_minus_dm / smooth_tr) * 100.0 } else { 0.0 };

        di_plus[i] = p_di;
        di_minus[i] = m_di;

        let di_sum = p_di + m_di;
        let di_diff = (p_di - m_di).abs();
        dx[i] = if di_sum > 0.0 { (di_diff / di_sum) * 100.0 } else { 0.0 };
    }

    let adx_start = period * 2;
    if n > adx_start {
        let mut smooth_adx: f64 = dx[period..adx_start].iter().sum::<f64>() / period as f64;
        adx[adx_start - 1] = smooth_adx;

        for i in adx_start..n {
            smooth_adx = (smooth_adx * (period - 1) as f64 + dx[i]) / period as f64;
            adx[i] = smooth_adx;
        }
    }

    DmiAdxResult { adx, di_plus, di_minus }
}

/// S/R Pivot Highs and Lows
#[derive(Debug, Clone)]
pub struct PivotLevel {
    pub time: u64,
    pub price: f64,
    pub is_high: bool,
}

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
            });
        }
        if is_pivot_low {
            pivots.push(PivotLevel {
                time: candles[i].time,
                price: curr_l,
                is_high: false,
            });
        }
    }

    pivots
}
