/*
 * Fotos de duplas.
 *
 * Quando o sorteio em dupla tira um par que tem foto cadastrada, o resultado mostra essa foto.
 * As fotos ficam salvas no próprio repositório do GitHub:
 *   assets/duplas/<pessoa>__<pessoa>-<id>.jpg   (a imagem)
 *   assets/duplas/duplas.json                   (a lista de duplas -> imagem)
 * O site lê o duplas.json publicado no GitHub Pages. Para cadastrar ou remover, usa a API
 * do GitHub com um token que fica só no navegador de quem cadastra (nunca no código).
 */
(function () {
  'use strict';

  const OWNER = 'FernandoBalbino';
  const REPO = 'roleta-do-chamado';
  const BRANCH = 'main';
  const DIR = 'assets/duplas';
  const MANIFEST = `${DIR}/duplas.json`;
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const TOKEN_KEY = 'roleta.ghToken';
  const MAX_SIDE = 1400; // a foto é reduzida antes de subir

  const R = window.Roleta;
  if (!R) return;

  const $ = (s) => document.querySelector(s);
  const ui = {
    openBtn: $('#pairsBtn'),
    modal: $('#pairsModal'),
    close: $('#pairsClose'),
    tokenBox: $('#pairsToken'),
    tokenInput: $('#ghToken'),
    tokenSave: $('#tokenSave'),
    tokenRemember: $('#tokenRemember'),
    connected: $('#pairsConnected'),
    forget: $('#tokenForget'),
    form: $('#pairForm'),
    a: $('#pairA'),
    b: $('#pairB'),
    file: $('#pairFile'),
    fileLabel: $('#pairFileLabel'),
    preview: $('#pairPreview'),
    save: $('#pairSave'),
    status: $('#pairsStatus'),
    list: $('#pairsList'),
    empty: $('#pairsEmpty'),
    summary: $('#pairsSummary'),
    bar: $('#pairsBar'),
    progress: $('#pairsProgress'),
  };
  const BTN_LABEL = '📸 Fotos de duplas';

  let entries = [];          // [{ pessoas: [idA, idB], nomes: [A, B], arquivo }]
  const localUrls = {};      // fotos recém-enviadas (antes do GitHub Pages publicar)
  // O GitHub Pages leva ~1 min para publicar. Até lá, lembra o que foi adicionado/removido aqui.
  const pendingAdds = new Map();   // arquivo -> entrada
  const pendingRemoves = new Set(); // arquivo
  let token = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { /* sem storage */ }
  let working = false;
  let previewUrl = '';

  // ---------------- identificação das duplas ----------------
  const idOf = (name) => {
    const p = R.personFor(name);
    return p ? p.key : R.norm(name).replace(/\s+/g, '-') || 'sem-nome';
  };
  const keyOf = (ids) => ids.slice().sort().join('__');
  const valid = (e) => e && Array.isArray(e.pessoas) && e.pessoas.length === 2 &&
    typeof e.arquivo === 'string' && e.arquivo.startsWith(`${DIR}/`);
  const srcOf = (e) => localUrls[e.arquivo] || e.arquivo;
  const labelOf = (e) => (Array.isArray(e.nomes) && e.nomes.length === 2 ? e.nomes : e.pessoas).join(' & ');

  // Foto da dupla (em qualquer ordem). Se houver várias, escolhe uma ao acaso.
  function find(nameA, nameB) {
    const k = keyOf([idOf(nameA), idOf(nameB)]);
    const matches = entries.filter((e) => keyOf(e.pessoas) === k);
    return matches.length ? matches[Math.floor(Math.random() * matches.length)] : null;
  }

  let published = []; // última lista lida do site publicado

  function refreshEntries() {
    const files = new Set(published.map((e) => e.arquivo));
    for (const f of [...pendingAdds.keys()]) if (files.has(f)) pendingAdds.delete(f);   // já publicado
    for (const f of [...pendingRemoves]) if (!files.has(f)) pendingRemoves.delete(f);   // já saiu
    entries = published.filter((e) => !pendingRemoves.has(e.arquivo)).concat([...pendingAdds.values()]);
    for (const e of entries) { const im = new Image(); im.src = srcOf(e); } // pré-carrega
    renderList();
  }

  async function loadManifest() {
    try {
      const r = await fetch(`${MANIFEST}?t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok) {
        const data = await r.json();
        published = (data && Array.isArray(data.duplas) ? data.duplas : []).filter(valid);
      }
    } catch (e) { /* sem lista (ex.: site aberto direto do arquivo) */ }
    refreshEntries();
  }

  // ---------------- API do GitHub ----------------
  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

  async function gh(method, path, body) {
    const url = path === null ? API : `${API}/contents/${encPath(path)}${method === 'GET' ? `?ref=${BRANCH}` : ''}`;
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (body) headers['Content-Type'] = 'application/json';
    const r = await fetch(url, { method, headers, cache: 'no-store', body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) {
      const err = new Error(`GitHub respondeu ${r.status}`);
      err.status = r.status;
      try { err.detail = (await r.json()).message; } catch (x) { /* sem corpo */ }
      throw err;
    }
    return r.status === 204 ? null : r.json();
  }

  function b64FromText(text) {
    const bytes = new TextEncoder().encode(text);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function textFromB64(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function blobToB64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1]);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async function readRemoteManifest() {
    try {
      const j = await gh('GET', MANIFEST);
      const text = j.content ? textFromB64(j.content) : '';
      return { data: text.trim() ? JSON.parse(text) : { duplas: [] }, sha: j.sha };
    } catch (e) {
      if (e.status === 404) return { data: { duplas: [] }, sha: null };
      throw e;
    }
  }

  // Lê a lista atual do repositório, aplica a mudança e grava (tenta de novo se houver conflito).
  async function updateManifest(change, message) {
    for (let attempt = 0; ; attempt++) {
      const cur = await readRemoteManifest();
      const data = { duplas: (Array.isArray(cur.data.duplas) ? cur.data.duplas : []).filter(valid) };
      change(data);
      const body = { message, content: b64FromText(`${JSON.stringify(data, null, 2)}\n`), branch: BRANCH };
      if (cur.sha) body.sha = cur.sha;
      try {
        await gh('PUT', MANIFEST, body);
        return data;
      } catch (e) {
        if ((e.status === 409 || e.status === 422) && attempt < 2) continue;
        throw e;
      }
    }
  }

  // Reduz e converte para JPEG antes de enviar.
  async function compress(file) {
    let src, w, h, tmpUrl = '';
    if (window.createImageBitmap) {
      src = await createImageBitmap(file);
      w = src.width; h = src.height;
    } else {
      tmpUrl = URL.createObjectURL(file);
      src = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('Não consegui abrir essa imagem.'));
        im.src = tmpUrl;
      });
      w = src.naturalWidth; h = src.naturalHeight;
    }
    const s = Math.min(1, MAX_SIDE / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * s));
    cv.height = Math.max(1, Math.round(h * s));
    const c = cv.getContext('2d');
    c.fillStyle = '#16102e';
    c.fillRect(0, 0, cv.width, cv.height);
    c.drawImage(src, 0, 0, cv.width, cv.height);
    if (tmpUrl) URL.revokeObjectURL(tmpUrl);
    return new Promise((resolve, reject) => {
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Não consegui ler essa imagem.'))), 'image/jpeg', 0.88);
    });
  }

  async function addPair(nameA, nameB, file) {
    const pair = [[idOf(nameA), nameA], [idOf(nameB), nameB]].sort((x, y) => (x[0] < y[0] ? -1 : 1));
    const ids = pair.map((p) => p[0]);
    const nomes = pair.map((p) => p[1]);
    const label = nomes.join(' & ');
    setStatus('Preparando a foto…');
    const blob = await compress(file);
    const path = `${DIR}/${ids.join('__')}-${Date.now().toString(36)}.jpg`;
    setStatus('Enviando a foto para o GitHub…');
    await gh('PUT', path, { message: `Adiciona foto da dupla ${label}`, content: await blobToB64(blob), branch: BRANCH });
    setStatus('Salvando na lista de duplas…');
    const entry = { pessoas: ids, nomes, arquivo: path };
    await updateManifest((d) => { d.duplas.push(entry); }, `Registra foto da dupla ${label}`);
    localUrls[path] = URL.createObjectURL(blob);
    pendingAdds.set(path, entry);
    await loadManifest(); // lista publicada + o que acabou de entrar
    return label;
  }

  async function removePair(entry) {
    const label = labelOf(entry);
    setStatus(`Removendo a foto de ${label}…`);
    // primeiro tira da lista (o site nunca aponta para um arquivo apagado), depois apaga a imagem
    await updateManifest((d) => { d.duplas = d.duplas.filter((e) => e.arquivo !== entry.arquivo); }, `Remove foto da dupla ${label}`);
    pendingAdds.delete(entry.arquivo);
    pendingRemoves.add(entry.arquivo);
    try {
      const f = await gh('GET', entry.arquivo);
      await gh('DELETE', entry.arquivo, { message: `Apaga imagem da dupla ${label}`, sha: f.sha, branch: BRANCH });
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    await loadManifest();
    return label;
  }

  function explain(e) {
    if (e && e.status === 401) return 'Token inválido ou expirado. Desconecte e conecte de novo com um token válido.';
    if (e && (e.status === 403 || e.status === 404)) return 'Esse token não tem permissão de escrita no repositório roleta-do-chamado (precisa de Contents: Read and write).';
    if (e && (e.status === 409 || e.status === 422)) return 'Conflito ao salvar no GitHub. Tente de novo.';
    return `Não deu certo: ${(e && (e.detail || e.message)) || e}`;
  }

  // ---------------- tela ----------------
  function setStatus(msg, kind) {
    ui.status.textContent = msg || '';
    ui.status.dataset.kind = kind || '';
  }

  function renderConn() {
    const on = !!token;
    ui.tokenBox.hidden = on;
    ui.connected.hidden = !on;
    ui.save.disabled = !on || working;
    ui.a.disabled = ui.b.disabled = ui.file.disabled = working;
    ui.tokenSave.disabled = working;
  }

  function fillSelects() {
    const names = [...new Set(R.getNames())];
    [[ui.a, 0], [ui.b, 1]].forEach(([sel, def]) => {
      const prev = sel.value;
      sel.textContent = '';
      for (const n of names) sel.append(new Option(n, n));
      sel.value = names.includes(prev) ? prev : names[def] || names[0] || '';
    });
  }

  // Pessoas da lista atual (sem repetir a mesma pessoa).
  function people() {
    const seen = new Set();
    const out = [];
    for (const name of R.getNames()) {
      const id = idOf(name);
      if (!seen.has(id)) { seen.add(id); out.push({ id, name }); }
    }
    return out;
  }

  // Progresso: para cada pessoa, com quem já tem foto de dupla e com quem falta.
  function renderProgress() {
    const ps = people();
    const counts = new Map();
    for (const e of entries) { const k = keyOf(e.pessoas); counts.set(k, (counts.get(k) || 0) + 1); }
    const total = (ps.length * (ps.length - 1)) / 2;
    let done = 0;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (counts.has(keyOf([ps[i].id, ps[j].id]))) done++;

    ui.openBtn.textContent = total ? `${BTN_LABEL} · ${done}/${total}` : BTN_LABEL;
    ui.bar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
    ui.summary.textContent = '';
    if (ps.length < 2) {
      ui.summary.textContent = 'Coloque pelo menos 2 nomes na lista para ver as duplas.';
    } else if (done === total) {
      ui.summary.textContent = `🎉 Todas as ${total} duplas já têm foto!`;
    } else {
      const b = document.createElement('b');
      b.textContent = `${done} de ${total}`;
      ui.summary.append(b, ` duplas com foto · faltam ${total - done}`);
    }

    ui.progress.textContent = '';
    for (const p of ps) {
      const partners = ps.filter((q) => q.id !== p.id);
      const have = partners.filter((q) => counts.has(keyOf([p.id, q.id]))).length;
      const row = document.createElement('div');
      row.className = `prog-row${have === partners.length ? ' complete' : ''}`;
      const head = document.createElement('div');
      head.className = 'prog-head';
      const nm = document.createElement('span');
      nm.textContent = p.name;
      const ct = document.createElement('span');
      ct.className = 'prog-count';
      ct.textContent = have === partners.length ? `✓ ${have}/${partners.length} completo` : `${have}/${partners.length}`;
      head.append(nm, ct);
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const q of partners) {
        const n = counts.get(keyOf([p.id, q.id])) || 0;
        const chip = document.createElement('button');
        chip.type = 'button';
        if (n) {
          chip.className = 'chip ok';
          chip.textContent = `✓ ${q.name}${n > 1 ? ` ×${n}` : ''}`;
          chip.title = `${p.name} & ${q.name} já tem ${n > 1 ? `${n} fotos` : 'foto'}`;
          chip.tabIndex = -1;
        } else {
          chip.className = 'chip miss';
          chip.textContent = `+ ${q.name}`;
          chip.title = `Adicionar foto de ${p.name} & ${q.name}`;
          chip.addEventListener('click', () => preselect(p.name, q.name));
        }
        chips.append(chip);
      }
      row.append(head, chips);
      ui.progress.append(row);
    }
  }

  // Clicar numa dupla que falta já preenche o formulário.
  function preselect(a, b) {
    fillSelects();
    ui.a.value = a;
    ui.b.value = b;
    setStatus(token ? `Escolha a foto de ${a} & ${b}.` : `Conecte com o token para enviar a foto de ${a} & ${b}.`);
    ui.form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderList() {
    renderProgress();
    ui.list.textContent = '';
    for (const e of entries) {
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = srcOf(e);
      img.alt = '';
      img.loading = 'lazy';
      const span = document.createElement('span');
      span.textContent = labelOf(e);
      li.append(img, span);
      if (token) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn ghost small';
        del.textContent = 'Remover';
        del.disabled = working;
        del.addEventListener('click', () => {
          if (!window.confirm(`Remover a foto da dupla ${labelOf(e)} do site?`)) return;
          run(() => removePair(e), (label) => `✓ Foto de ${label} removida. Some do site em cerca de 1 minuto.`);
        });
        li.append(del);
      }
      ui.list.append(li);
    }
    ui.empty.hidden = entries.length > 0;
  }

  async function run(task, okMsg) {
    if (working) return false;
    working = true;
    renderConn();
    renderList();
    try {
      const result = await task();
      setStatus(okMsg(result), 'ok');
      return true;
    } catch (e) {
      setStatus(explain(e), 'error');
      return false;
    } finally {
      working = false;
      renderConn();
      renderList();
    }
  }

  function clearFile() {
    ui.file.value = '';
    ui.fileLabel.textContent = '🖼️ Escolher a foto da dupla…';
    ui.preview.hidden = true;
    ui.preview.removeAttribute('src');
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ''; }
  }

  function open() {
    fillSelects();
    renderConn();
    renderList();
    setStatus('');
    ui.modal.hidden = false;
    requestAnimationFrame(() => ui.modal.classList.add('show'));
    loadManifest(); // atualiza a lista
  }
  function close() {
    ui.modal.classList.remove('show');
    setTimeout(() => { ui.modal.hidden = true; }, 250);
  }

  ui.openBtn.addEventListener('click', open);
  ui.close.addEventListener('click', close);
  ui.modal.addEventListener('click', (e) => { if (e.target === ui.modal) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ui.modal.hidden) close(); });

  ui.tokenSave.addEventListener('click', async () => {
    const t = ui.tokenInput.value.trim();
    if (!t) { setStatus('Cole o token do GitHub no campo acima.', 'error'); ui.tokenInput.focus(); return; }
    token = t;
    working = true;
    renderConn();
    setStatus('Verificando o token…');
    try {
      await gh('GET', null);
      if (ui.tokenRemember.checked) { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* sem storage */ } }
      ui.tokenInput.value = '';
      setStatus('✓ Conectado. Agora escolha a dupla e a foto.', 'ok');
    } catch (e) {
      token = '';
      setStatus(explain(e), 'error');
    } finally {
      working = false;
      renderConn();
      renderList();
    }
  });
  ui.tokenInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ui.tokenSave.click(); } });

  ui.forget.addEventListener('click', () => {
    token = '';
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* sem storage */ }
    setStatus('Desconectado deste navegador.');
    renderConn();
    renderList();
  });

  ui.file.addEventListener('change', () => {
    const f = ui.file.files && ui.file.files[0];
    if (!f) { clearFile(); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(f);
    ui.preview.src = previewUrl;
    ui.preview.hidden = false;
    ui.fileLabel.textContent = `🖼️ ${f.name}`;
  });

  ui.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!token) { setStatus('Conecte com o token do GitHub primeiro.', 'error'); return; }
    const a = ui.a.value, b = ui.b.value;
    const f = ui.file.files && ui.file.files[0];
    if (!a || !b) { setStatus('Escolha as duas pessoas da dupla.', 'error'); return; }
    if (idOf(a) === idOf(b)) { setStatus('Escolha duas pessoas diferentes.', 'error'); return; }
    if (!f) { setStatus('Escolha a foto da dupla.', 'error'); return; }
    if (f.type && !f.type.startsWith('image/')) { setStatus('Esse arquivo não é uma imagem.', 'error'); return; }
    const ok = await run(() => addPair(a, b, f), (label) => `✓ Foto da dupla ${label} salva no projeto! Em cerca de 1 minuto ela aparece para todo mundo no site.`);
    if (ok) clearFile();
  });

  window.Duplas = { find, srcOf, refresh: renderProgress };
  loadManifest();
})();
