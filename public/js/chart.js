import { clamp, formatPrice, formatPct, formatCompact, formatDate, formatTime } from './format.js';

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length === 0) return out;
  const k = 2 / (period + 1);
  let previous = values[0];
  out[0] = previous;
  for (let i = 1; i < values.length; i += 1) {
    previous = values[i] * k + previous * (1 - k);
    out[i] = previous;
  }
  return out;
}

function bollinger(values, period = 20, multiplier = 2) {
  const mid = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i += 1) {
    let variance = 0;
    for (let j = i - period + 1; j <= i; j += 1) variance += (values[j] - mid[i]) ** 2;
    const std = Math.sqrt(variance / period);
    upper[i] = mid[i] + std * multiplier;
    lower[i] = mid[i] - std * multiplier;
  }
  return { mid, upper, lower };
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
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function macd(values, fast = 12, slow = 26, signal = 9) {
  const fastLine = ema(values, fast);
  const slowLine = ema(values, slow);
  const dif = values.map((_, i) => (fastLine[i] === null || slowLine[i] === null ? null : fastLine[i] - slowLine[i]));
  const compact = dif.filter((value) => value !== null);
  const deaCompact = ema(compact, signal);
  let cursor = 0;
  const dea = dif.map((value) => {
    if (value === null) return null;
    const out = deaCompact[cursor];
    cursor += 1;
    return out;
  });
  const hist = dif.map((value, i) => (value === null || dea[i] === null ? null : (value - dea[i]) * 2));
  return { dif, dea, hist };
}

function niceTime(timestamp, interval) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '--';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  if (interval === '1d') return `${month}-${day}`;
  return `${hour}:${minute}`;
}

export class PriceChart {
  constructor(canvas, tooltip) {
    this.canvas = canvas;
    this.tooltip = tooltip;
    this.ctx = canvas.getContext('2d');
    this.candles = [];
    this.interval = '15m';
    this.indicators = { ma: true, boll: false, macd: false, rsi: false };
    this.ind = null;
    this.view = { start: 0, end: 1 };
    this.span = 1;
    this.stick = true;
    this.hover = null;
    this.drag = null;
    this.frame = 0;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.colors = {};
    this.layoutCache = null;
    this.resizeObserver = null;
    this.bound = {
      pointerdown: (event) => this.onPointerDown(event),
      pointermove: (event) => this.onPointerMove(event),
      pointerup: (event) => this.onPointerUp(event),
      pointerleave: () => this.onPointerLeave(),
      wheel: (event) => this.onWheel(event),
      dblclick: () => this.resetView(),
      resize: () => this.resize(),
    };
    this.bind();
    this.refreshTheme();
    this.resize();
  }

  bind() {
    this.canvas.addEventListener('pointerdown', this.bound.pointerdown);
    this.canvas.addEventListener('pointermove', this.bound.pointermove);
    this.canvas.addEventListener('pointerup', this.bound.pointerup);
    this.canvas.addEventListener('pointercancel', this.bound.pointerup);
    this.canvas.addEventListener('pointerleave', this.bound.pointerleave);
    this.canvas.addEventListener('wheel', this.bound.wheel, { passive: false });
    this.canvas.addEventListener('dblclick', this.bound.dblclick);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas.parentElement || this.canvas);
    } else {
      window.addEventListener('resize', this.bound.resize);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => this.schedule()).catch(() => {});
    }
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this.bound.pointerdown);
    this.canvas.removeEventListener('pointermove', this.bound.pointermove);
    this.canvas.removeEventListener('pointerup', this.bound.pointerup);
    this.canvas.removeEventListener('pointercancel', this.bound.pointerup);
    this.canvas.removeEventListener('pointerleave', this.bound.pointerleave);
    this.canvas.removeEventListener('wheel', this.bound.wheel);
    this.canvas.removeEventListener('dblclick', this.bound.dblclick);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    else window.removeEventListener('resize', this.bound.resize);
    if (this.frame) cancelAnimationFrame(this.frame);
  }

  refreshTheme() {
    const style = getComputedStyle(document.documentElement);
    const read = (name) => style.getPropertyValue(name).trim();
    this.colors = {
      accent: read('--accent'),
      accentBright: read('--accent-bright'),
      accentRgb: read('--accent-rgb'),
      text: read('--text'),
      text2: read('--text-2'),
      dim: read('--text-dim'),
      faint: read('--text-faint'),
      line: read('--line'),
      lineStrong: read('--line-strong'),
      grid: read('--grid'),
      green: read('--green'),
      red: read('--red'),
      cyan: read('--cyan'),
      bg: read('--bg'),
      panel: read('--panel'),
    };
    this.schedule();
  }

  setInterval(interval) {
    this.interval = interval;
    this.resetView();
  }

  setIndicators(indicators) {
    this.indicators = { ...this.indicators, ...indicators };
    this.layoutCache = null;
    this.compute();
    this.schedule();
  }

  setData(candles, options = {}) {
    const previousLength = this.candles.length;
    this.candles = Array.isArray(candles) ? candles.filter((c) => c && Number.isFinite(c.c)) : [];
    this.compute();
    if (this.candles.length === 0) {
      this.view = { start: 0, end: 1 };
      this.span = 1;
      this.schedule();
      return;
    }
    if (!options.preserveView || previousLength === 0) {
      this.resetView(false);
    } else {
      this.span = clamp(this.span, 20, Math.min(500, this.candles.length));
      if (this.stick) {
        this.view.end = this.candles.length;
        this.view.start = Math.max(0, this.view.end - this.span);
      } else {
        this.clampView();
      }
    }
    this.schedule();
  }

  updateLast(price) {
    if (!Number.isFinite(Number(price)) || this.candles.length === 0) return;
    const value = Number(price);
    const last = this.candles[this.candles.length - 1];
    last.c = value;
    if (value > last.h) last.h = value;
    if (value < last.l) last.l = value;
    this.compute();
    this.schedule();
  }

  resetView(draw = true) {
    if (this.candles.length === 0) return;
    this.span = Math.min(110, this.candles.length);
    this.view = { start: this.candles.length - this.span, end: this.candles.length };
    this.stick = true;
    if (draw) this.schedule();
  }

  clampView() {
    const length = this.candles.length;
    if (length === 0) return;
    this.span = clamp(this.span, Math.min(20, length), Math.min(500, length));
    let start = this.view.start;
    let end = start + this.span;
    if (start < 0) {
      start = 0;
      end = this.span;
    }
    if (end > length) {
      end = length;
      start = Math.max(0, length - this.span);
    }
    this.view = { start, end };
    this.stick = this.view.end >= length - 0.5;
  }

  compute() {
    if (this.candles.length === 0) {
      this.ind = null;
      return;
    }
    const closes = this.candles.map((candle) => candle.c);
    this.ind = {
      ma7: sma(closes, 7),
      ma25: sma(closes, 25),
      ma99: sma(closes, 99),
      boll: bollinger(closes, 20, 2),
      macd: macd(closes),
      rsi: rsi(closes, 14),
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    this.w = rect.width;
    this.h = rect.height;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.layoutCache = null;
    this.schedule();
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  layout() {
    if (this.layoutCache) return this.layoutCache;
    const left = 8;
    const right = 66;
    const top = 10;
    const bottom = 21;
    const width = this.w;
    const height = this.h;
    let oscCount = (this.indicators.macd ? 1 : 0) + (this.indicators.rsi ? 1 : 0);
    let volH = height > 430 ? 52 : 38;
    let oscH = oscCount > 0 ? Math.max(54, Math.min(92, height * 0.145)) : 0;
    let priceH = height - top - bottom - volH - oscH * oscCount - 8 * (1 + oscCount);
    if (priceH < 130) {
      volH = 30;
      oscH = Math.max(46, oscH - 8);
      priceH = height - top - bottom - volH - oscH * oscCount - 8 * (1 + oscCount);
    }
    const plotLeft = left;
    const plotRight = Math.max(left + 40, width - right);
    const plotW = plotRight - plotLeft;
    const priceTop = top;
    const priceBottom = priceTop + Math.max(80, priceH);
    let cursor = priceBottom + 8;
    const volume = { top: cursor, bottom: cursor + volH };
    cursor = volume.bottom;
    const oscs = [];
    if (this.indicators.macd) {
      oscs.push({ type: 'macd', top: cursor + 8, bottom: cursor + 8 + oscH });
      cursor += 8 + oscH;
    }
    if (this.indicators.rsi) {
      oscs.push({ type: 'rsi', top: cursor + 8, bottom: cursor + 8 + oscH });
      cursor += 8 + oscH;
    }
    this.layoutCache = {
      left,
      right,
      top,
      bottom,
      plotLeft,
      plotRight,
      plotW,
      priceTop,
      priceBottom,
      volume,
      oscs,
    };
    return this.layoutCache;
  }

  visible() {
    const length = this.candles.length;
    const start = Math.max(0, Math.floor(this.view.start));
    const end = Math.min(length, Math.ceil(this.view.end));
    return { start, end, span: Math.max(1, this.view.end - this.view.start) };
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx || this.w < 10 || this.h < 10) return;
    ctx.clearRect(0, 0, this.w, this.h);
    if (this.candles.length === 0) {
      this.tooltip.hidden = true;
      return;
    }
    const layout = this.layout();
    const visible = this.visible();
    if (visible.end <= visible.start) return;
    this.drawGrid(layout, visible);
    this.drawCandles(layout, visible);
    if (this.indicators.boll && this.ind) this.drawBoll(layout, visible);
    if (this.indicators.ma && this.ind) this.drawMAs(layout, visible);
    this.drawVolume(layout, visible);
    this.drawOscillators(layout, visible);
    this.drawLastPrice(layout, visible);
    this.drawCrosshair(layout, visible);
    this.drawLegend(layout, visible);
  }

  xFor(index, layout, visible) {
    return layout.plotLeft + ((index - this.view.start) / visible.span) * layout.plotW;
  }

  priceRange(visible) {
    let min = Infinity;
    let max = -Infinity;
    const { start, end } = visible;
    for (let i = start; i < end; i += 1) {
      const candle = this.candles[i];
      if (!candle) continue;
      if (candle.l < min) min = candle.l;
      if (candle.h > max) max = candle.h;
    }
    if (this.indicators.ma && this.ind) {
      for (const series of [this.ind.ma7, this.ind.ma25, this.ind.ma99]) {
        for (let i = start; i < end; i += 1) {
          const value = series[i];
          if (value === null) continue;
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
    }
    if (this.indicators.boll && this.ind) {
      for (const series of [this.ind.boll.upper, this.ind.boll.lower]) {
        for (let i = start; i < end; i += 1) {
          const value = series[i];
          if (value === null) continue;
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0;
      max = 1;
    }
    if (min === max) {
      min *= 0.995;
      max *= 1.005;
    }
    const pad = (max - min) * 0.07;
    return { min: min - pad, max: max + pad };
  }

  drawGrid(layout, visible) {
    const ctx = this.ctx;
    const range = this.priceRange(visible);
    this.range = range;
    ctx.save();
    ctx.strokeStyle = this.colors.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.font = '8px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = this.colors.dim;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= 4; i += 1) {
      const y = layout.priceTop + ((layout.priceBottom - layout.priceTop) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(layout.plotLeft, y);
      ctx.lineTo(layout.plotRight, y);
      ctx.stroke();
      const value = range.max - ((range.max - range.min) * i) / 4;
      ctx.fillText(formatPrice(value), layout.plotRight + 6, y);
    }

    const ticks = 5;
    for (let i = 0; i <= ticks; i += 1) {
      const x = layout.plotLeft + (layout.plotW * i) / ticks;
      ctx.beginPath();
      ctx.moveTo(x, layout.priceTop);
      ctx.lineTo(x, this.h - layout.bottom);
      ctx.stroke();
      const index = Math.floor(this.view.start + (visible.span * i) / ticks);
      const candle = this.candles[Math.min(this.candles.length - 1, Math.max(0, index))];
      if (candle) {
        ctx.textAlign = i === 0 ? 'left' : i === ticks ? 'right' : 'center';
        ctx.fillStyle = this.colors.faint;
        ctx.fillText(niceTime(candle.t, this.interval), x, this.h - 8);
      }
    }

    ctx.restore();
  }

  drawCandles(layout, visible) {
    const ctx = this.ctx;
    const range = this.range;
    const step = layout.plotW / visible.span;
    const bodyW = Math.max(1, Math.min(12, step * 0.62));
    const yFor = (value) => layout.priceBottom - ((value - range.min) / (range.max - range.min)) * (layout.priceBottom - layout.priceTop);

    ctx.save();
    for (let i = visible.start; i < visible.end; i += 1) {
      const candle = this.candles[i];
      if (!candle) continue;
      const x = this.xFor(i, layout, visible);
      const up = candle.c >= candle.o;
      const color = up ? this.colors.green : this.colors.red;
      const yHigh = yFor(candle.h);
      const yLow = yFor(candle.l);
      const yOpen = yFor(candle.o);
      const yClose = yFor(candle.c);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x - 0.5, yHigh, 1, Math.max(1, yLow - yHigh));
      const top = Math.min(yOpen, yClose);
      const height = Math.max(1, Math.abs(yOpen - yClose));
      ctx.fillRect(x - bodyW / 2, top, bodyW, height);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawLine(series, layout, visible, yFor, color, width = 1, dash = []) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let started = false;
    for (let i = visible.start; i < visible.end; i += 1) {
      const value = series[i];
      if (value === null || !Number.isFinite(value)) {
        started = false;
        continue;
      }
      const x = this.xFor(i, layout, visible);
      const y = yFor(value);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  drawMAs(layout, visible) {
    const range = this.range;
    const yFor = (value) => layout.priceBottom - ((value - range.min) / (range.max - range.min)) * (layout.priceBottom - layout.priceTop);
    this.drawLine(this.ind.ma7, layout, visible, yFor, this.colors.accent, 1.05);
    this.drawLine(this.ind.ma25, layout, visible, yFor, this.colors.cyan, 1);
    this.drawLine(this.ind.ma99, layout, visible, yFor, this.colors.text2, 0.85, [3, 3]);
  }

  drawBoll(layout, visible) {
    const ctx = this.ctx;
    const range = this.range;
    const yFor = (value) => layout.priceBottom - ((value - range.min) / (range.max - range.min)) * (layout.priceBottom - layout.priceTop);
    const upper = this.ind.boll.upper;
    const lower = this.ind.boll.lower;
    ctx.save();
    ctx.beginPath();
    let started = false;
    for (let i = visible.start; i < visible.end; i += 1) {
      if (upper[i] === null) continue;
      const x = this.xFor(i, layout, visible);
      const y = yFor(upper[i]);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    for (let i = visible.end - 1; i >= visible.start; i -= 1) {
      if (lower[i] === null) continue;
      ctx.lineTo(this.xFor(i, layout, visible), yFor(lower[i]));
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(${this.colors.accentRgb},0.045)`;
    ctx.fill();
    ctx.restore();
    this.drawLine(upper, layout, visible, yFor, `rgba(${this.colors.accentRgb},0.42)`, 0.9, [3, 3]);
    this.drawLine(this.ind.boll.mid, layout, visible, yFor, `rgba(${this.colors.accentRgb},0.35)`, 0.8, [1, 4]);
    this.drawLine(lower, layout, visible, yFor, `rgba(${this.colors.accentRgb},0.42)`, 0.9, [3, 3]);
  }

  drawVolume(layout, visible) {
    const ctx = this.ctx;
    const step = layout.plotW / visible.span;
    const bodyW = Math.max(1, Math.min(12, step * 0.62));
    let max = 0;
    for (let i = visible.start; i < visible.end; i += 1) {
      if (this.candles[i] && this.candles[i].v > max) max = this.candles[i].v;
    }
    if (max <= 0) return;
    const height = layout.volume.bottom - layout.volume.top;
    ctx.save();
    ctx.strokeStyle = this.colors.line;
    ctx.beginPath();
    ctx.moveTo(layout.plotLeft, layout.volume.top);
    ctx.lineTo(layout.plotRight, layout.volume.top);
    ctx.stroke();
    for (let i = visible.start; i < visible.end; i += 1) {
      const candle = this.candles[i];
      if (!candle) continue;
      const x = this.xFor(i, layout, visible);
      const h = Math.max(1, (candle.v / max) * (height - 5));
      ctx.fillStyle = candle.c >= candle.o ? this.colors.green : this.colors.red;
      ctx.globalAlpha = 0.32;
      ctx.fillRect(x - bodyW / 2, layout.volume.bottom - h, bodyW, h);
    }
    ctx.globalAlpha = 1;
    ctx.font = '7px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = this.colors.faint;
    ctx.textAlign = 'left';
    ctx.fillText('VOL', layout.plotLeft + 3, layout.volume.top + 9);
    ctx.restore();
  }

  drawOscillators(layout, visible) {
    for (const panel of layout.oscs) {
      if (panel.type === 'macd') this.drawMacd(panel, layout, visible);
      else this.drawRsi(panel, layout, visible);
    }
  }

  drawMacd(panel, layout, visible) {
    const ctx = this.ctx;
    const { dif, dea, hist } = this.ind.macd;
    let min = 0;
    let max = 0;
    for (let i = visible.start; i < visible.end; i += 1) {
      for (const value of [dif[i], dea[i], hist[i]]) {
        if (value === null || !Number.isFinite(value)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.12;
    min -= pad;
    max += pad;
    const yFor = (value) => panel.bottom - ((value - min) / (max - min)) * (panel.bottom - panel.top);
    const zero = yFor(0);
    const step = layout.plotW / visible.span;
    const bodyW = Math.max(1, Math.min(10, step * 0.55));

    ctx.save();
    ctx.strokeStyle = this.colors.line;
    ctx.beginPath();
    ctx.moveTo(layout.plotLeft, panel.top);
    ctx.lineTo(layout.plotRight, panel.top);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${this.colors.accentRgb},0.22)`;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(layout.plotLeft, zero);
    ctx.lineTo(layout.plotRight, zero);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = visible.start; i < visible.end; i += 1) {
      const value = hist[i];
      if (value === null) continue;
      const x = this.xFor(i, layout, visible);
      const y = yFor(value);
      ctx.fillStyle = value >= 0 ? this.colors.green : this.colors.red;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x - bodyW / 2, Math.min(y, zero), bodyW, Math.max(1, Math.abs(y - zero)));
    }
    ctx.globalAlpha = 1;
    this.drawLine(dif, layout, visible, yFor, this.colors.accent, 1);
    this.drawLine(dea, layout, visible, yFor, this.colors.cyan, 0.9);
    ctx.font = '7px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = this.colors.dim;
    ctx.textAlign = 'left';
    ctx.fillText('MACD 12/26/9', layout.plotLeft + 3, panel.top + 9);
    ctx.fillStyle = this.colors.accent;
    ctx.fillText('DIF', layout.plotLeft + 72, panel.top + 9);
    ctx.fillStyle = this.colors.cyan;
    ctx.fillText('DEA', layout.plotLeft + 95, panel.top + 9);
    ctx.restore();
  }

  drawRsi(panel, layout, visible) {
    const ctx = this.ctx;
    const series = this.ind.rsi;
    const yFor = (value) => panel.bottom - (value / 100) * (panel.bottom - panel.top);
    ctx.save();
    ctx.strokeStyle = this.colors.line;
    ctx.beginPath();
    ctx.moveTo(layout.plotLeft, panel.top);
    ctx.lineTo(layout.plotRight, panel.top);
    ctx.stroke();
    ctx.setLineDash([2, 4]);
    for (const level of [30, 70]) {
      ctx.strokeStyle = `rgba(${this.colors.accentRgb},${level === 70 ? 0.32 : 0.22})`;
      ctx.beginPath();
      ctx.moveTo(layout.plotLeft, yFor(level));
      ctx.lineTo(layout.plotRight, yFor(level));
      ctx.stroke();
      ctx.fillStyle = this.colors.faint;
      ctx.font = '6.5px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(String(level), layout.plotRight + 8, yFor(level) + 2);
    }
    ctx.setLineDash([]);
    this.drawLine(series, layout, visible, yFor, this.colors.accent, 1);
    ctx.font = '7px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = this.colors.dim;
    ctx.textAlign = 'left';
    ctx.fillText('RSI 14', layout.plotLeft + 3, panel.top + 9);
    ctx.restore();
  }

  drawLastPrice(layout, visible) {
    if (this.candles.length === 0) return;
    const last = this.candles[this.candles.length - 1];
    const range = this.range;
    if (!range || last.c < range.min || last.c > range.max) return;
    const ctx = this.ctx;
    const y = layout.priceBottom - ((last.c - range.min) / (range.max - range.min)) * (layout.priceBottom - layout.priceTop);
    const up = last.c >= last.o;
    const color = up ? this.colors.green : this.colors.red;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.45;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(layout.plotLeft, y);
    ctx.lineTo(layout.plotRight, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const label = formatPrice(last.c);
    ctx.font = '8px "Cascadia Code", Consolas, monospace';
    const width = Math.max(50, ctx.measureText(label).width + 10);
    ctx.fillStyle = color;
    ctx.fillRect(layout.plotRight + 1, y - 7, width, 14);
    ctx.fillStyle = this.colors.bg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, layout.plotRight + 6, y + 0.5);
    ctx.restore();
  }

  drawCrosshair(layout, visible) {
    if (!this.hover || this.hover.x < layout.plotLeft || this.hover.x > layout.plotRight) return;
    if (this.hover.y < layout.priceTop || this.hover.y > layout.priceBottom) {
      this.tooltip.hidden = true;
      return;
    }
    const index = clamp(this.hover.index, 0, this.candles.length - 1);
    const candle = this.candles[index];
    if (!candle) return;
    const x = this.xFor(index, layout, visible);
    const range = this.range;
    const y = layout.priceBottom - ((candle.c - range.min) / (range.max - range.min)) * (layout.priceBottom - layout.priceTop);
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = `rgba(${this.colors.accentRgb},0.38)`;
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, layout.priceTop);
    ctx.lineTo(x, layout.volume.bottom);
    ctx.moveTo(layout.plotLeft, y);
    ctx.lineTo(layout.plotRight, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '7.5px "Cascadia Code", Consolas, monospace';
    const priceLabel = formatPrice(candle.c);
    const width = Math.max(50, ctx.measureText(priceLabel).width + 10);
    ctx.fillStyle = this.colors.accent;
    ctx.fillRect(layout.plotRight + 1, y - 6, width, 13);
    ctx.fillStyle = this.colors.bg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(priceLabel, layout.plotRight + 6, y + 0.5);
    const timeLabel = formatDate(candle.t);
    const timeWidth = ctx.measureText(timeLabel).width + 12;
    ctx.fillStyle = this.colors.panel;
    ctx.fillRect(x - timeWidth / 2, this.h - layout.bottom + 1, timeWidth, 14);
    ctx.strokeStyle = this.colors.accent;
    ctx.strokeRect(x - timeWidth / 2, this.h - layout.bottom + 1, timeWidth, 14);
    ctx.fillStyle = this.colors.accent;
    ctx.textAlign = 'center';
    ctx.fillText(timeLabel, x, this.h - layout.bottom + 8);
    ctx.restore();
    this.updateTooltip(index, candle, x, y);
  }

  updateTooltip(index, candle, x, y) {
    const change = candle.o ? ((candle.c - candle.o) / candle.o) * 100 : 0;
    const up = candle.c >= candle.o;
    const rows = [
      ['O', formatPrice(candle.o)],
      ['H', formatPrice(candle.h)],
      ['L', formatPrice(candle.l)],
      ['C', formatPrice(candle.c)],
      ['CHG', formatPct(change)],
      ['VOL', formatCompact(candle.v)],
    ];
    if (this.indicators.ma && this.ind) {
      const ma7 = this.ind.ma7[index];
      const ma25 = this.ind.ma25[index];
      if (ma7 !== null) rows.push(['MA7', formatPrice(ma7)]);
      if (ma25 !== null) rows.push(['MA25', formatPrice(ma25)]);
    }
    this.tooltip.innerHTML = `<div class="tip-row"><span>TIME</span><b>${formatDate(candle.t)}:${formatTime(candle.t).slice(-2)}</b></div>`
      + rows.map(([key, value]) => `<div class="tip-row"><span>${key}</span><b class="${key === 'CHG' ? (up ? 'up' : 'down') : ''}">${value}</b></div>`).join('');
    this.tooltip.hidden = false;
    const tipW = 168;
    const tipH = 128;
    let left = x + 14;
    if (left + tipW > this.w - 8) left = x - tipW - 14;
    let top = y + 12;
    if (top + tipH > this.h - 8) top = y - tipH - 12;
    this.tooltip.style.left = `${Math.max(8, left)}px`;
    this.tooltip.style.top = `${Math.max(8, top)}px`;
  }

  drawLegend(layout, visible) {
    if (!this.indicators.ma || !this.ind) return;
    const ctx = this.ctx;
    const index = Math.min(this.candles.length - 1, Math.max(0, Math.floor(this.view.end) - 1));
    const parts = [
      ['MA7', this.ind.ma7[index], this.colors.accent],
      ['MA25', this.ind.ma25[index], this.colors.cyan],
      ['MA99', this.ind.ma99[index], this.colors.text2],
    ];
    ctx.save();
    ctx.font = '6.5px "Cascadia Code", Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let x = layout.plotLeft + 56;
    const y = layout.priceTop + 11;
    for (const [label, value, color] of parts) {
      if (value === null || !Number.isFinite(value)) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y - 2, 5, 1);
      ctx.fillStyle = color;
      ctx.fillText(`${label} ${formatPrice(value)}`, x + 8, y);
      x += ctx.measureText(`${label} ${formatPrice(value)}`).width + 18;
    }
    ctx.restore();
  }

  onPointerDown(event) {
    if (!this.candles.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const layout = this.layout();
    if (x < layout.plotLeft || x > layout.plotRight) return;
    this.drag = {
      x: event.clientX,
      start: this.view.start,
      span: this.view.end - this.view.start,
      step: layout.plotW / Math.max(1, this.view.end - this.view.start),
      moved: false,
    };
    this.canvas.setPointerCapture(event.pointerId);
    this.hover = null;
    this.tooltip.hidden = true;
  }

  onPointerMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (this.drag) {
      const delta = (event.clientX - this.drag.x) / this.drag.step;
      if (Math.abs(event.clientX - this.drag.x) > 3) this.drag.moved = true;
      let start = this.drag.start - delta;
      const length = this.candles.length;
      start = clamp(start, 0, Math.max(0, length - this.drag.span));
      this.view = { start, end: start + this.drag.span };
      this.span = this.drag.span;
      this.stick = this.view.end >= length - 0.5;
      this.schedule();
      return;
    }
    const layout = this.layout();
    if (x < layout.plotLeft || x > layout.plotRight || y < layout.priceTop || y > layout.priceBottom) {
      if (this.hover) {
        this.hover = null;
        this.tooltip.hidden = true;
        this.schedule();
      }
      return;
    }
    const visible = this.visible();
    const raw = this.view.start + ((x - layout.plotLeft) / layout.plotW) * visible.span;
    const index = clamp(Math.round(raw), 0, this.candles.length - 1);
    this.hover = { x, y, index };
    this.schedule();
  }

  onPointerUp(event) {
    if (!this.drag) return;
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released.
    }
    this.drag = null;
  }

  onPointerLeave() {
    this.hover = null;
    this.drag = null;
    this.tooltip.hidden = true;
    this.schedule();
  }

  onWheel(event) {
    if (!this.candles.length) return;
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const layout = this.layout();
    if (x < layout.plotLeft || x > layout.plotRight) return;
    const span = this.view.end - this.view.start;
    const factor = event.deltaY > 0 ? 1.14 : 0.88;
    const nextSpan = clamp(span * factor, Math.min(20, this.candles.length), Math.min(500, this.candles.length));
    const anchor = this.view.start + ((x - layout.plotLeft) / layout.plotW) * span;
    let start = anchor - ((anchor - this.view.start) * nextSpan) / span;
    start = clamp(start, 0, Math.max(0, this.candles.length - nextSpan));
    this.view = { start, end: start + nextSpan };
    this.span = nextSpan;
    this.stick = this.view.end >= this.candles.length - 0.5;
    this.schedule();
  }
}
