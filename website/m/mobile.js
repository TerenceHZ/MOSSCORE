(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(devicePixelRatio || 1, 2);

  const focus = [
    { sym: 'ARIA', price: '0.12066', chg: 25.30, oi: 49.5, score: 92, vol: '$24.1M', funding: '+0.010%', spark: [5, 9, 7, 12, 10, 17, 14, 22, 19, 27, 23, 31, 29, 36] },
    { sym: 'HYPE', price: '38.42', chg: 18.44, oi: 22.8, score: 84, vol: '$102M', funding: '+0.018%', spark: [7, 5, 9, 7, 13, 12, 16, 14, 20, 18, 24, 21, 27, 30] },
    { sym: 'JCT', price: '0.03612', chg: 39.02, oi: 5.6, score: 81, vol: '$24.0M', funding: '+0.005%', spark: [4, 8, 7, 13, 12, 16, 21, 19, 24, 20, 28, 25, 31, 34] },
    { sym: 'ELSA', price: '0.00841', chg: 48.06, oi: 6.1, score: 79, vol: '$10.8M', funding: '-0.004%', spark: [2, 4, 3, 8, 7, 12, 10, 18, 16, 22, 20, 26, 25, 32] },
    { sym: 'SOX', price: '0.2147', chg: 5.86, oi: 12.4, score: 76, vol: '$8.4M', funding: '+0.009%', spark: [9, 8, 11, 10, 13, 12, 17, 15, 18, 16, 21, 19, 24, 23] },
    { sym: 'CAP', price: '0.7742', chg: 29.20, oi: 0.2, score: 74, vol: '$25.9M', funding: '+0.011%', spark: [3, 6, 5, 9, 8, 13, 11, 16, 15, 21, 18, 24, 22, 28] }
  ];
  const signals = [
    { sym: 'HYPE', side: 'WHALE BUY', desc: '102K USDT · 216×', meta: '30S +0.86%', gold: false },
    { sym: 'SOX', side: 'VOLUME', desc: '3M VOL 12.4× · +5.8%', meta: 'BUY PRESSURE 78%', gold: true },
    { sym: 'JCT', side: 'LONG', desc: 'OI +5.6% · 15M', meta: 'SCORE 81 · ENTRY 0.03612', gold: true }
  ];
  const movers = {
    up: [
      ['ELSA', '+48.06%', 'OI 10.8M'], ['JCT', '+39.02%', 'OI 24M'], ['CAP', '+29.20%', 'OI 25.9M'],
      ['ARIA', '+25.30%', 'OI 31.6M'], ['HYPE', '+18.44%', 'OI 18.2M'], ['SOX', '+5.86%', 'OI 8.4M']
    ],
    down: [
      ['UAI', '-46.43%', 'OI 4.5M'], ['HUMA', '-18.55%', 'OI 7.9M'], ['BAN', '-12.08%', 'OI 2.1M'],
      ['PIPPIN', '-9.62%', 'OI 1.8M'], ['TST', '-7.34%', 'OI 3.4M']
    ],
    oi: [
      ['ARIA', '+49.5%', '15M'], ['HYPE', '+22.8%', '15M'], ['SOX', '+12.4%', '15M'],
      ['ELSA', '+6.1%', '15M'], ['JCT', '+5.6%', '15M']
    ]
  };

  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function color(chg) { return chg >= 0; }

  function drawSpark(canvas, points, up = true) {
    if (!canvas) return;
    const w = canvas.clientWidth || 68, h = canvas.clientHeight || 28;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const min = Math.min(...points), max = Math.max(...points);
    const pts = points.map((v, i) => [i / (points.length - 1) * w, h - 3 - ((v - min) / (max - min || 1)) * (h - 7)]);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, up ? 'rgba(99,192,142,.22)' : 'rgba(208,107,93,.18)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.moveTo(0, h); pts.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.lineTo(w, h);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.strokeStyle = up ? 'rgba(99,192,142,.8)' : 'rgba(208,107,93,.8)'; ctx.lineWidth = 1; ctx.stroke();
  }

  function renderFocus() {
    const list = $('#mFocusList');
    if (!list) return;
    list.innerHTML = focus.map((f, i) => `
      <button class="m-coin" data-sym="${f.sym}">
        <span class="m-rank">${String(i + 1).padStart(2, '0')}</span>
        <span class="m-coin-main"><b>${f.sym}<span> /USDT</span></b><small>OI ${f.oi > 0 ? '+' : ''}${f.oi.toFixed(1)}% · SCORE ${f.score}</small></span>
        <canvas class="m-spark" data-spark="${i}"></canvas>
        <span class="m-coin-right"><em class="${color(f.chg) ? '' : 'down'}">${f.chg >= 0 ? '+' : ''}${f.chg.toFixed(2)}%</em><small>${f.price}</small></span>
      </button>`).join('');
    $$('.m-spark', list).forEach(c => {
      const f = focus[Number(c.dataset.spark)];
      drawSpark(c, f.spark, f.chg >= 0);
    });
    $$('.m-coin', list).forEach(btn => btn.addEventListener('click', () => {
      const f = focus.find(x => x.sym === btn.dataset.sym);
      if (f) openSheet(f);
    }));
  }

  function renderSignals() {
    const list = $('#mSignalList');
    if (!list) return;
    list.innerHTML = signals.map(s => `
      <button class="m-sig-row" data-sym="${s.sym}">
        <b>${s.sym} / USDT</b><em class="${s.gold ? 'gold' : ''}">${s.side}</em>
        <span>${s.desc}</span><small>${s.meta}</small>
      </button>`).join('');
    $$('.m-sig-row', list).forEach(btn => btn.addEventListener('click', () => {
      const f = focus.find(x => x.sym === btn.dataset.sym) || focus[0];
      openSheet(f);
    }));
  }

  function renderMovers(kind = 'up') {
    const list = $('#mMoversList');
    if (!list) return;
    list.innerHTML = movers[kind].map(([sym, chg, meta]) => `
      <button class="m-move" data-sym="${sym}">
        <b>${sym}<span> /USDT</span></b><small>${meta}</small><em class="${chg.startsWith('-') ? 'down' : ''}">${chg}</em>
      </button>`).join('');
    $$('.m-move', list).forEach(btn => btn.addEventListener('click', () => {
      const f = focus.find(x => x.sym === btn.dataset.sym) || { ...focus[0], sym: btn.dataset.sym };
      openSheet(f);
    }));
  }

  /* tabs */
  function activateTab(name) {
    $$('#mTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $$('.m-panel').forEach(p => p.classList.toggle('on', p.id === `panel-${name}`));
    if (name === 'movers') renderMovers('up');
  }
  $$('#mTabs button').forEach(b => b.addEventListener('click', () => {
    activateTab(b.dataset.tab);
    const y = $('.m-tabs').offsetTop - 64;
    window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
  }));

  $$('.m-movers-tabs button').forEach((b, i) => b.addEventListener('click', () => {
    $$('.m-movers-tabs button').forEach(x => x.classList.toggle('on', x === b));
    renderMovers(['up', 'down', 'oi'][i]);
  }));

  /* sheet */
  const sheet = $('#mSheet'), backdrop = $('#mSheetBackdrop');
  let sheetTimer;
  function drawSheetChart(f) {
    const c = $('#mSheetChart');
    if (!c) return;
    const w = c.clientWidth || 350, h = c.clientHeight || 84;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pts = f.spark;
    const min = Math.min(...pts), max = Math.max(...pts);
    const xy = pts.map((v, i) => [i / (pts.length - 1) * w, h - 8 - ((v - min) / (max - min || 1)) * (h - 18)]);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(232,160,32,.2)'); grad.addColorStop(1, 'rgba(232,160,32,0)');
    ctx.beginPath(); ctx.moveTo(0, h); xy.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); xy.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.strokeStyle = 'rgba(232,160,32,.8)'; ctx.lineWidth = 1.2; ctx.stroke();
    const last = xy[xy.length - 1];
    ctx.fillStyle = '#ffe0a0'; ctx.beginPath(); ctx.arc(last[0], last[1], 2.2, 0, Math.PI * 2); ctx.fill();
  }
  function openSheet(f) {
    if (!sheet) return;
    $('#mSheetKicker').textContent = f.sym === 'ARIA' ? 'ENTRY SIGNAL' : 'FOCUS DETAIL';
    $('#mSheetTitle').textContent = `${f.sym} / USDT`;
    $('#mSheetBadge').textContent = f.chg >= 0 ? 'LONG' : 'WATCH';
    $('#mSheetPrice').textContent = f.price;
    $('#mSheetChange').textContent = `${f.chg >= 0 ? '+' : ''}${f.chg.toFixed(2)}%`;
    $('#mSheetChange').style.color = f.chg >= 0 ? 'var(--green)' : 'var(--red)';
    $('#mSheetOi').textContent = `+${f.oi.toFixed(1)}%`;
    $('#mSheetScore').textContent = f.score;
    $('#mSheetVol').textContent = f.vol;
    $('#mSheetTags').innerHTML = ['持仓异动', '主动买入', '放量'].map(t => `<span>${t}</span>`).join('');
    $('#mSheetBadge').style.background = f.chg >= 0 ? 'var(--green)' : 'var(--red)';
    sheet.classList.add('on'); backdrop.classList.add('on'); document.body.classList.add('sheet-open');
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(() => drawSheetChart(f), 180);
  }
  function closeSheet() {
    sheet?.classList.remove('on'); backdrop?.classList.remove('on'); document.body.classList.remove('sheet-open');
  }
  $('#mSheetClose')?.addEventListener('click', closeSheet);
  backdrop?.addEventListener('click', closeSheet);
  $('#mSignalDetail')?.addEventListener('click', () => openSheet(focus[0]));

  /* nav */
  $$('.m-nav button').forEach(b => b.addEventListener('click', () => {
    const which = b.dataset.nav;
    $$('.m-nav button').forEach(x => x.classList.toggle('on', x === b));
    if (which === 'top') window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    if (which === 'focus' || which === 'signal') {
      activateTab(which);
      const target = which === 'focus' ? $('#panel-focus') : $('#panel-signal');
      setTimeout(() => target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }), 80);
    }
    if (which === 'me') {
      const f = { ...focus[0], sym: 'ACCOUNT', price: 'PRO', chg: 0, oi: 0, score: 100, vol: 'ACTIVE', spark: focus[0].spark };
      openSheet(f);
      $('#mSheetKicker').textContent = 'DEVICE LICENSE';
      $('#mSheetTitle').textContent = 'MOSS CORE · MOBILE';
      $('#mSheetBadge').textContent = 'ACTIVE';
      $('#mSheetPrice').textContent = 'PREVIEW';
      $('#mSheetChange').textContent = 'H5';
      $('#mSheetOi').textContent = '86';
      $('#mSheetScore').textContent = 'MOBILE';
      $('#mSheetVol').textContent = '550C';
      $('#mSheetTags').innerHTML = '<span>设备绑定</span><span>邀请码激活</span><span>数据同步</span>';
    }
  }));
  $('#mAvatar')?.addEventListener('click', () => $('.m-nav button[data-nav="me"]').click());

  /* clock */
  const clock = () => { const el = $('#mClock'); if (el) el.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false }); };
  clock(); setInterval(clock, 1000);

  /* refresh */
  const refresh = $('#mRefresh');
  refresh?.addEventListener('click', () => {
    refresh.textContent = '同步中…';
    focus.forEach(f => {
      const drift = (Math.random() - .45) * .18;
      f.chg = Math.max(-9, f.chg + drift);
      f.oi = Math.max(0, f.oi + drift * .18);
      f.price = (Number(f.price) * (1 + drift / 100)).toFixed(5);
      f.spark = f.spark.map(v => Math.max(1, v + (Math.random() - .5) * 4));
    });
    setTimeout(() => { renderFocus(); refresh.textContent = '刷新 ↻'; }, 450);
  });

  /* orbit */
  const orbit = $('#mOrbit');
  function drawOrbit() {
    if (!orbit) return;
    const r = orbit.getBoundingClientRect(), w = r.width, h = r.height;
    if (orbit.width !== Math.round(w * dpr) || orbit.height !== Math.round(h * dpr)) {
      orbit.width = Math.round(w * dpr); orbit.height = Math.round(h * dpr);
    }
    const ctx = orbit.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, t = performance.now() * .001;
    const base = Math.min(w, h) * .29;
    for (let i = 0; i < 3; i++) {
      const rr = base * (1 + i * .19), ry = .48 - i * .025;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * (i % 2 ? -.08 : .06) + i * .7);
      ctx.strokeStyle = `rgba(232,160,32,${.18 - i * .035})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * ry, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([1, 7]); ctx.strokeStyle = `rgba(242,238,227,${.08 - i * .015})`;
      ctx.beginPath(); ctx.ellipse(0, 0, rr * 1.03, rr * ry * 1.03, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      const n = 26 + i * 8;
      for (let j = 0; j < n; j++) {
        const a = j / n * Math.PI * 2;
        ctx.fillStyle = j % 7 === 0 ? 'rgba(232,160,32,.64)' : 'rgba(242,238,227,.22)';
        ctx.fillRect(Math.cos(a) * rr, Math.sin(a) * rr * ry, j % 7 === 0 ? 2 : .8, j % 7 === 0 ? 2 : .8);
      }
      ctx.restore();
    }
    const a = t * .25;
    for (let i = 0; i < 4; i++) {
      const aa = a + i * 1.57, rr = base * (1.02 + i * .03);
      const x = cx + Math.cos(aa) * rr, y = cy + Math.sin(aa) * rr * .48;
      ctx.fillStyle = 'rgba(232,160,32,.8)'; ctx.beginPath(); ctx.arc(x, y, i === 0 ? 2.5 : 1.4, 0, Math.PI * 2); ctx.fill();
    }
    requestAnimationFrame(drawOrbit);
  }

  renderFocus(); renderSignals(); renderMovers('up');
  requestAnimationFrame(drawOrbit);
  addEventListener('resize', () => { $$('.m-spark').forEach(c => { const f = focus[Number(c.dataset.spark)]; drawSpark(c, f.spark, f.chg >= 0); }); });
})();
