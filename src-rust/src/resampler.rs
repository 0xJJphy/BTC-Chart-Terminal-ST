use crate::models::Candle;

pub fn resample_candles(candles: &[Candle], target_seconds: u64) -> Vec<Candle> {
    if candles.is_empty() || target_seconds == 0 {
        return candles.to_vec();
    }

    let mut resampled: Vec<Candle> = Vec::new();
    let mut current_bucket: Option<Candle> = None;
    let mut current_bucket_time: u64 = 0;

    for c in candles {
        let bucket_time = (c.time / target_seconds) * target_seconds;

        match current_bucket.as_mut() {
            Some(curr) if bucket_time == current_bucket_time => {
                // Update existing bucket
                if c.high > curr.high { curr.high = c.high; }
                if c.low < curr.low { curr.low = c.low; }
                curr.close = c.close;
                curr.volume = Some(curr.volume.unwrap_or(0.0) + c.volume.unwrap_or(0.0));
                curr.delta = Some(curr.delta.unwrap_or(0.0) + c.delta.unwrap_or(0.0));
                curr.buy_volume = Some(curr.buy_volume.unwrap_or(0.0) + c.buy_volume.unwrap_or(0.0));
                curr.sell_volume = Some(curr.sell_volume.unwrap_or(0.0) + c.sell_volume.unwrap_or(0.0));
                curr.txn_count = Some(curr.txn_count.unwrap_or(0) + c.txn_count.unwrap_or(0));
            }
            _ => {
                // Push completed bucket
                if let Some(prev) = current_bucket.take() {
                    resampled.push(prev);
                }

                // Start new bucket
                current_bucket_time = bucket_time;
                current_bucket = Some(Candle {
                    time: bucket_time,
                    open: c.open,
                    high: c.high,
                    low: c.low,
                    close: c.close,
                    volume: c.volume,
                    delta: c.delta,
                    buy_volume: c.buy_volume,
                    sell_volume: c.sell_volume,
                    txn_count: c.txn_count,
                });
            }
        }
    }

    if let Some(last) = current_bucket {
        resampled.push(last);
    }

    resampled
}
