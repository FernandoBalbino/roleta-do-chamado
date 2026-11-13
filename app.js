/*
 * Quem irá para o chamado? — roleta "de brincadeira".
 *
 * Com o som LIGADO a roleta é programada:
 *   - Solo:  o 1º nome da lista sempre é sorteado.
 *   - Dupla: o 1º e o 2º nomes da lista são sorteados (dois giros seguidos).
 * Com o som DESLIGADO o sorteio é aleatório de verdade (solo e dupla).
 *
 * Cada giro dura 7 s e para num ponto aleatório DENTRO da fatia escolhida,
 * então sempre parece um sorteio normal.
 */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const spinMs = 7000; // duração de cada giro
  const FONT = "'Fredoka', system-ui, sans-serif";

  // Geometria da roleta em unidades de desenho (diâmetro = 600)
  const W = {
    R: 296,       // borda externa
    rimIn: 279,   // início do aro
    segR: 280,    // raio das fatias
    pegR: 288,    // raio dos pinos
    hub: 102,     // raio do centro
    textIn: 118,  // onde o texto pode começar (logo depois do anel do centro)
    textOut: 262, // onde o texto termina
    tipR: 274,    // raio onde fica a ponta do garfo
  };
  const FORK_LEN = 250;

  const PALETTE = ['#ff4d6d', '#ffb703', '#2ec4b6', '#3a86ff', '#8338ec', '#fb5607', '#06d6a0', '#ff006e', '#ffd60a', '#4361ee'];
  // Pessoas com foto. O nome digitado na lista é reconhecido pelos apelidos (sem acento, sem maiúsculas).
  // Fotos em assets/pessoas/<key>-rosto.jpg (redonda, centro) e <key>.jpg (completa, resultado).
  const PEOPLE = [
    { key: 'luis-arthur', name: 'Luis Arthur', aliases: ['luis arthur', 'luis', 'arthur'] },
    { key: 'gabriel', name: 'Gabriel', aliases: ['gabriel'] },
    { key: 'marcos-melo', name: 'Marcos Melo', aliases: ['marcos melo', 'marcos', 'melo'] },
    { key: 'ruan', name: 'Ruan', aliases: ['ruan'] },
    { key: 'samuel-medina', name: 'Samuel Medina', aliases: ['samuel medina', 'samuel', 'medina'] },
    { key: 'fernando', name: 'Fernando', aliases: ['fernando', 'professor'] },
  ];
  const DEFAULT_NAMES = PEOPLE.map((p) => p.name);
  const IMG_VERSION = '2'; // mude ao trocar fotos, para o navegador não usar a versão antiga
  const NAMES_KEY = 'roleta.names.v2';

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem storage */ } },
  };

  const $ = (s) => document.querySelector(s);
  const el = {
    stage: $('#stage'),
    wrap: $('#wheelWrap'),
    wheel: $('#wheel'),
    hub: $('#hub'),
    hint: $('#tapHint'),
    pickBadge: $('#pickBadge'),
    names: $('#names'),
    count: $('#count'),
    spinBtn: $('#spinBtn'),
    spinNote: $('#spinNote'),
    shuffleBtn: $('#shuffleBtn'),
    clearBtn: $('#clearBtn'),
    soundBtn: $('#soundBtn'),
    modeBtns: Array.from(document.querySelectorAll('.mode-btn')),
    history: $('#history'),
    historyEmpty: $('#historyEmpty'),
    modal: $('#modal'),
    modalKicker: $('#modalKicker'),
    winners: $('#winners'),
    hubPhotos: $('#hubPhotos'),
    removeBtn: $('#removeBtn'),
    closeBtn: $('#closeBtn'),
    confetti: $('#confetti'),
    fallback: $('#fallbackPointer'),
  };
  const wctx = el.wheel.getContext('2d');
  const tex = document.createElement('canvas');

  // ---------------- estado ----------------
  let names = [];
  let order = [];            // fatia -> índice do nome
  let theta = Math.random() * TAU; // rotação atual da roleta (horário = positivo)
  let spin = null;           // giro em andamento { t0, from, delta }
  let draw = null;           // sorteio em andamento { rigged, needed, picks: [índices] }
  let lastPicks = [];        // resultado exibido no modal
  const excluded = new Set(); // fatias já sorteadas (ficam apagadas no modo dupla)
  let mode = store.get('roleta.mode', 'solo') === 'dupla' ? 'dupla' : 'solo';
  let omega = 0;             // velocidade angular (rad/s)
  let D = 0;                 // diâmetro em px
  let K = 1;                 // px por unidade de desenho
  let wheelDirty = true;
  let history = store.get('roleta.history', []);
  if (!Array.isArray(history)) history = [];
  let fork = null;           // garfo 3D (quando carregar)
  let useFallback = false;

  const mod = (a, n) => ((a % n) + n) % n;
  const wrapPi = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
  const needed = () => (mode === 'dupla' ? 2 : 1);
  const busy = () => !!spin || !!draw;

  // ---------------- pessoas / fotos ----------------
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function personFor(name) {
    const n = ` ${norm(name)} `;
    let best = null, bestLen = 0;
    for (const p of PEOPLE) {
      for (const a of p.aliases) {
        if (a.length > bestLen && n.includes(` ${a} `)) { best = p; bestLen = a.length; }
      }
    }
    return best;
  }

  function initials(name) {
    const w = name.trim().split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
  }

  // pré-carrega as fotos e monta uma camada redonda por pessoa no centro
  const hubInitials = document.createElement('div');
  hubInitials.className = 'hub-initials';
  for (const p of PEOPLE) {
    p.faceUrl = `assets/pessoas/${p.key}-rosto.jpg?v=${IMG_VERSION}`;
    p.fullUrl = `assets/pessoas/${p.key}.jpg?v=${IMG_VERSION}`;
    const face = document.createElement('img');
    face.src = p.faceUrl;
    face.alt = '';
    face.draggable = false;
    face.decoding = 'async';
    el.hubPhotos.append(face);
    p.hubEl = face;
    p.full = new Image();
    p.full.src = p.fullUrl;
  }
  el.hubPhotos.append(hubInitials);

  // Centro da roleta: começa com a foto atual e só troca quando a roleta gira.
  let centerSlot = -1;
  let centerEl = null;
  function showCenterFor(slot) {
    if (slot < 0 || slot === centerSlot) return;
    centerSlot = slot;
    const name = names[order[slot]];
    const p = personFor(name);
    let target;
    if (p) {
      target = p.hubEl;
    } else {
      hubInitials.textContent = initials(name);
      hubInitials.style.background = colorFor(slot, order.length);
      target = hubInitials;
    }
    if (centerEl !== target) {
      if (centerEl) centerEl.classList.remove('on');
      target.classList.add('on');
      centerEl = target;
    }
    el.hub.classList.add('show-photo');
    if (omega < 7 && el.hubPhotos.animate) {
      el.hubPhotos.animate([{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' });
    }
  }
  function resetCenter() {
    centerSlot = -1;
    if (centerEl) centerEl.classList.remove('on');
    centerEl = null;
    el.hub.classList.remove('show-photo');
  }

  // ---------------- som (Web Audio, sem arquivos) ----------------
  const Sound = (() => {
    let ctx = null, master = null, noise = null;
    let muted = store.get('roleta.muted', false) === true;
    function ensure() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.8;
        master.connect(ctx.destination);
        noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const ok = () => ctx && !muted;
    function tone(type, freq, at, len, vol) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(g).connect(master);
      o.start(at);
      o.stop(at + len + 0.02);
    }
    function tick(vol = 1) {
      if (!ok()) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2200 + Math.random() * 700;
      bp.Q.value = 2.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.55 * vol, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(bp).connect(g).connect(master);
      src.start(t);
      src.stop(t + 0.06);
      tone('sine', 2600 + Math.random() * 500, t, 0.14, 0.05 * vol); // "plim" metálico
    }
    function boing(vol = 1) {
      if (!ok()) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(380, t);
      o.frequency.exponentialRampToValueAtTime(140, t + 0.32);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 19;
      const lg = ctx.createGain();
      lg.gain.value = 38;
      lfo.connect(lg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14 * vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      o.connect(g).connect(master);
      o.start(t); lfo.start(t);
      o.stop(t + 0.45); lfo.stop(t + 0.45);
    }
    function ding() {
      if (!ok()) return;
      const t = ctx.currentTime;
      tone('triangle', 784, t, 0.25, 0.14);
      tone('triangle', 1175, t + 0.1, 0.45, 0.12);
    }
    function fanfare() {
      if (!ok()) return;
      const t = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        const at = t + i * 0.11;
        const len = i === notes.length - 1 ? 0.7 : 0.16;
        tone('triangle', f, at, len, 0.16);
        tone('square', f * 1.003, at, len, 0.03);
      });
    }
    return {
      ensure, tick, boing, ding, fanfare,
      get muted() { return muted; },
      setMuted(v) { muted = v; store.set('roleta.muted', v); },
    };
  })();

  // ---------------- confete ----------------
  const Confetti = (() => {
    const cv = el.confetti;
    const c = cv.getContext('2d');
    let parts = [], raf = 0, last = 0;
    function size() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(innerWidth * dpr);
      cv.height = Math.round(innerHeight * dpr);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function burst(x, y, count = 160) {
      size();
      for (let i = 0; i < count; i++) {
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
        const sp = 450 + Math.random() * 800;
        parts.push({
          x, y,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          r: Math.random() * TAU, vr: (Math.random() - 0.5) * 14,
          w: 6 + Math.random() * 7, h: 9 + Math.random() * 9,
          col: PALETTE[i % PALETTE.length],
          t: 0, ttl: 2.4 + Math.random() * 1.6, wob: Math.random() * TAU,
        });
      }
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
    }
    function step(now) {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      c.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter((p) => (p.t += dt) < p.ttl);
      for (const p of parts) {
        p.vy += 1500 * dt;
        p.vx *= 1 - 1.6 * dt;
        p.vy *= 1 - 1.1 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.r += p.vr * dt;
        p.wob += 10 * dt;
        c.save();
        c.globalAlpha = Math.min(1, (p.ttl - p.t) * 2);
        c.translate(p.x, p.y);
        c.rotate(p.r);
        c.scale(1, Math.cos(p.wob));
        c.fillStyle = p.col;
        c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        c.restore();
      }
      if (parts.length) raf = requestAnimationFrame(step);
      else { raf = 0; c.clearRect(0, 0, innerWidth, innerHeight); }
    }
    return { burst };
  })();

  // ---------------- nomes ----------------
  function parseNames(text) {
    return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 300);
  }

  function onNamesChanged() {
    names = parseNames(el.names.value);
    order = names.map((_, i) => i);
    excluded.clear();
    el.count.textContent = names.length === 1 ? '1 nome' : `${names.length} nomes`;
    store.set(NAMES_KEY, el.names.value);
    if (!busy()) resetCenter();
    if (window.Duplas) window.Duplas.refresh(); // atualiza o progresso das fotos de duplas
    updateControls();
    renderWheelTexture();
  }

  function shuffleWheel() {
    if (busy() || order.length < 2) return;
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    resetCenter();
    renderWheelTexture();
  }

  function setMode(m) {
    if (busy()) return;
    mode = m === 'dupla' ? 'dupla' : 'solo';
    store.set('roleta.mode', mode);
    updateControls();
  }

  function updateControls() {
    const on = busy();
    const enough = names.length >= needed();
    el.spinBtn.disabled = on || !enough;
    el.spinBtn.textContent = on ? 'GIRANDO…' : mode === 'dupla' ? 'SORTEAR DUPLA' : 'GIRAR';
    el.shuffleBtn.disabled = on || names.length < 2;
    el.clearBtn.disabled = on;
    el.names.readOnly = on;
    for (const b of el.modeBtns) {
      b.setAttribute('aria-checked', String(b.dataset.mode === mode));
      b.disabled = on;
    }
    const note = !on && !enough && names.length > 0 && mode === 'dupla' ? 'Adicione pelo menos 2 nomes para sortear uma dupla.' : '';
    el.spinNote.textContent = note;
    el.spinNote.hidden = !note;
    el.hint.classList.toggle('hide', on || !enough);
    el.hub.classList.toggle('spinning', !!spin);
  }

  // ---------------- desenho da roleta ----------------
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function colorFor(j, n) {
    const P = PALETTE.length;
    if (n > 1 && j === n - 1 && n % P === 1) return PALETTE[Math.floor(P / 2)];
    return PALETTE[j % P];
  }

  function pegRadius(n) {
    return Math.min(5.5, Math.max(2.2, ((TAU * W.pegR) / Math.max(n, 1)) * 0.16));
  }

  function renderWheelTexture() {
    if (!D) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(D * dpr);
    if (tex.width !== px) { tex.width = px; tex.height = px; }
    if (el.wheel.width !== px) { el.wheel.width = px; el.wheel.height = px; }
    const c = tex.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, px, px);
    const s = px / 600;
    c.setTransform(s, 0, 0, s, px / 2, px / 2);

    const n = order.length;
    const a = n ? TAU / n : TAU;

    // aro externo
    const rim = c.createRadialGradient(0, 0, W.rimIn, 0, 0, W.R);
    rim.addColorStop(0, '#1a1233');
    rim.addColorStop(0.5, '#3f2e78');
    rim.addColorStop(1, '#130d27');
    c.beginPath();
    c.arc(0, 0, W.R, 0, TAU);
    c.fillStyle = rim;
    c.fill();
    c.lineWidth = 2.4;
    c.strokeStyle = '#f7c948';
    c.beginPath();
    c.arc(0, 0, W.R - 1.3, 0, TAU);
    c.stroke();

    // fatias
    if (n === 0) {
      c.beginPath();
      c.arc(0, 0, W.segR, 0, TAU);
      c.fillStyle = '#3b3360';
      c.fill();
    } else {
      for (let j = 0; j < n; j++) {
        c.beginPath();
        c.moveTo(0, 0);
        c.arc(0, 0, W.segR, j * a, (j + 1) * a);
        c.closePath();
        c.fillStyle = colorFor(j, n);
        c.fill();
        if (excluded.has(j)) {
          c.fillStyle = 'rgba(18, 12, 38, 0.68)';
          c.fill();
        }
      }
    }

    // sombreamento para dar volume
    const sh = c.createRadialGradient(0, 0, W.hub * 0.9, 0, 0, W.segR);
    sh.addColorStop(0, 'rgba(0,0,0,0.25)');
    sh.addColorStop(0.22, 'rgba(0,0,0,0)');
    sh.addColorStop(0.86, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.28)');
    c.beginPath();
    c.arc(0, 0, W.segR, 0, TAU);
    c.fillStyle = sh;
    c.fill();

    // divisórias
    if (n > 1) {
      c.strokeStyle = 'rgba(255,255,255,0.6)';
      c.lineWidth = 1.6;
      for (let j = 0; j < n; j++) {
        const cs = Math.cos(j * a), sn = Math.sin(j * a);
        c.beginPath();
        c.moveTo(cs * W.hub * 0.95, sn * W.hub * 0.95);
        c.lineTo(cs * W.segR, sn * W.segR);
        c.stroke();
      }
    }
    c.strokeStyle = '#f7c948';
    c.lineWidth = 1.6;
    c.beginPath();
    c.arc(0, 0, W.rimIn, 0, TAU);
    c.stroke();

    // textos
    const avail = W.textOut - W.textIn;
    for (let j = 0; j < n; j++) {
      const label = names[order[j]];
      const col = colorFor(j, n);
      const dark = luminance(col) > 0.33 && !excluded.has(j);
      let fs = Math.min(32, n === 1 ? 40 : 2 * 210 * Math.sin(Math.min(a, Math.PI) / 2) * 0.5);
      c.save();
      c.rotate(j * a + a / 2);
      c.font = `600 ${fs}px ${FONT}`;
      let tw = c.measureText(label).width;
      if (tw > avail) {
        fs = Math.max(11, (fs * avail) / tw);
        c.font = `600 ${fs}px ${FONT}`;
        tw = c.measureText(label).width;
      }
      let text = label;
      if (tw > avail) {
        while (text.length > 1 && c.measureText(text + '…').width > avail) text = text.slice(0, -1);
        text += '…';
      }
      c.textAlign = 'right';
      c.textBaseline = 'middle';
      if (excluded.has(j)) c.globalAlpha = 0.5;
      c.fillStyle = dark ? '#24163f' : '#ffffff';
      if (!dark) {
        c.shadowColor = 'rgba(0,0,0,0.35)';
        c.shadowBlur = 3 * dpr;
        c.shadowOffsetY = 1 * dpr;
      }
      c.fillText(text, W.textOut, 1);
      c.restore();
    }

    // pinos dourados nas divisórias (é neles que o garfo bate)
    const rp = pegRadius(n);
    for (let j = 0; j < n; j++) {
      const x = Math.cos(j * a) * W.pegR, y = Math.sin(j * a) * W.pegR;
      c.beginPath();
      c.arc(x + 1, y + 1.6, rp, 0, TAU);
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fill();
      const g = c.createRadialGradient(x - rp * 0.35, y - rp * 0.35, rp * 0.1, x, y, rp);
      g.addColorStop(0, '#fff8d6');
      g.addColorStop(0.45, '#f7c948');
      g.addColorStop(1, '#9c6500');
      c.beginPath();
      c.arc(x, y, rp, 0, TAU);
      c.fillStyle = g;
      c.fill();
    }
    wheelDirty = true;
  }

  function drawWheel() {
    const px = el.wheel.width;
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    wctx.clearRect(0, 0, px, px);
    wctx.translate(px / 2, px / 2);
    wctx.rotate(theta);
    wctx.drawImage(tex, -px / 2, -px / 2);
    wheelDirty = false;
  }

  // ---------------- física do garfo mole ----------------
  // b = deslocamento da ponta (para baixo, em unidades), w = "barriga" balançando
  const PHYS = {
    k1: Math.pow(TAU * 4.6, 2), c1: 2 * 0.08 * TAU * 4.6,
    k2: Math.pow(TAU * 9.5, 2), c2: 2 * 0.1 * TAU * 9.5,
    g: 0.6,
    slip: 20,  // quanto a ponta entorta antes de escapar do pino
    vmax: 320, // velocidade máxima que o pino passa para a ponta
  };
  const F = { b: 0, vb: 0, w: 0, vw: 0, touching: false };
  let HT = 15; // meia altura da ponta do garfo (atualizada pelo modelo 3D)
  let lastRelease = 0;

  function forkStep(h, th, om) {
    const vb0 = F.vb;
    F.vb += (-PHYS.k1 * F.b - PHYS.c1 * F.vb) * h;
    F.b += F.vb * h;

    let touching = false;
    const n = order.length;
    if (n > 0) {
      const a = TAU / n;
      const rp = pegRadius(n);
      const j0 = Math.floor(-th / a);
      const m = Math.ceil(0.3 / a) + 1;
      for (let dj = -m; dj <= m; dj++) {
        const ang = wrapPi(th + (j0 + dj) * a);
        if (Math.cos(ang) < 0.7) continue;
        const yPeg = W.pegR * Math.sin(ang);
        const need = yPeg + rp + HT;
        if (need > F.b && need <= PHYS.slip) {
          F.b = need;
          const vPeg = Math.min(W.pegR * Math.cos(ang) * om, PHYS.vmax);
          if (F.vb < vPeg) F.vb = vPeg;
          touching = true;
        }
      }
    }
    if (F.touching && !touching && F.b > PHYS.slip * 0.6) onForkRelease(om);
    F.touching = touching;

    const ab = (F.vb - vb0) / h;
    F.vw += (-PHYS.k2 * F.w - PHYS.c2 * F.vw - PHYS.g * ab) * h;
    F.vw = Math.max(-1400, Math.min(1400, F.vw));
    F.w += F.vw * h;
    F.w = Math.max(-18, Math.min(18, F.w));
    F.b = Math.max(-38, Math.min(34, F.b));
  }

  function onForkRelease(om) {
    const now = performance.now();
    Sound.tick(Math.min(1, 0.45 + om / 12));
    if (om < 3.2 && now - lastRelease > 140) Sound.boing(0.8);
    lastRelease = now;
  }

  function pokeFork() {
    Sound.ensure();
    F.vb -= 420;
    F.vw += 300;
    Sound.boing(1);
  }

  // ---------------- sorteio ----------------
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const easeD = (t) => 3 * Math.pow(1 - t, 2);

  function slotAt(th) {
    const n = order.length;
    if (!n) return -1;
    return Math.floor(mod(-th, TAU) / (TAU / n)) % n;
  }

  // Escolhe a fatia onde o giro vai parar.
  function chooseSlot() {
    const k = draw.picks.length; // 0 = 1º sorteado, 1 = 2º sorteado (dupla)
    if (draw.rigged) return order.indexOf(k); // programado: k-ésimo nome da lista
    const free = [];
    for (let j = 0; j < order.length; j++) if (!excluded.has(j)) free.push(j);
    return free[Math.floor(Math.random() * free.length)];
  }

  function startDraw() {
    if (busy() || names.length < needed()) return;
    Sound.ensure();
    closeModal(true);
    excluded.clear();
    renderWheelTexture();
    el.pickBadge.hidden = true;
    // som ligado = programado; som desligado = aleatório de verdade
    draw = { rigged: !Sound.muted, needed: needed(), picks: [] };
    spinTo(chooseSlot());
  }

  function spinTo(slot) {
    theta = mod(theta, TAU);
    const n = order.length;
    const a = TAU / n;
    const u = 0.22 + Math.random() * 0.56; // ponto aleatório dentro da fatia
    const lambda = (slot + u) * a;
    const turns = 6 + Math.floor(Math.random() * 3);
    const base = theta + turns * TAU;
    const to = base + mod(-lambda - base, TAU);
    spin = { t0: performance.now(), from: theta, delta: to - theta };
    updateControls();
  }

  function popHead() {
    el.hub.classList.remove('pop');
    void el.hub.offsetWidth;
    el.hub.classList.add('pop');
  }

  function finishSpin() {
    spin = null;
    omega = 0;
    const slot = slotAt(theta);
    draw.picks.push(order[slot]);
    updateControls();
    popHead();

    if (draw.picks.length < draw.needed) {
      // dupla: mostra o 1º e gira de novo
      excluded.add(slot);
      renderWheelTexture();
      el.pickBadge.textContent = `1º sorteado: ${names[draw.picks[0]]}`;
      el.pickBadge.hidden = false;
      Sound.ding();
      setTimeout(() => { if (draw) spinTo(chooseSlot()); }, 1500);
      return;
    }

    const picks = draw.picks.slice();
    draw = null;
    updateControls();
    history.unshift({ name: picks.map((i) => names[i]).join(' & '), at: Date.now() });
    history = history.slice(0, 8);
    store.set('roleta.history', history);
    renderHistory();
    setTimeout(() => showResult(picks), 550);
  }

  // ---------------- resultado ----------------
  function showResult(picks) {
    lastPicks = picks;
    const two = picks.length > 1;
    el.modalKicker.textContent = two ? '🎉 A dupla do chamado é…' : '🎉 Quem vai para o chamado é…';
    el.removeBtn.textContent = two ? 'Remover os dois' : 'Remover da lista';
    el.winners.textContent = '';
    // dupla com foto cadastrada (Fotos de duplas): mostra a foto dos dois juntos
    const pairPhoto = two && window.Duplas ? window.Duplas.find(names[picks[0]], names[picks[1]]) : null;
    el.winners.classList.toggle('two', two && !pairPhoto);
    if (pairPhoto) {
      const fig = document.createElement('figure');
      fig.className = 'winner';
      const img = document.createElement('img');
      img.src = window.Duplas.srcOf(pairPhoto);
      img.alt = `${names[picks[0]]} & ${names[picks[1]]}`;
      img.draggable = false;
      const cap = document.createElement('figcaption');
      const amp = document.createElement('span');
      amp.className = 'amp-inline';
      amp.textContent = ' & ';
      cap.append(names[picks[0]], amp, names[picks[1]]);
      fig.append(img, cap);
      el.winners.append(fig);
    }
    if (!pairPhoto) picks.forEach((idx, i) => {
      if (i > 0) {
        const amp = document.createElement('div');
        amp.className = 'amp';
        amp.textContent = '&';
        el.winners.append(amp);
      }
      const name = names[idx];
      const p = personFor(name);
      const fig = document.createElement('figure');
      fig.className = 'winner';
      if (p) {
        const img = document.createElement('img');
        img.src = p.fullUrl;
        img.alt = name;
        img.draggable = false;
        fig.append(img);
      } else {
        const av = document.createElement('div');
        av.className = 'winner-initials';
        av.textContent = initials(name);
        av.style.background = colorFor(Math.max(0, order.indexOf(idx)), order.length);
        fig.append(av);
      }
      const cap = document.createElement('figcaption');
      cap.textContent = name;
      fig.append(cap);
      el.winners.append(fig);
    });
    sizeWinners();
    el.pickBadge.hidden = true;
    el.modal.hidden = false;
    requestAnimationFrame(() => el.modal.classList.add('show'));
    Sound.fanfare();
    Confetti.burst(innerWidth / 2, innerHeight * 0.42, picks.length > 1 ? 240 : 180);
    setTimeout(() => el.closeBtn.focus(), 50);
  }

  // deixa as fotos completas o maior possível dentro da tela
  function sizeWinners() {
    const imgs = el.winners.querySelectorAll('img');
    const count = el.winners.querySelectorAll('.winner').length;
    const stacked = count > 1 && innerWidth < 640;
    const maxW = stacked ? innerWidth * 0.84 : (Math.min(innerWidth * 0.9, 1100) - (count > 1 ? 70 : 0)) / count;
    const maxH = stacked ? innerHeight * 0.28 : Math.min(innerHeight * (count > 1 ? 0.56 : 0.62), 700);
    imgs.forEach((img) => {
      const apply = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return;
        const s = Math.min(maxW / w, maxH / h);
        img.style.width = `${Math.round(w * s)}px`;
        img.style.height = `${Math.round(h * s)}px`;
      };
      if (img.complete && img.naturalWidth) apply();
      else img.addEventListener('load', apply, { once: true });
    });
  }

  function closeModal(instant) {
    if (el.modal.hidden) return;
    el.modal.classList.remove('show');
    if (instant) el.modal.hidden = true;
    else setTimeout(() => { el.modal.hidden = true; }, 250);
    if (excluded.size) { excluded.clear(); renderWheelTexture(); }
    resetCenter(); // volta a foto original no centro
  }

  // remove da lista os nomes sorteados (por posição entre as linhas preenchidas)
  function removeWinners() {
    const drop = new Set(lastPicks);
    let k = -1;
    const kept = el.names.value.split(/\r?\n/).filter((line) => {
      if (!line.trim()) return true;
      k++;
      return !drop.has(k);
    });
    el.names.value = kept.join('\n');
    lastPicks = [];
    onNamesChanged();
    closeModal();
  }

  function renderHistory() {
    el.history.textContent = '';
    for (const h of history) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = h.name;
      const time = document.createElement('time');
      time.textContent = new Date(h.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      li.append(span, time);
      el.history.append(li);
    }
    el.historyEmpty.hidden = history.length > 0;
  }

  // ---------------- layout ----------------
  function positionPointer() {
    if (fork) {
      fork.setScale(K);
      fork.canvas.style.left = `${(300 + W.tipR - fork.PADL) * K}px`;
      fork.canvas.style.top = `${(300 - fork.HALF_H) * K}px`;
      fork.render(F.b, F.w);
    }
    if (useFallback) {
      el.fallback.style.left = `${(300 + W.tipR - 2) * K}px`;
      el.fallback.style.top = `${300 * K - D * 0.03}px`;
    }
  }

  function layout() {
    const cs = getComputedStyle(el.stage);
    const avail = el.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const desktop = window.matchMedia('(min-width: 900px)').matches;
    const over = (W.tipR + FORK_LEN - 300) / 600; // quanto o garfo passa da roleta
    let d = avail / (1 + over + 0.03);
    if (d < 380) d = Math.min(avail * 0.84, 380);
    if (desktop) d = Math.min(d, window.innerHeight - 64 - 48);
    d = Math.floor(Math.max(220, Math.min(660, d)));
    const total = d * (1 + over);
    const left = total <= avail ? (avail - total) / 2 : Math.max(0, (avail - d) * 0.25);
    el.wrap.style.marginLeft = `${left}px`;
    if (d !== D) {
      D = d;
      K = d / 600;
      document.documentElement.style.setProperty('--d', `${d}px`);
      renderWheelTexture();
      positionPointer();
    }
  }

  // ---------------- loop principal ----------------
  let last = performance.now();
  function frame(now) {
    update(now);
    requestAnimationFrame(frame);
  }
  function update(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const prev = theta;
    let finished = false;
    if (spin) {
      const t = Math.min(1, (now - spin.t0) / spinMs);
      theta = spin.from + spin.delta * ease(t);
      omega = (spin.delta * easeD(t)) / (spinMs / 1000);
      if (t >= 1) finished = true;
      wheelDirty = true;
      showCenterFor(slotAt(theta)); // troca a foto do centro quando o garfo passa por outro nome
    }
    if (dt > 0) {
      const steps = Math.max(1, Math.ceil(dt * 600));
      const h = dt / steps;
      for (let i = 1; i <= steps; i++) forkStep(h, prev + ((theta - prev) * i) / steps, omega);
    }
    if (wheelDirty) drawWheel();
    if (fork) fork.render(F.b, F.w);
    if (useFallback) {
      el.fallback.style.transform = `translateY(${F.b * K * 0.6}px) rotate(${-F.b * 0.9}deg)`;
    }
    if (finished) finishSpin();
  }

  // ---------------- eventos ----------------
  function onStageClick(e) {
    const r = el.wrap.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    const tipX = W.tipR * K;
    if (dx > tipX - 6 && dx < tipX + FORK_LEN * K && Math.abs(dy) < 30 * K) { pokeFork(); return; }
    if (dx * dx + dy * dy <= (D / 2) * (D / 2)) startDraw();
  }

  el.stage.addEventListener('click', onStageClick);
  el.wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startDraw(); }
  });
  el.spinBtn.addEventListener('click', startDraw);
  el.shuffleBtn.addEventListener('click', shuffleWheel);
  el.clearBtn.addEventListener('click', () => {
    if (busy()) return;
    el.names.value = '';
    onNamesChanged();
    el.names.focus();
  });
  for (const b of el.modeBtns) b.addEventListener('click', () => setMode(b.dataset.mode));
  el.names.addEventListener('input', onNamesChanged);
  el.names.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); startDraw(); }
  });
  el.soundBtn.addEventListener('click', () => {
    Sound.setMuted(!Sound.muted);
    updateSoundBtn();
    if (!Sound.muted) { Sound.ensure(); Sound.tick(0.8); }
  });
  el.closeBtn.addEventListener('click', () => closeModal());
  el.removeBtn.addEventListener('click', removeWinners);
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.modal.hidden) closeModal();
  });
  window.addEventListener('resize', () => {
    layout();
    if (!el.modal.hidden) sizeWinners();
  });

  function updateSoundBtn() {
    el.soundBtn.textContent = Sound.muted ? '🔇' : '🔊';
    el.soundBtn.setAttribute('aria-label', Sound.muted ? 'Ligar som' : 'Desligar som');
  }

  // ---------------- início ----------------
  function showFallback() {
    useFallback = true;
    el.fallback.hidden = false;
    positionPointer();
  }

  function init() {
    const saved = store.get(NAMES_KEY, null);
    el.names.value = typeof saved === 'string' && saved.trim() ? saved : DEFAULT_NAMES.join('\n');
    updateSoundBtn();
    renderHistory();
    layout();
    onNamesChanged();
    requestAnimationFrame(frame);

    if (document.fonts && document.fonts.load) {
      document.fonts.load(`600 32px ${FONT}`).then(() => renderWheelTexture()).catch(() => {});
    }

    if (typeof window.createFork3D === 'function') {
      window.createFork3D(el.wrap)
        .then((f) => {
          fork = f;
          HT = f.contactHalf || HT;
          fork.mount();
          positionPointer();
        })
        .catch((err) => {
          console.warn('Garfo 3D indisponível, usando ponteiro simples.', err);
          showFallback();
        });
    } else {
      showFallback();
    }
  }

  // usado pelo duplas.js (fotos de duplas)
  window.Roleta = { personFor, norm, getNames: () => names.slice() };

  init();
})();
