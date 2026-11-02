import { PriceChart } from './chart.js';
import {
  formatPrice,
  formatPct,
  formatCompact,
  formatUsd,
  formatClock,
  formatDate,
  formatTime,
  timeAgo,
  changeClass,
  signedArrow,
  baseOf,
  escapeHtml,
  setText,
  clamp,
  debounce,
} from './format.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const isDesktop = Boolean(window.desktop && window.desktop.isDesktop);
const LS_THEME = '550c.theme';
const LS_SYMBOL = '550c.symbol';
const LS_CHART = '550c.chart';

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];
const THEMES = [
  { id: 'amber', label: '琥珀', bars: ['#e8a020', '#ffc043', '#4fd1c5', '#0a0f18'] },
  { id: 'green', label: '磷绿', bars: ['#4ad46a', '#a6ffbb', '#7fe0d0', '#06160c'] },
  { id: 'cyan', label: '冷青', bars: ['#3fc8dc', '#a6f0ff', '#7ff0d0', '#06161a'] },
  { id: 'white', label: '白磷', bars: ['#c9c9c9', '#ffffff', '#d0d0d0', '#0c0c0c'] },
  { id: 'paper', label: '纸白', bars: ['#a8621a', '#c87c2a', '#17605e', '#fbf8f1'] },
];
const ALERT_LABELS = {
  price_above: '价格上穿',
  price_below: '价格下穿',
  change_above: '24H 涨幅达到',
  change_below: '24H 跌幅达到',
};
const STRATEGY_LABELS = {
  ma_cross: '均线交叉',
  rsi_reversal: 'RSI 反转',
  breakout: '区间突破',
  volume_surge: '放量异动',
};

const GLYPHS = {
  5: ['████', '█···', '███·', '···█', '████'],
  0: ['·██·', '█··█', '█··█', '█··█', '·██·'],
  C: ['·███', '█···', '█···', '█···', '·███'],
};

const state = {
  settings: null,
  source: null,
  newsStatus: null,
  health: null,
  watchlist: [],
  active: null,
  tickers: new Map(),
  interval: '15m',
  indicators: { ma: true, boll: false, macd: false, rsi: false },
  candles: [],
  chart: null,
  alerts: [],
  signals: [],
  news: [],
  notifications: [],
  version: '0.1.0',
  tab: 'signals',
  newsFilter: 'all',
  booted: false,
  streamOpen: false,
  online: false,
  lastPrice: null,
  lastTickAt: null,
  search: { items: [], active: -1, query: '' },
  eventSource: null,
  audio: null,
  settingsOpen: false,
  scanning: false,
  chartToken: 0,
  chartSaveTimer: null,
  healthTimer: null,
  clockTimer: null,
  klineTimer: null,
};

const TIMERS = [];

function bootLog(text) {
  const node = $('#bootLog');
  if (node) node.textContent = text;
}

function renderLogo(target) {
  const node = typeof target === 'string' ? $(target) : target;
  if (!node) return;
  node.replaceChildren();
  const glyphRows = ['5', '5', '0', 'C'];
  for (let row = 0; row < 5; row += 1) {
    const line = document.createElement('div');
    line.className = 'logo__row';
    glyphRows.forEach((glyph, glyphIndex) => {
      const pattern = GLYPHS[glyph][row];
      for (let col = 0; col < pattern.length; col += 1) {
        const cell = document.createElement('span');
        cell.className = `logo__cell${pattern[col] === '█' ? ' is-lit' : ''}`;
        cell.style.setProperty('--delay', `${(row * 6 + col * 3 + glyphIndex * 11) * 20}ms`);
        line.appendChild(cell);
      }
      if (glyphIndex < glyphRows.length - 1) {
        const gap = document.createElement('span');
        gap.className = 'logo__cell';
        gap.style.width = '3px';
        line.appendChild(gap);
      }
    });
    node.appendChild(line);
  }
}

function readLocal(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or a locked profile; not fatal.
  }
}

function applyTheme(themeId) {
  const theme = THEMES.find((item) => item.id === themeId) ? themeId : 'amber';
  document.documentElement.dataset.theme = theme;
  writeLocal(LS_THEME, theme);
  const meta = $('meta[name="theme-color"]');
  if (meta) {
    const colors = { amber: '#04060a', green: '#010601', cyan: '#010608', white: '#010101', paper: '#f3efe6' };
    meta.setAttribute('content', colors[theme] || '#04060a');
  }
  if (state.chart) state.chart.refreshTheme();
  $$('.theme-swatch').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.themeChoice === theme);
  });
}

function applyEffects(effects = {}) {
  document.documentElement.dataset.scanlines = effects.scanlines === false ? 'off' : 'on';
  document.documentElement.dataset.vignette = effects.vignette === false ? 'off' : 'on';
  document.documentElement.dataset.glow = effects.glow === false ? 'off' : 'on';
}

async function api(path, options = {}) {
  const init = { method: options.method || 'GET', headers: {} };
  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, init);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || `HTTP ${response.status}` };
  }
  if (!response.ok) {
    throw new Error((data && data.error) || `HTTP ${response.status}`);
  }
  return data;
}

function setConnection(kind, label) {
  const conn = $('#conn');
  if (!conn) return;
  conn.classList.toggle('is-live', kind === 'live');
  conn.classList.toggle('is-error', kind === 'error');
  setText($('#connLabel'), label);
}

function updateStatus() {
  const source = state.source || {};
  const settings = state.settings || {};
  const live = Boolean(source.connected && state.streamOpen);
  if (source.lastError) setConnection('error', 'FEED ERROR');
  else if (live) setConnection('live', 'LIVE');
  else if (state.streamOpen) setConnection('', 'LINK OK');
  else setConnection('error', 'RECONNECT');

  setText($('#sourceLabel'), source.source || String(settings.source || '--').toUpperCase());
  setText($('#latencyLabel'), Number.isFinite(source.latencyMs) ? `${source.latencyMs} MS` : '-- MS');
  setText($('#quoteSource'), source.source || '--');
  setText($('#statusFeed'), source.connected ? 'ONLINE' : 'OFFLINE');
  setText($('#statusPoll'), `${Math.round((source.pollMs || settings.pollMs || 2000) / 1000)}S`);
  setText($('#statusClients'), state.health && Number.isFinite(state.health.clients) ? String(state.health.clients) : '--');
  const memory = performance && performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null;
  setText($('#statusMem'), memory ? `${memory.toFixed(0)}M` : '--');
  setText($('#statusVersion'), state.version);
  const invalid = Array.isArray(source.invalidSymbols) ? source.invalidSymbols : [];
  const statusError = source.lastError || (invalid.length > 0 ? `交易对不可用：${invalid.join(', ')}` : '');
  const errorNode = $('#statusError');
  if (errorNode) {
    errorNode.textContent = statusError;
    errorNode.title = statusError;
  }
  const feedAlert = $('#feedAlert');
  if (feedAlert) {
    feedAlert.hidden = !source.lastError;
    setText($('#feedAlertText'), source.lastError || '');
  }
  const newsStatus = state.newsStatus;
  setText(
    $('#newsStatus'),
    newsStatus && newsStatus.lastRefreshAt
      ? (newsStatus.connected ? 'RSS LIVE' : 'RSS OFFLINE')
      : 'RSS',
  );
}

function setBootProgress(text) {
  bootLog(text);
}

function renderWatchlist() {
  const list = $('#watchList');
  if (!list) return;
  list.replaceChildren();
  if (state.watchlist.length === 0) {
    list.appendChild(emptyBlock('NO PAIRS', 'ADD A PAIR TO ARM THE FEED'));
  }
  state.watchlist.forEach((symbol, index) => {
    const row = document.createElement('div');
    row.className = 'watch-row';
    row.dataset.symbol = symbol;
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-pressed', String(symbol === state.active));
    if (symbol === state.active) row.classList.add('is-active');

    const idx = document.createElement('span');
    idx.className = 'watch-row__idx';
    idx.textContent = String(index + 1).padStart(2, '0');

    const id = document.createElement('span');
    id.className = 'watch-row__id';
    const sym = document.createElement('span');
    sym.className = 'watch-row__sym';
    sym.textContent = baseOf(symbol);
    const sub = document.createElement('span');
    sub.className = 'watch-row__sub';
    sub.textContent = 'USDT · SPOT';
    id.append(sym, sub);

    const quote = document.createElement('span');
    quote.className = 'watch-row__quote';
    const price = document.createElement('span');
    price.className = 'watch-row__price';
    price.textContent = '--';
    const pct = document.createElement('span');
    pct.className = 'watch-row__pct flat';
    pct.textContent = '--';
    quote.append(price, pct);

    const range = document.createElement('span');
    range.className = 'watch-row__range';
    const fill = document.createElement('i');
    fill.style.width = '0%';
    range.appendChild(fill);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'watch-row__x';
    remove.dataset.remove = symbol;
    remove.title = `移除 ${symbol}`;
    remove.setAttribute('aria-label', `移除 ${symbol}`);
    remove.textContent = '×';

    row.append(idx, id, quote, range, remove);
    list.appendChild(row);
  });
  setText($('#watchCount'), String(state.watchlist.length).padStart(2, '0'));
  updateWatchRows();
  renderAlertSymbolOptions();
}

function updateWatchRows() {
  const rows = $$('.watch-row');
  for (const row of rows) {
    const symbol = row.dataset.symbol;
    const ticker = state.tickers.get(symbol);
    const priceNode = $('.watch-row__price', row);
    const pctNode = $('.watch-row__pct', row);
    const fill = $('.watch-row__range i', row);
    if (!ticker) {
      setText(priceNode, '--');
      setText(pctNode, '--');
      pctNode.className = 'watch-row__pct flat';
      fill.style.width = '0%';
      continue;
    }
    const last = Number(ticker.lastPrice);
    const change = Number(ticker.priceChangePercent);
    setText(priceNode, formatPrice(last));
    setText(pctNode, `${signedArrow(change)} ${formatPct(change)}`);
    pctNode.className = `watch-row__pct ${changeClass(change)}`;
    const high = Number(ticker.highPrice);
    const low = Number(ticker.lowPrice);
    const ratio = high > low ? clamp(((last - low) / (high - low)) * 100, 0, 100) : 50;
    fill.style.width = `${ratio}%`;
    fill.style.background = change >= 0 ? 'var(--green)' : 'var(--red)';
    row.classList.toggle('is-active', symbol === state.active);
    row.setAttribute('aria-pressed', String(symbol === state.active));
  }
}

function clearQuoteFields() {
  setText($('#highPrice'), '--');
  setText($('#lowPrice'), '--');
  setText($('#volume'), '--');
  setText($('#quoteVolume'), '--');
  setText($('#openPrice'), '--');
  setText($('#rangeText'), '--');
  setText($('#trades'), '--');
  setText($('#updatedAt'), 'AWAITING FEED');
}

function updateHeader() {
  if (!state.active) {
    setText($('#symbolBase'), '--');
    setText($('#lastPrice'), '--');
    setText($('#priceChange'), '--');
    clearQuoteFields();
    return;
  }
  const ticker = state.tickers.get(state.active);
  setText($('#symbolBase'), baseOf(state.active));
  setText($('#quoteSource'), (state.source && state.source.source) || '--');
  if (!ticker) {
    setText($('#lastPrice'), '--');
    setText($('#priceChange'), '--');
    clearQuoteFields();
    return;
  }
  const price = Number(ticker.lastPrice);
  const change = Number(ticker.priceChangePercent);
  const priceNode = $('#lastPrice');
  if (priceNode) {
    setText(priceNode, formatPrice(price));
    priceNode.classList.toggle('is-up', change > 0);
    priceNode.classList.toggle('is-down', change < 0);
    if (state.lastPrice !== null && price !== state.lastPrice && priceNode.animate) {
      priceNode.classList.remove('flash-up', 'flash-down');
      void priceNode.offsetWidth;
      priceNode.classList.add(price > state.lastPrice ? 'flash-up' : 'flash-down');
    }
  }
  const changeNode = $('#priceChange');
  if (changeNode) {
    changeNode.className = `quote-change ${changeClass(change)}`;
    changeNode.innerHTML = `<span class="arrow">${signedArrow(change)}</span><span>${formatPct(change)}</span><span class="mono">${formatPrice(ticker.priceChange)}</span>`;
  }
  setText($('#highPrice'), formatPrice(ticker.highPrice));
  setText($('#lowPrice'), formatPrice(ticker.lowPrice));
  setText($('#volume'), formatCompact(ticker.volume));
  setText($('#quoteVolume'), formatUsd(ticker.quoteVolume));
  setText($('#openPrice'), formatPrice(ticker.openPrice));
  setText($('#rangeText'), `${formatPrice(ticker.lowPrice)} — ${formatPrice(ticker.highPrice)}`);
  setText($('#trades'), formatCompact(ticker.trades));
  setText($('#updatedAt'), `LIVE ${formatClock(new Date(ticker.at || Date.now()))}`);
  state.lastPrice = price;
  document.title = `${baseOf(state.active)} ${formatPrice(price)} · 550C`;
}

function renderTape() {
  const tape = $('#tape');
  if (!tape) return;
  tape.replaceChildren();
  const tickers = [...state.tickers.values()]
    .filter((ticker) => state.watchlist.includes(ticker.symbol))
    .sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent))
    .slice(0, 6);
  if (tickers.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'micro';
    empty.textContent = 'AWAITING FEED';
    tape.appendChild(empty);
    setText($('#tapeMeta'), 'IDLE');
    return;
  }
  for (const ticker of tickers) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'tape__item';
    item.dataset.symbol = ticker.symbol;
    const sym = document.createElement('span');
    sym.className = 'tape__sym';
    sym.textContent = `${baseOf(ticker.symbol)} / USDT`;
    const price = document.createElement('span');
    price.className = 'tape__px';
    price.textContent = formatPrice(ticker.lastPrice);
    const pct = document.createElement('span');
    pct.className = `tape__pct ${changeClass(ticker.priceChangePercent)}`;
    pct.textContent = `${signedArrow(ticker.priceChangePercent)} ${formatPct(ticker.priceChangePercent)}`;
    item.append(sym, price, pct);
    tape.appendChild(item);
  }
  setText($('#tapeMeta'), `${tickers.length} MOVERS`);
}

function emptyBlock(title, subtitle) {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  const mark = document.createElement('div');
  mark.className = 'empty__mark';
  mark.textContent = '⌁';
  const strong = document.createElement('b');
  strong.textContent = title;
  const sub = document.createElement('span');
  sub.textContent = subtitle;
  wrap.append(mark, strong, sub);
  return wrap;
}

function renderSignals() {
  const list = $('#signalList');
  if (!list) return;
  list.replaceChildren();
  setText($('#signalCount'), String(state.signals.length));
  if (state.signals.length === 0) {
    list.appendChild(emptyBlock('SCANNER STANDBY', '每 60 秒扫描 15M / 1H 周期'));
    return;
  }
  for (const signal of state.signals.slice(0, 50)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'signal-item';
    button.dataset.symbol = signal.symbol;
    button.dataset.interval = signal.interval;

    const side = document.createElement('span');
    const sideKey = signal.side === 'long' ? 'long' : signal.side === 'short' ? 'short' : 'watch';
    side.className = `side side--${sideKey}`;
    side.textContent = sideKey === 'long' ? 'LONG' : sideKey === 'short' ? 'SHORT' : 'WATCH';

    const main = document.createElement('span');
    main.className = 'signal-item__main';
    const top = document.createElement('span');
    top.className = 'signal-item__top';
    const sym = document.createElement('span');
    sym.className = 'signal-item__sym';
    sym.textContent = baseOf(signal.symbol);
    const strategy = document.createElement('span');
    strategy.className = 'signal-item__strategy';
    strategy.textContent = `${signal.strategyLabel || STRATEGY_LABELS[signal.strategy] || signal.strategy} · ${signal.interval}`;
    const time = document.createElement('span');
    time.className = 'signal-item__time';
    time.textContent = timeAgo(signal.createdAt);
    top.append(sym, strategy, time);

    const msg = document.createElement('span');
    msg.className = 'signal-item__msg';
    msg.textContent = signal.message || '';

    const meta = document.createElement('span');
    meta.className = 'signal-item__meta';
    meta.textContent = `${formatPrice(signal.price)} · ${formatPct(signal.changePercent)}`;

    main.append(top, msg, meta);
    button.append(side, main);
    list.appendChild(button);
  }
}

function renderAlerts() {
  const list = $('#alertList');
  if (!list) return;
  list.replaceChildren();
  setText($('#alertCount'), String(state.alerts.filter((alert) => alert.enabled).length));
  if (state.alerts.length === 0) {
    list.appendChild(emptyBlock('NO ALERT RULES', '创建一个价格或涨跌幅预警'));
    return;
  }
  for (const alert of state.alerts) {
    const item = document.createElement('div');
    item.className = `alert-item${alert.enabled ? '' : ' is-off'}`;
    item.dataset.id = alert.id;

    const top = document.createElement('div');
    top.className = 'alert-item__top';
    const dot = document.createElement('span');
    dot.className = `alert-item__state${alert.enabled ? '' : ' is-off'}`;
    const sym = document.createElement('span');
    sym.className = 'alert-item__sym';
    sym.textContent = baseOf(alert.symbol);
    const cond = document.createElement('span');
    cond.className = 'alert-item__cond';
    cond.textContent = `${ALERT_LABELS[alert.type] || alert.type} ${alert.type.startsWith('change') ? `${alert.threshold}%` : formatPrice(alert.threshold)}`;
    const acts = document.createElement('span');
    acts.className = 'alert-item__acts';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.dataset.toggle = alert.id;
    toggle.textContent = alert.enabled ? 'ON' : 'OFF';
    const del = document.createElement('button');
    del.type = 'button';
    del.dataset.delete = alert.id;
    del.className = 'is-danger';
    del.textContent = 'DEL';
    acts.append(toggle, del);
    top.append(dot, sym, cond, acts);

    const meta = document.createElement('div');
    meta.className = 'alert-item__meta';
    const cooldown = document.createElement('span');
    cooldown.textContent = `COOLDOWN ${Math.round(alert.cooldown / 60)}M`;
    const triggered = document.createElement('span');
    triggered.textContent = alert.lastTriggeredAt ? `LAST ${timeAgo(alert.lastTriggeredAt)}` : 'ARMED';
    meta.append(cooldown, triggered);
    item.append(top, meta);
    list.appendChild(item);
  }
}

function renderEventLog() {
  const log = $('#eventLog');
  if (!log) return;
  log.replaceChildren();
  if (state.notifications.length === 0) {
    log.appendChild(emptyBlock('NO EVENTS', '预警触发后会写入事件日志'));
    return;
  }
  for (const notification of state.notifications.slice(0, 12)) {
    const item = document.createElement('div');
    item.className = 'event-item';
    const time = document.createElement('span');
    time.className = 'event-item__time';
    time.textContent = formatTime(notification.createdAt);
    const body = document.createElement('span');
    body.className = 'event-item__body';
    const symbol = document.createElement('b');
    symbol.textContent = notification.symbol ? `${notification.symbol} ` : '';
    const text = document.createElement('span');
    text.textContent = notification.body || notification.title || '';
    body.append(symbol, text);
    item.append(time, body);
    log.appendChild(item);
  }
}

function renderNews() {
  const list = $('#newsList');
  if (!list) return;
  list.replaceChildren();
  setText($('#newsCount'), String(state.news.length));
  const activeBase = state.active ? baseOf(state.active) : null;
  const items = state.news
    .filter((item) => state.newsFilter === 'all' || !activeBase || (item.symbols || []).includes(activeBase))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  if (items.length === 0) {
    const message = state.newsStatus && state.newsStatus.lastError
      ? 'RSS 暂不可达，稍后自动重试'
      : '等待资讯源返回数据';
    list.appendChild(emptyBlock('INTEL SILENT', message));
    return;
  }
  for (const item of items) {
    const card = document.createElement('a');
    const safeLink = /^https?:\/\//i.test(item.link || '') ? item.link : '#';
    card.className = 'news-card';
    card.href = safeLink;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    if (isDesktop && safeLink !== '#') {
      card.addEventListener('click', (event) => {
        event.preventDefault();
        window.desktop.openExternal(safeLink);
      });
    }
    const meta = document.createElement('div');
    meta.className = 'news-card__meta';
    const source = document.createElement('span');
    source.className = 'news-card__source';
    source.textContent = item.source || 'WIRE';
    const time = document.createElement('span');
    time.textContent = timeAgo(item.publishedAt);
    meta.append(source, time);
    const title = document.createElement('div');
    title.className = 'news-card__title';
    title.textContent = item.title || '';
    const summary = document.createElement('div');
    summary.className = 'news-card__summary';
    summary.textContent = item.summary || '';
    card.append(meta, title, summary);
    if (item.symbols && item.symbols.length > 0) {
      const tags = document.createElement('div');
      tags.className = 'news-card__tags';
      for (const symbol of item.symbols.slice(0, 4)) {
        const tag = document.createElement('span');
        tag.className = 'news-card__tag';
        tag.textContent = symbol;
        tags.appendChild(tag);
      }
      card.appendChild(tags);
    }
    list.appendChild(card);
  }
}

function renderAll() {
  renderWatchlist();
  updateHeader();
  renderTape();
  renderSignals();
  renderAlerts();
  renderEventLog();
  renderNews();
  updateStatus();
}

function switchTab(tab) {
  state.tab = tab;
  $$('#intelTabs button').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === tab));
  $$('.tab-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab;
  });
}

function selectSymbol(symbol) {
  if (!symbol || !state.watchlist.includes(symbol)) return;
  state.active = symbol;
  writeLocal(LS_SYMBOL, symbol);
  $$('.watch-row').forEach((row) => {
    const active = row.dataset.symbol === symbol;
    row.classList.toggle('is-active', active);
    row.setAttribute('aria-pressed', String(active));
  });
  state.lastPrice = null;
  updateHeader();
  renderNews();
  loadChart();
}

function changeInterval(interval) {
  if (!INTERVALS.includes(interval)) return;
  state.interval = interval;
  $$('#tfGroup button').forEach((button) => button.classList.toggle('is-active', button.dataset.tf === interval));
  setText($('#chartBadge'), interval.toUpperCase());
  if (state.chart) state.chart.setInterval(interval);
  loadChart();
  scheduleChartSave();
}

function toggleIndicator(name) {
  if (!(name in state.indicators)) return;
  state.indicators[name] = !state.indicators[name];
  const button = $(`#indGroup button[data-ind="${name}"]`);
  if (button) button.classList.toggle('is-on', state.indicators[name]);
  if (state.chart) state.chart.setIndicators(state.indicators);
  scheduleChartSave();
}

function scheduleChartSave() {
  if (state.chartSaveTimer) clearTimeout(state.chartSaveTimer);
  state.chartSaveTimer = setTimeout(async () => {
    state.chartSaveTimer = null;
    try {
      const data = await api('/api/settings', {
        method: 'PATCH',
        body: { chart: { interval: state.interval, indicators: state.indicators } },
      });
      state.settings = data.settings;
    } catch (error) {
      console.error('保存图表设置失败', error);
    }
  }, 450);
}

async function loadChart(options = {}) {
  if (!state.active) {
    const loading = $('#chartLoading');
    const empty = $('#chartEmpty');
    if (loading) loading.hidden = true;
    if (empty) {
      empty.hidden = false;
      empty.textContent = 'NO PAIR SELECTED';
    }
    if (state.chart) state.chart.setData([]);
    return;
  }
  if (!state.chart) return;
  const token = ++state.chartToken;
  const symbol = state.active;
  const interval = state.interval;
  const loading = $('#chartLoading');
  const empty = $('#chartEmpty');
  if (loading) loading.hidden = false;
  if (empty) empty.hidden = true;
  try {
    const data = await api(`/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=360`);
    if (token !== state.chartToken) return;
    state.candles = data.candles || [];
    state.chart.setData(state.candles, { preserveView: Boolean(options.silent) });
    state.chart.setIndicators(state.indicators);
    if (loading) loading.hidden = true;
    if (state.candles.length === 0 && empty) {
      empty.hidden = false;
      empty.textContent = 'NO DATA // CHECK FEED';
    }
  } catch (error) {
    if (token !== state.chartToken) return;
    if (loading) loading.hidden = true;
    if (empty) {
      empty.hidden = false;
      empty.textContent = `FEED ERROR // ${error.message}`;
    }
  }
}

async function fetchTickers() {
  if (state.watchlist.length === 0) return;
  try {
    const query = encodeURIComponent(state.watchlist.join(','));
    const data = await api(`/api/ticker?symbols=${query}`);
    handleTickers(data.tickers || []);
  } catch (error) {
    state.source = { ...(state.source || {}), connected: false, lastError: error.message };
    updateStatus();
  }
}

function handleTickers(tickers) {
  if (!Array.isArray(tickers)) return;
  const seen = new Set();
  for (const ticker of tickers) {
    if (ticker && ticker.symbol) {
      state.tickers.set(ticker.symbol, ticker);
      seen.add(ticker.symbol);
    }
  }
  for (const symbol of state.watchlist) {
    if (!seen.has(symbol)) state.tickers.delete(symbol);
  }
  state.online = true;
  state.lastTickAt = Date.now();
  updateWatchRows();
  updateHeader();
  renderTape();
  updateStatus();
  if (state.chart && state.active) {
    const ticker = state.tickers.get(state.active);
    if (ticker) state.chart.updateLast(ticker.lastPrice);
  }
}

function handleAlert(notification) {
  if (!notification) return;
  state.notifications.unshift(notification);
  state.notifications = state.notifications.slice(0, 40);
  renderEventLog();
  showToast(notification.title || 'ALERT', notification.body || '', 'alert');
  playSound('alert');
  if (!isDesktop && state.settings && state.settings.desktopNotifications && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const item = new Notification(notification.title || '550C ALERT', { body: notification.body || '' });
      item.onclick = () => window.focus();
    } catch {
      // Notification may be unavailable in this context.
    }
  }
}

function handleSignal(signal) {
  if (!signal) return;
  state.signals.unshift(signal);
  state.signals = state.signals.slice(0, 100);
  renderSignals();
  showToast(`SIGNAL // ${signal.symbol}`, signal.message || '', 'signal');
}

function mergeNews(items) {
  if (!Array.isArray(items) || items.length === 0) return;
  const map = new Map(state.news.map((item) => [item.id, item]));
  for (const item of items) if (item && item.id) map.set(item.id, item);
  state.news = [...map.values()]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 120);
  renderNews();
}

function connectEvents() {
  if (state.eventSource) state.eventSource.close();
  const source = new EventSource('/api/events');
  state.eventSource = source;
  source.onopen = () => {
    state.streamOpen = true;
    updateStatus();
  };
  source.onerror = () => {
    state.streamOpen = false;
    updateStatus();
  };
  source.addEventListener('tickers', (event) => {
    try {
      handleTickers(JSON.parse(event.data));
    } catch {
      // Ignore a malformed frame.
    }
  });
  source.addEventListener('status', (event) => {
    try {
      const data = JSON.parse(event.data);
      state.source = data;
      if (data.news) state.newsStatus = data.news;
      updateStatus();
    } catch {
      // Ignore a malformed frame.
    }
  });
  source.addEventListener('settings', (event) => {
    try {
      const settings = JSON.parse(event.data);
      const sourceChanged = state.settings && state.settings.source !== settings.source;
      state.settings = settings;
      applyTheme(settings.theme);
      applyEffects(settings.effects);
      updateSettingsControls();
      if (sourceChanged) {
        state.tickers.clear();
        updateWatchRows();
        updateHeader();
        renderTape();
      }
      updateStatus();
    } catch {
      // Ignore a malformed frame.
    }
  });
  source.addEventListener('alerts', (event) => {
    try {
      state.alerts = JSON.parse(event.data);
      renderAlerts();
    } catch {
      // Ignore a malformed frame.
    }
  });
  source.addEventListener('alert', (event) => {
    try {
      handleAlert(JSON.parse(event.data));
    } catch {
      // Ignore a malformed frame.
    }
  });
  source.addEventListener('signal', (event) => {
    try {
      handleSignal(JSON.parse(event.data));
    } catch {
      // Ignore a malformed frame.
    }
  });
  source.addEventListener('news', (event) => {
    try {
      const data = JSON.parse(event.data);
      mergeNews(data.items);
    } catch {
      // Ignore a malformed frame.
    }
  });
}

async function fetchHealth() {
  try {
    const data = await api('/api/health');
    state.health = data;
    if (data.news) state.newsStatus = data.news;
    if (data.source && !state.streamOpen) state.source = data.source;
    updateStatus();
  } catch {
    // Health is informational; the SSE status remains authoritative.
  }
}

function showToast(title, body, kind = 'info') {
  const stack = $('#toastStack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = `toast toast--${kind}`;
  const head = document.createElement('div');
  head.className = 'toast__head';
  const label = document.createElement('span');
  label.textContent = title || 'SYSTEM';
  const time = document.createElement('span');
  time.className = 'toast__time';
  time.textContent = formatClock();
  head.append(label, time);
  const text = document.createElement('div');
  text.className = 'toast__body';
  text.textContent = body || '';
  toast.append(head, text);
  toast.addEventListener('click', () => toast.remove());
  stack.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 220);
  }, 5600);
}

function ensureAudio() {
  if (state.audio) return state.audio;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    state.audio = new Ctx();
  } catch {
    state.audio = null;
  }
  return state.audio;
}

function playSound(kind = 'alert') {
  if (!state.settings || !state.settings.sound) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const beep = (frequency, offset, duration) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + offset + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + duration);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(ctx.currentTime + offset);
      oscillator.stop(ctx.currentTime + offset + duration + 0.02);
    };
    if (kind === 'alert') {
      beep(880, 0, 0.11);
      beep(1180, 0.14, 0.14);
    } else {
      beep(720, 0, 0.07);
    }
  } catch {
    // Audio is optional.
  }
}

function populateSearchResults(items, query) {
  const box = $('#searchResults');
  if (!box) return;
  box.replaceChildren();
  state.search.items = items;
  state.search.active = -1;
  if (!query) {
    box.hidden = true;
    return;
  }
  const normalized = query.trim().toUpperCase();
  const manual = /^[A-Z0-9]{2,16}USDT$/.test(normalized) && !state.watchlist.includes(normalized);
  if (manual) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'search__result';
    add.dataset.symbol = normalized;
    const strong = document.createElement('strong');
    strong.textContent = normalized;
    const span = document.createElement('span');
    span.textContent = 'ADD';
    add.append(strong, span);
    box.appendChild(add);
  }
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search__result';
    button.dataset.symbol = item.symbol;
    const strong = document.createElement('strong');
    strong.textContent = item.symbol;
    const span = document.createElement('span');
    span.textContent = state.watchlist.includes(item.symbol) ? 'TRACKED' : item.base;
    button.append(strong, span);
    box.appendChild(button);
  }
  if (box.childElementCount === 0) {
    const empty = document.createElement('div');
    empty.className = 'search__empty';
    empty.textContent = 'NO MATCHING PAIR';
    box.appendChild(empty);
  }
  box.hidden = false;
}

const searchPairs = debounce(async (value) => {
  const query = value.trim();
  state.search.query = query;
  if (!query) {
    populateSearchResults([], '');
    return;
  }
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
    if (state.search.query !== query) return;
    populateSearchResults(data.results || [], query);
  } catch {
    if (state.search.query === query) populateSearchResults([], query);
  }
}, 200);

function closeSearch() {
  const box = $('#searchResults');
  if (box) box.hidden = true;
  state.search.active = -1;
}

async function addSymbol(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) return;
  if (state.watchlist.includes(normalized)) {
    selectSymbol(normalized);
    closeSearch();
    const input = $('#searchInput');
    if (input) input.value = '';
    return;
  }
  try {
    const data = await api('/api/watchlist', { method: 'POST', body: { symbol: normalized } });
    state.watchlist = data.watchlist || [...state.watchlist, normalized];
    renderWatchlist();
    selectSymbol(normalized);
    closeSearch();
    const input = $('#searchInput');
    if (input) input.value = '';
    showToast('WATCHLIST', `${normalized} 已加入监控`, 'info');
  } catch (error) {
    showToast('ADD FAILED', error.message, 'alert');
  }
}

async function removeSymbol(symbol) {
  if (!symbol) return;
  try {
    const data = await api(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
    state.watchlist = data.watchlist || state.watchlist.filter((item) => item !== symbol);
    state.tickers.delete(symbol);
    state.alerts = state.alerts.filter((alert) => alert.symbol !== symbol);
    if (state.active === symbol) state.active = state.watchlist[0] || null;
    renderWatchlist();
    renderAlerts();
    if (state.active) {
      writeLocal(LS_SYMBOL, state.active);
      updateHeader();
      loadChart();
    } else {
      updateHeader();
      renderNews();
      loadChart();
    }
    showToast('WATCHLIST', `${symbol} 已移除`, 'info');
  } catch (error) {
    showToast('REMOVE FAILED', error.message, 'alert');
  }
}

function openAlertForm() {
  const form = $('#alertForm');
  if (!form) return;
  renderAlertSymbolOptions();
  form.hidden = false;
  const select = $('#alertSymbol');
  if (select && state.active) select.value = state.active;
  const type = $('#alertType');
  if (type) type.value = 'price_above';
  const threshold = $('#alertThreshold');
  const ticker = state.active ? state.tickers.get(state.active) : null;
  if (threshold && ticker) threshold.value = String(Number(ticker.lastPrice).toPrecision(8)).replace(/0+$/, '').replace(/\.$/, '');
  updateAlertPlaceholder();
  if (threshold) threshold.focus();
}

function updateAlertPlaceholder() {
  const type = $('#alertType');
  const threshold = $('#alertThreshold');
  if (!type || !threshold) return;
  threshold.placeholder = type.value.startsWith('change') ? '5.0' : '0.00';
}

async function submitAlert(event) {
  event.preventDefault();
  const symbol = $('#alertSymbol') ? $('#alertSymbol').value : state.active;
  const type = $('#alertType') ? $('#alertType').value : 'price_above';
  const threshold = Number($('#alertThreshold') ? $('#alertThreshold').value : 0);
  const cooldown = Number($('#alertCooldown') ? $('#alertCooldown').value : 900);
  if (!symbol) {
    showToast('ALERT', '请先选择交易对', 'alert');
    return;
  }
  if (!Number.isFinite(threshold) || threshold <= 0) {
    showToast('ALERT', '阈值必须大于 0', 'alert');
    return;
  }
  try {
    const data = await api('/api/alerts', { method: 'POST', body: { symbol, type, threshold, cooldown } });
    state.alerts.unshift(data.alert);
    renderAlerts();
    const form = $('#alertForm');
    if (form) form.hidden = true;
    showToast('ALERT ARMED', `${symbol} · ${ALERT_LABELS[type]} ${threshold}`, 'info');
  } catch (error) {
    showToast('ALERT FAILED', error.message, 'alert');
  }
}

async function toggleAlert(id) {
  const alert = state.alerts.find((item) => item.id === id);
  if (!alert) return;
  try {
    const data = await api(`/api/alerts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { enabled: !alert.enabled },
    });
    const index = state.alerts.findIndex((item) => item.id === id);
    if (index >= 0) state.alerts[index] = data.alert;
    renderAlerts();
  } catch (error) {
    showToast('ALERT FAILED', error.message, 'alert');
  }
}

async function deleteAlert(id) {
  try {
    const data = await api(`/api/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.alerts = data.alerts || state.alerts.filter((item) => item.id !== id);
    renderAlerts();
  } catch (error) {
    showToast('ALERT FAILED', error.message, 'alert');
  }
}

async function scanSignals() {
  if (state.scanning) return;
  state.scanning = true;
  const buttons = [$('#btnScan'), $('#btnScanInline')].filter(Boolean);
  buttons.forEach((button) => {
    button.disabled = true;
  });
  try {
    const data = await api('/api/signals/scan', { method: 'POST' });
    if (Array.isArray(data.signals)) {
      state.signals = data.signals;
      renderSignals();
    }
    showToast('SCANNER', data.created > 0 ? `扫描完成 · 新增 ${data.created} 条信号` : '扫描完成 · 暂无新信号', 'info');
  } catch (error) {
    showToast('SCANNER', error.message, 'alert');
  } finally {
    state.scanning = false;
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

function renderAlertSymbolOptions() {
  const select = $('#alertSymbol');
  if (!select) return;
  const previous = select.value;
  select.replaceChildren();
  for (const symbol of state.watchlist) {
    const option = document.createElement('option');
    option.value = symbol;
    option.textContent = symbol;
    select.appendChild(option);
  }
  if (state.watchlist.includes(previous)) select.value = previous;
  else if (state.active) select.value = state.active;
}

function getPath(object, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}

function buildPatch(path, value) {
  const parts = path.split('.');
  const patch = {};
  let cursor = patch;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
  return patch;
}

function renderSettings() {
  const body = $('#settingsBody');
  if (!body) return;
  const settings = state.settings || {};
  const effects = settings.effects || {};
  const desktopRows = isDesktop
    ? `
      <div class="setting-row">
        <div class="setting-row__label"><b>开机自动启动</b><span>登录 Windows 后在托盘运行</span></div>
        <button class="switch ${settings.launchAtLogin ? 'is-on' : ''}" data-toggle="launchAtLogin" aria-pressed="${Boolean(settings.launchAtLogin)}"></button>
      </div>
      <div class="setting-row">
        <div class="setting-row__label"><b>关闭窗口时最小化到托盘</b><span>预警与采集继续在后台运行</span></div>
        <button class="switch ${settings.minimizeToTray ? 'is-on' : ''}" data-toggle="minimizeToTray" aria-pressed="${Boolean(settings.minimizeToTray)}"></button>
      </div>`
    : `
      <div class="setting-row">
        <div class="setting-row__label"><b>桌面客户端功能</b><span>托盘、开机启动和原生通知需在 Electron 客户端中使用</span></div>
      </div>`;

  body.innerHTML = `
    <section class="settings-section">
      <div class="settings-section__head">01 / APPEARANCE · 550C</div>
      <div class="settings-section__body">
        <div class="theme-grid">
          ${THEMES.map((theme) => `
            <button type="button" class="theme-swatch ${settings.theme === theme.id ? 'is-active' : ''}" data-theme-choice="${theme.id}">
              <span class="theme-swatch__bar">${theme.bars.map((color) => `<i style="background:${color}"></i>`).join('')}</span>
              <span class="theme-swatch__name">${theme.label}</span>
            </button>
          `).join('')}
        </div>
        <div class="setting-row">
          <div class="setting-row__label"><b>扫描线与暗角</b><span>CRT 屏幕纹理，可随时关闭</span></div>
          <button class="switch ${effects.scanlines !== false ? 'is-on' : ''}" data-toggle="effects.scanlines" aria-pressed="${effects.scanlines !== false}"></button>
        </div>
        <div class="setting-row">
          <div class="setting-row__label"><b>屏幕暗角</b><span>边缘压暗，增强终端感</span></div>
          <button class="switch ${effects.vignette !== false ? 'is-on' : ''}" data-toggle="effects.vignette" aria-pressed="${effects.vignette !== false}"></button>
        </div>
        <div class="setting-row">
          <div class="setting-row__label"><b>磷光辉光</b><span>面板与强调色的微弱发光</span></div>
          <button class="switch ${effects.glow !== false ? 'is-on' : ''}" data-toggle="effects.glow" aria-pressed="${effects.glow !== false}"></button>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-section__head">02 / DATA FEED</div>
      <div class="settings-section__body">
        <div class="setting-row">
          <div class="setting-row__label"><b>行情源</b><span>本地演示模式不需要联网</span></div>
          <select class="setting-select" id="settingSource">
            <option value="binance" ${settings.source === 'binance' ? 'selected' : ''}>BINANCE SPOT</option>
            <option value="demo" ${settings.source === 'demo' ? 'selected' : ''}>DEMO / SIMULATED</option>
          </select>
        </div>
        <div class="setting-row">
          <div class="setting-row__label"><b>行情地址</b><span>可替换为可达的 Binance 镜像或反向代理</span></div>
          <input class="setting-input" id="settingBase" value="${escapeHtml(settings.binanceBase || '')}" spellcheck="false">
        </div>
        <div class="setting-row">
          <div class="setting-row__label"><b>轮询间隔</b><span>服务端拉取 24H 行情的频率</span></div>
          <select class="setting-select" id="settingPoll">
            <option value="2000" ${Number(settings.pollMs) === 2000 ? 'selected' : ''}>2 SECONDS</option>
            <option value="3000" ${Number(settings.pollMs) === 3000 ? 'selected' : ''}>3 SECONDS</option>
            <option value="5000" ${Number(settings.pollMs) === 5000 ? 'selected' : ''}>5 SECONDS</option>
          </select>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-section__head">03 / ALERTS & DESKTOP</div>
      <div class="settings-section__body">
        <div class="setting-row">
          <div class="setting-row__label"><b>系统通知</b><span>预警触发时发送原生通知</span></div>
          <button class="switch ${settings.desktopNotifications ? 'is-on' : ''}" data-toggle="desktopNotifications" aria-pressed="${Boolean(settings.desktopNotifications)}"></button>
        </div>
        <div class="setting-row">
          <div class="setting-row__label"><b>提示音</b><span>预警触发时播放终端提示音</span></div>
          <button class="switch ${settings.sound ? 'is-on' : ''}" data-toggle="sound" aria-pressed="${Boolean(settings.sound)}"></button>
        </div>
        <div class="setting-row">
          <div class="setting-row__label"><b>暂停全部预警</b><span>保留规则，但暂时不触发</span></div>
          <button class="switch ${settings.alertsMuted ? 'is-on' : ''}" data-toggle="alertsMuted" aria-pressed="${Boolean(settings.alertsMuted)}"></button>
        </div>
        ${desktopRows}
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-section__head">04 / SYSTEM</div>
      <div class="settings-section__body">
        <div class="setting-row">
          <div class="setting-row__label"><b>测试通知通道</b><span>发送一条本地通知与事件日志</span></div>
          <button class="btn btn--ghost btn--sm" data-action="test-notification">TEST</button>
        </div>
        ${isDesktop ? `<div class="setting-row">
          <div class="setting-row__label"><b>数据目录</b><span>state.json 与本地运行数据</span></div>
          <button class="btn btn--ghost btn--sm" data-action="open-data">OPEN</button>
        </div>` : ''}
        <div class="setting-row">
          <div class="setting-row__label"><b>清空事件日志</b><span>不会删除预警规则</span></div>
          <button class="btn btn--ghost btn--sm" data-action="clear-log">CLEAR</button>
        </div>
        <div class="setting-row">
          <div class="setting-row__label"><b>终端版本</b><span>${escapeHtml(state.version)} · ${isDesktop ? `Electron ${escapeHtml(window.desktop.versions.electron)}` : 'WEB PREVIEW'}</span></div>
          <span class="micro">550C</span>
        </div>
        <p class="settings-note">Binance 公共行情无需 API Key。若当前网络无法直连，切换到 DEMO 可完整验证界面、预警与信号逻辑；正式部署时建议将行情地址改为你自己的反向代理。</p>
      </div>
    </section>

    <div class="settings-actions">
      <button class="btn btn--ghost btn--sm" data-close-modal>CLOSE</button>
    </div>
  `;
}

function updateSettingsControls() {
  if (!state.settingsOpen || !state.settings) return;
  const body = $('#settingsBody');
  if (!body) return;
  const settings = state.settings;
  $$('.theme-swatch', body).forEach((button) => {
    button.classList.toggle('is-active', button.dataset.themeChoice === settings.theme);
  });
  $$('[data-toggle]', body).forEach((button) => {
    const value = Boolean(getPath(settings, button.dataset.toggle));
    button.classList.toggle('is-on', value);
    button.setAttribute('aria-pressed', String(value));
  });
  const source = $('#settingSource');
  if (source) source.value = settings.source;
  const poll = $('#settingPoll');
  if (poll) poll.value = String(settings.pollMs);
  const base = $('#settingBase');
  if (base && document.activeElement !== base) base.value = settings.binanceBase || '';
}

async function patchSettings(patch) {
  try {
    const data = await api('/api/settings', { method: 'PATCH', body: patch });
    state.settings = data.settings;
    applyTheme(state.settings.theme);
    applyEffects(state.settings.effects);
    updateSettingsControls();
    updateStatus();
    return state.settings;
  } catch (error) {
    showToast('SETTINGS', error.message, 'alert');
    return null;
  }
}

async function handleSettingToggle(path) {
  if (!state.settings) return;
  const current = Boolean(getPath(state.settings, path));
  const next = !current;
  if (path === 'launchAtLogin' && isDesktop) {
    await window.desktop.setLaunchAtLogin(next);
  }
  const settings = await patchSettings(buildPatch(path, next));
  if (settings && path.startsWith('effects.')) applyEffects(settings.effects);
  if (path === 'desktopNotifications' && next && !isDesktop && 'Notification' in window) {
    try {
      await Notification.requestPermission();
    } catch {
      // Permission is optional.
    }
  }
}

async function openSettings() {
  state.settingsOpen = true;
  renderSettings();
  const root = $('#modalRoot');
  if (root) root.hidden = false;
  updateSettingsControls();
}

function closeSettings() {
  state.settingsOpen = false;
  const root = $('#modalRoot');
  if (root) root.hidden = true;
}

async function testNotification() {
  if (!isDesktop && 'Notification' in window && Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch {
      // Ignore.
    }
  }
  try {
    await api('/api/notifications/test', { method: 'POST' });
    showToast('LINK', '测试通知已发送', 'info');
  } catch (error) {
    showToast('LINK', error.message, 'alert');
  }
}

function wireSettings() {
  const body = $('#settingsBody');
  if (!body) return;
  body.addEventListener('click', async (event) => {
    const themeButton = event.target.closest('[data-theme-choice]');
    if (themeButton) {
      await patchSettings({ theme: themeButton.dataset.themeChoice });
      return;
    }
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      await handleSettingToggle(toggle.dataset.toggle);
      return;
    }
    const action = event.target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'test-notification') await testNotification();
    else if (action.dataset.action === 'open-data' && isDesktop) await window.desktop.openDataFolder();
    else if (action.dataset.action === 'clear-log') {
      try {
        await api('/api/notifications/clear', { method: 'POST' });
        state.notifications = [];
        renderEventLog();
        showToast('EVENT LOG', '日志已清空', 'info');
      } catch (error) {
        showToast('EVENT LOG', error.message, 'alert');
      }
    }
  });
  body.addEventListener('change', async (event) => {
    if (event.target.id === 'settingSource') {
      showToast('DATA FEED', '正在切换行情源 ...', 'info');
      await patchSettings({ source: event.target.value });
    } else if (event.target.id === 'settingPoll') {
      await patchSettings({ pollMs: Number(event.target.value) });
    } else if (event.target.id === 'settingBase') {
      const value = event.target.value.trim();
      if (!/^https?:\/\/\S+$/i.test(value)) {
        showToast('DATA FEED', '请输入合法的 http(s) 地址', 'alert');
        return;
      }
      await patchSettings({ binanceBase: value });
    }
  });
}

function wireWindowControls() {
  if (!isDesktop) {
    const controls = $('#winControls');
    if (controls) controls.hidden = true;
    return;
  }
  const controls = $('#winControls');
  if (controls) controls.hidden = false;
  $('#winMin')?.addEventListener('click', () => window.desktop.minimize());
  $('#winMax')?.addEventListener('click', () => window.desktop.toggleMaximize());
  $('#winClose')?.addEventListener('click', () => window.desktop.close());
  window.desktop.onWindowState(({ maximized }) => {
    const button = $('#winMax');
    if (button) button.textContent = maximized ? '❐' : '□';
  });
  window.desktop.isMaximized().then((maximized) => {
    const button = $('#winMax');
    if (button) button.textContent = maximized ? '❐' : '□';
  }).catch(() => {});
}

function wireEvents() {
  renderLogo('#bootLogo');
  renderLogo('#headerLogo');
  wireWindowControls();
  wireSettings();

  $('#watchList')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('[data-remove]')) return;
    const row = event.target.closest('.watch-row');
    if (!row) return;
    event.preventDefault();
    selectSymbol(row.dataset.symbol);
  });

  $('#watchList')?.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      event.stopPropagation();
      removeSymbol(remove.dataset.remove);
      return;
    }
    const row = event.target.closest('.watch-row');
    if (row) selectSymbol(row.dataset.symbol);
  });

  $('#tape')?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-symbol]');
    if (item) selectSymbol(item.dataset.symbol);
  });

  const searchInput = $('#searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => searchPairs(searchInput.value));
    searchInput.addEventListener('focus', () => {
      if (searchInput.value.trim()) searchPairs(searchInput.value);
    });
    searchInput.addEventListener('keydown', (event) => {
      const results = $$('.search__result');
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.search.active = Math.min(results.length - 1, state.search.active + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.search.active = Math.max(0, state.search.active - 1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const target = results[state.search.active] || results[0];
        if (target) addSymbol(target.dataset.symbol);
        else if (/^[A-Z0-9]{2,16}USDT$/.test(searchInput.value.trim().toUpperCase())) addSymbol(searchInput.value);
        return;
      } else if (event.key === 'Escape') {
        closeSearch();
        searchInput.blur();
        return;
      } else {
        return;
      }
      results.forEach((item, index) => item.classList.toggle('is-active', index === state.search.active));
      resultScroll(results[state.search.active]);
    });
  }

  $('#searchResults')?.addEventListener('click', (event) => {
    const result = event.target.closest('[data-symbol]');
    if (result) addSymbol(result.dataset.symbol);
  });

  $('#tfGroup')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tf]');
    if (button) changeInterval(button.dataset.tf);
  });

  $('#indGroup')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ind]');
    if (button) toggleIndicator(button.dataset.ind);
  });

  $('#btnResetChart')?.addEventListener('click', () => state.chart && state.chart.resetView());
  $('#btnAddFocus')?.addEventListener('click', () => {
    searchInput?.focus();
    searchInput?.select();
  });

  $('#intelTabs')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button) switchTab(button.dataset.tab);
  });

  $('#btnNewAlert')?.addEventListener('click', openAlertForm);
  $('#btnCancelAlert')?.addEventListener('click', () => {
    const form = $('#alertForm');
    if (form) form.hidden = true;
  });
  $('#alertType')?.addEventListener('change', updateAlertPlaceholder);
  $('#alertForm')?.addEventListener('submit', submitAlert);

  $('#alertList')?.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      toggleAlert(toggle.dataset.toggle);
      return;
    }
    const del = event.target.closest('[data-delete]');
    if (del) deleteAlert(del.dataset.delete);
  });

  $('#btnScan')?.addEventListener('click', scanSignals);
  $('#btnScanInline')?.addEventListener('click', scanSignals);

  $('#btnClearLog')?.addEventListener('click', async () => {
    try {
      await api('/api/notifications/clear', { method: 'POST' });
      state.notifications = [];
      renderEventLog();
    } catch (error) {
      showToast('EVENT LOG', error.message, 'alert');
    }
  });

  $('#signalList')?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-symbol]');
    if (!item) return;
    selectSymbol(item.dataset.symbol);
    if (item.dataset.interval && INTERVALS.includes(item.dataset.interval)) changeInterval(item.dataset.interval);
  });

  $('#newsFilter')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    state.newsFilter = button.dataset.filter;
    $$('#newsFilter button').forEach((item) => item.classList.toggle('is-active', item === button));
    renderNews();
  });

  $('#btnSettings')?.addEventListener('click', openSettings);
  $('#btnFeedSettings')?.addEventListener('click', openSettings);
  $('#btnFeedDemo')?.addEventListener('click', async () => {
    const settings = await patchSettings({ source: 'demo' });
    if (settings) showToast('DATA FEED', '已切换到 DEMO 模拟行情', 'info');
  });
  $('#modalRoot')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-modal]')) closeSettings();
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.search')) closeSearch();
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      searchInput?.focus();
      searchInput?.select();
      return;
    }
    if (event.key === 'Escape') {
      if (state.settingsOpen) closeSettings();
      else if (!$('#searchResults')?.hidden) closeSearch();
    }
  });

  $('#shell')?.addEventListener('pointerdown', () => ensureAudio(), { once: true });

  if (isDesktop) {
    window.desktop.onNavigate((payload) => {
      if (payload && payload.symbol && payload.symbol !== 'SYSTEM' && state.watchlist.includes(payload.symbol)) {
        selectSymbol(payload.symbol);
      }
      if (payload && payload.tab) switchTab(payload.tab);
    });
    document.querySelector('.titlebar')?.addEventListener('dblclick', (event) => {
      if (event.target.closest('button')) return;
      window.desktop.toggleMaximize();
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      fetchHealth();
      if (state.chart) loadChart({ silent: true });
    }
  });
}

function resultScroll(node) {
  if (!node) return;
  const box = $('#searchResults');
  if (!box) return;
  const top = node.offsetTop;
  const bottom = top + node.offsetHeight;
  if (top < box.scrollTop) box.scrollTop = top;
  else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
}

function startTimers() {
  if (state.clockTimer) clearInterval(state.clockTimer);
  state.clockTimer = setInterval(() => {
    setText($('#clock'), formatClock());
  }, 1000);
  setText($('#clock'), formatClock());

  if (state.healthTimer) clearInterval(state.healthTimer);
  state.healthTimer = setInterval(fetchHealth, 15_000);
  fetchHealth();

  if (state.klineTimer) clearInterval(state.klineTimer);
  state.klineTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && state.active) loadChart({ silent: true });
    if (!state.streamOpen) fetchTickers();
  }, 25_000);
}

function showShell() {
  const shell = $('#shell');
  if (shell) shell.hidden = false;
  requestAnimationFrame(() => {
    if (!state.chart) {
      const canvas = $('#chart');
      const tip = $('#chartTip');
      state.chart = new PriceChart(canvas, tip);
      state.chart.setIndicators(state.indicators);
      state.chart.setInterval(state.interval);
    }
    if (state.chart) {
      state.chart.refreshTheme();
      state.chart.resize();
    }
    loadChart();
    setTimeout(() => {
      const boot = $('#boot');
      if (boot) boot.classList.add('is-done');
    }, 320);
  });
}

async function bootFetch() {
  setBootProgress('CONNECTING LOCAL CORE ...');
  try {
    const data = await api('/api/state');
    state.settings = data.settings || {};
    state.watchlist = Array.isArray(data.watchlist) ? data.watchlist : [];
    state.alerts = data.alerts || [];
    state.signals = data.signals || [];
    state.news = data.news || [];
    state.notifications = data.notifications || [];
    state.newsStatus = data.newsStatus || null;
    state.source = data.source || null;
    state.health = null;
    state.version = data.version || '0.1.0';

    const savedChart = (() => {
      try {
        return JSON.parse(readLocal(LS_CHART) || 'null');
      } catch {
        return null;
      }
    })();
    const chartSettings = data.settings && data.settings.chart ? data.settings.chart : {};
    const savedSymbol = readLocal(LS_SYMBOL);
    state.active = state.watchlist.includes(savedSymbol) ? savedSymbol : state.watchlist[0] || null;
    state.interval = INTERVALS.includes(chartSettings.interval)
      ? chartSettings.interval
      : savedChart && INTERVALS.includes(savedChart.interval) ? savedChart.interval : '15m';
    state.indicators = {
      ...state.indicators,
      ...(chartSettings.indicators || {}),
      ...(savedChart && savedChart.indicators ? savedChart.indicators : {}),
    };
    applyTheme(state.settings.theme || readLocal(LS_THEME) || 'amber');
    applyEffects(state.settings.effects || {});
    $$('#tfGroup button').forEach((button) => button.classList.toggle('is-active', button.dataset.tf === state.interval));
    $$('#indGroup button').forEach((button) => button.classList.toggle('is-on', Boolean(state.indicators[button.dataset.ind])));
    setText($('#chartBadge'), state.interval.toUpperCase());
    renderAll();
    showShell();
    connectEvents();
    startTimers();
    state.booted = true;
    setBootProgress('LINK ESTABLISHED // TERMINAL READY');
    fetchTickers();
  } catch (error) {
    setBootProgress(`CORE OFFLINE // ${String(error.message || 'RETRY').toUpperCase()}`);
    setTimeout(bootFetch, 2200);
  }
}

wireEvents();
bootFetch();
