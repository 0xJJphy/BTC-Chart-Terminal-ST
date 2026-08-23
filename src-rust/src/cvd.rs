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
    pub cvd_trend: String,
    pub drift_bias: f64,
    pub der: f64,                  // Delta Efficiency Ratio
    pub fragility_index: f64,      // Liquidity Fragility Index (Psi)
    pub adr: f64,                  // Average Daily/Session Range
    pub adv: f64,                  // Average Daily/Session Volume
    pub session_range: f64,
    pub session_delta: f64,
    pub market_regime: String,     // "PASSIVE_ABSORPTION", "LIQUIDITY_VACUUM", "EFFICIENT_TREND", "COMPRESSION"
    pub regime_description: String,
}

fn should_reset_anchor(curr_time: u64, prev_time: u64, anchor: AnchorPeriod) -> bool {
    if prev_time == 0 { return false; }
    match anchor {
        AnchorPeriod::None => false,
        AnchorPeriod::Daily => {
            (curr_time / 86400) != (prev_time / 86400)
        }
        AnchorPeriod::Weekly => {
            ((curr_time + 345600) / 604800) != ((prev_time + 345600) / 604800)
        }
        AnchorPeriod::Monthly => {
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
            der: 0.0,
            fragility_index: 1.0,
            adr: 0.0,
            adv: 0.0,
            session_range: 0.0,
            session_delta: 0.0,
            market_regime: "COMPRESSION".to_string(),
            regime_description: "Sin datos suficientes".to_string(),
        };
    }

    let anchor = match anchor_str.to_lowercase().as_str() {
        "daily" | "d" => AnchorPeriod::Daily,
        "weekly" | "w" => AnchorPeriod::Weekly,
        "monthly" | "m" => AnchorPeriod::Monthly,
        "quarterly" | "q" => AnchorPeriod::Quarterly,
        "yearly" | "y" => AnchorPeriod::Yearly,
        _ => AnchorPeriod::Daily,
    };

    let period = if sma_period == 0 { 20 } else { sma_period };
    let lookback = if div_lookback == 0 { 24 } else { div_lookback };

    let mut points = Vec::with_capacity(candles.len());
    let mut running_cvd = 0.0;
    let mut cvd_values = Vec::with_capacity(candles.len());
    let mut total_delta = 0.0;
    let mut prev_time = 0;

    let mut session_start_idx = 0;

    for (idx, candle) in candles.iter().enumerate() {
        let is_reset = should_reset_anchor(candle.time, prev_time, anchor);
        if is_reset {
            running_cvd = 0.0; // Reset anchor
            session_start_idx = idx;
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

    // --- QUANTITATIVE ADR, ADV, DER & FRAGILITY CALCULATIONS ---
    let session_candles = &candles[session_start_idx..];
    let session_high = session_candles.iter().map(|c| c.high).fold(f64::MIN, f64::max);
    let session_low = session_candles.iter().map(|c| c.low).fold(f64::MAX, f64::min);
    let session_range = (session_high - session_low).max(0.01);
    let session_delta = running_cvd;

    // Baseline ADR & ADV across lookback
    let base_lookback = candles.len().min(100);
    let base_slice = &candles[(candles.len() - base_lookback)..];
    let adr: f64 = base_slice.iter().map(|c| c.high - c.low).sum::<f64>() / base_lookback as f64;
    let adv: f64 = base_slice.iter().map(|c| c.volume.unwrap_or(0.0)).sum::<f64>() / base_lookback as f64;

    let norm_range = session_range / adr.max(0.01);
    let norm_delta = (session_delta.abs() / adv.max(0.01)).max(0.001);

    // Delta Efficiency Ratio (DER): Price shift per unit of normalized delta
    let der = session_range / (session_delta.abs().max(1.0));

    // Liquidity Fragility Index (Psi): High range with small delta => Thin Book / Vacuum
    let fragility_index = norm_range / norm_delta;

    // Classification of Microstructure Regimes
    let (market_regime, regime_description) = if fragility_index > 2.2 && norm_range > 1.1 {
        (
            "LIQUIDITY_VACUUM".to_string(),
            "Vacío de Liquidez (Thin Book): Alto desplazamiento de precio con Delta reducido. Riesgo de reversión violenta / Stop Hunt.".to_string(),
        )
    } else if fragility_index < 0.45 && session_delta.abs() > (adv * 0.8) {
        (
            "PASSIVE_ABSORPTION".to_string(),
            "Absorción Pasiva (Iceberg Walls): Delta extremo contenido en rango estrecho. Acumulación/Distribución institucional masiva.".to_string(),
        )
    } else if norm_range > 1.2 && norm_delta > 1.0 {
        (
            "EFFICIENT_TREND".to_string(),
            "Tendencia Eficiente: Expansión de rango respaldada por flujo direccional agresivo.".to_string(),
        )
    } else {
        (
            "COMPRESSION".to_string(),
            "Compresión / Equilibrio: Rango y delta dentro de parámetros estadísticos normales de subasta.".to_string(),
        )
    };

    // Divergence detection
    let mut divergences = Vec::new();
    if candles.len() > lookback + 5 {
        for i in (lookback + 2)..(candles.len() - 1) {
            let curr_c = &candles[i];
            let curr_cvd = cvd_values[i];
            let curr_z = points[i].z_score;

            let is_price_low = curr_c.low <= candles[i - 1].low && curr_c.low <= candles[i + 1].low;
            if is_price_low {
                let window_start = i.saturating_sub(lookback);
                for j in window_start..(i - 2) {
                    let prev_c = &candles[j];
                    let prev_cvd = cvd_values[j];
                    let is_prev_low = prev_c.low <= candles[j - 1].low && prev_c.low <= candles[j + 1].low;

                    if is_prev_low {
                        if curr_c.low < prev_c.low && curr_cvd > prev_cvd && curr_z < 1.5 {
                            let strength = ((curr_cvd - prev_cvd).abs() / (prev_cvd.abs() + 1.0)).min(1.0);
                            divergences.push(CvdDivergence {
                                time: curr_c.time,
                                price: curr_c.low,
                                div_type: "BULLISH_ABSORPTION".to_string(),
                                strength,
                                z_score: curr_z,
                                desc: format!("Bullish Absorption ({:?}): Price Lower Low vs aCVD Higher Low (Z: {:.2})", anchor, curr_z),
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
                        if curr_c.high > prev_c.high && curr_cvd < prev_cvd && curr_z > -1.5 {
                            let strength = ((prev_cvd - curr_cvd).abs() / (prev_cvd.abs() + 1.0)).min(1.0);
                            divergences.push(CvdDivergence {
                                time: curr_c.time,
                                price: curr_c.high,
                                div_type: "BEARISH_ABSORPTION".to_string(),
                                strength,
                                z_score: curr_z,
                                desc: format!("Bearish Absorption ({:?}): Price Higher High vs aCVD Lower High (Z: {:.2})", anchor, curr_z),
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
        der,
        fragility_index,
        adr,
        adv,
        session_range,
        session_delta,
        market_regime,
        regime_description,
    }
}
