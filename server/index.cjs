'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { Store, THEMES, SOURCES } = require('./store.cjs');
const { SseHub } = require('./sse.cjs');
const { FeedManager } = require('./feed.cjs');
const { AlertEngine } = require('./alerts.cjs');
const { SignalScanner } = require('./signals.cjs');
const { NewsService } = require('./news.cjs');
const {
  VALID_INTERVALS,
  HttpError,
  normalizeSymbol,
  deepMerge,
  isPlainObject,
} = require('./util.cjs');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const VERSION = require('../package.json').version;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function baseHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
}

function sendJson(res, status, body) {
  baseHeaders(res);
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function sendError(res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  if (status >= 500) console.error('[550C] API 错误：', error && error.stack ? error.stack : error);
  sendJson(res, status, {
    error: error && error.message ? error.message : '内部错误',
    details: error && error.details ? error.details : undefined,
  });
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128 * 1024) throw new HttpError(413, '请求体过大');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON');
  }
}

function ensureSymbol(value) {
  const symbol = normalizeSymbol(value);
  if (!/^[A-Z0-9]{2,16}USDT$/.test(symbol) || symbol.length > 20) {
    throw new HttpError(400, '请输入 USDT 交易对，例如 BTCUSDT');
  }
  return symbol;
}

function ensureInterval(value) {
  if (!VALID_INTERVALS.includes(value)) throw new HttpError(400, 'K 线周期不合法');
  return value;
}

function normalizeAlertInput(body, watchlist) {
  const symbol = ensureSymbol(body.symbol);
  if (!watchlist.includes(symbol)) throw new HttpError(400, '该币种不在监控列表中');
  const types = ['price_above', 'price_below', 'change_above', 'change_below'];
  if (!types.includes(body.type)) throw new HttpError(400, '预警类型不合法');
  const threshold = Number(body.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0) throw new HttpError(400, '阈值必须大于 0');
  const cooldown = Math.round(Number(body.cooldown) || 900);
  return {
    id: `al_${crypto.randomUUID()}`,
    symbol,
    type: body.type,
    threshold,
    enabled: body.enabled !== false,
    armed: true,
    cooldown: Math.max(60, Math.min(86_400, cooldown)),
    lastTriggeredAt: null,
    lastPrice: null,
    createdAt: new Date().toISOString(),
  };
}

function applySettings(current, patch) {
  if (!isPlainObject(patch)) throw new HttpError(400, '设置格式不合法');
  const next = { ...current };
  if ('theme' in patch) {
    if (!THEMES.has(patch.theme)) throw new HttpError(400, '主题不合法');
    next.theme = patch.theme;
  }
  if ('source' in patch) {
    if (!SOURCES.has(patch.source)) throw new HttpError(400, '行情源不合法');
    next.source = patch.source;
  }
  if ('binanceBase' in patch) {
    const base = String(patch.binanceBase || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s]+$/i.test(base)) throw new HttpError(400, '行情地址必须是 http(s) URL');
    next.binanceBase = base;
  }
  if ('pollMs' in patch) {
    next.pollMs = Math.max(1000, Math.min(15_000, Math.round(Number(patch.pollMs) || 2000)));
  }
  for (const key of ['sound', 'desktopNotifications', 'alertsMuted', 'minimizeToTray', 'launchAtLogin', 'newsEnabled', 'autoScan']) {
    if (key in patch) next[key] = Boolean(patch[key]);
  }
  if (isPlainObject(patch.effects)) next.effects = deepMerge(current.effects, patch.effects);
  if (isPlainObject(patch.chart)) {
    next.chart = deepMerge(current.chart, patch.chart);
    if (!VALID_INTERVALS.includes(next.chart.interval)) next.chart.interval = '15m';
    next.chart.indicators = deepMerge(current.chart.indicators, patch.chart.indicators || {});
  }
  return next;
}

function checkOrigin(req, port) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.host === req.headers.host) return true;
    if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && Number(url.port) === port) return true;
    return false;
  } catch {
    return false;
  }
}

function serveStatic(req, res, pathname) {
  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, '路径不合法');
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  let filePath = path.resolve(PUBLIC_DIR, relative);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    throw new HttpError(403, '禁止访问');
  }
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new HttpError(404, '页面不存在');
  }
  if (stat.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    try {
      stat = fs.statSync(filePath);
    } catch {
      throw new HttpError(404, '页面不存在');
    }
  }
  baseHeaders(res);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

async function createContext(options) {
  const store = new Store(options.dataDir);
  if (options.source && SOURCES.has(options.source)) {
    store.data.settings.source = options.source;
    store.save();
  }
  const hub = new SseHub();
  const onNotify = typeof options.onNotify === 'function' ? options.onNotify : null;
  let news = null;
  const alerts = new AlertEngine({ store, hub, onNotify });
  const feed = new FeedManager({
    store,
    onTickers: (tickers) => {
      alerts.check(tickers, store.settings);
      hub.broadcast('tickers', tickers);
    },
    onStatus: (status) => {
      hub.broadcast('status', {
        ...status,
        news: news ? news.getStatus() : null,
      });
    },
  });
  const scanner = new SignalScanner({ store, feed, hub });
  news = new NewsService({ store, hub });

  return { store, hub, alerts, feed, scanner, news, onNotify, desktop: Boolean(options.desktop) };
}

async function startServer(options = {}) {
  const dataDir = options.dataDir || process.env.APP_DATA_DIR || path.join(process.cwd(), 'data');
  const host = options.host || process.env.HOST || '127.0.0.1';
  const port = options.port === undefined ? Number(process.env.PORT || 0) : Number(options.port);
  const context = await createContext({ ...options, dataDir });
  const { store, hub, alerts, feed, scanner, news } = context;
  const startedAt = Date.now();

  const server = http.createServer((req, res) => {
    handleRequest(req, res, context, server, startedAt).catch((error) => {
      if (res.headersSent) {
        try {
          res.end();
        } catch {
          // Socket already closed.
        }
        return;
      }
      sendError(res, error);
    });
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.on('error', (error) => {
    console.error('[550C] HTTP 服务错误：', error.message);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const actualPort = server.address().port;
  feed.start();
  scanner.start();
  news.start();

  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actualPort}`;

  return {
    port: actualPort,
    url,
    version: VERSION,
    getSettings: () => ({ ...store.settings }),
    setSettings: (patch) => {
      store.data.settings = applySettings(store.settings, patch);
      store.save();
      return store.settings;
    },
    getDataDir: () => dataDir,
    async close() {
      feed.stop();
      scanner.stop();
      news.stop();
      hub.close();
      await store.flush();
      await new Promise((resolve) => {
        server.close(() => resolve());
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      });
    },
    _context: context,
  };
}

async function handleRequest(req, res, context, server, startedAt) {
  const { store, hub, alerts, feed, scanner, news } = context;
  const host = req.headers.host || '127.0.0.1';
  let url;
  try {
    url = new URL(req.url, `http://${host}`);
  } catch {
    throw new HttpError(400, '请求地址不合法');
  }
  const pathname = url.pathname;
  const method = req.method || 'GET';
  const port = server.address() ? server.address().port : 0;

  if (pathname === '/api/events') {
    if (method !== 'GET') throw new HttpError(405, '方法不允许');
    hub.add(req, res);
    return;
  }

  if (pathname.startsWith('/api/')) {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && !checkOrigin(req, port)) {
      throw new HttpError(403, '请求来源不合法');
    }

    if (pathname === '/api/health' && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        version: VERSION,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        source: feed.getStatus(),
        news: news.getStatus(),
        clients: hub.size,
        desktop: context.desktop,
      });
      return;
    }

    if (pathname === '/api/state' && method === 'GET') {
      sendJson(res, 200, {
        version: VERSION,
        serverTime: Date.now(),
        desktop: context.desktop,
        watchlist: store.data.watchlist,
        alerts: store.data.alerts,
        signals: store.data.signals.slice(0, 80),
        notifications: store.data.notifications.slice(0, 30),
        news: store.data.news.slice(0, 60),
        settings: store.settings,
        source: feed.getStatus(),
        newsStatus: news.getStatus(),
      });
      return;
    }

    if (pathname === '/api/ticker' && method === 'GET') {
      const raw = url.searchParams.get('symbols');
      const symbols = raw ? raw.split(',').map(ensureSymbol) : [...store.data.watchlist];
      try {
        const tickers = await feed.getTickers(symbols);
        sendJson(res, 200, { tickers });
      } catch (error) {
        throw new HttpError(502, `行情获取失败：${error.message}`);
      }
      return;
    }

    if (pathname === '/api/klines' && method === 'GET') {
      const symbol = ensureSymbol(url.searchParams.get('symbol'));
      const interval = ensureInterval(url.searchParams.get('interval') || '15m');
      const limit = Math.max(20, Math.min(1000, Number(url.searchParams.get('limit')) || 320));
      try {
        const candles = await feed.getKlines(symbol, interval, limit);
        sendJson(res, 200, { symbol, interval, candles });
      } catch (error) {
        throw new HttpError(502, `K 线获取失败：${error.message}`);
      }
      return;
    }

    if (pathname === '/api/search' && method === 'GET') {
      const q = String(url.searchParams.get('q') || '').slice(0, 24);
      const results = await feed.search(q);
      sendJson(res, 200, { results });
      return;
    }

    if (pathname === '/api/watchlist' && method === 'POST') {
      const body = await readJson(req);
      const symbol = ensureSymbol(body.symbol);
      if (store.data.watchlist.includes(symbol)) {
        sendJson(res, 200, { watchlist: store.data.watchlist, added: false });
        return;
      }
      if (store.data.watchlist.length >= 50) throw new HttpError(400, '监控列表最多 50 个币种');
      try {
        const valid = await feed.validateSymbol(symbol);
        if (!valid) throw new HttpError(400, `${symbol} 不是当前行情源支持的现货交易对`);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, `暂时无法校验交易对：${error.message}`);
      }
      store.data.watchlist.push(symbol);
      store.save();
      feed.refresh();
      sendJson(res, 201, { watchlist: store.data.watchlist, added: true });
      return;
    }

    if (pathname === '/api/watchlist' && method === 'PATCH') {
      const body = await readJson(req);
      if (!Array.isArray(body.symbols)) throw new HttpError(400, 'symbols 必须是数组');
      const known = new Set(store.data.watchlist);
      const symbols = [...new Set(body.symbols.map(ensureSymbol))].slice(0, 50);
      if (symbols.length === 0) throw new HttpError(400, '监控列表不能为空');
      if (symbols.some((symbol) => !known.has(symbol))) throw new HttpError(400, '只能调整现有监控列表的顺序');
      store.data.watchlist = symbols;
      store.save();
      feed.refresh();
      sendJson(res, 200, { watchlist: store.data.watchlist });
      return;
    }

    const watchMatch = pathname.match(/^\/api\/watchlist\/([A-Z0-9]{5,20})$/i);
    if (watchMatch && method === 'DELETE') {
      const symbol = normalizeSymbol(watchMatch[1]);
      store.data.watchlist = store.data.watchlist.filter((item) => item !== symbol);
      store.data.alerts = store.data.alerts.filter((alert) => alert.symbol !== symbol);
      store.save();
      feed.refresh();
      sendJson(res, 200, { watchlist: store.data.watchlist });
      return;
    }

    if (pathname === '/api/alerts' && method === 'GET') {
      sendJson(res, 200, { alerts: store.data.alerts });
      return;
    }

    if (pathname === '/api/alerts' && method === 'POST') {
      const body = await readJson(req);
      const alert = normalizeAlertInput(body, store.data.watchlist);
      store.data.alerts.unshift(alert);
      store.data.alerts = store.data.alerts.slice(0, 100);
      store.save();
      hub.broadcast('alerts', store.data.alerts);
      sendJson(res, 201, { alert });
      return;
    }

    const alertMatch = pathname.match(/^\/api\/alerts\/([A-Za-z0-9_-]+)$/);
    if (alertMatch && method === 'PATCH') {
      const alert = store.data.alerts.find((item) => item.id === alertMatch[1]);
      if (!alert) throw new HttpError(404, '预警不存在');
      const body = await readJson(req);
      if ('enabled' in body) alert.enabled = Boolean(body.enabled);
      if ('threshold' in body) {
        const threshold = Number(body.threshold);
        if (!Number.isFinite(threshold) || threshold <= 0) throw new HttpError(400, '阈值必须大于 0');
        alert.threshold = threshold;
        alert.armed = true;
        alert.lastTriggeredAt = null;
      }
      if ('cooldown' in body) {
        alert.cooldown = Math.max(60, Math.min(86_400, Math.round(Number(body.cooldown) || 900)));
      }
      store.save();
      hub.broadcast('alerts', store.data.alerts);
      sendJson(res, 200, { alert });
      return;
    }

    if (alertMatch && method === 'DELETE') {
      store.data.alerts = store.data.alerts.filter((item) => item.id !== alertMatch[1]);
      store.save();
      hub.broadcast('alerts', store.data.alerts);
      sendJson(res, 200, { alerts: store.data.alerts });
      return;
    }

    if (pathname === '/api/settings' && method === 'GET') {
      sendJson(res, 200, { settings: store.settings });
      return;
    }

    if (pathname === '/api/settings' && method === 'PATCH') {
      const body = await readJson(req);
      const previous = store.settings;
      const next = applySettings(previous, body);
      store.data.settings = next;
      store.save();
      const sourceChanged = previous.source !== next.source || previous.binanceBase !== next.binanceBase;
      if (sourceChanged) feed.reload();
      if (!previous.newsEnabled && next.newsEnabled) news.refresh();
      if (previous.source !== next.source && next.source === 'demo') news.refresh();
      hub.broadcast('settings', next);
      sendJson(res, 200, { settings: next });
      return;
    }

    if (pathname === '/api/notifications/test' && method === 'POST') {
      const notification = alerts.test();
      sendJson(res, 201, { notification });
      return;
    }

    if (pathname === '/api/notifications/clear' && method === 'POST') {
      alerts.clear();
      sendJson(res, 200, { notifications: [] });
      return;
    }

    if (pathname === '/api/signals/scan' && method === 'POST') {
      if (!feed.getStatus().connected) throw new HttpError(503, '行情源离线，暂时无法扫描');
      const created = await scanner.scan(true);
      sendJson(res, 200, { created, signals: store.data.signals.slice(0, 80) });
      return;
    }

    if (pathname === '/api/news' && method === 'GET') {
      sendJson(res, 200, { news: store.data.news.slice(0, 80), status: news.getStatus() });
      return;
    }

    throw new HttpError(404, '接口不存在');
  }

  if (method === 'GET' || method === 'HEAD') {
    serveStatic(req, res, pathname);
    return;
  }
  throw new HttpError(405, '方法不允许');
}

if (require.main === module) {
  const port = Number(process.env.PORT || 5178);
  const host = process.env.HOST || '127.0.0.1';
  startServer({ port, host })
    .then((server) => {
      console.log('');
      console.log('  550C // MARKET TERMINAL');
      console.log(`  ${server.url}`);
      console.log(`  data: ${server.getDataDir()}`);
      console.log('');
      const shutdown = async () => {
        await server.close();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((error) => {
      console.error('[550C] 启动失败：', error);
      process.exit(1);
    });
}

module.exports = { startServer };
