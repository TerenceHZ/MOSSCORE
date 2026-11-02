'use strict';

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period, seedFromStart = false) {
  const out = new Array(values.length).fill(null);
  if (period <= 0 || values.length === 0) return out;
  const k = 2 / (period + 1);
  let previous = null;
  if (seedFromStart) {
    previous = values[0];
    out[0] = previous;
    for (let i = 1; i < values.length; i += 1) {
      previous = values[i] * k + previous * (1 - k);
      out[i] = previous;
    }
    return out;
  }
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  previous = sum / period;
  out[period - 1] = previous;
  for (let i = period; i < values.length; i += 1) {
    previous = values[i] * k + previous * (1 - k);
    out[i] = previous;
  }
  return out;
}

function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    const up = delta > 0 ? delta : 0;
    const down = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function macd(values, fast = 12, slow = 26, signal = 9) {
  const fastLine = ema(values, fast, true);
  const slowLine = ema(values, slow, true);
  const dif = values.map((_, index) =>
    fastLine[index] === null || slowLine[index] === null ? null : fastLine[index] - slowLine[index],
  );
  const compact = dif.filter((value) => value !== null);
  const deaCompact = ema(compact, signal, true);
  let cursor = 0;
  const dea = dif.map((value) => {
    if (value === null) return null;
    const out = deaCompact[cursor];
    cursor += 1;
    return out;
  });
  const hist = dif.map((value, index) =>
    value === null || dea[index] === null ? null : (value - dea[index]) * 2,
  );
  return { dif, dea, hist };
}

function bollinger(values, period = 20, multiplier = 2) {
  const mid = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i += 1) {
    let variance = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      variance += (values[j] - mid[i]) ** 2;
    }
    const std = Math.sqrt(variance / period);
    upper[i] = mid[i] + std * multiplier;
    lower[i] = mid[i] - std * multiplier;
  }
  return { mid, upper, lower };
}

function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;
  const ranges = [];
  for (let i = 1; i < candles.length; i += 1) {
    const high = candles[i].h;
    const low = candles[i].l;
    const previousClose = candles[i - 1].c;
    ranges.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
  }
  let value = ranges.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
  out[period] = value;
  for (let i = period + 1; i < candles.length; i += 1) {
    value = (value * (period - 1) + ranges[i - 1]) / period;
    out[i] = value;
  }
  return out;
}

function lastValue(series) {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i] !== null && Number.isFinite(series[i])) return series[i];
  }
  return null;
}

module.exports = { sma, ema, rsi, macd, bollinger, atr, lastValue };
