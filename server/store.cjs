'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { deepMerge, normalizeSymbol } = require('./util.cjs');

const THEMES = new Set(['amber', 'green', 'cyan', 'white', 'paper']);
const SOURCES = new Set(['binance', 'demo']);

const DEFAULT_SETTINGS = {
  theme: 'amber',
  effects: {
    scanlines: true,
    vignette: true,
    glow: true,
  },
  source: 'binance',
  binanceBase: 'https://data-api.binance.vision',
  pollMs: 2000,
  sound: true,
  desktopNotifications: true,
  alertsMuted: false,
  minimizeToTray: true,
  launchAtLogin: false,
  newsEnabled: true,
  autoScan: true,
  chart: {
    interval: '15m',
    indicators: {
      ma: true,
      boll: false,
      macd: false,
      rsi: false,
    },
  },
};

const cloneDefaults = () => JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

const DEFAULT_STATE = () => ({
  version: 1,
  createdAt: new Date().toISOString(),
  watchlist: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT'],
  alerts: [],
  signals: [],
  notifications: [],
  news: [],
  settings: cloneDefaults(),
});

function normalizeAlert(alert, index) {
  const types = new Set(['price_above', 'price_below', 'change_above', 'change_below']);
  return {
    id: typeof alert.id === 'string' && alert.id ? alert.id : `al_${Date.now()}_${index}`,
    symbol: normalizeSymbol(alert.symbol),
    type: types.has(alert.type) ? alert.type : 'price_above',
    threshold: Number.isFinite(Number(alert.threshold)) ? Number(alert.threshold) : 0,
    enabled: alert.enabled !== false,
    armed: alert.armed !== false,
    cooldown: Math.max(60, Math.min(86_400, Math.round(Number(alert.cooldown) || 900))),
    lastTriggeredAt: alert.lastTriggeredAt || null,
    lastPrice: Number.isFinite(Number(alert.lastPrice)) ? Number(alert.lastPrice) : null,
    createdAt: alert.createdAt || new Date().toISOString(),
  };
}

function normalizeState(raw) {
  const base = DEFAULT_STATE();
  const data = raw && typeof raw === 'object' ? raw : {};
  const hasWatchlist = Array.isArray(data.watchlist);
  const watchlist = hasWatchlist
    ? [...new Set(data.watchlist.map(normalizeSymbol).filter((symbol) => /^[A-Z0-9]{5,20}$/.test(symbol)))].slice(0, 50)
    : base.watchlist;

  let settings = deepMerge(cloneDefaults(), data.settings || {});
  if (!THEMES.has(settings.theme)) settings.theme = 'amber';
  if (!SOURCES.has(settings.source)) settings.source = 'binance';
  settings.pollMs = Math.max(1000, Math.min(15_000, Number(settings.pollMs) || 2000));
  settings.binanceBase = String(settings.binanceBase || DEFAULT_SETTINGS.binanceBase).trim().replace(/\/+$/, '');
  settings.chart = deepMerge(DEFAULT_SETTINGS.chart, settings.chart || {});
  if (!['1m', '5m', '15m', '1h', '4h', '1d'].includes(settings.chart.interval)) settings.chart.interval = '15m';
  settings.chart.indicators = deepMerge(DEFAULT_SETTINGS.chart.indicators, settings.chart.indicators || {});

  return {
    ...base,
    ...data,
    version: 1,
    watchlist: hasWatchlist ? watchlist : base.watchlist,
    alerts: Array.isArray(data.alerts) ? data.alerts.map(normalizeAlert).filter((a) => a.symbol).slice(0, 100) : [],
    signals: Array.isArray(data.signals) ? data.signals.slice(0, 300) : [],
    notifications: Array.isArray(data.notifications) ? data.notifications.slice(0, 80) : [],
    news: Array.isArray(data.news) ? data.news.slice(0, 150) : [],
    settings,
  };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'state.json');
    this.timer = null;
    this.writeChain = Promise.resolve();
    this.data = this.load();
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.file)) {
      const initial = DEFAULT_STATE();
      fs.writeFileSync(this.file, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return normalizeState(raw);
    } catch (error) {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(this.file, backup);
      } catch {
        // Ignore; a fresh state is still better than crashing on boot.
      }
      console.error('[550C] state.json 损坏，已重建：', error.message);
      const initial = DEFAULT_STATE();
      fs.writeFileSync(this.file, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
  }

  get settings() {
    return this.data.settings;
  }

  update(mutator) {
    mutator(this.data);
    this.save();
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write();
    }, 120);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  write() {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writeChain = this.writeChain
      .then(async () => {
        const tmp = `${this.file}.tmp`;
        await fs.promises.writeFile(tmp, snapshot, 'utf8');
        await fs.promises.rename(tmp, this.file);
      })
      .catch((error) => {
        console.error('[550C] state.json 写入失败：', error.message);
      });
    return this.writeChain;
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.write();
  }
}

module.exports = {
  Store,
  DEFAULT_SETTINGS,
  THEMES,
  SOURCES,
  normalizeState,
};
