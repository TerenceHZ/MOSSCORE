import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startServer } = require('../server/index.cjs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '550c-smoke-'));
let server;

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}: ${text.slice(0, 200)}`);
  return data;
}

try {
  server = await startServer({ dataDir: tempDir, port: 0, host: '127.0.0.1', source: 'demo' });
  console.log('[1/6] server', server.url);

  const health = await json(`${server.url}/api/health`);
  if (!health.ok) throw new Error('health check failed');

  await json(`${server.url}/api/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'demo' }),
  });
  await sleep(1200);
  console.log('[2/6] demo feed switched');

  const state = await json(`${server.url}/api/state`);
  if (!Array.isArray(state.watchlist) || state.watchlist.length === 0) throw new Error('watchlist empty');

  const tickers = await json(`${server.url}/api/ticker?symbols=${state.watchlist.slice(0, 3).join(',')}`);
  if (!Array.isArray(tickers.tickers) || tickers.tickers.length === 0) throw new Error('ticker empty');
  console.log('[3/6] tickers', tickers.tickers.length);

  const klines = await json(`${server.url}/api/klines?symbol=BTCUSDT&interval=15m&limit=120`);
  if (!Array.isArray(klines.candles) || klines.candles.length === 0) throw new Error('klines empty');
  console.log('[4/6] candles', klines.candles.length);

  const search = await json(`${server.url}/api/search?q=BTC`);
  if (!Array.isArray(search.results) || search.results.length === 0) throw new Error('search empty');
  console.log('[5/6] search', search.results[0].symbol);

  const price = tickers.tickers[0].lastPrice;
  const alert = await json(`${server.url}/api/alerts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ symbol: tickers.tickers[0].symbol, type: 'price_above', threshold: price * 1.2, cooldown: 300 }),
  });
  if (!alert.alert || !alert.alert.id) throw new Error('alert create failed');

  const scan = await json(`${server.url}/api/signals/scan`, { method: 'POST' });
  console.log('[6/6] scan', scan.created, 'new signals');
  console.log('SMOKE OK');
} catch (error) {
  console.error('SMOKE FAILED:', error.message);
  process.exitCode = 1;
} finally {
  if (server) {
    try {
      await server.close();
    } catch {
      // Ignore shutdown errors in the smoke test.
    }
  }
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors.
  }
}
