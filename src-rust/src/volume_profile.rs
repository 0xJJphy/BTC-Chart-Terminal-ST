use serde::{Deserialize, Serialize};
use crate::models::Candle;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VolumeBin {
    pub price: f64,
    pub total_volume: f64,
    pub buy_volume: f64,
    pub sell_volume: f64,
    pub delta: f64,
    pub is_value_area: bool,
    pub is_poc: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VolumeProfileResult {
    pub poc_price: f64,
    pub poc_volume: f64,
    pub vah_price: f64,
    pub val_price: f64,
    pub total_volume: f64,
    pub total_delta: f64,
    pub bins: Vec<VolumeBin>,
}

pub fn calculate_volume_profile(candles: &[Candle], num_bins: usize) -> VolumeProfileResult {
    if candles.is_empty() {
        return VolumeProfileResult {
            poc_price: 0.0,
            poc_volume: 0.0,
            vah_price: 0.0,
            val_price: 0.0,
            total_volume: 0.0,
            total_delta: 0.0,
            bins: vec![],
        };
    }

    let bins_count = if num_bins == 0 { 50 } else { num_bins.min(200) };

    let mut min_price = f64::MAX;
    let mut max_price = f64::MIN;
    let mut total_vol = 0.0;
    let mut total_delta = 0.0;

    for c in candles {
        if c.low < min_price { min_price = c.low; }
        if c.high > max_price { max_price = c.high; }
        let vol = c.volume.unwrap_or(1.0);
        total_vol += vol;
        let d = c.delta.unwrap_or(0.0);
        total_delta += d;
    }

    if min_price >= max_price {
        max_price = min_price + 1.0;
    }

    let price_range = max_price - min_price;
    let bin_size = price_range / bins_count as f64;

    let mut bin_total_vols = vec![0.0; bins_count];
    let mut bin_buy_vols = vec![0.0; bins_count];
    let mut bin_sell_vols = vec![0.0; bins_count];
    let mut bin_deltas = vec![0.0; bins_count];

    for c in candles {
        let vol = c.volume.unwrap_or(1.0);
        let buy_vol = c.buy_volume.unwrap_or(vol * 0.5);
        let sell_vol = c.sell_volume.unwrap_or(vol * 0.5);
        let delta = c.delta.unwrap_or(buy_vol - sell_vol);

        let start_bin = (((c.low - min_price) / bin_size).floor() as usize).min(bins_count - 1);
        let end_bin = (((c.high - min_price) / bin_size).floor() as usize).min(bins_count - 1);

        let touched_bins = (end_bin - start_bin + 1) as f64;
        let vol_per_bin = vol / touched_bins;
        let buy_per_bin = buy_vol / touched_bins;
        let sell_per_bin = sell_vol / touched_bins;
        let delta_per_bin = delta / touched_bins;

        for b in start_bin..=end_bin {
            bin_total_vols[b] += vol_per_bin;
            bin_buy_vols[b] += buy_per_bin;
            bin_sell_vols[b] += sell_per_bin;
            bin_deltas[b] += delta_per_bin;
        }
    }

    // Find Point of Control (POC)
    let mut max_bin_vol = 0.0;
    let mut poc_idx = 0;
    for (i, &v) in bin_total_vols.iter().enumerate() {
        if v > max_bin_vol {
            max_bin_vol = v;
            poc_idx = i;
        }
    }

    // Compute Value Area (70% standard)
    let target_va_vol = total_vol * 0.70;
    let mut va_vol = max_bin_vol;
    let mut va_low_idx = poc_idx;
    let mut va_high_idx = poc_idx;

    while va_vol < target_va_vol && (va_low_idx > 0 || va_high_idx < bins_count - 1) {
        let next_above_vol = if va_high_idx < bins_count - 1 { bin_total_vols[va_high_idx + 1] } else { 0.0 };
        let next_below_vol = if va_low_idx > 0 { bin_total_vols[va_low_idx - 1] } else { 0.0 };

        if next_above_vol >= next_below_vol && va_high_idx < bins_count - 1 {
            va_high_idx += 1;
            va_vol += next_above_vol;
        } else if va_low_idx > 0 {
            va_low_idx -= 1;
            va_vol += next_below_vol;
        } else if va_high_idx < bins_count - 1 {
            va_high_idx += 1;
            va_vol += next_above_vol;
        } else {
            break;
        }
    }

    let poc_price = min_price + (poc_idx as f64 + 0.5) * bin_size;
    let vah_price = min_price + (va_high_idx as f64 + 1.0) * bin_size;
    let val_price = min_price + (va_low_idx as f64) * bin_size;

    let mut bins = Vec::with_capacity(bins_count);
    for i in 0..bins_count {
        let price = min_price + (i as f64 + 0.5) * bin_size;
        bins.push(VolumeBin {
            price,
            total_volume: bin_total_vols[i],
            buy_volume: bin_buy_vols[i],
            sell_volume: bin_sell_vols[i],
            delta: bin_deltas[i],
            is_value_area: i >= va_low_idx && i <= va_high_idx,
            is_poc: i == poc_idx,
        });
    }

    VolumeProfileResult {
        poc_price,
        poc_volume: max_bin_vol,
        vah_price,
        val_price,
        total_volume: total_vol,
        total_delta,
        bins,
    }
}
