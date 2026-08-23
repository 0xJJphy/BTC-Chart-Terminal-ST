use serde::{Deserialize, Serialize};
use crate::models::Candle;

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AnchorPeriod {
    None,
    Daily,
    Weekly,
    Monthly,
    Quarterly,
    Yearly,
}

impl Default for AnchorPeriod {
    fn default() -> Self {
        AnchorPeriod::Daily
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CvdPoint {
    pub time: u64,
    pub cvd: f64,
    pub delta: f64,
    pub rel_delta: f64,      // Delta / Volume (-1.0 to +1.0)
    pub cvd_sma: f64,
    pub z_score: f64,        // Standardized rolling Z-Score
    pub upper_band: f64,     // +2 Std Dev
    pub lower_band: f64,     // -2 Std Dev
    pub is_anchor_reset: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CvdDivergence {
    pub time: u64,
    pub price: f64,
    #[serde(rename = "type")]
    pub div_type: String,    // "BULLISH_ABSORPTION", "BEARISH_ABSORPTION"
    pub strength: f64,
    pub z_score: f64,
    pub desc: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CvdAnalysisResult {
    pub anchor: String,
    pub points: Vec<CvdPoint>,
    pub divergences: Vec<CvdDivergence>,
    pub current_cvd: f64,
    pub current_z_score: f64,
    pub cvd_trend: String,   // "ACCUMULATION", "DISTRIBUTION", "NEUTRAL"
    pub drift_bias: f64,     // Mean delta drift per candle
}

fn should_reset_anchor(curr_time: u64, prev_time: u64, anchor: AnchorPeriod) -> bool {
    if prev_time == 0 { return false; }
    match anchor {
        AnchorPeriod::None => false,
        AnchorPeriod::Daily => {
            (curr_time / 86400) != (prev_time / 86400)
        }
        AnchorPeriod::Weekly => {
            // 1970-01-01 was Thursday (+345600 to align to Monday 00:00 UTC)
            ((curr_time + 345600) / 604800) != ((prev_time + 345600) / 604800)
        }
        AnchorPeriod::Monthly => {
            // Approx 30.4375 days per month check or 2629743s
            let curr_month = (curr_time / 2629743) as u64;
            let prev_month = (prev_time / 2629743) as u64;
            curr_month != prev_month
        }
        AnchorPeriod::Quarterly => {
            let curr_q = (curr_time / (2629743 * 3)) as u64;
            let prev_q = (prev_time / (2629743 * 3)) as u64;
            curr_q != prev_q
        }
        AnchorPeriod::Yearly => {
            (curr_time / 31536000) != (prev_time / 31536000)
        }
    }
}

pub fn analyze_anchored_cvd(
    candles: &[Candle], 
    anchor_str: &str, 
    sma_period: usize, 
    div_lookback: usize
) -> CvdAnalysisResult {
    if candles.is_empty() {
        return CvdAnalysisResult {
            anchor: anchor_str.to_string(),
            points: vec![],
            divergences: vec![],
            current_cvd: 0.0,
            current_z_score: 0.0,
            cvd_trend: "NEUTRAL".to_string(),
            drift_bias: 0.0,
        };
    }

    let anchor = match anchor_str.to_lowercase().as_str() {
        "daily" | "d" => AnchorPeriod::Daily,
        "weekly" | "w" => AnchorPeriod::Weekly,
        "monthly" | "m" => AnchorPeriod::Monthly,
        "quarterly" | "q" => AnchorPeriod::Quarterly,
        "yearly" | "y" => AnchorPeriod::Yearly,
        _ => AnchorPeriod::Daily, // Default to daily anchor for robust institutional sessions
    };

    let period = if sma_period == 0 { 20 } else { sma_period };
    let lookback = if div_lookback == 0 { 24 } else { div_lookback };

    let mut points = Vec::with_capacity(candles.len());
    let mut running_cvd = 0.0;
    let mut cvd_values = Vec::with_capacity(candles.len());
    let mut total_delta = 0.0;

    let mut prev_time = 0;

    for candle in candles {
        let is_reset = should_reset_anchor(candle.time, prev_time, anchor);
        if is_reset {
            running_cvd = 0.0; // Reset anchor
        }

        let vol = candle.volume.unwrap_or(1.0).max(0.0001);
        let delta = if let Some(d) = candle.delta {
            d
        } else if let (Some(bv), Some(sv)) = (candle.buy_volume, candle.sell_volume) {
            bv - sv
        } else {
            if candle.close >= candle.open { vol * 0.25 } else { -vol * 0.25 }
        };

        let rel_delta = (delta / vol).clamp(-1.0, 1.0);
        running_cvd += delta;
        total_delta += delta;
        cvd_values.push(running_cvd);

        // Rolling Statistics: Mean and Standard Deviation for Z-Score Bands
        let window_start = if cvd_values.len() >= period { cvd_values.len() - period } else { 0 };
        let window = &cvd_values[window_start..];
        let cvd_sma: f64 = window.iter().sum::<f64>() / window.len() as f64;

        let variance: f64 = window.iter().map(|&x| {
            let diff = x - cvd_sma;
            diff * diff
        }).sum::<f64>() / window.len() as f64;
        let std_dev = variance.sqrt().max(0.0001);

        let z_score = (running_cvd - cvd_sma) / std_dev;
        let upper_band = cvd_sma + 2.0 * std_dev;
        let lower_band = cvd_sma - 2.0 * std_dev;

        points.push(CvdPoint {
            time: candle.time,
            cvd: running_cvd,
            delta,
            rel_delta,
            cvd_sma,
            z_score,
            upper_band,
            lower_band,
            is_anchor_reset: is_reset,
        });

        prev_time = candle.time;
    }

    let drift_bias = total_delta / candles.len() as f64;

    // Statistically-Filtered Divergence Detection
    let mut divergences = Vec::new();
    if candles.len() > lookback + 5 {
        for i in (lookback + 2)..(candles.len() - 1) {
            let curr_c = &candles[i];
            let curr_cvd = cvd_values[i];
            let curr_z = points[i].z_score;

            // Local Price Low Pivot
            let is_price_low = curr_c.low <= candles[i - 1].low && curr_c.low <= candles[i + 1].low;
            if is_price_low {
                let window_start = i.saturating_sub(lookback);
                for j in window_start..(i - 2) {
                    let prev_c = &candles[j];
                    let prev_cvd = cvd_values[j];
                    let is_prev_low = prev_c.low <= candles[j - 1].low && prev_c.low <= candles[j + 1].low;

                    if is_prev_low {
                        // Bullish Divergence: Price Lower Low + CVD Higher Low
                        // Enhanced Filter: Require CVD Z-Score not excessively overbought
                        if curr_c.low < prev_c.low && curr_cvd > prev_cvd && curr_z < 1.5 {
                            let strength = ((curr_cvd - prev_cvd).abs() / (prev_cvd.abs() + 1.0)).min(1.0);
                            divergences.push(CvdDivergence {
                                time: curr_c.time,
                                price: curr_c.low,
                                div_type: "BULLISH_ABSORPTION".to_string(),
                                strength,
                                z_score: curr_z,
                                desc: format!("Bullish Absorption (Anchor: {}): Price Lower Low vs aCVD Higher Low (Z: {:.2})", anchor_str, curr_z),
                            });
                            break;
                        }
                    }
                }
            }

            // Local Price High Pivot
            let is_price_high = curr_c.high >= candles[i - 1].high && curr_c.high >= candles[i + 1].high;
            if is_price_high {
                let window_start = i.saturating_sub(lookback);
                for j in window_start..(i - 2) {
                    let prev_c = &candles[j];
                    let prev_cvd = cvd_values[j];
                    let is_prev_high = prev_c.high >= candles[j - 1].high && prev_c.high >= candles[j + 1].high;

                    if is_prev_high {
                        // Bearish Divergence: Price Higher High + CVD Lower High
                        // Filter: To overcome natural negative delta bias, require statistically verified exhaustion (Z-score > -1.0)
                        if curr_c.high > prev_c.high && curr_cvd < prev_cvd && curr_z > -1.5 {
                            let strength = ((prev_cvd - curr_cvd).abs() / (prev_cvd.abs() + 1.0)).min(1.0);
                            divergences.push(CvdDivergence {
                                time: curr_c.time,
                                price: curr_c.high,
                                div_type: "BEARISH_ABSORPTION".to_string(),
                                strength,
                                z_score: curr_z,
                                desc: format!("Bearish Absorption (Anchor: {}): Price Higher High vs aCVD Lower High (Z: {:.2})", anchor_str, curr_z),
                            });
                            break;
                        }
                    }
                }
            }
        }
    }

    let last_pt = points.last().cloned().unwrap_or(CvdPoint {
        time: 0, cvd: 0.0, delta: 0.0, rel_delta: 0.0, cvd_sma: 0.0, z_score: 0.0, upper_band: 0.0, lower_band: 0.0, is_anchor_reset: false
    });

    let cvd_trend = if last_pt.z_score > 1.0 {
        "STRONG_ACCUMULATION".to_string()
    } else if last_pt.z_score > 0.3 {
        "ACCUMULATION".to_string()
    } else if last_pt.z_score < -1.0 {
        "STRONG_DISTRIBUTION".to_string()
    } else if last_pt.z_score < -0.3 {
        "DISTRIBUTION".to_string()
    } else {
        "NEUTRAL".to_string()
    };

    CvdAnalysisResult {
        anchor: anchor_str.to_string(),
        points,
        divergences,
        current_cvd: last_pt.cvd,
        current_z_score: last_pt.z_score,
        cvd_trend,
        drift_bias,
    }
}
