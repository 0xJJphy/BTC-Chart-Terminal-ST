use crate::models::Candle;

pub fn calculate_atr(candles: &[Candle], period: usize) -> Vec<f64> {
    let mut atr = vec![0.0; candles.len()];
    if candles.len() <= period {
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

pub fn calculate_avg_volume(candles: &[Candle], period: usize) -> Vec<f64> {
    let mut avg_vol = vec![0.0; candles.len()];
    if candles.len() < period {
        return avg_vol;
    }

    let mut vol_sum: f64 = candles.iter().take(period).filter_map(|c| c.volume).sum();

    for i in period..candles.len() {
        avg_vol[i] = vol_sum / period as f64;
        if i < candles.len() - 1 {
            vol_sum -= candles[i - period + 1].volume.unwrap_or(0.0);
            vol_sum += candles[i + 1].volume.unwrap_or(0.0);
        }
    }

    avg_vol
}
