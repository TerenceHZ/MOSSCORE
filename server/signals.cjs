'use strict';

const crypto = require('node:crypto');
const { sma, rsi, lastValue } = require('./indicators.cjs');
const { sleep, formatPrice } = require('./util.cjs');

const STRATEGY_LABELS = {
  ma_cross: '均线交叉',
  rsi_reversal: 'RSI 反转',
  breakout: '区间突破',
  volume_surge: '放量异动',
};

function candleChange(candle, previous) {
  if (!previous || !previous.c) return 0;
  return ((candle.c - previous.c) / previous.c) * 100;
}

function detectSignals(candles, symbol, interval) {
  if (!Array.isArray(candles) || candles.length < 60) return [];
  const closed = candles.slice(0, -1);
  if (closed.length < 40) return [];
  const i = closed.length - 1;
  const current = closed[i];
  const previous = closed[i - 1];
  const closes = closed.map((candle) => candle.c);
  const out = [];

  const fast = sma(closes, 7);
  const slow = sma(closes, 25);
  if (
    fast[i] !== null && slow[i] !== null &&
    fast[i - 1] !== null && slow[i - 1] !== null
  ) {
    if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) {
      out.push({
        strategy: 'ma_cross',
        side: 'long',
        message: `MA7 上穿 MA25 · ${formatPrice(current.c)}`,
      });
    } else if (fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]) {
      out.push({
        strategy: 'ma_cross',
        side: 'short',
        message: `MA7 下穿 MA25 · ${formatPrice(current.c)}`,
      });
    }
  }

  const rsiSeries = rsi(closes, 14);
  if (rsiSeries[i] !== null && rsiSeries[i - 1] !== null) {
    if (rsiSeries[i - 1] <= 30 && rsiSeries[i] > 30) {
      out.push({
        strategy: 'rsi_reversal',
        side: 'long',
        message: `RSI 自超卖区回升 · ${rsiSeries[i].toFixed(1)}`,
      });
    } else if (rsiSeries[i - 1] >= 70 && rsiSeries[i] < 70) {
      out.push({
        strategy: 'rsi_reversal',
        side: 'short',
        message: `RSI 自超买区回落 · ${rsiSeries[i].toFixed(1)}`,
      });
    }
  }

  const window = closed.slice(-21, -1);
  if (window.length === 20) {
    const high = Math.max(...window.map((candle) => candle.h));
    const low = Math.min(...window.map((candle) => candle.l));
    if (current.c > high) {
      out.push({
        strategy: 'breakout',
        side: 'long',
        message: `突破 20 周期高点 ${formatPrice(high)}`,
      });
    } else if (current.c < low) {
      out.push({
        strategy: 'breakout',
        side: 'short',
        message: `跌破 20 周期低点 ${formatPrice(low)}`,
      });
    }
  }

  const volumeWindow = closed.slice(-21, -1);
  if (volumeWindow.length === 20) {
    const average = volumeWindow.reduce((sum, candle) => sum + candle.v, 0) / 20;
    if (average > 0 && current.v / average >= 3) {
      out.push({
        strategy: 'volume_surge',
        side: current.c >= current.o ? 'long' : 'short',
        message: `成交量达到 20 周期均量的 ${(current.v / average).toFixed(1)} 倍`,
      });
    }
  }

  return out.map((signal) => ({
    ...signal,
    symbol,
    interval,
    price: current.c,
    changePercent: candleChange(current, previous),
    candleTime: current.t,
    key: `${symbol}:${interval}:${signal.strategy}:${current.t}`,
  }));
}

class SignalScanner {
  constructor({ store, feed, hub }) {
    this.store = store;
    this.feed = feed;
    this.hub = hub;
    this.timer = null;
    this.startTimer = null;
    this.running = false;
    this.keys = new Set();
    this.rebuildKeys();
  }

  rebuildKeys() {
    this.keys.clear();
    for (const signal of this.store.data.signals) {
      const key = signal.key || `${signal.symbol}:${signal.interval}:${signal.strategy}:${signal.candleTime}`;
      this.keys.add(key);
    }
  }

  start() {
    if (this.timer) return;
    this.startTimer = setTimeout(() => this.scan(), 5000);
    if (typeof this.startTimer.unref === 'function') this.startTimer.unref();
    this.timer = setInterval(() => this.scan(), 60_000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.timer) clearInterval(this.timer);
    this.startTimer = null;
    this.timer = null;
  }

  async scan(manual = false) {
    if (this.running) return 0;
    if (!manual && !this.store.settings.autoScan) return 0;
    if (this.feed.getStatus && !this.feed.getStatus().connected) return 0;
    this.running = true;
    let created = 0;
    try {
      const symbols = [...this.store.data.watchlist];
      for (const symbol of symbols) {
        for (const interval of ['15m', '1h']) {
          try {
            const candles = await this.feed.getKlines(symbol, interval, 220);
            const detected = detectSignals(candles, symbol, interval);
            for (const candidate of detected) {
              if (this.keys.has(candidate.key)) continue;
              this.keys.add(candidate.key);
              const signal = {
                id: `sg_${crypto.randomUUID()}`,
                ...candidate,
                strategyLabel: STRATEGY_LABELS[candidate.strategy] || candidate.strategy,
                createdAt: new Date().toISOString(),
              };
              this.store.data.signals.unshift(signal);
              created += 1;
              if (this.hub) this.hub.broadcast('signal', signal);
            }
          } catch (error) {
            console.error(`[550C] 扫描 ${symbol}/${interval} 失败：`, error.message);
          }
          await sleep(120);
        }
      }
      if (created > 0) {
        this.store.data.signals = this.store.data.signals.slice(0, 300);
        this.store.save();
      }
    } finally {
      this.running = false;
    }
    return created;
  }
}

module.exports = {
  SignalScanner,
  detectSignals,
  STRATEGY_LABELS,
};
