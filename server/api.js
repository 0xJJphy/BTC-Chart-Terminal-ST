import http from 'node:http';
import url from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import duckdb from 'duckdb';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// DB Pools
const dbConfigBase = {
    host: process.env.GLI_DB_HOST || '127.0.0.1',
    port: parseInt(process.env.GLI_DB_PORT || '5433', 10),
    user: process.env.GLI_DB_USER || 'gli_user',
    password: process.env.GLI_DB_PASSWORD || 'password',
    max: 10,
    idleTimeoutMillis: 30000,
};

export const poolAltScraper = new Pool({
    ...dbConfigBase,
    database: process.env.GLI_DB_ALT_SCRAPER || 'alt_scraper',
});

export const poolDashboard = new Pool({
    ...dbConfigBase,
    database: process.env.GLI_DB_DASHBOARD || 'gli_dashboard',
});

// DuckDB In-Memory Instance for Parquet Reading
export const duckInstance = new duckdb.Database(':memory:');

const PARQUET_DIR = process.env.GLI_PARQUET_KLINES_1M || 'C:/Users/Pedro/Documents/GitHub/GLI-CLI-Estimation/backend/research/data/binance_klines1m';
const PARQUET_SPOT_DIR = process.env.GLI_PARQUET_SPOT_1M || 'C:/Users/Pedro/Documents/GitHub/GLI-CLI-Estimation/backend/research/data/binance_spot_klines1m';

function serializeBigInt(obj) {
    return JSON.parse(
        JSON.stringify(obj, (key, value) =>
            typeof value === 'bigint' ? Number(value) : value
        )
    );
}

function sendJson(res, statusCode, data) {
    const payload = JSON.stringify(serializeBigInt(data));
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(payload);
}

function queryDuck(sql) {
    return new Promise((resolve, reject) => {
        duckInstance.all(sql, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

export async function handleApiRequest(req, res) {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        return res.end();
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname.replace(/^\/api/, '');
    const query = parsedUrl.query;

    try {
        // 1. Health & Connection Status
        if (pathname === '/health' || pathname === '') {
            let altDbOk = false;
            let dashDbOk = false;
            let parquetCount = 0;

            try {
                const r = await poolAltScraper.query('SELECT 1 as ok');
                altDbOk = r.rows[0].ok === 1;
            } catch (e) {
                console.error('[API] AltScraper DB Error:', e.message);
            }

            try {
                const r = await poolDashboard.query('SELECT 1 as ok');
                dashDbOk = r.rows[0].ok === 1;
            } catch (e) {
                console.error('[API] Dashboard DB Error:', e.message);
            }

            if (fs.existsSync(PARQUET_DIR)) {
                parquetCount = fs.readdirSync(PARQUET_DIR).filter(f => f.endsWith('.parquet')).length;
            }

            return sendJson(res, 200, {
                status: 'online',
                databases: {
                    alt_scraper: altDbOk ? 'connected' : 'error',
                    gli_dashboard: dashDbOk ? 'connected' : 'error',
                },
                parquet_storage: {
                    path: PARQUET_DIR,
                    files_count: parquetCount,
                },
            });
        }

        // 2. 15m DB Klines (alt_scraper: futures_klines_15m)
        if (pathname === '/db/klines') {
            const symbol = (query.symbol || 'BTCUSDT').toUpperCase();
            const exchange = (query.exchange || 'binance').toLowerCase();
            const limit = Math.min(parseInt(query.limit || '5000', 10), 50000);
            const startTime = query.startTime ? new Date(parseInt(query.startTime, 10)) : null;
            const endTime = query.endTime ? new Date(parseInt(query.endTime, 10)) : null;

            let sql = `
                SELECT 
                    EXTRACT(EPOCH FROM candle_open_at)::BIGINT as time,
                    price_open::FLOAT as open,
                    price_high::FLOAT as high,
                    price_low::FLOAT as low,
                    price_close::FLOAT as close,
                    volume_base::FLOAT as volume,
                    volume_usd::FLOAT as volume_usd,
                    volume_delta::FLOAT as volume_delta,
                    txn_count::BIGINT as txn_count
                FROM futures_klines_15m
                WHERE symbol = $1 AND exchange = $2
            `;
            const params = [symbol, exchange];
            let paramIdx = 3;

            if (startTime) {
                sql += ` AND candle_open_at >= $${paramIdx++}`;
                params.push(startTime);
            }
            if (endTime) {
                sql += ` AND candle_open_at <= $${paramIdx++}`;
                params.push(endTime);
            }

            sql += ` ORDER BY candle_open_at DESC LIMIT $${paramIdx}`;
            params.push(limit);

            const result = await poolAltScraper.query(sql, params);
            // Reverse so they are chronological (oldest to newest)
            const candles = result.rows.reverse();

            return sendJson(res, 200, {
                symbol,
                exchange,
                count: candles.length,
                candles,
            });
        }

        // 3. Metrics: Long/Short Ratio, OI, Funding, Liquidations
        if (pathname === '/db/metrics/futures') {
            const symbol = (query.symbol || 'BTCUSDT').toUpperCase();
            const exchange = query.exchange ? query.exchange.toLowerCase() : null;
            const limit = Math.min(parseInt(query.limit || '500', 10), 2000);

            let sql = `
                SELECT 
                    date,
                    symbol,
                    exchange,
                    ls_ratio::FLOAT,
                    ls_acc_global::FLOAT,
                    ls_acc_top::FLOAT,
                    ls_pos_top::FLOAT,
                    oi_usd_close::FLOAT as oi_usd,
                    funding_close::FLOAT as funding,
                    pred_funding_close::FLOAT as pred_funding,
                    liq_longs::FLOAT,
                    liq_shorts::FLOAT,
                    liq_total::FLOAT,
                    volume_delta::FLOAT
                FROM futures_daily_metrics
                WHERE symbol = $1
            `;
            const params = [symbol];
            if (exchange) {
                sql += ` AND exchange = $2 ORDER BY date DESC LIMIT $3`;
                params.push(exchange, limit);
            } else {
                sql += ` ORDER BY date DESC LIMIT $2`;
                params.push(limit);
            }

            const result = await poolAltScraper.query(sql, params);
            return sendJson(res, 200, {
                symbol,
                count: result.rows.length,
                metrics: result.rows.reverse(),
            });
        }

        // 4. Hyperliquid OHLCV & Context (gli_dashboard)
        if (pathname === '/db/hyperliquid/klines') {
            const coin = (query.coin || 'BTC').toUpperCase();
            const table = query.interval === '5m' ? 'market_data.hl_ohlcv_5m' : 'market_data.hl_ohlcv';
            const limit = Math.min(parseInt(query.limit || '5000', 10), 20000);

            const sql = `
                SELECT 
                    EXTRACT(EPOCH FROM timestamp)::BIGINT as time,
                    open,
                    high,
                    low,
                    close,
                    volume
                FROM ${table}
                WHERE coin = $1
                ORDER BY timestamp DESC
                LIMIT $2
            `;
            const result = await poolDashboard.query(sql, [coin, limit]);
            return sendJson(res, 200, {
                coin,
                count: result.rows.length,
                candles: result.rows.reverse(),
            });
        }

        // 5. Hyperliquid Context & Institutional Levels
        if (pathname === '/db/hyperliquid/context') {
            const coin = (query.coin || 'BTC').toUpperCase();
            const ctxSql = `
                SELECT * FROM market_data.hl_perp_ctx 
                WHERE coin = $1 
                ORDER BY snapshot_at DESC 
                LIMIT 1
            `;
            const summarySql = `
                SELECT * FROM market_data.hyperliquid_daily_summary 
                ORDER BY date DESC 
                LIMIT 1
            `;
            const [ctxRes, summaryRes] = await Promise.all([
                poolDashboard.query(ctxSql, [coin]),
                poolDashboard.query(summarySql),
            ]);

            return sendJson(res, 200, {
                coin,
                perp_context: ctxRes.rows[0] || null,
                daily_summary: summaryRes.rows[0] || null,
            });
        }

        // 6. Deribit Greeks & Gamma Profile (gli_dashboard)
        if (pathname === '/db/deribit/greeks') {
            const sql = `
                SELECT 
                    snapshot_date,
                    expiry_date,
                    dte,
                    oi_btc::FLOAT,
                    gex::FLOAT,
                    dex::FLOAT,
                    vex::FLOAT,
                    tex::FLOAT,
                    call_gex::FLOAT,
                    put_gex::FLOAT,
                    gamma_profile,
                    delta_profile
                FROM market_data.deribit_expiry_greeks
                ORDER BY snapshot_date DESC, expiry_date ASC
                LIMIT 50
            `;
            const result = await poolDashboard.query(sql);
            return sendJson(res, 200, {
                count: result.rows.length,
                greeks: result.rows,
            });
        }

        // 7. Parquet Files Listing
        if (pathname === '/parquet/files') {
            const symbol = (query.symbol || 'BTCUSDT').toUpperCase();
            const targetDir = query.type === 'spot' ? PARQUET_SPOT_DIR : PARQUET_DIR;

            if (!fs.existsSync(targetDir)) {
                return sendJson(res, 404, { error: `Directory not found: ${targetDir}` });
            }

            const files = fs.readdirSync(targetDir)
                .filter(f => f.startsWith(symbol) && f.endsWith('.parquet'))
                .sort();

            return sendJson(res, 200, {
                symbol,
                type: query.type || 'futures',
                total_files: files.length,
                files,
            });
        }

        // 8. 1m Parquet Klines Reader (via DuckDB)
        if (pathname === '/parquet/klines') {
            const symbol = (query.symbol || 'BTCUSDT').toUpperCase();
            const month = query.month || 'current'; // e.g. "2026-07" or "current"
            const limit = Math.min(parseInt(query.limit || '10000', 10), 100000);
            const targetDir = query.type === 'spot' ? PARQUET_SPOT_DIR : PARQUET_DIR;
            
            const normalizedDir = targetDir.replace(/\\/g, '/');
            const filePath = `${normalizedDir}/${symbol}_${month}.parquet`;

            if (!fs.existsSync(filePath)) {
                return sendJson(res, 404, { error: `Parquet file not found: ${filePath}` });
            }

            const sql = `
                SELECT 
                    (open_time / 1000)::BIGINT as time,
                    open::FLOAT as open,
                    high::FLOAT as high,
                    low::FLOAT as low,
                    close::FLOAT as close,
                    volume::FLOAT as volume,
                    quote_volume::FLOAT as quote_volume,
                    count::BIGINT as txn_count,
                    taker_buy_volume::FLOAT as taker_buy_volume,
                    taker_buy_quote_volume::FLOAT as taker_buy_quote_volume
                FROM '${filePath}'
                ORDER BY open_time ASC
                LIMIT ${limit}
            `;

            const rows = await queryDuck(sql);
            return sendJson(res, 200, {
                symbol,
                month,
                count: rows.length,
                candles: rows,
            });
        }

        // Not Found
        sendJson(res, 404, { error: `Endpoint not found: ${pathname}` });
    } catch (err) {
        console.error('[API Handler Error]:', err);
        sendJson(res, 500, { error: err.message });
    }
}

// Standalone Server Entry
if (process.argv[1] && (process.argv[1].endsWith('api.js') || process.argv[1].includes('server'))) {
    const PORT = parseInt(process.env.API_PORT || '3001', 10);
    const server = http.createServer(handleApiRequest);
    server.listen(PORT, () => {
        console.log(`\n======================================================`);
        console.log(`🚀 BTC Quant Terminal Local API running at:`);
        console.log(`   http://localhost:${PORT}/api/health`);
        console.log(`   Connected DBs: alt_scraper, gli_dashboard (Port ${process.env.GLI_DB_PORT || 5433})`);
        console.log(`   Parquet Engine: DuckDB active`);
        console.log(`======================================================\n`);
    });
}
