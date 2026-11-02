'use strict';

const INTERVALS = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

const VALID_INTERVALS = Object.keys(INTERVALS);

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashString(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, patch) {
  const out = { ...base };
  if (!isPlainObject(patch)) return out;
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      out[key] = deepMerge(base[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  if (number >= 10_000) return number.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (number >= 100) return number.toLocaleString('en-US', { maximumFractionDigits: 3 });
  if (number >= 1) return number.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (number >= 0.01) return number.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return number.toPrecision(6);
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function alignTime(time, interval) {
  const ms = INTERVALS[interval] || 60_000;
  return Math.floor(time / ms) * ms;
}

module.exports = {
  INTERVALS,
  VALID_INTERVALS,
  HttpError,
  clamp,
  sleep,
  hashString,
  mulberry32,
  isPlainObject,
  deepMerge,
  normalizeSymbol,
  formatPrice,
  numeric,
  alignTime,
};
