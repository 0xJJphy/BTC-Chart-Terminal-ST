use crate::models::Candle;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrendLine {
    pub id: String,
    pub start_idx: usize,
    pub end_idx: usize,
    pub start_price: f64,
    pub end_price: f64,
    pub slope: f64,
    #[serde(rename = "type")]
    pub line_type: String, // "UP", "DOWN"
    pub status: String,    // "ACTIVE", "BROKEN"
    pub break_index: Option<usize>,
    pub touch_indices: Vec<usize>,
}

pub fn calculate_trend_lines(candles: &[Candle]) -> Vec<TrendLine> {
    let mut lines = Vec::new();
    if candles.len() < 50 { return lines; }

    // Detección simplificada de pivotes para las líneas
    let mut highs = Vec::new();
    let mut lows = Vec::new();
    let window = 5;

    for i in window..(candles.len() - window) {
        let mut is_high = true;
        let mut is_low = true;
        for j in 1..=window {
            if candles[i-j].high > candles[i].high || candles[i+j].high > candles[i].high { is_high = false; }
            if candles[i-j].low < candles[i].low || candles[i+j].low < candles[i].low { is_low = false; }
        }
        if is_high { highs.push(i); }
        if is_low { lows.push(i); }
    }

    // Generar líneas de tendencia bajistas (conectando máximos)
    for i in 0..highs.len().saturating_sub(1) {
        for j in (i+1)..highs.len() {
            let idx1 = highs[i];
            let idx2 = highs[j];
            if idx2 - idx1 < 20 { continue; }

            let slope = (candles[idx2].high - candles[idx1].high) / (idx2 - idx1) as f64;
            if slope >= 0.0 { continue; } // Buscamos líneas descendentes

            let mut valid = true;
            let mut touches = vec![idx1, idx2];
            
            for k in (idx1 + 1)..idx2 {
                if candles[k].high > candles[idx1].high + slope * (k - idx1) as f64 {
                    valid = false;
                    break;
                }
            }

            if valid {
                let mut status = "ACTIVE".to_string();
                let mut break_idx = None;
                for k in (idx2 + 1)..candles.len() {
                    if candles[k].close > candles[idx1].high + slope * (k - idx1) as f64 {
                        status = "BROKEN".to_string();
                        break_idx = Some(k);
                        break;
                    }
                }

                lines.push(TrendLine {
                    id: format!("tl-down-{}-{}", idx1, idx2),
                    start_idx: idx1,
                    end_idx: idx2,
                    start_price: candles[idx1].high,
                    end_price: candles[idx2].high,
                    slope,
                    line_type: "DOWN".to_string(),
                    status,
                    break_index: break_idx,
                    touch_indices: touches,
                });
                break; // Solo una línea por pivote inicial para evitar ruido
            }
        }
    }

    lines
}
