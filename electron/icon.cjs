'use strict';

const zlib = require('node:zlib');

const ACCENT = [232, 160, 32];
const ACCENT_BRIGHT = [255, 192, 67];
const BG = [4, 6, 10];
const PANEL = [7, 11, 18];
const TEXT_DIM = [95, 109, 128];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const body = Buffer.concat([name, data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function makeCanvas(size) {
  const data = Buffer.alloc(size * size * 4);
  const blend = (x, y, color, alpha = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return;
    const i = (y * size + x) * 4;
    const srcA = Math.min(255, alpha) / 255;
    const dstA = data[i + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;
    data[i] = Math.round((color[0] * srcA + data[i] * dstA * (1 - srcA)) / outA);
    data[i + 1] = Math.round((color[1] * srcA + data[i + 1] * dstA * (1 - srcA)) / outA);
    data[i + 2] = Math.round((color[2] * srcA + data[i + 2] * dstA * (1 - srcA)) / outA);
    data[i + 3] = Math.round(outA * 255);
  };
  const fill = (left, top, right, bottom, color, alpha = 255, radius = 0) => {
    for (let y = Math.floor(top); y <= Math.ceil(bottom); y += 1) {
      for (let x = Math.floor(left); x <= Math.ceil(right); x += 1) {
        if (radius > 0 ? insideRoundedRect(x, y, left, top, right, bottom, radius) : true) {
          blend(x, y, color, alpha);
        }
      }
    }
  };
  const line = (x0, y0, x1, y1, color, width = 1, alpha = 255) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i += 1) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      const r = width / 2;
      for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy += 1) {
        for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx += 1) {
          if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) blend(xx, yy, color, alpha);
        }
      }
    }
  };
  return { data, blend, fill, line };
}

const GLYPHS = {
  5: ['████', '█···', '███·', '···█', '████'],
  0: ['·██·', '█··█', '█··█', '█··█', '·██·'],
  C: ['·███', '█···', '█···', '█···', '·███'],
};

function drawLogo(canvas, size, opts = {}) {
  const { transparent = false, scale = 1 } = opts;
  const cell = Math.round(size * 0.043 * scale);
  const gap = Math.max(1, Math.round(size * 0.008 * scale));
  const glyphGap = Math.round(size * 0.018 * scale);
  const glyphWidth = cell * 4;
  const totalWidth = glyphWidth * 4 + glyphGap * 3;
  const totalHeight = cell * 5 + gap * 4;
  const startX = Math.round((size - totalWidth) / 2);
  const startY = Math.round((size - totalHeight) / 2 - size * 0.055);
  const order = ['5', '5', '0', 'C'];

  order.forEach((glyph, glyphIndex) => {
    const rows = GLYPHS[glyph];
    const offsetX = startX + glyphIndex * (glyphWidth + glyphGap);
    rows.forEach((row, rowIndex) => {
      for (let col = 0; col < row.length; col += 1) {
        const x = offsetX + col * (cell + gap);
        const y = startY + rowIndex * (cell + gap);
        if (row[col] === '█') {
          const bright = !transparent && rowIndex === 0 && glyphIndex === 3;
          canvas.fill(x, y, x + cell - 1, y + cell - 1, bright ? ACCENT_BRIGHT : ACCENT, 255, Math.max(1, cell * 0.12));
        } else if (!transparent) {
          canvas.fill(x, y, x + cell - 1, y + cell - 1, ACCENT, 18, Math.max(1, cell * 0.12));
        }
      }
    });
  });

  return { startY, totalHeight, startX, totalWidth };
}

function drawAppIcon(size) {
  const canvas = makeCanvas(size);
  const pad = Math.round(size * 0.035);
  const radius = Math.round(size * 0.13);
  canvas.fill(pad - 2, pad - 2, size - pad + 2, size - pad + 2, ACCENT, 255, radius + 2);
  canvas.fill(pad, pad, size - pad, size - pad, BG, 255, radius);

  for (let y = pad + 4; y < size - pad; y += Math.max(3, Math.round(size * 0.018))) {
    canvas.fill(pad + 2, y, size - pad - 2, y, [255, 255, 255], 7);
  }

  const gridStep = Math.round(size * 0.0625);
  for (let x = pad + gridStep; x < size - pad; x += gridStep) {
    canvas.fill(x, pad + 2, x, size - pad - 2, ACCENT, 8);
  }

  const logo = drawLogo(canvas, size);
  const baseline = logo.startY + logo.totalHeight + Math.round(size * 0.055);
  canvas.fill(Math.round(size * 0.22), baseline, Math.round(size * 0.78), baseline + Math.max(1, Math.round(size * 0.006)), ACCENT, 210);
  canvas.fill(Math.round(size * 0.22), baseline + Math.round(size * 0.026), Math.round(size * 0.48), baseline + Math.round(size * 0.034), TEXT_DIM, 180);

  const blocks = 9;
  const blockW = Math.round(size * 0.017);
  const blockGap = Math.round(size * 0.009);
  for (let i = 0; i < blocks; i += 1) {
    const x = Math.round(size * 0.72) + i * (blockW + blockGap);
    canvas.fill(x, baseline + Math.round(size * 0.024), x + blockW, baseline + Math.round(size * 0.034), i < 6 ? ACCENT : TEXT_DIM, i < 6 ? 220 : 90);
  }

  return encodePng(size, size, canvas.data);
}

function drawTrayIcon(size) {
  const canvas = makeCanvas(size);
  const s = size / 32;
  const points = [
    [2, 18], [7, 18], [9.5, 12], [12.5, 24], [16, 7], [19.5, 22], [22, 15], [30, 15],
  ];
  for (let i = 0; i < points.length - 1; i += 1) {
    canvas.line(points[i][0] * s, points[i][1] * s, points[i + 1][0] * s, points[i + 1][1] * s, ACCENT, Math.max(1.2, 2.2 * s));
  }
  canvas.fill(0, 0, size - 1, size - 1, ACCENT, 0);
  return encodePng(size, size, canvas.data);
}

function icoFromPng(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 0;
  header[7] = 0;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

module.exports = {
  drawAppIcon,
  drawTrayIcon,
  encodePng,
  icoFromPng,
};
