'use strict';

const crypto = require('node:crypto');
const { formatPrice } = require('./util.cjs');

const TYPE_LABELS = {
  price_above: '价格上穿',
  price_below: '价格下穿',
  change_above: '24H 涨幅达到',
  change_below: '24H 跌幅达到',
};

function conditionFor(alert, ticker) {
  const price = Number(ticker.lastPrice);
  const change = Number(ticker.priceChangePercent);
  switch (alert.type) {
    case 'price_above':
      return price >= alert.threshold;
    case 'price_below':
      return price <= alert.threshold;
    case 'change_above':
      return change >= alert.threshold;
    case 'change_below':
      return change <= -Math.abs(alert.threshold);
    default:
      return false;
  }
}

function describe(alert) {
  const suffix = alert.type.startsWith('change') ? '%' : '';
  return `${alert.symbol} · ${TYPE_LABELS[alert.type] || alert.type} ${formatPrice(alert.threshold)}${suffix}`;
}

class AlertEngine {
  constructor({ store, hub, onNotify }) {
    this.store = store;
    this.hub = hub;
    this.onNotify = onNotify;
  }

  check(tickers, settings) {
    if (!settings || settings.alertsMuted) return;
    if (!Array.isArray(tickers) || tickers.length === 0) return;
    const map = new Map(tickers.map((ticker) => [ticker.symbol, ticker]));
    let dirty = false;
    const now = Date.now();

    for (const alert of this.store.data.alerts) {
      if (!alert.enabled) continue;
      const ticker = map.get(alert.symbol);
      if (!ticker) continue;
      const active = conditionFor(alert, ticker);
      if (!active) {
        if (!alert.armed) {
          alert.armed = true;
          dirty = true;
        }
        continue;
      }
      if (!alert.armed) continue;
      const last = alert.lastTriggeredAt ? Date.parse(alert.lastTriggeredAt) : 0;
      if (last && now - last < alert.cooldown * 1000) continue;
      alert.armed = false;
      alert.lastTriggeredAt = new Date(now).toISOString();
      alert.lastPrice = Number(ticker.lastPrice);
      dirty = true;
      this.trigger(alert, ticker);
    }

    if (dirty) this.store.save();
  }

  trigger(alert, ticker) {
    const price = formatPrice(ticker.lastPrice);
    const threshold = formatPrice(alert.threshold);
    let body;
    if (alert.type === 'price_above') body = `${alert.symbol} 已上穿 ${threshold}，现价 ${price}`;
    else if (alert.type === 'price_below') body = `${alert.symbol} 已下穿 ${threshold}，现价 ${price}`;
    else if (alert.type === 'change_above') body = `${alert.symbol} 24H 涨幅达到 ${threshold}%，现价 ${price}`;
    else body = `${alert.symbol} 24H 跌幅达到 ${threshold}%，现价 ${price}`;

    const notification = {
      id: `nt_${crypto.randomUUID()}`,
      alertId: alert.id,
      kind: 'alert',
      symbol: alert.symbol,
      title: `ALERT // ${alert.symbol}`,
      body,
      price: Number(ticker.lastPrice),
      change: Number(ticker.priceChangePercent),
      createdAt: new Date().toISOString(),
      read: false,
    };
    this.store.data.notifications.unshift(notification);
    this.store.data.notifications = this.store.data.notifications.slice(0, 80);
    this.store.save();
    if (this.hub) this.hub.broadcast('alert', notification);
    if (this.onNotify) {
      try {
        this.onNotify(notification);
      } catch (error) {
        console.error('[550C] 系统通知失败：', error.message);
      }
    }
    return notification;
  }

  test() {
    const notification = {
      id: `nt_${crypto.randomUUID()}`,
      alertId: null,
      kind: 'test',
      symbol: 'SYSTEM',
      title: 'LINK // TEST',
      body: '预警通道工作正常。550C 控制终端已就绪。',
      price: null,
      change: null,
      createdAt: new Date().toISOString(),
      read: false,
    };
    this.store.data.notifications.unshift(notification);
    this.store.data.notifications = this.store.data.notifications.slice(0, 80);
    this.store.save();
    if (this.hub) this.hub.broadcast('alert', notification);
    if (this.onNotify) {
      try {
        this.onNotify(notification);
      } catch (error) {
        console.error('[550C] 测试通知失败：', error.message);
      }
    }
    return notification;
  }

  clear() {
    this.store.data.notifications = [];
    this.store.save();
  }
}

module.exports = { AlertEngine, TYPE_LABELS, describe };
