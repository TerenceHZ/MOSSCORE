'use strict';

const {
  INTERVALS,
  VALID_INTERVALS,
  hashString,
  mulberry32,
  normalizeSymbol,
  numeric,
  alignTime,
  clamp,
} = require('./util.cjs');

const STATIC_SYMBOLS = [
  ['BTCUSDT', 'BTC'], ['ETHUSDT', 'ETH'], ['SOLUSDT', 'SOL'], ['BNBUSDT', 'BNB'],
  ['XRPUSDT', 'XRP'], ['DOGEUSDT', 'DOGE'], ['ADAUSDT', 'ADA'], ['AVAXUSDT', 'AVAX'],
  ['LINKUSDT', 'LINK'], ['TONUSDT', 'TON'], ['DOTUSDT', 'DOT'], ['TRXUSDT', 'TRX'],
  ['LTCUSDT', 'LTC'], ['BCHUSDT', 'BCH'], ['NEARUSDT', 'NEAR'], ['APTUSDT', 'APT'],
  ['ARBUSDT', 'ARB'], ['OPUSDT', 'OP'], ['SUIUSDT', 'SUI'], ['SEIUSDT', 'SEI'],
  ['INJUSDT', 'INJ'], ['TIAUSDT', 'TIA'], ['FILUSDT', 'FIL'], ['ATOMUSDT', 'ATOM'],
  ['ETCUSDT', 'ETC'], ['UNIUSDT', 'UNI'], ['AAVEUSDT', 'AAVE'], ['MKRUSDT', 'MKR'],
  ['RENDERUSDT', 'RENDER'], ['FETUSDT', 'FET'], ['TAOUSDT', 'TAO'], ['WIFUSDT', 'WIF'],
  ['PEPEUSDT', 'PEPE'], ['SHIBUSDT', 'SHIB'], ['BONKUSDT', 'BONK'], ['JUPUSDT', 'JUP'],
  ['PYTHUSDT', 'PYTH'], ['STRKUSDT', 'STRK'], ['WLDUSDT', 'WLD'], ['ENAUSDT', 'ENA'],
  ['ONDOUSDT', 'ONDO'], ['JTOUSDT', 'JTO'], ['ORDIUSDT', 'ORDI'], ['STXUSDT', 'STX'],
  ['IMXUSDT', 'IMX'], ['GALAUSDT', 'GALA'], ['SANDUSDT', 'SAND'], ['MANAUSDT', 'MANA'],
  ['CRVUSDT', 'CRV'], ['LDOUSDT', 'LDO'], ['COMPUSDT', 'COMP'], ['SNXUSDT', 'SNX'],
];

const STATIC_INDEX = STATIC_SYMBOLS.map(([symbol, base]) => ({ symbol, base, quote: 'USDT' }));

const DEMO_BASE_PRICES = {
  BTC: 67420, ETH: 3280, SOL: 178.4, BNB: 592.1, XRP: 0.612, DOGE: 0.148,
  ADA: 0.452, AVAX: 34.2, LINK: 14.8, TON: 5.42, DOT: 4.18, TRX: 0.128,
  LTC: 72.4, BCH: 362, NEAR: 4.62, APT: 8.74, ARB: 0.842, OP: 1.62,
  SUI: 2.14, SEI: 0.286, INJ: 22.6, TIA: 4.92, FIL: 4.86, ATOM: 6.24,
  ETC: 24.8, UNI: 7.42, AAVE: 98.6, MKR: 1480, RENDER: 5.24, FET: 1.42,
  TAO: 368, WIF: 1.86, PEPE: 0.0000108, SHIB: 0.0000182, BONK: 0.0000248,
  JUP: 0.842, PYTH: 0.342, STRK: 0.462, WLD: 2.28, ENA: 0.742, ONDO: 0.982,
  JTO: 3.12, ORDI: 28.4, STX: 1.78, IMX: 1.12, GALA: 0.0248, SAND: 0.342,
  MANA: 0.382, CRV: 0.742, LDO: 1.92, COMP: 48.2, SNX: 2.42,
};

function feedError(message, cause) {
  const error = new Error(message);
  error.cause = cause;
  return error;
}

async function fetchText(url, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json,text/plain,*/*',
        'user-agent': '550C-Market-Terminal/0.1 (+local desktop)',
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw feedError(`上游返回 HTTP ${response.status}`, new Error(text.slice(0, 240)));
    }
    return text;
  } catch (error) {
    if (error.name === 'AbortError') throw feedError('上游请求超时', error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function mapTicker(row) {
  const symbol = normalizeSymbol(row.symbol);
  return {
    symbol,
    base: symbol.replace(/(USDT|USDC|FDUSD|BUSD|BTC|ETH)$/, '') || symbol,
    lastPrice: numeric(row.lastPrice),
    priceChange: numeric(row.priceChange),
    priceChangePercent: numeric(row.priceChangePercent),
    highPrice: numeric(row.highPrice),
    lowPrice: numeric(row.lowPrice),
    openPrice: numeric(row.openPrice),
    volume: numeric(row.volume),
    quoteVolume: numeric(row.quoteVolume),
    trades: numeric(row.count),
    at: Date.now(),
  };
}

class BinanceFeed {
  constructor(baseUrl) {
    this.baseUrl = String(baseUrl || 'https://data-api.binance.vision').replace(/\/+$/, '');
    this.name = 'BINANCE';
    this.exchange = null;
    this.exchangeAt = 0;
    this.invalid = new Set();
  }

  async request(path) {
    const text = await fetchText(`${this.baseUrl}${path}`);
    try {
      return JSON.parse(text);
    } catch {
      throw feedError('上游返回了无法解析的数据');
    }
  }

  async fetchBatch(list) {
    const query = encodeURIComponent(JSON.stringify(list));
    const data = await this.request(`/api/v3/ticker/24hr?symbols=${query}`);
    if (data && !Array.isArray(data) && data.code) {
      throw feedError(`上游错误 ${data.code}：${data.msg || '请求被拒绝'}`);
    }
    const rows = Array.isArray(data) ? data : [data];
    return rows.filter((row) => row && row.symbol).map(mapTicker);
  }

  async getTickers(symbols) {
    const requested = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
    const list = requested.filter((symbol) => !this.invalid.has(symbol));
    if (list.length === 0) return [];
    try {
      return await this.fetchBatch(list);
    } catch (error) {
      // A single unknown symbol makes Binance reject the entire batch. Fall
      // back to per-symbol requests so one typo cannot black out the feed.
      if (!/HTTP 400|invalid symbol|illegal characters|-1121/i.test(error.message)) throw error;
      const rows = [];
      for (const symbol of list) {
        try {
          rows.push(...await this.fetchBatch([symbol]));
          this.invalid.delete(symbol);
        } catch (inner) {
          if (/HTTP 400|invalid symbol|illegal characters|-1121/i.test(inner.message)) this.invalid.add(symbol);
          else throw inner;
        }
      }
      if (rows.length === 0) throw error;
      return rows;
    }
  }

  async validateSymbol(symbol) {
    const safeSymbol = normalizeSymbol(symbol);
    const list = await this.ensureExchange();
    const valid = list.some((item) => item.symbol === safeSymbol);
    if (valid) this.invalid.delete(safeSymbol);
    return valid;
  }

  async getKlines(symbol, interval, limit = 320) {
    const safeSymbol = normalizeSymbol(symbol);
    if (!VALID_INTERVALS.includes(interval)) throw feedError('不支持的 K 线周期');
    const safeLimit = clamp(Math.round(Number(limit) || 320), 20, 1000);
    const data = await this.request(
      `/api/v3/klines?symbol=${encodeURIComponent(safeSymbol)}&interval=${encodeURIComponent(interval)}&limit=${safeLimit}`,
    );
    if (!Array.isArray(data)) throw feedError('K 线数据格式异常');
    return data
      .filter((row) => Array.isArray(row) && row.length >= 6)
      .map((row) => ({
        t: Number(row[0]),
        o: numeric(row[1]),
        h: numeric(row[2]),
        l: numeric(row[3]),
        c: numeric(row[4]),
        v: numeric(row[5]),
        closeTime: Number(row[6]),
      }));
  }

  async ensureExchange() {
    if (this.exchange && Date.now() - this.exchangeAt < 6 * 60 * 60 * 1000) return this.exchange;
    const data = await this.request('/api/v3/exchangeInfo');
    if (!data || !Array.isArray(data.symbols)) throw feedError('交易对列表格式异常');
    this.exchange = data.symbols
      .filter((row) => row && row.status === 'TRADING' && row.quoteAsset === 'USDT')
      .map((row) => ({ symbol: row.symbol, base: row.baseAsset, quote: row.quoteAsset }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    this.exchangeAt = Date.now();
    return this.exchange;
  }

  async search(query) {
    const q = String(query || '').trim().toUpperCase();
    let list;
    try {
      list = await this.ensureExchange();
    } catch {
      list = STATIC_INDEX;
    }
    if (!q) return list.slice(0, 40);
    return list
      .filter((item) => item.symbol.includes(q) || item.base.includes(q))
      .sort((a, b) => {
        const aExact = a.base === q ? 0 : a.symbol.startsWith(q) ? 1 : 2;
        const bExact = b.base === q ? 0 : b.symbol.startsWith(q) ? 1 : 2;
        return aExact - bExact || a.symbol.length - b.symbol.length;
      })
      .slice(0, 24);
  }
}

class DemoFeed {
  constructor() {
    this.name = 'DEMO';
    this.quotes = new Map();
    this.series = new Map();
  }

  quoteFor(symbol) {
    const sym = normalizeSymbol(symbol);
    if (this.quotes.has(sym)) return this.quotes.get(sym);
    const base = sym.replace(/USDT$/, '') || sym;
    const anchor = DEMO_BASE_PRICES[base] || 10 + (hashString(base) % 5000) / 100;
    const random = mulberry32(hashString(sym));
    const price = anchor * (0.96 + random() * 0.08);
    const quote = {
      symbol: sym,
      base,
      anchor,
      price,
      dayOpen: price * (0.97 + random() * 0.06),
      high: price,
      low: price,
      volume: anchor > 100 ? 1200 + random() * 8000 : 120_000 + random() * 4_000_000,
      trades: 20_000 + Math.floor(random() * 180_000),
      trend: (random() - 0.5) * 0.00008,
      lastMoveAt: Date.now(),
    };
    quote.high = Math.max(quote.high, quote.dayOpen);
    quote.low = Math.min(quote.low, quote.dayOpen);
    this.quotes.set(sym, quote);
    return quote;
  }

  advance(quote) {
    const now = Date.now();
    const elapsed = clamp(now - quote.lastMoveAt, 0, 5000);
    if (elapsed < 500) return;
    quote.lastMoveAt = now;
    const random = Math.random;
    const wave = Math.sin(now / 41_000 + hashString(quote.symbol) / 1000) * 0.00006;
    const shock = (random() - 0.5) * 0.0009;
    const next = quote.price * (1 + quote.trend + wave + shock);
    quote.price = clamp(next, quote.anchor * 0.55, quote.anchor * 1.8);
    quote.high = Math.max(quote.high, quote.price);
    quote.low = Math.min(quote.low, quote.price);
    quote.volume += (quote.anchor > 100 ? 1 : 80) * (0.4 + random() * 2.2);
  }

  async getTickers(symbols) {
    return [...new Set(symbols.map(normalizeSymbol).filter(Boolean))].map((symbol) => {
      const quote = this.quoteFor(symbol);
      this.advance(quote);
      const change = quote.price - quote.dayOpen;
      return {
        symbol,
        base: quote.base,
        lastPrice: quote.price,
        priceChange: change,
        priceChangePercent: (change / quote.dayOpen) * 100,
        highPrice: quote.high,
        lowPrice: quote.low,
        openPrice: quote.dayOpen,
        volume: quote.volume,
        quoteVolume: quote.volume * quote.price,
        trades: quote.trades,
        at: Date.now(),
      };
    });
  }

  buildSeries(symbol, interval) {
    const quote = this.quoteFor(symbol);
    const ms = INTERVALS[interval];
    const now = alignTime(Date.now(), interval);
    const count = 600;
    const random = mulberry32(hashString(`${symbol}:${interval}`));
    const volatility = clamp(0.004 * Math.sqrt(ms / 60_000), 0.0025, 0.045);
    let price = quote.price * (0.82 + random() * 0.3);
    const candles = [];
    for (let i = count - 1; i >= 0; i -= 1) {
      const t = now - i * ms;
      const open = price;
      const drift = (random() - 0.5) * volatility * 1.6;
      const close = Math.max(0.00000001, open * (1 + drift));
      const high = Math.max(open, close) * (1 + random() * volatility * 0.7);
      const low = Math.min(open, close) * (1 - random() * volatility * 0.7);
      const volume = (quote.anchor > 100 ? 12 : 90_000) * (0.35 + random() * 2.5);
      candles.push({ t, o: open, h: high, l: low, c: close, v: volume, closeTime: t + ms - 1 });
      price = close;
    }
    const last = candles[candles.length - 1];
    const factor = quote.price / last.c;
    for (const candle of candles) {
      candle.o *= factor;
      candle.h *= factor;
      candle.l *= factor;
      candle.c *= factor;
    }
    this.series.set(`${symbol}:${interval}`, { candles, ms, lastRefresh: now });
    return this.series.get(`${symbol}:${interval}`);
  }

  refreshSeries(series, quote) {
    const now = alignTime(Date.now(), series.ms);
    let guard = 0;
    while (series.candles.length > 0 && now >= series.candles[series.candles.length - 1].t + series.ms && guard < 600) {
      const previous = series.candles[series.candles.length - 1];
      const open = previous.c;
      const close = open * (1 + (Math.random() - 0.5) * 0.006);
      series.candles.push({
        t: previous.t + series.ms,
        o: open,
        h: Math.max(open, close),
        l: Math.min(open, close),
        c: close,
        v: 0,
        closeTime: previous.t + series.ms * 2 - 1,
      });
      guard += 1;
    }
    const current = series.candles[series.candles.length - 1];
    current.c = quote.price;
    current.h = Math.max(current.h, quote.price);
    current.l = Math.min(current.l, quote.price);
    current.v += (quote.anchor > 100 ? 0.04 : 200) * (0.2 + Math.random());
    const max = 650;
    if (series.candles.length > max) series.candles.splice(0, series.candles.length - max);
    series.lastRefresh = now;
  }

  async getKlines(symbol, interval, limit = 320) {
    const sym = normalizeSymbol(symbol);
    if (!VALID_INTERVALS.includes(interval)) throw feedError('不支持的 K 线周期');
    const quote = this.quoteFor(sym);
    let series = this.series.get(`${sym}:${interval}`);
    if (!series) series = this.buildSeries(sym, interval);
    this.advance(quote);
    this.refreshSeries(series, quote);
    const safeLimit = clamp(Math.round(Number(limit) || 320), 20, 600);
    return series.candles.slice(-safeLimit).map((candle) => ({ ...candle }));
  }

  async search(query) {
    const q = String(query || '').trim().toUpperCase();
    return STATIC_INDEX
      .filter((item) => !q || item.symbol.includes(q) || item.base.includes(q))
      .sort((a, b) => {
        const aExact = a.base === q ? 0 : a.symbol.startsWith(q) ? 1 : 2;
        const bExact = b.base === q ? 0 : b.symbol.startsWith(q) ? 1 : 2;
        return aExact - bExact || a.symbol.length - b.symbol.length;
      })
      .slice(0, 24);
  }

  async validateSymbol(symbol) {
    const safeSymbol = normalizeSymbol(symbol);
    return STATIC_INDEX.some((item) => item.symbol === safeSymbol);
  }
}

class FeedManager {
  constructor({ store, onTickers, onStatus }) {
    this.store = store;
    this.onTickers = onTickers;
    this.onStatus = onStatus;
    this.feed = this.createFeed();
    this.lastTickers = new Map();
    this.lastTickersAt = 0;
    this.timer = null;
    this.inFlight = false;
    this.stopped = true;
    this.status = {
      source: this.feed.name,
      connected: false,
      lastError: null,
      lastTickAt: null,
      latencyMs: null,
      pollMs: this.store.settings.pollMs,
      invalidSymbols: [],
    };
  }

  createFeed() {
    const settings = this.store.settings;
    if (settings.source === 'demo') return new DemoFeed();
    return new BinanceFeed(settings.binanceBase);
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(delay) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), Math.max(1000, delay));
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    if (this.onStatus) this.onStatus(this.getStatus());
  }

  getStatus() {
    return { ...this.status };
  }

  async tick() {
    if (this.stopped || this.inFlight) return;
    this.inFlight = true;
    const started = Date.now();
    const symbols = [...this.store.data.watchlist];
    try {
      const tickers = await this.feed.getTickers(symbols);
      const latency = Date.now() - started;
      this.lastTickers = new Map(tickers.map((ticker) => [ticker.symbol, ticker]));
      this.lastTickersAt = Date.now();
      this.setStatus({
        source: this.feed.name,
        connected: true,
        lastError: null,
        lastTickAt: Date.now(),
        latencyMs: latency,
        pollMs: this.store.settings.pollMs,
        invalidSymbols: this.feed.invalid ? [...this.feed.invalid] : [],
      });
      if (this.onTickers) this.onTickers(tickers);
      this.inFlight = false;
      this.schedule(this.store.settings.pollMs);
    } catch (error) {
      const raw = error && error.message ? error.message : '行情源连接失败';
      const message = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(raw)
        ? '行情源不可达（网络或区域限制，可在设置中切换 DEMO 或代理地址）'
        : /HTTP 451/i.test(raw)
          ? '行情源拒绝访问（HTTP 451，请使用可用的代理地址）'
          : raw;
      this.setStatus({
        source: this.feed.name,
        connected: false,
        lastError: message,
        lastTickAt: Date.now(),
        latencyMs: null,
        pollMs: this.store.settings.pollMs,
      });
      this.inFlight = false;
      this.schedule(5000);
    }
  }

  refresh() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.tick();
  }

  reload() {
    this.stop();
    this.feed = this.createFeed();
    this.lastTickers.clear();
    this.lastTickersAt = 0;
    this.setStatus({
      source: this.feed.name,
      connected: false,
      lastError: null,
      lastTickAt: null,
      latencyMs: null,
      pollMs: this.store.settings.pollMs,
      invalidSymbols: [],
    });
    this.start();
  }

  async getTickers(symbols) {
    const list = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
    const fresh = Date.now() - this.lastTickersAt < 8000;
    if (fresh && list.every((symbol) => this.lastTickers.has(symbol))) {
      return list.map((symbol) => this.lastTickers.get(symbol));
    }
    const tickers = await this.feed.getTickers(list);
    for (const ticker of tickers) this.lastTickers.set(ticker.symbol, ticker);
    this.lastTickersAt = Date.now();
    return tickers;
  }

  getKlines(symbol, interval, limit) {
    return this.feed.getKlines(symbol, interval, limit);
  }

  search(query) {
    return this.feed.search(query);
  }

  validateSymbol(symbol) {
    if (typeof this.feed.validateSymbol === 'function') return this.feed.validateSymbol(symbol);
    return this.search(symbol).then((results) => results.some((item) => item.symbol === symbol));
  }
}

module.exports = {
  BinanceFeed,
  DemoFeed,
  FeedManager,
  STATIC_SYMBOLS,
  STATIC_INDEX,
};
