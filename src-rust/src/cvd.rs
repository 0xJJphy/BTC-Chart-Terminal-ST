use serde::{Deserialize, Serialize};
use crate::models::Candle;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CvdPoint {
    pub time: u64,
    pub cvd: f64,
    pub delta: f64,
    pub cvd_sma: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CvdDivergence {
    pub time: u64,
    pub price: f64,
    #[serde(rename = "type")]
    pub div_type: String, // "BULLISH_ABSORPTION" (Long), "BEARISH_ABSORPTION" (Short)
    pub strength: f64,
    pub desc: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CvdAnalysisResult {
    pub points: Vec<CvdPoint>,
    pub divergences: Vec<CvdDivergence>,
    pub current_cvd: f64,
    pub cvd_trend: String, // "ACCUMULATION", "DISTRIBUTION", "NEUTRAL"
}

pub fn analyze_cvd(candles: &[Candle], sma_period: usize, div_lookback: usize) -> CvdAnalysisResult {
    if candles.is_empty() {
        return CvdAnalysisResult {
            points: vec![],
            divergences: vec![],
            current_cvd: 0.0,
            cvd_trend: "NEUTRAL".to_string(),
        };
    }

    let period = if sma_period == 0 { 14 } else { sma_period };
    let lookback = if div_lookback == 0 { 20 } else { div_lookback };

    let mut points = Vec::with_capacity(candles.len());
    let mut running_cvd = 0.0;
    let mut cvd_values = Vec::with_capacity(candles.len());

    for candle in candles {
        let delta = if let Some(d) = candle.delta {
            d
        } else if let (Some(bv), Some(sv)) = (candle.buy_volume, candle.sell_volume) {
            bv - sv
        } else {
            let vol = candle.volume.unwrap_or(1.0);
            if candle.close >= candle.open {
                vol * 0.25
            } else {
                -vol * 0.25
            }
        };

        running_cvd += delta;
        cvd_values.push(running_cvd);

        let window_start = if cvd_values.len() >= period {
            cvd_values.len() - period
        } else {
            0
        };
        let window = &cvd_values[window_start..];
        let cvd_sma: f64 = window.iter().sum::<f64>() / window.len() as f64;

        points.push(CvdPoint {
            time: candle.time,
            cvd: running_cvd,
            delta,
            cvd_sma,
        });
    }

    let mut divergences = Vec::new();
    if candles.len() > lookback + 5 {
        for i in (lookback + 2)..(candles.len() - 1) {
            let curr_c = &candles[i];
            let curr_cvd = cvd_values[i];

            let is_price_low = curr_c.low <= candles[i - 1].low && curr_c.low <= candles[i + 1].low;
            if is_price_low {
                let window_start = i.saturating_sub(lookback);
                for j in window_start..(i - 2) {
                    let prev_c = &candles[j];
                    let prev_cvd = cvd_values[j];
                    let is_prev_low = prev_c.low <= candles[j - 1].low && prev_c.low <= candles[j + 1].low;

                    if is_prev_low {
                        if curr_c.low < prev_c.low && curr_cvd > prev_cvd {
                            let diff = (curr_cvd - prev_cvd).abs();
                            divergences.push(CvdDivergence {
                                time: curr_c.time,
                                price: curr_c.low,
                                div_type: "BULLISH_ABSORPTION".to_string(),
                                strength: (diff / (prev_cvd.abs() + 1.0)).min(1.0),
                                desc: format!("Bullish Absorption: Price Lower Low vs CVD Higher Low (+{:.2} delta)", diff),
                            });
                            break;
                        }
                    }
                }
            }

            let is_price_high = curr_c.high >= candles[i - 1].high && curr_c.high >= candles[i + 1].high;
            if is_price_high {
                let window_start = i.saturating_sub(lookback);
                for j in window_start..(i - 2) {
                    let prev_c = &candles[j];
                    let prev_cvd = cvd_values[j];
                    let is_prev_high = prev_c.high >= candles[j - 1].high && prev_c.high >= candles[j + 1].high;

                    if is_prev_high {
                        if curr_c.high > prev_c.high && curr_cvd < prev_cvd {
                            let diff = (prev_cvd - curr_cvd).abs();
                            divergences.push(CvdDivergence {
                                time: curr_c.time,
                                price: curr_c.high,
                                div_type: "BEARISH_ABSORPTION".to_string(),
                                strength: (diff / (prev_cvd.abs() + 1.0)).min(1.0),
                                desc: format!("Bearish Absorption: Price Higher High vs CVD Lower High (-{:.2} delta)", diff),
                            });
                            break;
                        }
                    }
                }
            }
        }
    }

    let cvd_trend = if points.len() >= 10 {
        let last = points.last().unwrap().cvd;
        let prev = points[points.len() - 10].cvd;
        if last > prev * 1.02 {
            "ACCUMULATION".to_string()
        } else if last < prev * 0.98 {
            "DISTRIBUTION".to_string()
        } else {
            "NEUTRAL".to_string()
        }
    } else {
        "NEUTRAL".to_string()
    };

    CvdAnalysisResult {
        points,
        divergences,
        current_cvd: running_cvd,
        cvd_trend,
    }
}
