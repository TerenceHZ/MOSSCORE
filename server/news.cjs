'use strict';

const crypto = require('node:crypto');
const { hashString } = require('./util.cjs');

const NEWS_SOURCES = [
  { id: 'coindesk', name: 'COINDESK', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { id: 'cointelegraph', name: 'COINTELEGRAPH', url: 'https://cointelegraph.com/rss' },
  { id: 'decrypt', name: 'DECRYPT', url: 'https://decrypt.co/feed' },
];

const KEYWORDS = {
  BTC: ['bitcoin', 'btc'],
  ETH: ['ethereum', 'ether', 'eth'],
  SOL: ['solana', 'sol '],
  BNB: ['bnb', 'binance coin'],
  XRP: ['xrp', 'ripple'],
  DOGE: ['dogecoin', 'doge'],
  ADA: ['cardano', 'ada'],
  AVAX: ['avalanche', 'avax'],
  LINK: ['chainlink', 'link'],
  TON: ['toncoin', 'ton '],
  DOT: ['polkadot', 'dot '],
  TRX: ['tron', 'trx'],
  LTC: ['litecoin', 'ltc'],
  BCH: ['bitcoin cash', 'bch'],
  NEAR: ['near protocol'],
  APT: ['aptos', 'apt'],
  ARB: ['arbitrum', 'arb'],
  OP: ['optimism', 'op '],
  SUI: ['sui '],
  SEI: ['sei '],
  INJ: ['injective', 'inj'],
  TIA: ['celestia', 'tia'],
  FIL: ['filecoin', 'fil'],
  ATOM: ['cosmos', 'atom'],
  UNI: ['uniswap', 'uni'],
  AAVE: ['aave'],
  PEPE: ['pepe'],
  SHIB: ['shiba', 'shib'],
  WIF: ['dogwifhat', 'wif'],
  TAO: ['bittensor', 'tao'],
};

const DEMO_NEWS = [
  {
    id: 'nw_demo_1',
    title: 'BTC 重返 67,000 美元上方，ETF 资金流连续三日转正',
    summary: '现货 ETF 净流入回升，市场重新测试前期密集成交区。衍生品资金费率保持中性。',
    source: 'SIMULATED',
    symbols: ['BTC'],
    minutesAgo: 11,
    link: 'https://example.com/550c/demo/btc',
  },
  {
    id: 'nw_demo_2',
    title: '以太坊质押队列延长，L2 活动量升至月内高位',
    summary: '链上活动回暖，Gas 中位数小幅抬升；ETH/BTC 汇率仍处于区间震荡。',
    source: 'SIMULATED',
    symbols: ['ETH'],
    minutesAgo: 28,
    link: 'https://example.com/550c/demo/eth',
  },
  {
    id: 'nw_demo_3',
    title: 'SOL 生态 DEX 周成交额创季度新高',
    summary: ' meme 与 DeFi 板块同时活跃，SOL 短线波动率高于市场均值。',
    source: 'SIMULATED',
    symbols: ['SOL'],
    minutesAgo: 47,
    link: 'https://example.com/550c/demo/sol',
  },
  {
    id: 'nw_demo_4',
    title: '监管观察：多国稳定币规则进入实施阶段',
    summary: '合规成本上升，主要交易场所开始调整稳定币交易对与储备披露口径。',
    source: 'SIMULATED',
    symbols: ['BTC', 'ETH'],
    minutesAgo: 83,
    link: 'https://example.com/550c/demo/regulation',
  },
  {
    id: 'nw_demo_5',
    title: '衍生品市场：永续合约未平仓量温和回升',
    summary: '杠杆率仍低于年内高点，短期清算风险可控。关注美盘时段的成交量变化。',
    source: 'SIMULATED',
    symbols: ['BTC', 'ETH', 'SOL'],
    minutesAgo: 126,
    link: 'https://example.com/550c/demo/derivatives',
  },
];

async function fetchText(url, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*',
        'user-agent': '550C-Market-Terminal/0.1 (+local desktop)',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function stripTags(value) {
  return decodeEntities(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tagValue(block, tag) {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = block.match(pattern);
  return match ? decodeEntities(match[1]).trim() : '';
}

function atomLink(block) {
  const match = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (match) return decodeEntities(match[1]);
  return tagValue(block, 'link');
}

function parseFeed(xml, source) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi)
    || xml.match(/<entry\b[\s\S]*?<\/entry>/gi)
    || [];
  const items = [];
  for (const block of blocks.slice(0, 40)) {
    const title = stripTags(tagValue(block, 'title'));
    if (!title) continue;
    const link = stripTags(atomLink(block));
    const summaryRaw = tagValue(block, 'description') || tagValue(block, 'summary') || tagValue(block, 'content:encoded');
    const summary = stripTags(summaryRaw).slice(0, 260);
    const dateRaw = tagValue(block, 'pubDate') || tagValue(block, 'published') || tagValue(block, 'updated');
    const parsed = Date.parse(dateRaw);
    items.push({
      id: `nw_${hashString(link || `${source.id}:${title}`)}`,
      title,
      summary,
      link,
      source: source.name,
      sourceId: source.id,
      publishedAt: new Date(Number.isFinite(parsed) ? parsed : Date.now()).toISOString(),
    });
  }
  return items;
}

function matchSymbols(text) {
  const haystack = ` ${String(text || '').toLowerCase()} `;
  const found = new Set();
  for (const [symbol, words] of Object.entries(KEYWORDS)) {
    if (words.some((word) => haystack.includes(word))) found.add(symbol);
  }
  const cashtags = String(text || '').match(/\$([A-Za-z]{2,10})\b/g) || [];
  for (const tag of cashtags) found.add(tag.slice(1).toUpperCase());
  return [...found];
}

function demoItems() {
  const now = Date.now();
  return DEMO_NEWS.map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary,
    link: item.link,
    source: item.source,
    sourceId: 'demo',
    symbols: item.symbols,
    publishedAt: new Date(now - item.minutesAgo * 60_000).toISOString(),
  }));
}

class NewsService {
  constructor({ store, hub }) {
    this.store = store;
    this.hub = hub;
    this.timer = null;
    this.startTimer = null;
    this.running = false;
    this.status = {
      connected: false,
      lastError: null,
      lastRefreshAt: null,
      sources: NEWS_SOURCES.length,
    };
  }

  start() {
    if (this.timer) return;
    this.startTimer = setTimeout(() => this.refresh(), 3000);
    if (typeof this.startTimer.unref === 'function') this.startTimer.unref();
    this.timer = setInterval(() => this.refresh(), 5 * 60_000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.timer) clearInterval(this.timer);
    this.startTimer = null;
    this.timer = null;
  }

  getStatus() {
    return { ...this.status };
  }

  async refresh() {
    if (this.running) return;
    if (!this.store.settings.newsEnabled) return;
    this.running = true;
    try {
      const results = await Promise.allSettled(
        NEWS_SOURCES.map(async (source) => parseFeed(await fetchText(source.url), source)),
      );
      const incoming = [];
      const errors = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') incoming.push(...result.value);
        else errors.push(`${NEWS_SOURCES[index].name}: ${result.reason && result.reason.message ? result.reason.message : '不可达'}`);
      });

      if (incoming.length === 0) {
        if (this.store.settings.source === 'demo' && this.store.data.news.length === 0) {
          this.store.data.news = demoItems();
          this.store.save();
          this.hub.broadcast('news', { items: this.store.data.news });
        }
        this.status = {
          ...this.status,
          connected: false,
          lastError: errors.join(' / ') || '资讯源暂不可达',
          lastRefreshAt: new Date().toISOString(),
        };
        return;
      }

      const existing = new Map(this.store.data.news.map((item) => [item.id, item]));
      const fresh = [];
      for (const item of incoming) {
        const symbols = matchSymbols(`${item.title} ${item.summary}`);
        const enriched = { ...item, symbols };
        if (!existing.has(item.id)) fresh.push(enriched);
        existing.set(item.id, enriched);
      }
      const merged = [...existing.values()]
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
        .slice(0, 150);
      this.store.data.news = merged;
      this.store.save();
      if (fresh.length > 0 && this.hub) this.hub.broadcast('news', { items: fresh });
      this.status = {
        ...this.status,
        connected: true,
        lastError: errors.length > 0 ? errors.join(' / ') : null,
        lastRefreshAt: new Date().toISOString(),
      };
    } catch (error) {
      this.status = {
        ...this.status,
        connected: false,
        lastError: error.message,
        lastRefreshAt: new Date().toISOString(),
      };
    } finally {
      this.running = false;
    }
  }
}

module.exports = {
  NewsService,
  NEWS_SOURCES,
  parseFeed,
  matchSymbols,
  demoItems,
};
