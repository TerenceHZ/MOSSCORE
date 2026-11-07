(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  /* clock */
  const clockEls = [$('#heroClock'), $('#tfClock')].filter(Boolean);
  const clock = () => {
    const s = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    clockEls.forEach(el => el.textContent = s);
  };
  clock(); setInterval(clock, 1000);

  /* nav + progress + cursor */
  const nav = $('#nav'), progress = $('#progress'), glow = $('#cursorGlow');
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.width = `${max > 0 ? (scrollY / max) * 100 : 0}%`;
    nav.classList.toggle('scrolled', scrollY > 24);
  };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  if (!reduce) {
    addEventListener('pointermove', e => {
      glow.style.opacity = '1';
      glow.style.left = `${e.clientX}px`;
      glow.style.top = `${e.clientY}px`;
    }, { passive: true });
  }

  /* reveal */
  const reveal = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); reveal.unobserve(e.target); }
    });
  }, { threshold: .12 });
  $$('.reveal').forEach(el => reveal.observe(el));

  /* counters */
  const counted = new Set();
  const countEls = $$('[data-count]');
  countEls.forEach(el => el.textContent = Number(el.dataset.count).toLocaleString('en-US'));
  const countObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting || counted.has(e.target)) return;
      counted.add(e.target);
      const el = e.target, target = Number(el.dataset.count);
      const start = performance.now(), dur = reduce ? 1 : 1450;
      const tick = now => {
        const t = Math.min(1, (now - start) / dur);
        el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3))).toLocaleString('en-US');
        if (t < 1) requestAnimationFrame(tick);
      };
      el.textContent = '0';
      requestAnimationFrame(tick);
    });
  }, { threshold: .6 });
  countEls.forEach(el => countObs.observe(el));

  /* ticker */
  const tick = $('#tickerTrack');
  if (tick) {
    const items = [
      ['ARIA / USDT', '+25.30%', true], ['JCT / USDT', '+39.02%', true],
      ['BTC / USDT', '+0.24%', true], ['HUMA / USDT', '-18.55%', false],
      ['OI DELTA', '+18.4M', true], ['VOL SPIKE', '12.4×', true],
      ['SIGNAL', 'ARIA · LONG', true], ['HYPE WHALE', '102K USDT', true]
    ];
    const html = items.map(([k, v, up]) => `<span>${k} <b class="${up ? '' : 'neg'}">${v}</b></span>`).join('');
    tick.innerHTML = html + html;
  }

  /* tilt */
  if (!reduce) {
    $$('[data-tilt]').forEach(card => {
      card.addEventListener('pointermove', e => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - .5;
        const y = (e.clientY - r.top) / r.height - .5;
        card.style.transform = `perspective(900px) rotateX(${-y * 4}deg) rotateY(${x * 5}deg) translateY(-2px)`;
        card.style.setProperty('--mx', `${(x + .5) * 100}%`);
        card.style.setProperty('--my', `${(y + .5) * 100}%`);
      });
      card.addEventListener('pointerleave', () => { card.style.transform = ''; });
    });
  }

  /* magnetic buttons */
  if (!reduce) {
    $$('.magnetic').forEach(btn => {
      btn.addEventListener('pointermove', e => {
        const r = btn.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        btn.style.transform = `translate(${x * .035}px,${y * .06}px)`;
      });
      btn.addEventListener('pointerleave', () => { btn.style.transform = ''; });
    });
  }

  /* download pulse */
  const dl = $('#downloadBtn');
  if (dl) {
    dl.addEventListener('click', () => {
      dl.classList.add('downloading');
      setTimeout(() => dl.classList.remove('downloading'), 1800);
    });
  }

  /* canvases sizing */
  function fit(canvas, alpha = true) {
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d', { alpha });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  /* hero scene */
  const heroCanvas = $('#heroCanvas');
  let heroStars = [], heroW = 0, heroH = 0;
  const heroState = { t: 0, mx: 0, my: 0, tx: 0, ty: 0 };
  function initHero() {
    const r = heroCanvas.getBoundingClientRect();
    heroW = r.width; heroH = r.height;
    heroStars = Array.from({ length: Math.min(220, Math.round(heroW / 7)) }, () => ({
      x: Math.random(), y: Math.random(), s: Math.random() * 1.3 + .2, a: Math.random() * .5 + .15,
      v: Math.random() * .00004 + .00001
    }));
  }
  function drawHero() {
    if (!heroCanvas) return;
    const r = fit(heroCanvas, false); if (!r) return;
    const { ctx, w, h } = r;
    ctx.clearRect(0, 0, w, h);
    const cx = w * .66, cy = h * .48;
    heroState.tx += ((heroState.mx - heroState.tx) * .035);
    heroState.ty += ((heroState.my - heroState.ty) * .035);
    const t = performance.now() * .001;
    const ox = heroState.tx * 18, oy = heroState.ty * 12;
    // stars
    for (const s of heroStars) {
      s.x += s.v * (reduce ? 0 : 1);
      if (s.x > 1) s.x = 0;
      const x = s.x * w, y = s.y * h;
      ctx.fillStyle = `rgba(232,224,204,${s.a * (.6 + .4 * Math.sin(t + s.x * 9))})`;
      ctx.fillRect(x, y, s.s, s.s);
    }
    ctx.save();
    ctx.translate(cx + ox, cy + oy);
    // outer arc geometry
    ctx.rotate(-.12 + heroState.tx * .03);
    const rings = [
      { r: Math.min(w, h) * .27, ry: .46, a: .22, n: 54, speed: .08 },
      { r: Math.min(w, h) * .34, ry: .5, a: .14, n: 72, speed: -.05 },
      { r: Math.min(w, h) * .42, ry: .55, a: .09, n: 92, speed: .03 }
    ];
    rings.forEach((ring, idx) => {
      ctx.save();
      ctx.rotate(ring.speed * t + idx * 1.2);
      ctx.strokeStyle = `rgba(232,160,32,${ring.a * .65})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 0, ring.r, ring.r * ring.ry, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([1, 8]);
      ctx.strokeStyle = `rgba(242,240,232,${ring.a * .32})`;
      ctx.beginPath(); ctx.ellipse(0, 0, ring.r * 1.04, ring.r * ring.ry * 1.04, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < ring.n; i++) {
        const a = (i / ring.n) * Math.PI * 2;
        const x = Math.cos(a) * ring.r, y = Math.sin(a) * ring.r * ring.ry;
        const dot = i % 7 === 0 ? 1.8 : .7;
        ctx.fillStyle = i % 7 === 0 ? 'rgba(232,160,32,.48)' : 'rgba(242,240,232,.18)';
        ctx.fillRect(x, y, dot, dot);
      }
      ctx.restore();
    });
    // sweep
    const sweep = t * .32;
    const sg = ctx.createLinearGradient(0, 0, Math.cos(sweep) * 300, Math.sin(sweep) * 160);
    sg.addColorStop(0, 'rgba(232,160,32,.15)'); sg.addColorStop(1, 'rgba(232,160,32,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, Math.min(w, h) * .38, sweep - .08, sweep + .08);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // horizon line
    ctx.strokeStyle = 'rgba(232,160,32,.09)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(w * .04, h * .84); ctx.lineTo(w * .96, h * .84); ctx.stroke();
    requestAnimationFrame(drawHero);
  }
  if (heroCanvas) {
    initHero();
    addEventListener('resize', initHero);
    addEventListener('pointermove', e => {
      heroState.mx = (e.clientX / innerWidth - .5) * 2;
      heroState.my = (e.clientY / innerHeight - .5) * 2;
    }, { passive: true });
    requestAnimationFrame(drawHero);
  }

  /* orbit canvas */
  const orbitCanvas = $('#orbitCanvas');
  function drawOrbit() {
    if (!orbitCanvas) return;
    const r = fit(orbitCanvas); if (!r) return;
    const { ctx, w, h } = r;
    const cx = w / 2, cy = h / 2, t = performance.now() * .001;
    ctx.clearRect(0, 0, w, h);
    const base = Math.min(w, h) * .33;
    const rings = [
      { r: base, squash: .52, a: .22, speed: .17, n: 70 },
      { r: base * 1.15, squash: .48, a: .14, speed: -.11, n: 84 },
      { r: base * 1.3, squash: .44, a: .09, speed: .07, n: 96 }
    ];
    rings.forEach((ring, i) => {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * ring.speed + i * 1.4);
      ctx.strokeStyle = `rgba(232,160,32,${ring.a})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 0, ring.r, ring.r * ring.squash, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([1, 7]); ctx.strokeStyle = `rgba(242,240,232,${ring.a * .4})`;
      ctx.beginPath(); ctx.ellipse(0, 0, ring.r * 1.03, ring.r * ring.squash * 1.03, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      for (let j = 0; j < ring.n; j++) {
        const a = j / ring.n * Math.PI * 2;
        const x = Math.cos(a) * ring.r, y = Math.sin(a) * ring.r * ring.squash;
        ctx.fillStyle = j % 9 === 0 ? 'rgba(232,160,32,.6)' : 'rgba(242,240,232,.2)';
        ctx.fillRect(x, y, j % 9 === 0 ? 2 : .8, j % 9 === 0 ? 2 : .8);
      }
      ctx.restore();
    });
    // orbiting nodes
    for (let i = 0; i < 4; i++) {
      const a = t * (.2 + i * .035) + i * 1.7;
      const rr = base * (1.08 + i * .045);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * .5;
      ctx.fillStyle = 'rgba(232,160,32,.8)'; ctx.beginPath(); ctx.arc(x, y, i === 0 ? 3 : 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(232,160,32,.16)'; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
    }
    // faint radial rays
    ctx.save(); ctx.translate(cx, cy);
    for (let i = 0; i < 36; i++) {
      const a = i / 36 * Math.PI * 2;
      ctx.strokeStyle = 'rgba(232,160,32,.035)'; ctx.beginPath();
      ctx.moveTo(Math.cos(a) * base * .95, Math.sin(a) * base * .95);
      ctx.lineTo(Math.cos(a) * base * 1.7, Math.sin(a) * base * 1.7); ctx.stroke();
    }
    ctx.restore();
    requestAnimationFrame(drawOrbit);
  }
  if (orbitCanvas) requestAnimationFrame(drawOrbit);

  /* gauge */
  const gaugeCanvas = $('#gaugeCanvas');
  let gaugeStart = 0;
  function drawGauge() {
    if (!gaugeCanvas) return;
    const r = fit(gaugeCanvas); if (!r) return;
    const { ctx, w, h } = r;
    const cx = w / 2, cy = h * .55, rad = Math.min(w * .34, h * .45);
    const t = performance.now() * .001;
    if (!gaugeStart) gaugeStart = t;
    const p = Math.min(1, (t - gaugeStart) / 2.2);
    ctx.clearRect(0, 0, w, h);
    const start = Math.PI * .78, end = Math.PI * 2.22;
    // base ring
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(232,160,32,.12)';
    ctx.beginPath(); ctx.arc(cx, cy, rad, start, end); ctx.stroke();
    // tick marks
    for (let i = 0; i <= 48; i++) {
      const a = start + (end - start) * i / 48;
      const inner = rad - (i % 4 === 0 ? 9 : 4), outer = rad + 3;
      ctx.strokeStyle = i % 4 === 0 ? 'rgba(232,160,32,.5)' : 'rgba(242,240,232,.16)';
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer); ctx.stroke();
    }
    // value arc
    const val = .68 * p;
    const grad = ctx.createLinearGradient(cx - rad, cy, cx + rad, cy);
    grad.addColorStop(0, '#b96e1d'); grad.addColorStop(.55, '#e8a020'); grad.addColorStop(1, '#ffe3a3');
    ctx.strokeStyle = grad; ctx.lineWidth = 3; ctx.shadowBlur = 14; ctx.shadowColor = 'rgba(232,160,32,.45)';
    ctx.beginPath(); ctx.arc(cx, cy, rad - 2, start, start + (end - start) * val); ctx.stroke();
    ctx.shadowBlur = 0;
    // inner dashed
    ctx.strokeStyle = 'rgba(232,160,32,.15)'; ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]); ctx.beginPath(); ctx.arc(cx, cy, rad * .73, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    // needle
    const na = start + (end - start) * val;
    ctx.strokeStyle = '#ffe0a0'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(na) * (rad - 17), cy + Math.sin(na) * (rad - 17)); ctx.stroke();
    ctx.fillStyle = '#e8a020'; ctx.beginPath(); ctx.arc(cx + Math.cos(na) * (rad - 17), cy + Math.sin(na) * (rad - 17), 2.5, 0, Math.PI * 2); ctx.fill();
    // labels
    ctx.fillStyle = 'rgba(232,160,32,.7)'; ctx.font = '7px monospace'; ctx.textAlign = 'center';
    ctx.fillText('FEAR', cx - rad * .78, cy + rad * .55);
    ctx.fillText('GREED', cx + rad * .78, cy + rad * .55);
    requestAnimationFrame(drawGauge);
  }
  if (gaugeCanvas) requestAnimationFrame(drawGauge);

  /* flow sparkline */
  const flowCanvas = $('#flowCanvas');
  const flowPoints = Array.from({ length: 64 }, (_, i) => .3 + Math.sin(i * .42) * .14 + Math.random() * .1);
  function drawFlow() {
    if (!flowCanvas) return;
    const r = fit(flowCanvas); if (!r) return;
    const { ctx, w, h } = r;
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(232,160,32,.2)'); grad.addColorStop(1, 'rgba(232,160,32,0)');
    const pts = flowPoints.map((v, i) => [i / (flowPoints.length - 1) * w, h - v * h * .8 - 5]);
    ctx.beginPath(); ctx.moveTo(0, h);
    pts.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.strokeStyle = 'rgba(232,160,32,.72)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#ffe0a0'; ctx.beginPath(); ctx.arc(pts[pts.length - 1][0], pts[pts.length - 1][1], 2, 0, Math.PI * 2); ctx.fill();
    if (Math.random() < .07) { flowPoints.shift(); flowPoints.push(.3 + Math.random() * .25); }
    requestAnimationFrame(drawFlow);
  }
  if (flowCanvas) requestAnimationFrame(drawFlow);

  /* radar */
  const radarCanvas = $('#radarCanvas');
  function drawRadar() {
    if (!radarCanvas) return;
    const r = fit(radarCanvas); if (!r) return;
    const { ctx, w, h } = r;
    const cx = w / 2, cy = h / 2, rad = Math.min(w, h) * .46;
    const t = performance.now() * .001;
    ctx.clearRect(0, 0, w, h);
    // concentric
    for (let i = 1; i <= 4; i++) {
      ctx.strokeStyle = `rgba(232,160,32,${.06 + (4 - i) * .02})`;
      ctx.beginPath(); ctx.arc(cx, cy, rad * i / 4, 0, Math.PI * 2); ctx.stroke();
    }
    // sweep
    const a = (t * .42) % (Math.PI * 2);
    const g = ctx.createConicGradient ? ctx.createConicGradient(a - .7, cx, cy) : null;
    if (g) { g.addColorStop(0, 'rgba(232,160,32,0)'); g.addColorStop(.15, 'rgba(232,160,32,.16)'); g.addColorStop(.17, 'rgba(232,160,32,.02)'); g.addColorStop(1, 'rgba(232,160,32,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = 'rgba(232,160,32,.5)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); ctx.stroke();
    // points
    const dots = [[.2, .3], [.62, .21], [.7, .62], [.35, .7], [.48, .44], [.8, .42]];
    dots.forEach(([x, y], i) => {
      const px = cx + (x - .5) * rad * 1.6, py = cy + (y - .5) * rad * 1.6;
      const pulse = .6 + .4 * Math.sin(t * 1.4 + i);
      ctx.fillStyle = `rgba(232,160,32,${.4 + pulse * .4})`;
      ctx.beginPath(); ctx.arc(px, py, i === 4 ? 2.4 : 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(232,160,32,${pulse * .25})`; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.stroke();
    });
    requestAnimationFrame(drawRadar);
  }
  if (radarCanvas) requestAnimationFrame(drawRadar);

  /* resize */
  addEventListener('resize', () => { onScroll(); });
})();
