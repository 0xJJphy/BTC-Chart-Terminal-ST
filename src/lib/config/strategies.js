/**
 * Strategy and engine configuration.
 *
 * Single source of truth for the CryptoPRO parameters. They used to be written out twice,
 * verbatim, inside `app_controller.js` (once in `manualRefresh`, once in
 * `executeStrategy`), which meant the live dashboard and the backtest could silently drift
 * apart. Everything now reads from here, and the UI edits `state.strategyParams`.
 *
 * Keys are camelCase to match the serde `rename_all = "camelCase"` contract on the Rust
 * structs. The Rust side has `#[serde(default)]`, so omitting a field is safe.
 */

export const COST_MODES = [
    {
        id: 'realistic',
        label: 'Realista (taker/maker + funding)',
        hint: 'Entrada a mercado con taker, TPs como limit con maker, SL a mercado con slippage, y funding prorrateado. Es el modelo correcto para perpetuos.',
    },
    {
        id: 'flat',
        label: 'Fee plano (bps por lado)',
        hint: 'Un único cargo en bps aplicado a cada fill. Suficiente para comparar estrategias entre sí.',
    },
    {
        id: 'none',
        label: 'Bruto (sin costes)',
        hint: 'PnL sin costes. Úsalo junto al análisis de sensibilidad para ver cuánto margen tiene el edge.',
    },
];

export const INTRABAR_POLICIES = [
    {
        id: 'sl_first',
        label: 'SL primero (conservador)',
        hint: 'En una vela que toca objetivo y stop, se asume que saltó el stop. Es la hipótesis honesta cuando no hay datos intra-vela.',
    },
    {
        id: 'nearest_open',
        label: 'El más cercano a la apertura',
        hint: 'Se asume que se alcanzó primero el nivel que estaba más cerca del open de la vela.',
    },
    {
        id: 'tp_first',
        label: 'TP primero (optimista)',
        hint: 'Se asume que se alcanzó primero el objetivo. Infla los resultados; es lo que hacía el motor antiguo de forma implícita.',
    },
];

/** Defaults mirroring `CryptoProConfig::default()` in src-rust/src/crypto_pro.rs. */
export const DEFAULT_CRYPTO_PRO = {
    // Signal
    emaFast: 50,
    emaSlow: 200,
    rsiLength: 14,
    adxLength: 14,
    pivotLeft: 6,
    pivotRight: 6,
    srLookbackPivots: 20,
    volumeLength: 20,
    highVolume: 1.5,
    veryHighVolume: 2.0,
    minimumScore: 65,

    // Retest
    waitForRetest: true,
    minPullbackAtr: 0.3,
    maxPullbackAtr: 1.5,
    maxWaitBars: 8,
    requireRecoveryCandle: true,

    // Risk / targets
    atrLength: 14,
    atrMultiplier: 1.5,
    maxSlAtr: 2.5,
    rrTp1: 1.0,
    rrTp2: 2.0,
    rrTp3: 3.0,
    tp1Fraction: 0.5,
    tp2Fraction: 0.25,

    // Capital
    initialCapital: 1000,
    capitalPerTrade: 150,
    leverage: 10,
    riskPercent: 1.0,
    compoundCapital: false,
    compoundPercent: 15,
    maintenanceMarginPct: 0.5,

    // Execution
    intrabarPolicy: 'sl_first',
    maxTradesPerDay: 3,
    cooldownBars: 6,
    costs: {
        mode: 'realistic',
        perSideBps: 5.0,
        takerBps: 4.5,
        makerBps: 1.8,
        slippageBps: 1.0,
        fundingBps8h: 1.0,
    },

    // Reporting
    analysisDays: 15,
};

/** Defaults mirroring `MetricsConfig::default()` in src-rust/src/metrics.rs. */
export const DEFAULT_METRICS = {
    initialCapital: 1000,
    riskFreeRate: 0.0,
    // 365, not 252: crypto perpetuals trade every day of the year.
    periodsPerYear: 365,
    bootstrapIterations: 5000,
    monteCarloIterations: 5000,
    ruinThresholdPct: 50,
    trialsTested: 1,
    oosFraction: 0.3,
    fallbackRiskUsd: 100,
    // Must stay under 2^53 so JSON keeps it an exact integer for serde u64.
    seed: 987654321,
};

/**
 * Editable parameter schema driving the Strategy Lab form.
 * `group` buckets fields into collapsible sections; `step`/`min`/`max` bound the inputs.
 */
export const PARAM_SCHEMA = [
    // --- Señal ---
    { key: 'minimumScore', group: 'Señal', label: 'Score mínimo', type: 'number', min: 0, max: 100, step: 5,
      hint: 'Confluencia mínima (sobre 100) para considerar un setup.' },
    { key: 'emaFast', group: 'Señal', label: 'EMA rápida', type: 'number', min: 5, max: 400, step: 1 },
    { key: 'emaSlow', group: 'Señal', label: 'EMA lenta', type: 'number', min: 10, max: 800, step: 1 },
    { key: 'adxLength', group: 'Señal', label: 'Periodo ADX', type: 'number', min: 5, max: 60, step: 1 },
    { key: 'rsiLength', group: 'Señal', label: 'Periodo RSI', type: 'number', min: 2, max: 60, step: 1 },
    { key: 'volumeLength', group: 'Señal', label: 'Media de volumen', type: 'number', min: 2, max: 200, step: 1 },
    { key: 'highVolume', group: 'Señal', label: 'Volumen alto (x)', type: 'number', min: 1, max: 5, step: 0.1 },
    { key: 'pivotLeft', group: 'Señal', label: 'Pivote izq.', type: 'number', min: 1, max: 30, step: 1 },
    { key: 'pivotRight', group: 'Señal', label: 'Pivote der.', type: 'number', min: 1, max: 30, step: 1,
      hint: 'Un pivote no se confirma hasta que pasan estas velas. El motor no lo usa antes.' },
    { key: 'srLookbackPivots', group: 'Señal', label: 'Pivotes en el libro S/R', type: 'number', min: 1, max: 200, step: 1 },

    // --- Retest ---
    { key: 'waitForRetest', group: 'Retest', label: 'Esperar retest', type: 'boolean' },
    { key: 'requireRecoveryCandle', group: 'Retest', label: 'Exigir vela de recuperación', type: 'boolean' },
    { key: 'minPullbackAtr', group: 'Retest', label: 'Pullback mín. (ATR)', type: 'number', min: 0, max: 5, step: 0.05 },
    { key: 'maxPullbackAtr', group: 'Retest', label: 'Pullback máx. (ATR)', type: 'number', min: 0.1, max: 10, step: 0.05 },
    { key: 'maxWaitBars', group: 'Retest', label: 'Velas máx. de espera', type: 'number', min: 1, max: 100, step: 1 },

    // --- Riesgo ---
    { key: 'riskPercent', group: 'Riesgo', label: 'Riesgo por trade (%)', type: 'number', min: 0.05, max: 10, step: 0.05,
      hint: 'Ahora sí dimensiona la posición: qty = (equity x riesgo%) / distancia al stop.' },
    { key: 'atrLength', group: 'Riesgo', label: 'Periodo ATR', type: 'number', min: 2, max: 100, step: 1 },
    { key: 'atrMultiplier', group: 'Riesgo', label: 'Multiplicador ATR del SL', type: 'number', min: 0.1, max: 10, step: 0.1 },
    { key: 'maxSlAtr', group: 'Riesgo', label: 'SL máximo (ATR)', type: 'number', min: 0.1, max: 20, step: 0.1 },
    { key: 'rrTp1', group: 'Riesgo', label: 'R:R de TP1', type: 'number', min: 0.1, max: 20, step: 0.1 },
    { key: 'rrTp2', group: 'Riesgo', label: 'R:R de TP2', type: 'number', min: 0.1, max: 20, step: 0.1 },
    { key: 'rrTp3', group: 'Riesgo', label: 'R:R de TP3', type: 'number', min: 0.1, max: 20, step: 0.1 },
    { key: 'tp1Fraction', group: 'Riesgo', label: 'Cierre en TP1', type: 'number', min: 0, max: 1, step: 0.05 },
    { key: 'tp2Fraction', group: 'Riesgo', label: 'Cierre en TP2', type: 'number', min: 0, max: 1, step: 0.05 },

    // --- Capital ---
    { key: 'initialCapital', group: 'Capital', label: 'Capital inicial ($)', type: 'number', min: 10, max: 10000000, step: 100 },
    { key: 'capitalPerTrade', group: 'Capital', label: 'Margen por trade ($)', type: 'number', min: 1, max: 1000000, step: 10,
      hint: 'Tope de nocional = margen x apalancamiento. Si es alto frente al riesgo%, los costes dominan.' },
    { key: 'leverage', group: 'Capital', label: 'Apalancamiento', type: 'number', min: 1, max: 125, step: 1 },
    { key: 'maintenanceMarginPct', group: 'Capital', label: 'Margen de mantenimiento (%)', type: 'number', min: 0, max: 10, step: 0.1 },
    { key: 'compoundCapital', group: 'Capital', label: 'Componer capital', type: 'boolean' },
    { key: 'compoundPercent', group: 'Capital', label: 'Composición (%)', type: 'number', min: 1, max: 100, step: 1 },

    // --- Ejecución ---
    { key: 'intrabarPolicy', group: 'Ejecución', label: 'Resolución intra-vela', type: 'select', options: INTRABAR_POLICIES },
    { key: 'maxTradesPerDay', group: 'Ejecución', label: 'Trades máx. por día', type: 'number', min: 1, max: 50, step: 1 },
    { key: 'cooldownBars', group: 'Ejecución', label: 'Enfriamiento (velas)', type: 'number', min: 0, max: 200, step: 1 },
];

export const PARAM_GROUPS = ['Señal', 'Retest', 'Riesgo', 'Capital', 'Ejecución'];

/** Deep clone of the defaults, safe to mutate. */
export function defaultStrategyParams() {
    return structuredClone(DEFAULT_CRYPTO_PRO);
}

/**
 * Merge user params over the defaults, so a partially-populated store never sends an
 * incomplete config to the engine.
 */
export function resolveStrategyConfig(params = {}) {
    return {
        ...DEFAULT_CRYPTO_PRO,
        ...params,
        costs: { ...DEFAULT_CRYPTO_PRO.costs, ...(params.costs || {}) },
    };
}

/** Metrics config derived from the strategy config, so capital never disagrees. */
export function resolveMetricsConfig(strategyParams = {}, overrides = {}) {
    const strategy = resolveStrategyConfig(strategyParams);
    return {
        ...DEFAULT_METRICS,
        initialCapital: strategy.initialCapital,
        ...overrides,
    };
}

/** Cost sweep points for the sensitivity panel, in bps per side. */
export const COST_SWEEP_BPS = [0, 1, 2, 3, 4, 5, 7.5, 10, 12.5, 15, 20];
