export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function toNumber(value, fallback = NaN) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  const abs = Math.abs(number);
  if (abs >= 1000) {
    return number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (abs >= 1) {
    return number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  if (abs >= 0.01) {
    return number.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (abs === 0) return '0';
  return number.toPrecision(6).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatPct(value, signed = true) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  const sign = signed && number > 0 ? '+' : '';
  return `${sign}${number.toFixed(2)}%`;
}

export function formatCompact(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  const abs = Math.abs(number);
  if (abs >= 1e12) return `${(number / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(number / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(number / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(number / 1e3).toFixed(2)}K`;
  return number.toFixed(2);
}

export function formatUsd(value) {
  const text = formatCompact(value);
  return text === '--' ? text : `$${text}`;
}

export function changeClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'flat';
  return number > 0 ? 'up' : 'down';
}

export function signedArrow(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return '·';
  return number > 0 ? '▲' : '▼';
}

export function formatClock(date = new Date()) {
  return date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

export function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

export function timeAgo(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function baseOf(symbol) {
  return String(symbol || '').replace(/USDT$/, '');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setText(node, text) {
  if (node && node.textContent !== String(text)) node.textContent = String(text);
}

export function debounce(fn, delay = 200) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delay);
  };
}
