'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => 'n' + Math.random().toString(36).slice(2, 9);

function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  setTimeout(() => (t.className = 'toast'), 2800);
}
async function api(url, opts) {
  const r = await fetch(url, opts);
  let d; try { d = await r.json(); } catch { d = {}; }
  if (!r.ok) { const e = new Error(d.error || ('Erro ' + r.status)); e.data = d; e.status = r.status; throw e; }
  return d;
}
function openModal(html) { $('#modal').innerHTML = html; $('#modalBg').hidden = false; }
function closeModal() { $('#modalBg').hidden = true; $('#modal').innerHTML = ''; $('#modal').classList.remove('modal-wide'); }
$('#modalBg').addEventListener('click', (e) => { if (e.target.id === 'modalBg') closeModal(); });
function openDrawer(title, bodyHtml, footHtml) {
  $('#drawerTitle').textContent = title;
  $('#drawerBody').innerHTML = bodyHtml || '';
  $('#drawerFoot').innerHTML = footHtml || '';
  $('#drawer').hidden = false; $('#drawerBg').hidden = false;
}
function closeDrawer() { $('#drawer').hidden = true; $('#drawerBg').hidden = true; }
$('#closeDrawer').addEventListener('click', closeDrawer);
$('#drawerBg').addEventListener('click', closeDrawer);

function createMultiSelect(adapter) {
  const selected = new Set();

  function isMulti() { return selected.size > 1; }
  function clear() { selected.forEach((id) => adapter.nodeEl(id)?.classList.remove('multi-sel')); selected.clear(); }
  function toggle(id) {
    if (selected.has(id)) { selected.delete(id); adapter.nodeEl(id)?.classList.remove('multi-sel'); }
    else { selected.add(id); adapter.nodeEl(id)?.classList.add('multi-sel'); }
  }
  function add(id) { if (!selected.has(id)) { selected.add(id); adapter.nodeEl(id)?.classList.add('multi-sel'); } }
  function has(id) { return selected.has(id); }
  function ids() { return [...selected]; }

  // Retângulo de seleção (marquee) — desenhado como um <div> absoluto sobre
  // o canvas, em coordenadas de TELA (não de conteúdo), por simplicidade;
  // a interseção com os nodes é calculada convertendo para conteúdo no fim.
  function beginMarquee(startEv) {
    const canvasEl = adapter.canvasEl();
    const box = document.createElement('div');
    box.className = 'marquee-box';
    canvasEl.appendChild(box);
    const r0 = canvasEl.getBoundingClientRect();
    const sx = startEv.clientX, sy = startEv.clientY;
    const draw = (x1, y1, x2, y2) => {
      box.style.left = Math.min(x1, x2) - r0.left + 'px';
      box.style.top = Math.min(y1, y2) - r0.top + 'px';
      box.style.width = Math.abs(x2 - x1) + 'px';
      box.style.height = Math.abs(y2 - y1) + 'px';
    };
    draw(sx, sy, sx, sy);
    const mv = (ev) => draw(sx, sy, ev.clientX, ev.clientY);
    const up = (ev) => {
      document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
      const r = box.getBoundingClientRect(); box.remove();
      // converte o retângulo de tela para coordenadas de conteúdo, e marca
      // como selecionado todo node cujo retângulo (também em conteúdo)
      // intersecte essa área.
      const a = adapter.screenToContent(r.left, r.top), b = adapter.screenToContent(r.right, r.bottom);
      const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
      if (maxX - minX < 4 && maxY - minY < 4) return; // clique sem arrastar de fato — não conta como marquee
      clear();
      for (const id of adapter.allNodeIds()) {
        const nr = adapter.nodeRect(id); if (!nr) continue;
        const intersects = nr.x < maxX && nr.x + nr.w > minX && nr.y < maxY && nr.y + nr.h > minY;
        if (intersects) add(id);
      }
    };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  }

  // Arrasta TODOS os nodes selecionados juntos, mantendo a posição
  // relativa entre eles — chamado a partir do mousedown de um node que já
  // está dentro da seleção múltipla.
  function beginGroupDrag(startEv) {
    const start = adapter.screenToContent(startEv.clientX, startEv.clientY);
    const origins = new Map(ids().map((id) => [id, adapter.getPos(id)]));
    let moved = false;
    const mv = (ev) => {
      const p = adapter.screenToContent(ev.clientX, ev.clientY);
      const dx = p.x - start.x, dy = p.y - start.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      for (const [id, origin] of origins) adapter.setPos(id, origin.x + dx, origin.y + dy);
      adapter.renderEdges();
    };
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); if (moved) adapter.scheduleSave(); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  }

  function showContextMenu(x, y) {
    document.querySelectorAll('.node-ctx-menu').forEach((m) => { m._cleanup?.(); m.remove(); });
    const menu = document.createElement('div');
    menu.className = 'node-ctx-menu';
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
    menu.innerHTML = `<button data-act="dup">⎘ Duplicar ${selected.size} nós</button><button data-act="del" class="danger">🗑 Excluir ${selected.size} nós</button>`;
    document.body.appendChild(menu);
    menu.querySelector('[data-act="dup"]').addEventListener('click', () => { close(); adapter.duplicateMany(ids()); clear(); });
    menu.querySelector('[data-act="del"]').addEventListener('click', () => { close(); if (confirm(`Excluir ${selected.size} nós selecionados?`)) { adapter.deleteMany(ids()); clear(); } });
    const onDocClick = (ev) => { if (!menu.contains(ev.target)) close(); };
    setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    function close() { document.removeEventListener('mousedown', onDocClick); menu.remove(); }
    menu._cleanup = close;
  }

  // Hook principal: chamado no mousedown do CANVAS (área vazia). Se Shift
  // estiver pressionado, inicia o marquee; senão, limpa a seleção múltipla
  // (clique normal em área vazia desfaz a seleção, como é convenção usual).
  function onCanvasMouseDown(e) {
    if (e.target.closest('.node')) return; // tratado em onNodeMouseDown
    if (e.shiftKey) { e.preventDefault(); beginMarquee(e); }
    else if (selected.size) clear();
  }

  // Hook por node: chamado no mousedown da "head" do node (mesmo handler
  // que já existe para drag normal). Retorna true se assumiu o evento
  // (shift-click ou drag em grupo), e o caller deve então NÃO prosseguir
  // com a lógica de drag/clique individual padrão.
  function onNodeMouseDown(id, e) {
    if (e.shiftKey) { e.preventDefault(); e.stopPropagation(); toggle(id); return true; }
    if (has(id) && isMulti()) { e.stopPropagation(); beginGroupDrag(e); return true; }
    return false;
  }

  // Hook de context menu por node: se o node clicado com botão direito faz
  // parte de uma seleção múltipla ativa, mostra o menu de grupo em vez do
  // menu individual. Retorna true se assumiu o evento.
  function onNodeContextMenu(id, e) {
    if (has(id) && isMulti()) { showContextMenu(e.clientX, e.clientY); return true; }
    return false;
  }

  return { clear, toggle, add, has, ids, isMulti, onCanvasMouseDown, onNodeMouseDown, onNodeContextMenu };
}

const ICON = {
  timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/></svg>',
  message: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v11H9l-4 4V5z"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7l8-4 8 4v7l-8 4-8-4V7z"/><circle cx="11" cy="9" r="2"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.6"/><path d="M21 16l-5-5L4 20"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="M17 9l4-2v10l-4-2"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v18M8 7v10M16 7v10M4 10v4M20 10v4"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  wait_reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  condition: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 3v12a3 3 0 0 0 3 3h9M6 3L3 6m3-3l3 3M18 18l3-3m-3 3l-3-3"/></svg>',
  distributor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 3v6m0 0a3 3 0 1 0 0 6m0-6h12m0 0a3 3 0 1 1 0 6m0-6V3"/></svg>',
  notify: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  webhook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 7a3 3 0 1 1 4 2.8L10 15M15 12a3 3 0 1 1-1.5 5.6L8 17M6 12a3 3 0 1 0 4.5 2.6"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z"/></svg>',
  pixel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0z"/></svg>'
};

const state = {
  devices: [], tagNames: [], tagsMap: {}, flows: [],
  flow: null, view: { x: 60, y: 80, zoom: 1 }, sel: null,
  drawerStep: null, runPoll: null, lastRunStatus: null,
  runInfo: { executed: [], active: [] },
  x1Flow: null, x1View: { x: 60, y: 80, zoom: 1 }, x1Sel: null, x1DrawerStep: null
};


/* ============ Navegação ============ */
function showView(name) {
  document.querySelectorAll('.menu-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== 'view-' + name));
  if (name === 'x1-chats') loadX1Chats();
  if (name === 'x1-flows') loadX1Flows();
  if (name === 'x1-contacts') loadX1Contacts();
  if (name === 'x1-settings') loadX1Settings();
  if (name === 'x1-triggers') loadX1Triggers();
  if (name === 'devices') loadDevices();
}
document.querySelectorAll('.menu-item').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

/* ============ Conexão ============ */
async function refreshConn() {
  const conn = $('#conn'), txt = $('#connText'), ver = $('#appVersion');
  try {
    const cfg = await api('/api/config');
    if (ver) ver.textContent = cfg.version ? `GoX1 v${cfg.version}` : 'GoX1';
    if (!cfg.configured) { conn.className = 'conn bad'; txt.textContent = 'sem conexão'; return; }
    conn.className = 'conn ok'; txt.textContent = 'Evolution ok';
    $('#btnGogrupo').href = cfg.url_gogrupo || 'https://gogroup-gogrupo.ntwddx.easypanel.host/'; $('#btnGogrupo').style.opacity = '1';
    $('#btnGoFire').href = cfg.url_gofire || 'https://gogroup-gofire.ntwddx.easypanel.host/'; $('#btnGoFire').style.opacity = '1';
  } catch { conn.className = 'conn bad'; txt.textContent = 'erro'; }
}

/* ============ Dispositivos ============ */
async function loadDevicesQuiet() {
  try { state.devices = await api('/api/devices'); } catch { state.devices = []; }
}
async function loadDevices() {
  await loadDevicesQuiet();
  const list = $('#deviceList');
  if (!state.devices.length) { list.innerHTML = '<div class="empty"><div class="big">Nenhum dispositivo</div></div>'; return; }
  list.innerHTML = state.devices.map((d) => {
    const on = d.state === 'open' || d.state === 'connected';
    return `<div class="device-card">
      <div class="dev-head"><span class="dev-name">${esc(d.name)}</span><span class="dstate ${on ? 'ok' : 'bad'}"><span class="dot"></span>${on ? 'conectado' : 'desconectado'}</span></div>
      ${d.profileName ? `<div class="hint">${esc(d.profileName)}${d.number ? ' · ' + esc(String(d.number).split('@')[0]) : ''}</div>` : ''}
      <div class="row-gap" style="margin-top:10px">
        ${!on ? `<button class="btn primary sm" data-qr="${esc(d.name)}">Conectar (QR)</button>` : ''}
        ${on ? `<button class="btn ghost sm" data-testsend="${esc(d.name)}">Testar envio</button>` : ''}
        <button class="btn ghost sm" data-logout="${esc(d.name)}">Desconectar</button>
        <button class="btn danger sm" data-del="${esc(d.name)}">Excluir</button>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-qr]').forEach((b) => b.addEventListener('click', () => showQR(b.dataset.qr)));
  list.querySelectorAll('[data-testsend]').forEach((b) => b.addEventListener('click', async () => {
    const number = prompt(`Teste de envio pelo ${b.dataset.testsend}.\nDigite o número de destino (com DDI+DDD, ex: 5573999998888):`);
    if (!number) return;
    try {
      const r = await api(`/api/x1/devices/${encodeURIComponent(b.dataset.testsend)}/test-send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number }) });
      const sessaoOk = r.own_number && r.profile_name;
      toast(`Estado: ${r.state} | Nº da sessão: ${r.own_number || '⚠️ VAZIO'} (${r.profile_name || '⚠️ sem nome'}) | id: ${r.message_id || '—'}. ${sessaoOk ? 'Confira se chegou no celular.' : 'Nº/perfil vazio com estado "aberto" = sessão fantasma — reconecte este aparelho.'}`);
    } catch (e) { toast('Falhou: ' + e.message, true); }
  }));
  list.querySelectorAll('[data-logout]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/devices/${encodeURIComponent(b.dataset.logout)}/logout`, { method: 'POST' }); toast('Desconectado.'); loadDevices(); } catch (e) { toast(e.message, true); }
  }));
  list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Excluir ${b.dataset.del}?`)) return;
    try { await api(`/api/devices/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); toast('Excluído.'); loadDevices(); } catch (e) { toast(e.message, true); }
  }));
}
function showQR(name) {
  openModal(`<h2 style="margin:0 0 12px">Conectar: ${esc(name)}</h2><div id="qrArea"><p class="hint">Carregando QR…</p></div>
    <button class="btn ghost" style="margin-top:12px;width:100%" onclick="closeModal()">Fechar</button>`);
  api(`/api/devices/${encodeURIComponent(name)}/qr`).then((d) => {
    const area = $('#qrArea'); if (!area) return;
    if (d.base64) area.innerHTML = `<img src="${d.base64.startsWith('data:') ? d.base64 : 'data:image/png;base64,' + d.base64}" style="width:220px;height:220px;display:block;margin:auto" />`;
    else if (d.code) area.innerHTML = `<p class="hint" style="font-size:18px;letter-spacing:3px;text-align:center">${esc(d.code)}</p>`;
    else area.innerHTML = '<p class="hint">Sem QR disponível.</p>';
  }).catch((e) => { const area = $('#qrArea'); if (area) area.innerHTML = `<p class="hint err">${esc(e.message)}</p>`; });
}
$('#newDevice').addEventListener('click', () => {
  openModal(`<h2 style="margin:0 0 12px">Conectar dispositivo</h2>
    <div class="field"><label class="lbl">Nome</label><input id="newDevName" placeholder="ex: MeuCelular" /></div>
    <div class="row-gap" style="margin-top:12px">
      <button class="btn ghost" style="flex:1" onclick="closeModal()">Cancelar</button>
      <button class="btn primary" style="flex:1" id="newDevConfirm">Conectar</button>
    </div>`);
  $('#newDevConfirm').addEventListener('click', async () => {
    const name = $('#newDevName').value.trim(); if (!name) return;
    try {
      const r = await api('/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      closeModal(); loadDevices();
      if (r.qr?.base64 || r.qr?.code) showQR(name);
    } catch (e) { toast(e.message, true); }
  });
});

/* ============ GoX1: Contatos ============ */
async function loadX1Contacts() {
  const box = $('#x1ContactsList'); box.innerHTML = '<p class="hint">Carregando…</p>';
  try {
    const contacts = await api('/api/x1/contacts');
    if (!contacts.length) { box.innerHTML = '<div class="empty"><div class="big">Nenhum contato ainda</div>Contatos aparecem aqui automaticamente quando alguém mandar mensagem.</div>'; return; }
    box.innerHTML = `<table class="x1-table"><thead><tr><th>Nome</th><th>Número</th><th>Etiquetas</th><th>Última atividade</th></tr></thead><tbody>
      ${contacts.map((c) => `<tr data-jid="${esc(c.jid)}">
        <td>${esc(c.name || c.jid.split('@')[0])}</td>
        <td>${esc(c.jid.split('@')[0])}</td>
        <td>${(c.tags || []).map((t) => `<span class="tag-pill">${esc(t)}</span>`).join(' ') || '<span class="hint">—</span>'}</td>
        <td class="hint">${new Date(c.last_seen).toLocaleString('pt-BR')}</td>
      </tr>`).join('')}
    </tbody></table>`;
    box.querySelectorAll('tr[data-jid]').forEach((row) => row.addEventListener('click', () => {
      showView('x1-chats'); document.querySelector('[data-view="x1-chats"]').classList.add('active');
      setTimeout(() => openX1Chat(row.dataset.jid), 150);
    }));
  } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
}

/* ============ GoX1: Configurações ============ */
async function loadX1Settings() {
  try {
    const [settings, flows, devices, cfg] = await Promise.all([
      api('/api/x1/settings'), api('/api/x1/flows'),
      api('/api/devices').catch(() => []),
      api('/api/config').catch(() => ({}))
    ]);
    // Conexão
    if ($('#cfgUrl')) $('#cfgUrl').value = cfg.evolution_url || '';
    if ($('#cfgKey')) { $('#cfgKey').value = ''; $('#cfgKey').placeholder = cfg.has_key ? 'deixe em branco para manter' : 'cole a API key'; }
    if ($('#cfgUrlGogrupo')) $('#cfgUrlGogrupo').value = cfg.url_gogrupo || '';
    if ($('#cfgUrlGoFire')) $('#cfgUrlGoFire').value = cfg.url_gofire || '';
    if ($('#cfgOpenaiKey')) { $('#cfgOpenaiKey').value = ''; $('#cfgOpenaiKey').placeholder = cfg.has_openai ? 'configurada — deixe em branco para manter' : 'sk-...'; }
    if ($('#cfgOpenaiState')) $('#cfgOpenaiState').textContent = cfg.has_openai ? '✅ Chave configurada.' : '⚠️ Nenhuma chave — os blocos de IA não vão funcionar.';
    $('#x1WebhookDevice').innerHTML = devices.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('') || '<option value="">nenhum dispositivo conectado</option>';
    if ($('#x1AsaasUrl')) $('#x1AsaasUrl').textContent = `${location.origin}/webhook/asaas`;
    if ($('#x1AsaasSecret')) { $('#x1AsaasSecret').value = ''; $('#x1AsaasSecret').placeholder = cfg.has_asaas_secret ? 'configurada — deixe em branco para manter' : 'cole a chave secreta'; }
    if ($('#x1AsaasPageId')) $('#x1AsaasPageId').value = cfg.asaas_page_id || '';
    state.x1AsaasPixelId = cfg.asaas_pixel_id || '';
    if ($('#x1AsaasFlow')) {
      $('#x1AsaasFlow').innerHTML = '<option value="">(escolha um fluxo)</option>' +
        (flows || []).map((f) => `<option value="${f.id}" ${String(cfg.asaas_flow_id) === String(f.id) ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
    }
    if ($('#x1AsaasState')) $('#x1AsaasState').textContent = cfg.has_asaas_secret ? '✅ Chave secreta configurada.' : '⚠️ Configure a chave secreta (a mesma do GOX1_RELAY_SECRET no Worker do checkout) para começar a receber.';
    state.x1Flows = flows;
    loadX1Tags();
  } catch (e) { toast(e.message, true); }
}

async function loadX1Tags() {
  try { renderX1Tags(await api('/api/x1/tags')); } catch {}
  try { renderX1Pixels(await api('/api/x1/pixels')); } catch {}
}
function renderX1Pixels(pixels) {
  const box = $('#x1PixelList'); if (!box) return;
  box.innerHTML = (pixels || []).length
    ? (pixels || []).map((p) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)">
        <span><strong>${esc(p.name)}</strong> <span class="hint">· ID ${esc(p.pixel_id)} ${p.has_token ? '· token ✓' : '· sem token'}</span></span>
        <button class="btn sm danger" data-pxdel="${p.id}">excluir</button></div>`).join('')
    : '<p class="hint">Nenhum pixel cadastrado ainda.</p>';
  box.querySelectorAll('[data-pxdel]').forEach((el) => el.addEventListener('click', async () => {
    try { renderX1Pixels(await api(`/api/x1/pixels/${el.dataset.pxdel}`, { method: 'DELETE' })); } catch (err) { toast(err.message, true); }
  }));
  const asaasSel = $('#x1AsaasPixel');
  if (asaasSel) {
    const cur = state.x1AsaasPixelId || '';
    asaasSel.innerHTML = '<option value="">(escolha um pixel cadastrado acima)</option>' +
      (pixels || []).map((p) => `<option value="${p.id}" ${String(cur) === String(p.id) ? 'selected' : ''}>${esc(p.name)} · ID ${esc(p.pixel_id)}</option>`).join('');
  }
  state.x1PixelsCache = pixels || [];
}
function renderX1Tags(tags) {
  const box = $('#x1TagList'); if (!box) return;
  box.innerHTML = (tags || []).length
    ? (tags || []).map((t) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)">
        <span>#${esc(t.name)} ${t.stores_value ? '<span class="hint">· guarda valor</span>' : ''}</span>
        <button class="btn sm danger" data-tagdel="${esc(t.name)}">excluir</button></div>`).join('')
    : '<p class="hint">Nenhuma etiqueta criada ainda.</p>';
  box.querySelectorAll('[data-tagdel]').forEach((el) => el.addEventListener('click', async () => {
    try { renderX1Tags(await api(`/api/x1/tags/${encodeURIComponent(el.dataset.tagdel)}`, { method: 'DELETE' })); } catch (err) { toast(err.message, true); }
  }));
}
/* ============ GoX1: Disparos por dispositivo ============ */
let x1TrgState = { device: '', keywords: [], flows: [] };
async function loadX1Triggers() {
  try {
    const [devices, flows] = await Promise.all([api('/api/devices').catch(() => (state.devices || [])), api('/api/x1/flows').catch(() => [])]);
    x1TrgState.flows = flows;
    const list = Array.isArray(devices) ? devices : (devices.devices || state.devices || []);
    $('#x1TrgDevice').innerHTML = '<option value="">Escolha um número…</option>' + list.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('');
    $('#x1TrgConfig').hidden = true;
    await renderX1Configured();
  } catch (e) { toast(e.message, true); }
}
function x1FlowName(id) { const f = (x1TrgState.flows || []).find((x) => String(x.id) === String(id)); return f ? f.name : (id ? `#${id}` : '—'); }
async function renderX1Configured() {
  const box = $('#x1TrgConfigured'); if (!box) return;
  let list = [];
  try { list = await api('/api/x1/device-triggers'); } catch {}
  box.innerHTML = list.length
    ? list.map((c) => `<div class="x1trg-row" data-trgdev="${esc(c.device)}">
        <div><strong>${esc(c.device)}</strong><br><span class="hint">boas-vindas: ${esc(x1FlowName(c.welcome_flow_id))} · padrão: ${esc(x1FlowName(c.default_flow_id))} · ${(c.keyword_triggers || []).length} palavra(s)-chave</span></div>
        <div class="row-gap"><button class="btn ghost sm" data-trgedit="${esc(c.device)}">editar</button><button class="btn sm danger" data-trgdel="${esc(c.device)}">excluir</button></div>
      </div>`).join('')
    : '<p class="hint">Nenhum número configurado ainda.</p>';
  box.querySelectorAll('[data-trgedit]').forEach((el) => el.addEventListener('click', () => { $('#x1TrgDevice').value = el.dataset.trgedit; x1LoadDeviceTriggers(el.dataset.trgedit); window.scrollTo({ top: 9999, behavior: 'smooth' }); }));
  box.querySelectorAll('[data-trgdel]').forEach((el) => el.addEventListener('click', async () => {
    if (!confirm(`Remover a configuração de disparo de ${el.dataset.trgdel}? Ele deixa de disparar fluxo.`)) return;
    try { await api(`/api/x1/device-triggers/${encodeURIComponent(el.dataset.trgdel)}`, { method: 'DELETE' }); toast('Configuração removida.'); if (x1TrgState.device === el.dataset.trgdel) $('#x1TrgConfig').hidden = true; renderX1Configured(); }
    catch (err) { toast(err.message, true); }
  }));
}
function x1FlowOptions(sel) { return '<option value="">(nenhum)</option>' + (x1TrgState.flows || []).map((f) => `<option value="${f.id}" ${String(f.id) === String(sel) ? 'selected' : ''}>${esc(f.name)}</option>`).join(''); }
async function x1LoadDeviceTriggers(device) {
  if (!device) { $('#x1TrgConfig').hidden = true; return; }
  try {
    const cfg = await api(`/api/x1/device-triggers/${encodeURIComponent(device)}`);
    x1TrgState.device = device;
    x1TrgState.keywords = cfg.keyword_triggers || [];
    $('#x1TrgWelcome').innerHTML = x1FlowOptions(cfg.welcome_flow_id);
    $('#x1TrgDefault').innerHTML = x1FlowOptions(cfg.default_flow_id);
    $('#x1TrgTimeout').value = cfg.default_flow_timeout_hours ?? 24;
    renderX1TrgKeywords();
    $('#x1TrgConfig').hidden = false;
  } catch (e) { toast(e.message, true); }
}
function renderX1TrgKeywords() {
  const box = $('#x1TrgKeywords');
  box.innerHTML = (x1TrgState.keywords || []).map((k, i) => `<div class="row-gap" style="margin-bottom:8px">
    <select data-kmatch="${i}" style="width:120px"><option value="contains" ${k.match !== 'equals' ? 'selected' : ''}>contém</option><option value="equals" ${k.match === 'equals' ? 'selected' : ''}>é exatamente</option></select>
    <input data-kvalue="${i}" value="${esc(k.value || '')}" placeholder="palavra-chave" style="flex:1" />
    <select data-kflow="${i}" style="width:160px">${x1FlowOptions(k.flow_id)}</select>
    <button class="btn sm danger" data-kdel="${i}">×</button>
  </div>`).join('') || '<p class="hint">Nenhuma palavra-chave configurada.</p>';
  box.querySelectorAll('[data-kmatch]').forEach((el) => el.addEventListener('change', (e) => { x1TrgState.keywords[+el.dataset.kmatch].match = e.target.value; }));
  box.querySelectorAll('[data-kvalue]').forEach((el) => el.addEventListener('input', (e) => { x1TrgState.keywords[+el.dataset.kvalue].value = e.target.value; }));
  box.querySelectorAll('[data-kflow]').forEach((el) => el.addEventListener('change', (e) => { x1TrgState.keywords[+el.dataset.kflow].flow_id = +e.target.value; }));
  box.querySelectorAll('[data-kdel]').forEach((el) => el.addEventListener('click', () => { x1TrgState.keywords.splice(+el.dataset.kdel, 1); renderX1TrgKeywords(); }));
}
$('#x1TrgDevice').addEventListener('change', (e) => x1LoadDeviceTriggers(e.target.value));
$('#x1TrgAddKw').addEventListener('click', () => { x1TrgState.keywords.push({ match: 'contains', value: '', flow_id: '' }); renderX1TrgKeywords(); });
$('#x1TrgSave').addEventListener('click', async () => {
  if (!x1TrgState.device) { toast('Escolha um dispositivo.', true); return; }
  try {
    await api(`/api/x1/device-triggers/${encodeURIComponent(x1TrgState.device)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      welcome_flow_id: $('#x1TrgWelcome').value ? +$('#x1TrgWelcome').value : null,
      default_flow_id: $('#x1TrgDefault').value ? +$('#x1TrgDefault').value : null,
      default_flow_timeout_hours: +$('#x1TrgTimeout').value || 24,
      keyword_triggers: x1TrgState.keywords.filter((k) => k.value && k.flow_id)
    }) });
    toast('Disparos deste número salvos.');
    renderX1Configured();
  } catch (e) { toast(e.message, true); }
});
$('#x1WebhookSetup').addEventListener('click', async () => {
  const instance = $('#x1WebhookDevice').value, base_url = $('#x1WebhookBaseUrl').value.trim();
  if (!instance || !base_url) return toast('Escolha o dispositivo e informe a URL pública.', true);
  try {
    const r = await api('/api/x1/webhook-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instance, base_url }) });
    $('#x1WebhookResult').textContent = `Conectado: ${r.webhook_url}`;
    toast('Webhook configurado.');
  } catch (e) { $('#x1WebhookResult').textContent = ''; toast(e.message, true); }
});

/* ============ GoX1: Chats ao vivo ============ */
let x1ChatPoll = null, x1CurrentChatJid = null, x1ChatFilterValue = 'waiting', x1DeviceFilterValue = '', x1WebhooksConfigured = false, x1MsgPollTimer = null;
async function x1CheckWebhooks() {
  const box = $('#whStatus'); if (!box) return;
  box.innerHTML = 'Verificando…';
  try {
    const list = await api('/api/x1/webhook-status');
    if (!list.length) { box.innerHTML = 'Nenhum dispositivo conectado.'; return; }
    const base = window.location.origin;
    box.innerHTML = list.map((d) => {
      let icon, label;
      if (!d.url) { icon = '❌'; label = 'sem webhook — clique em corrigir'; }
      else if (d.url.startsWith(base)) { icon = '✅'; label = 'GoX1 recebe (e repassa para os outros)'; }
      else if (d.url.includes('/webhook/in/')) { icon = '✅'; label = 'unificado (via outro app, repassa para o GoX1)'; }
      else { icon = '⚠️'; label = 'aponta para outro app sem repasse — clique em corrigir'; }
      return `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--line)">
        <span>${icon} <strong>${esc(d.device)}</strong></span><span class="hint">${label}</span></div>`;
    }).join('');
  } catch (err) { box.innerHTML = `Erro ao verificar: ${esc(err.message)}`; }
}

async function loadX1Chats() {
  try {
    const devs = await api('/api/devices');
    const connected = devs.filter((d) => d.state === 'open' || d.state === 'connected');
    const sel = $('#x1DeviceFilter');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Todos os dispositivos</option>' +
      connected.map((d) => `<option value="${esc(d.name)}" ${d.name === cur ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
    x1DeviceFilterValue = sel.value;
    // Garante que o GoX1 receba as mensagens: aponta o webhook de cada
    // dispositivo conectado para este app (uma vez por sessão). Sem isso, se o
    // aparelho estiver no GoFire, o webhook fica apontado para lá e o chat não
    // recebe nada.
    if (!x1WebhooksConfigured && connected.length) {
      x1WebhooksConfigured = true;
      const base = window.location.origin;
      Promise.all(connected.map((d) => api('/api/x1/webhook-setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance: d.name, base_url: base })
      }).catch(() => {})));
    }
  } catch {}
  await renderX1ChatList();
  if (!x1ChatPoll) x1ChatPoll = setInterval(() => renderX1ChatList(), 6000);
}
async function renderX1ChatList() {
  try {
    const convs = await api('/api/x1/conversations');
    const contacts = {};
    try { const cs = await api('/api/x1/contacts'); cs.forEach((c) => { contacts[c.jid] = c; }); } catch {}
    let filtered = convs.filter((c) => c.status === x1ChatFilterValue);
    if (x1DeviceFilterValue) filtered = filtered.filter((c) => c.device === x1DeviceFilterValue);
    const box = $('#x1ChatItems');
    box.innerHTML = filtered.length ? filtered.map((c) => {
      const displayName = contacts[c.jid]?.name || c.jid.split('@')[0];
      const last = c.messages[c.messages.length - 1];
      const deviceLabel = c.device ? `<span class="hint" style="font-size:10px">${esc(c.device)}</span>` : '';
      return `<div class="x1-chat-item ${c.jid === x1CurrentChatJid ? 'active' : ''}" data-jid="${esc(c.jid)}">
        <div class="x1ci-name">${esc(displayName)} ${deviceLabel}</div>
        <div class="x1ci-preview hint">${esc((last?.text || '').slice(0, 60))}</div>
      </div>`;
    }).join('') : '<div class="empty" style="padding:30px 16px"><div class="big">Nada aqui</div></div>';
    box.querySelectorAll('[data-jid]').forEach((el) => el.addEventListener('click', () => openX1Chat(el.dataset.jid)));
  } catch {}
}
async function openX1Chat(jid) {
  x1CurrentChatJid = jid;
  renderX1ChatList();
  try {
    const [conv, contact, run, flows] = await Promise.all([
      api(`/api/x1/conversations/${encodeURIComponent(jid)}`),
      api(`/api/x1/contacts/${encodeURIComponent(jid)}`),
      api(`/api/x1/contacts/${encodeURIComponent(jid)}/run`).catch(() => ({ in_flow: false })),
      api('/api/x1/flows').catch(() => [])
    ]);
    const panel = $('#x1ChatPanel');
    const attendingDevice = (() => { for (let i = conv.messages.length - 1; i >= 0; i--) if (conv.messages[i].device) return conv.messages[i].device; return conv.device || '—'; })();
    panel.innerHTML = `<div class="x1-chat-wrap">
      <div class="x1-chat-col">
        <div class="x1-chat-head">
          <div><div class="x1ci-name">${esc(contact.name || jid.split('@')[0])}</div><div class="hint">${esc(jid.split('@')[0])}</div></div>
          <div class="row-gap">
            <select id="x1StatusSel"><option value="waiting" ${conv.status === 'waiting' ? 'selected' : ''}>Aguardando</option><option value="attending" ${conv.status === 'attending' ? 'selected' : ''}>Atendendo</option><option value="done" ${conv.status === 'done' ? 'selected' : ''}>Resolvido</option></select>
          </div>
        </div>
        <div class="x1-chat-msgs" id="x1ChatMsgs">${conv.messages.map((m) => `<div class="x1-msg ${m.fromMe ? 'out' : 'in'}">${esc(m.text)}</div>`).join('')}</div>
        <div class="x1-chat-input">
          <select id="x1SendDevice"></select>
          <input id="x1SendText" placeholder="Digite uma mensagem…" />
          <button class="btn primary" id="x1SendBtn">Enviar</button>
        </div>
      </div>
      <aside class="x1-chat-info" id="x1ChatInfo">${x1ContactInfoHTML(jid, contact, run, attendingDevice, flows)}</aside>
    </div>`;
    $('#x1ChatMsgs').scrollTop = $('#x1ChatMsgs').scrollHeight;
    $('#x1StatusSel').addEventListener('change', async (e) => { try { await api(`/api/x1/conversations/${encodeURIComponent(jid)}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: e.target.value }) }); renderX1ChatList(); } catch (err) { toast(err.message, true); } });
    await loadDevicesQuiet();
    $('#x1SendDevice').innerHTML = state.devices.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('') || '<option value="">sem dispositivo</option>';
    // O seletor acompanha o dispositivo que ATENDE esta conversa.
    if (conv.device && state.devices.some((d) => d.name === conv.device)) $('#x1SendDevice').value = conv.device;
    // Atualização em tempo real: enquanto este chat está aberto, busca novas
    // mensagens a cada 4s e atualiza a lista sem precisar sair e voltar.
    clearInterval(x1MsgPollTimer);
    let lastCount = conv.messages.length;
    x1MsgPollTimer = setInterval(async () => {
      if (x1CurrentChatJid !== jid) { clearInterval(x1MsgPollTimer); return; }
      try {
        const c2 = await api(`/api/x1/conversations/${encodeURIComponent(jid)}`);
        const box = $('#x1ChatMsgs'); if (!box) return;
        if ((c2.messages || []).length !== lastCount) {
          lastCount = c2.messages.length;
          const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 60;
          box.innerHTML = c2.messages.map((m) => `<div class="x1-msg ${m.fromMe ? 'out' : 'in'}">${esc(m.text)}</div>`).join('');
          if (atBottom) box.scrollTop = box.scrollHeight;
          renderX1ChatList();
        }
      } catch { /* silencioso */ }
    }, 4000);
    const doSend = async () => {
      const text = $('#x1SendText').value.trim(), device = $('#x1SendDevice').value;
      if (!text || !device) return;
      try {
        await api(`/api/x1/conversations/${encodeURIComponent(jid)}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device, text }) });
        $('#x1SendText').value = ''; openX1Chat(jid);
      } catch (err) { toast(err.message, true); }
    };
    $('#x1SendBtn').addEventListener('click', doSend);
    $('#x1SendText').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); });
    x1BindContactInfo(jid);
  } catch (e) { toast(e.message, true); }
}

function x1ContactInfoHTML(jid, contact, run, device, flows) {
  const tags = (contact.tags || []);
  const fields = contact.fields || {};
  const fieldRows = Object.keys(fields).length
    ? Object.entries(fields).map(([k, v]) => `<div class="x1ci-field"><span class="x1ci-key">${esc(k)}</span><span class="x1ci-val">${esc(String(v ?? ''))}</span></div>`).join('')
    : '<p class="hint">Nenhum campo preenchido ainda.</p>';
  const typeLabel = { message: 'mensagem', wait_reply: 'aguarda resposta', condition: 'condição', tag: 'etiqueta', distributor: 'distribuidor', ai: 'IA', notify: 'notificação', webhook: 'webhook', pixel: 'pixel', inicio: 'início', trigger: 'gatilho' };
  const frontierTxt = (run.frontier || []).length
    ? (run.frontier).map((f) => typeLabel[f.type] || f.type).join(', ')
    : 'nenhum (fluxo terminou)';
  const fmtDT = (ts) => ts ? new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  const lastEnd = run.last_flow_end;
  const flowState = run.in_flow
    ? `<div class="x1ci-flow"><strong>${esc(run.flow_name)}</strong>${run.paused ? ' <span class="hint">(PAUSADO)</span>' : ''}<br>
        <span class="hint">${run.waiting ? (run.waiting.mode === 'reply' ? 'aguardando resposta do lead' : 'aguardando tempo') : 'em execução'}</span><br>
        <span class="hint">parado em: <strong>${esc(frontierTxt)}</strong></span></div>`
    : (lastEnd
        ? `<p class="hint">Nenhum fluxo em andamento.</p>
           <div class="x1ci-flow"><strong>${esc(lastEnd.flow_name)}</strong> <span class="hint">(encerrado)</span><br>
             <span class="hint">${lastEnd.had_next_for_outcome === false ? '⚠ parou sem seguir adiante' : 'terminou'} em: <strong>${esc(typeLabel[lastEnd.last_node_type] || lastEnd.last_node_type || '?')}</strong>${lastEnd.outcome ? ` (saída "${esc(lastEnd.outcome)}")` : ''}</span><br>
             <span class="hint">${fmtDT(lastEnd.ended_at)}</span></div>`
        : '<p class="hint">Nenhum fluxo em andamento.</p>');
  const flowOpts = (flows || []).map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  return `<div class="x1ci-sec"><div class="x1ci-h" style="display:flex;justify-content:space-between;align-items:center"><span>Informações do contato</span> <button class="btn ghost sm" id="x1CiEdit">✎ Editar</button></div>
      <div class="x1ci-name" style="font-size:1.05rem">${esc(contact.name || jid.split('@')[0])}</div>
      <div class="x1ci-field"><span class="x1ci-key">Telefone</span><span class="x1ci-val">${esc(jid.split('@')[0])}</span></div>
      <div class="x1ci-field"><span class="x1ci-key">Atendendo por</span><span class="x1ci-val">${esc(device || '—')}</span></div></div>
    <div class="x1ci-sec"><div class="x1ci-h">Etiquetas</div>${tags.length ? `<div class="x1ci-tags">${tags.map((t) => `<span class="x1ci-tag">#${esc(t)}</span>`).join('')}</div>` : '<p class="hint">Sem etiquetas.</p>'}</div>
    <div class="x1ci-sec"><div class="x1ci-h">Fluxo</div>${flowState}
      <div class="row-gap" style="margin-top:10px">
        <select id="x1CiFlowSel" style="flex:1"><option value="">Disparar fluxo…</option>${flowOpts}</select>
        <button class="btn ghost sm" id="x1CiStartFlow">Disparar</button>
      </div>
      ${run.in_flow ? `<button class="btn ghost sm" id="x1CiViewPos" style="margin-top:8px;width:100%">👁 Ver posição no fluxo</button>` : ''}
      ${!run.in_flow && lastEnd ? `<button class="btn ghost sm" id="x1CiViewPos" style="margin-top:8px;width:100%">👁 Ver onde o fluxo parou</button>` : ''}
      ${run.in_flow ? '<button class="btn ghost sm danger" id="x1CiStopFlow" style="margin-top:8px;width:100%">Parar fluxo</button>' : ''}</div>
    <div class="x1ci-sec"><div class="x1ci-h">Informações adicionais</div>${fieldRows}</div>
    <div class="x1ci-sec"><div class="x1ci-h">Ações destrutivas</div>
      <button class="btn sm danger" id="x1CiDeleteChat" style="width:100%">Excluir chat e zerar contato</button>
      <p class="hint" style="margin-top:6px">Apaga a conversa, o contato e o fluxo em andamento só aqui no GoX1 (não mexe no WhatsApp). O contato volta a ser "novo" e o fluxo de boas-vindas dispara de novo.</p></div>`;
}
function x1BindContactInfo(jid) {
  const edit = $('#x1CiEdit');
  if (edit) edit.addEventListener('click', async () => {
    try {
      const [contact, conv] = await Promise.all([
        api(`/api/x1/contacts/${encodeURIComponent(jid)}`),
        api(`/api/x1/conversations/${encodeURIComponent(jid)}`)
      ]);
      const aside = $('#x1ChatInfo'); if (!aside) return;
      const devOpts = state.devices.map((d) => `<option value="${esc(d.name)}" ${conv.device === d.name ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
      const fieldsTxt = Object.entries(contact.fields || {}).map(([k, v]) => `${k}=${v ?? ''}`).join('\n');
      aside.innerHTML = `<div class="x1ci-sec"><div class="x1ci-h">Editar contato</div>
          <div class="field"><label class="lbl">Nome</label><input id="x1EdName" value="${esc(contact.name || '')}"/></div>
          <div class="field"><label class="lbl">Dispositivo de atendimento</label><select id="x1EdDevice">${devOpts || '<option value="">nenhum</option>'}</select>
            <div class="hint" style="margin-top:4px">É por este número que os fluxos e respostas saem.</div></div>
          <div class="field"><label class="lbl">Etiquetas (separadas por vírgula)</label><input id="x1EdTags" value="${esc((contact.tags || []).join(', '))}"/></div>
          <div class="field"><label class="lbl">Informações adicionais (uma por linha: chave=valor)</label>
            <textarea id="x1EdFields" style="min-height:120px;font-family:monospace;font-size:0.8rem">${esc(fieldsTxt)}</textarea></div>
          <div class="row-gap"><button class="btn primary" id="x1EdSave" style="flex:1">Salvar</button><button class="btn ghost" id="x1EdCancel" style="flex:1">Cancelar</button></div></div>`;
      $('#x1EdCancel').addEventListener('click', () => openX1Chat(jid));
      $('#x1EdSave').addEventListener('click', async () => {
        const fields = {};
        $('#x1EdFields').value.split('\n').forEach((ln) => {
          const i = ln.indexOf('='); if (i < 1) return;
          const k = ln.slice(0, i).trim(), v = ln.slice(i + 1).trim();
          if (k) fields[k] = v;
        });
        try {
          await api(`/api/x1/contacts/${encodeURIComponent(jid)}/edit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            name: $('#x1EdName').value.trim(),
            device: $('#x1EdDevice').value,
            tags: $('#x1EdTags').value.split(',').map((t) => t.trim()).filter(Boolean),
            fields
          }) });
          toast('Contato atualizado.'); openX1Chat(jid);
        } catch (err) { toast(err.message, true); }
      });
    } catch (err) { toast(err.message, true); }
  });
  const start = $('#x1CiStartFlow');
  if (start) start.addEventListener('click', async () => {
    const fid = $('#x1CiFlowSel').value; if (!fid) { toast('Escolha um fluxo.', true); return; }
    try { const r = await api(`/api/x1/contacts/${encodeURIComponent(jid)}/start-flow`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flow_id: fid }) }); toast(r.note || 'Fluxo disparado.'); setTimeout(() => openX1Chat(jid), 2500); }
    catch (err) { toast(err.message, true); }
  });
  const viewPos = $('#x1CiViewPos');
  if (viewPos) viewPos.addEventListener('click', () => x1ShowFlowPosition(jid));
  const stop = $('#x1CiStopFlow');
  if (stop) stop.addEventListener('click', async () => {
    try { await api(`/api/x1/contacts/${encodeURIComponent(jid)}/stop-flow`, { method: 'POST' }); toast('Fluxo parado.'); openX1Chat(jid); }
    catch (err) { toast(err.message, true); }
  });
  const del = $('#x1CiDeleteChat');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('Excluir a conversa e zerar este contato no GoX1? Isso apaga a conversa, o contato e o fluxo em andamento (só aqui, não no WhatsApp). O contato volta a ser novo.')) return;
    try {
      await api(`/api/x1/contacts/${encodeURIComponent(jid)}/chat`, { method: 'DELETE' });
      toast('Chat excluído e contato zerado.');
      x1CurrentChatJid = null;
      $('#x1ChatPanel').innerHTML = '<div class="x1-empty">Selecione uma conversa.</div>';
      loadX1Chats();
    } catch (err) { toast(err.message, true); }
  });
}

// Popup só de visualização: mostra o fluxo inteiro em miniatura (reaproveita
// as posições x/y salvas pelo editor — não faz layout novo) com o(s) node(s)
// onde o lead está agora pulsando, pra achar de relance sem precisar abrir o
// editor de verdade e sem risco de mexer em nada sem querer.
async function x1ShowFlowPosition(jid) {
  let run, flow, endedInfo = null;
  try {
    run = await api(`/api/x1/contacts/${encodeURIComponent(jid)}/run`);
    if (run.in_flow) {
      flow = await api(`/api/x1/flows/${run.flow_id}`);
    } else if (run.last_flow_end) {
      endedInfo = run.last_flow_end;
      flow = await api(`/api/x1/flows/${endedInfo.flow_id}`);
    } else {
      toast('Este contato nunca esteve em nenhum fluxo.', true); return;
    }
  } catch (e) { toast(e.message, true); return; }

  const activeIds = new Set(run.in_flow ? (run.frontier || []).map((f) => f.nodeId) : []);
  const endedId = endedInfo ? endedInfo.last_node_id : null;
  const NODE_COLORS = { start: '#8b5cf6', trigger: '#8b5cf6', message: '#22c55e', wait_reply: '#f97316', condition: '#3b82f6', tag: '#ec4899', ai: '#06b6d4', notify: '#eab308', webhook: '#94a3b8', distributor: '#6366f1', pixel: '#1877f2', inicio: '#8b5cf6' };
  const nodes = [
    { id: 'start', type: 'inicio', x: flow.start_x ?? 80, y: flow.start_y ?? 200, label: 'Início' },
    ...(flow.steps || []).map((s) => ({ id: s.id, type: s.type, x: s.x ?? 0, y: s.y ?? 0, label: x1NodeSummary(s) || (({ message: 'Mensagem', wait_reply: 'Aguarda resposta', condition: 'Condicional', tag: 'Etiqueta', distributor: 'Distribuidor', ai: 'IA', notify: 'Notificação', webhook: 'Webhook', pixel: 'Pixel' })[s.type] || s.type) }))
  ];
  const W = 168, H = 60; // mesmo tamanho aproximado de node do editor
  const minX = Math.min(...nodes.map((n) => n.x)), minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + W)), maxY = Math.max(...nodes.map((n) => n.y + H));
  const pad = 40;
  const totalW = (maxX - minX) + pad * 2, totalH = (maxY - minY) + pad * 2;

  // Linhas de conexão: mesma lógica de "next" do editor, simplificada (linha
  // reta em vez de curva — é só pra orientar, não precisa ser bonito).
  const edges = [];
  const pushNext = (fromId, next) => {
    if (!next) return;
    if (typeof next === 'string') edges.push([fromId, next]);
    else if (Array.isArray(next)) next.forEach((n) => n && edges.push([fromId, n]));
    else if (typeof next === 'object') Object.values(next).forEach((n) => n && edges.push([fromId, n]));
  };
  pushNext('start', flow.start_next);
  for (const s of (flow.steps || [])) pushNext(s.id, s.next);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  // Zoom de verdade (não CSS transform): recalcula posições/tamanhos em cada
  // nível, senão a área de rolagem não acompanha o zoom e fica ou cortando
  // conteúdo ou sobrando uma tela vazia gigante.
  function renderAt(zoom) {
    const w = W * zoom, h = H * zoom, fz = Math.max(9, 12 * zoom);
    const edgeSvg = edges.filter(([a, b]) => byId[a] && byId[b]).map(([a, b]) => {
      const na = byId[a], nb = byId[b];
      const x1 = (na.x - minX + pad + W / 2) * zoom, y1 = (na.y - minY + pad + H / 2) * zoom;
      const x2 = (nb.x - minX + pad + W / 2) * zoom, y2 = (nb.y - minY + pad + H / 2) * zoom;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--line-bright)" stroke-width="${Math.max(1, 1.5 * zoom)}"/>`;
    }).join('');
    const nodesHtml = nodes.map((n) => {
      const isActive = activeIds.has(n.id) || (n.id === 'start' && activeIds.has(flow.start_next));
      const isEnded = endedId && n.id === endedId;
      const color = NODE_COLORS[n.type] || '#888';
      const icon = ICON[n.type] || ICON.message;
      const cls = isActive ? ' active' : (isEnded ? ' ended' : '');
      const tag = isActive ? '<span class="x1pos-tag">lead está aqui</span>' : (isEnded ? `<span class="x1pos-tag ended">${endedInfo.had_next_for_outcome === false ? 'parou aqui (sem saída)' : 'terminou aqui'}</span>` : '');
      return `<div class="x1pos-node${cls}" style="left:${(n.x - minX + pad) * zoom}px;top:${(n.y - minY + pad) * zoom}px;width:${w}px;min-height:${h}px;border-color:${color};font-size:${fz}px" data-node="${esc(n.id)}">
        <span class="x1pos-ic" style="color:${color}">${icon}</span>
        <span class="x1pos-lb">${esc(n.label)}</span>
        ${tag}
      </div>`;
    }).join('');
    return { edgeSvg, nodesHtml, w: totalW * zoom, h: totalH * zoom };
  }

  const subtitle = run.in_flow
    ? 'Posição do lead no fluxo — só visualização, nada aqui pode ser editado.'
    : `Fluxo encerrado ${endedInfo ? 'em ' + new Date(endedInfo.ended_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''} — mostrando o último nó alcançado. Só visualização.`;
  openModal(`<div class="modal-inner x1pos-modal">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;gap:10px">
      <div><h2>${esc(flow.name)}</h2><p class="sub" style="margin:0">${esc(subtitle)}</p></div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <button class="icon-btn" id="x1PosOut" title="Diminuir">−</button>
        <span class="zoom-label" id="x1PosZoomLabel">100%</span>
        <button class="icon-btn" id="x1PosIn" title="Aumentar">+</button>
        <button class="icon-btn" id="x1PosFit" title="Encaixar na tela">⤢</button>
        <button class="icon-btn" id="x1PosClose">&times;</button>
      </div>
    </div>
    <div class="x1pos-viewport" id="x1PosViewport">
      <div class="x1pos-canvas" id="x1PosCanvas">
        <svg id="x1PosSvg" style="position:absolute;left:0;top:0"></svg>
      </div>
    </div>
  </div>`);
  $('#modal').classList.add('modal-wide');
  $('#x1PosClose').addEventListener('click', closeModal);

  const vp = $('#x1PosViewport'), canvas = $('#x1PosCanvas'), svg = $('#x1PosSvg'), label = $('#x1PosZoomLabel');
  let zoom = 1;
  function paint(centerOnFocus) {
    zoom = Math.max(0.15, Math.min(2.5, zoom));
    const { edgeSvg, nodesHtml, w, h } = renderAt(zoom);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    svg.setAttribute('width', w); svg.setAttribute('height', h); svg.innerHTML = edgeSvg;
    canvas.querySelectorAll('.x1pos-node').forEach((n) => n.remove());
    canvas.insertAdjacentHTML('beforeend', nodesHtml);
    label.textContent = Math.round(zoom * 100) + '%';
    if (centerOnFocus) {
      const focusEl = canvas.querySelector('.x1pos-node.active') || canvas.querySelector('.x1pos-node.ended');
      if (focusEl) {
        vp.scrollLeft = Math.max(0, focusEl.offsetLeft - vp.clientWidth / 2 + focusEl.offsetWidth / 2);
        vp.scrollTop = Math.max(0, focusEl.offsetTop - vp.clientHeight / 2 + focusEl.offsetHeight / 2);
      }
    }
  }
  function fitToScreen() {
    const availW = vp.clientWidth - 40, availH = vp.clientHeight - 40;
    zoom = Math.max(0.15, Math.min(1, availW / totalW, availH / totalH));
    paint(true);
  }
  $('#x1PosIn').addEventListener('click', () => { zoom += 0.15; paint(false); });
  $('#x1PosOut').addEventListener('click', () => { zoom -= 0.15; paint(false); });
  $('#x1PosFit').addEventListener('click', fitToScreen);
  vp.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // scroll normal rola; ctrl/cmd+scroll dá zoom
    e.preventDefault();
    zoom += e.deltaY < 0 ? 0.1 : -0.1;
    paint(false);
  }, { passive: false });
  // Arrastar pra navegar (clicar e arrastar no fundo, sem soltar em cima de um node).
  let dragging = false, dragX = 0, dragY = 0, dragSL = 0, dragST = 0;
  vp.addEventListener('mousedown', (e) => {
    if (e.target.closest('.x1pos-node')) return;
    dragging = true; dragX = e.clientX; dragY = e.clientY; dragSL = vp.scrollLeft; dragST = vp.scrollTop;
    vp.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    vp.scrollLeft = dragSL - (e.clientX - dragX);
    vp.scrollTop = dragST - (e.clientY - dragY);
  });
  window.addEventListener('mouseup', () => { dragging = false; vp.style.cursor = ''; });

  // Primeiro desenho: encaixa tudo na tela e centraliza onde o lead está/parou.
  fitToScreen();
}

/* ============ GoX1: Fluxos (lista) ============ */
async function loadX1Flows() {
  const box = $('#x1FlowGrid'); box.innerHTML = '<p class="hint">Carregando…</p>';
  try {
    const flows = await api('/api/x1/flows');
    box.innerHTML = flows.length ? flows.map((f) => `<div class="flow-card">
        <div class="fc-name">${esc(f.name)}</div>
        <div class="hint">${(f.steps || []).length} nó(s)</div>
        <div class="acts"><button class="btn" data-x1open="${f.id}">Abrir</button><button class="btn ghost" data-x1dup="${f.id}">Duplicar</button><button class="btn danger" data-x1del="${f.id}">Excluir</button></div>
      </div>`).join('') : '<div class="empty"><div class="big">Nenhum fluxo ainda</div>Crie um fluxo de boas-vindas, resposta padrão, ou por palavra-chave.</div>';
    box.querySelectorAll('[data-x1open]').forEach((b) => b.addEventListener('click', () => openX1Editor(b.dataset.x1open)));
    box.querySelectorAll('[data-x1dup]').forEach((b) => b.addEventListener('click', async () => { try { await api(`/api/x1/flows/${b.dataset.x1dup}/duplicate`, { method: 'POST' }); loadX1Flows(); } catch (e) { toast(e.message, true); } }));
    box.querySelectorAll('[data-x1del]').forEach((b) => b.addEventListener('click', async () => { if (!confirm('Excluir este fluxo?')) return; try { await api(`/api/x1/flows/${b.dataset.x1del}`, { method: 'DELETE' }); loadX1Flows(); } catch (e) { toast(e.message, true); } }));
  } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
}
$('#x1NewFlow').addEventListener('click', async () => {
  try { await api('/api/x1/flows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Novo fluxo' }) }); loadX1Flows(); }
  catch (e) { toast(e.message, true); }
});

// Importa um fluxo exportado (.json) — cria um fluxo novo com o conteúdo do
// arquivo. Útil para receber de volta um fluxo que eu (Claude) analisei/ajustei.
$('#x1ImportFlow').addEventListener('click', () => $('#x1ImportInput').click());
$('#x1ImportInput').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.steps)) throw new Error('Arquivo não parece um fluxo do GoX1 (falta "steps").');
    const name = (data.name ? data.name : file.name.replace(/\.json$/i, '')) + ' (importado)';
    const created = await api('/api/x1/flows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    await api(`/api/x1/flows/${created.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...created, name, steps: data.steps, start_next: data.start_next ?? null, start_x: data.start_x, start_y: data.start_y })
    });
    toast('Fluxo importado.'); loadX1Flows();
  } catch (err) { toast('Não deu para importar: ' + err.message, true); }
  e.target.value = '';
});

/* ============ GoX1: Editor visual de fluxo ============ */
const x1CanvasEl = () => $('#x1Canvas');

async function openX1Editor(id) {
  try {
    state.x1Flow = await api(`/api/x1/flows/${id}`);
    state.x1NodeCounts = await api(`/api/x1/flows/${id}/counts`).catch(() => ({}));
    state.x1TagsCache = await api('/api/x1/tags').catch(() => []);
    state.x1PixelsCache = await api('/api/x1/pixels').catch(() => []);
  } catch (e) { return toast(e.message, true); }
  $('#x1Editor').hidden = false;
  $('#x1FlowName').value = state.x1Flow.name || '';
  x1UpdatePauseBtn();
  state.x1View = { x: 60, y: 80, zoom: 1 };
  x1ApplyTransform();
  x1RenderCanvas();
}
function x1UpdatePauseBtn() {
  const btn = $('#x1TogglePause'); if (!btn || !state.x1Flow) return;
  const paused = state.x1Flow.active === false;
  btn.textContent = paused ? '▶ Ativar fluxo' : '⏸ Pausar fluxo';
  btn.classList.toggle('primary', paused);
}
$('#x1BackToFlows').addEventListener('click', () => { $('#x1Editor').hidden = true; state.x1Flow = null; loadX1Flows(); });
// Exporta o fluxo aberto como .json — dá pra mandar esse arquivo pra mim
// analisar, ou guardar como backup antes de mexer.
$('#x1ExportFlow').addEventListener('click', () => {
  if (!state.x1Flow) return;
  const slug = (state.x1Flow.name || 'fluxo').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'fluxo';
  const blob = new Blob([JSON.stringify(state.x1Flow, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `gox1-${slug}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('Fluxo exportado.');
});
$('#x1TogglePause').addEventListener('click', async () => {
  if (!state.x1Flow) return;
  const newActive = state.x1Flow.active === false; // se estava pausado, ativa
  try {
    await api(`/api/x1/flows/${state.x1Flow.id}/active`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: newActive }) });
    state.x1Flow.active = newActive; x1UpdatePauseBtn();
    toast(newActive ? 'Fluxo ativado.' : 'Fluxo pausado — não dispara para nenhum lead até reativar.');
  } catch (err) { toast(err.message, true); }
});
$('#x1FlowName').addEventListener('input', (e) => { state.x1Flow.name = e.target.value; x1ScheduleSave(); });

let x1SaveTimer = null;
function x1ScheduleSave() { $('#x1SaveDot').className = 'save-dot saving'; clearTimeout(x1SaveTimer); x1SaveTimer = setTimeout(x1DoSave, 650); }
async function x1DoSave() {
  try {
    await api(`/api/x1/flows/${state.x1Flow.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.x1Flow) });
    $('#x1SaveDot').className = 'save-dot';
    const el = $('#x1SavedAt'); if (el) el.textContent = 'salvo automaticamente às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { toast(e.message, true); }
}

function x1ApplyTransform() { const v = state.x1View; $('#x1Content').style.transform = `translate(${v.x}px,${v.y}px) scale(${v.zoom})`; $('#x1ZoomLabel').textContent = Math.round(v.zoom * 100) + '%'; x1UpdateMinimap(); }
function x1SetZoom(z, cx, cy) {
  const v = state.x1View, old = v.zoom; v.zoom = Math.min(1.6, Math.max(0.08, z));
  if (cx != null) { const r = x1CanvasEl().getBoundingClientRect(); v.x -= ((cx - r.left - v.x) / old) * (v.zoom - old); v.y -= ((cy - r.top - v.y) / old) * (v.zoom - old); }
  x1ApplyTransform();
}
// Ajusta o zoom/posição para que TODOS os nodes caibam na tela.
function x1FitToScreen() {
  const nodes = [...document.querySelectorAll('#x1Content .node')];
  const rect = x1CanvasEl().getBoundingClientRect();
  if (!nodes.length) { state.x1View = { x: 60, y: 80, zoom: 1 }; x1ApplyTransform(); return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach((el) => { const x = el.offsetLeft, y = el.offsetTop, w = el.offsetWidth, h = el.offsetHeight; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h); });
  const pad = 70, bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
  const zoom = Math.max(0.08, Math.min(1.6, Math.min((rect.width - pad * 2) / bw, (rect.height - pad * 2) / bh)));
  state.x1View.zoom = zoom;
  state.x1View.x = (rect.width - bw * zoom) / 2 - minX * zoom;
  state.x1View.y = (rect.height - bh * zoom) / 2 - minY * zoom;
  x1ApplyTransform();
}
function x1ScreenToContent(cx, cy) { const r = x1CanvasEl().getBoundingClientRect(), v = state.x1View; return { x: (cx - r.left - v.x) / v.zoom, y: (cy - r.top - v.y) / v.zoom }; }

// Minimapa: desenha todos os nodes em miniatura + o retângulo da área visível.
let _x1mmRaf = null;
function x1UpdateMinimap() {
  if (_x1mmRaf) return;
  _x1mmRaf = requestAnimationFrame(() => {
    _x1mmRaf = null;
    const svg = document.getElementById('x1MinimapSvg');
    if (!svg || !state.x1Flow) return;
    const nodes = [...document.querySelectorAll('#x1Content .node')];
    if (!nodes.length) { svg.innerHTML = ''; return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const boxes = nodes.map((el) => {
      const x = el.offsetLeft, y = el.offsetTop, w = el.offsetWidth, h = el.offsetHeight;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
      return { x, y, w, h, start: el.dataset.id === 'start' };
    });
    const pad = 40; minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const scale = Math.min(200 / bw, 130 / bh);
    const ox = (200 - bw * scale) / 2, oy = (130 - bh * scale) / 2;
    const mx = (x) => ox + (x - minX) * scale, my = (y) => oy + (y - minY) * scale;
    let html = boxes.map((b) => `<rect class="x1-mm-node ${b.start ? 'start' : ''}" x="${mx(b.x).toFixed(1)}" y="${my(b.y).toFixed(1)}" width="${Math.max(2, b.w * scale).toFixed(1)}" height="${Math.max(2, b.h * scale).toFixed(1)}" rx="1.5"/>`).join('');
    // Retângulo da área visível (viewport) em coordenadas de conteúdo.
    const r = x1CanvasEl().getBoundingClientRect();
    const tl = x1ScreenToContent(r.left, r.top), br = x1ScreenToContent(r.right, r.bottom);
    html += `<rect class="x1-mm-view" x="${mx(tl.x).toFixed(1)}" y="${my(tl.y).toFixed(1)}" width="${Math.max(2, (br.x - tl.x) * scale).toFixed(1)}" height="${Math.max(2, (br.y - tl.y) * scale).toFixed(1)}" rx="2"/>`;
    svg.innerHTML = html;
  });
}

// Remapeia o campo "next" de um node duplicado: mantém a ligação só se o
// destino também estiver sendo duplicado (mapeado em idMap); senão, corta —
// não queremos que a cópia fique ligada a um node que não foi duplicado.
function x1RemapNextValue(next, idMap) {
  if (next == null) return null;
  if (typeof next === 'string') return idMap[next] || null;
  if (Array.isArray(next)) { const out = next.map((n) => idMap[n]).filter(Boolean); return out.length ? out : null; }
  if (typeof next === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(next)) {
      out[k] = Array.isArray(v) ? (v.map((n) => idMap[n]).filter(Boolean).length ? v.map((n) => idMap[n]).filter(Boolean) : null) : (v ? (idMap[v] || null) : null);
    }
    return out;
  }
  return null;
}
// Duplica vários nós de uma vez mantendo as ligações QUE EXISTIAM ENTRE ELES
// (ex.: shift+clique em 3 nós conectados em sequência → as cópias saem
// conectadas na mesma sequência, não soltas).
function x1DuplicateManyKeepLinks(ids) {
  const idMap = {};
  const pairs = [];
  for (const id of ids) {
    const src = state.x1Flow.steps.find((s) => s.id === id); if (!src) continue;
    const copy = structuredClone(src);
    copy.id = uid(); copy.x = (src.x ?? 380) + 60; copy.y = (src.y ?? 160) + 60;
    if (Array.isArray(copy.blocks)) copy.blocks.forEach((b) => { b.id = uid(); });
    idMap[id] = copy.id;
    pairs.push({ src, copy });
  }
  pairs.forEach(({ src, copy }) => { copy.next = x1RemapNextValue(src.next, idMap); });
  pairs.forEach(({ copy }) => state.x1Flow.steps.push(copy));
  x1RenderCanvas(); x1ScheduleSave();
  toast(`${pairs.length} nós duplicados${pairs.length > 1 ? ', ligações entre eles mantidas.' : '.'}`);
  return pairs.map((p) => p.copy.id);
}

// Adapter de seleção múltipla para o editor do GoX1 — ver createMultiSelect.
const x1MultiSel = createMultiSelect({
  canvasEl: x1CanvasEl,
  screenToContent: x1ScreenToContent,
  allNodeIds: () => ['start', ...state.x1Flow.steps.map((s) => s.id)],
  nodeEl: (id) => $('#x1Content').querySelector(`.node[data-id="${id}"]`),
  nodeRect: x1NodeRect,
  getPos: (id) => id === 'start' ? { x: state.x1Flow.start_x ?? 80, y: state.x1Flow.start_y ?? 200 } : (() => { const s = state.x1Flow.steps.find((x) => x.id === id); return { x: s?.x ?? 380, y: s?.y ?? 160 }; })(),
  setPos: (id, x, y) => { if (id === 'start') { state.x1Flow.start_x = x; state.x1Flow.start_y = y; } else { const s = state.x1Flow.steps.find((x2) => x2.id === id); if (s) { s.x = x; s.y = y; } } const el = $('#x1Content').querySelector(`.node[data-id="${id}"]`); if (el) { el.style.left = x + 'px'; el.style.top = y + 'px'; } },
  renderEdges: x1RenderEdges,
  scheduleSave: x1ScheduleSave,
  duplicateMany: (ids) => x1DuplicateManyKeepLinks(ids.filter((id) => id !== 'start')),
  deleteMany: (ids) => { ids.filter((id) => id !== 'start').forEach((id) => x1DeleteNode(id)); }
});

$('#x1ZoomIn').addEventListener('click', () => x1SetZoom(state.x1View.zoom + 0.1));
$('#x1ZoomOut').addEventListener('click', () => x1SetZoom(state.x1View.zoom - 0.1));
$('#x1ZoomReset').addEventListener('click', () => x1FitToScreen());
x1CanvasEl().addEventListener('wheel', (e) => { e.preventDefault(); x1SetZoom(state.x1View.zoom * (e.deltaY < 0 ? 1.08 : 0.92), e.clientX, e.clientY); }, { passive: false });
(function () {
  let panning = false, lastX, lastY;
  x1CanvasEl().addEventListener('mousedown', (e) => {
    if (e.target.closest('.node')) return;
    if (e.shiftKey) { x1MultiSel.onCanvasMouseDown(e); return; }
    if (x1MultiSel.isMulti()) x1MultiSel.clear();
    panning = true; lastX = e.clientX; lastY = e.clientY;
  });
  document.addEventListener('mousemove', (e) => { if (!panning) return; state.x1View.x += e.clientX - lastX; state.x1View.y += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; x1ApplyTransform(); });
  document.addEventListener('mouseup', () => { panning = false; });
})();

function x1GetNexts(srcId, outcome) {
  const raw = srcId === 'start' ? state.x1Flow.start_next : state.x1Flow.steps.find((s) => s.id === srcId)?.next;
  if (!raw) return [];
  if (typeof raw === 'object' && !Array.isArray(raw)) { const v = outcome ? raw[outcome] : null; return v ? (Array.isArray(v) ? v.filter(Boolean) : [v]) : []; }
  return Array.isArray(raw) ? raw.filter(Boolean) : [raw];
}
function x1AllOutcomes(srcId) {
  const s = srcId === 'start' ? null : state.x1Flow.steps.find((x) => x.id === srcId);
  if (s && s.type === 'wait_reply') return ['replied', 'timeout'];
  if (s && s.type === 'condition') return ['then', 'else'];
  if (s && s.type === 'ai') return s.identify_receipt ? ['ok', 'receipt', 'fail'] : ['ok', 'fail'];
  if (s && s.type === 'pixel') return ['ok', 'fail'];
  return [null];
}
function x1SetNexts(srcId, outcome, arr) {
  const clean = [...new Set(arr.filter(Boolean))];
  const val = clean.length === 0 ? null : (clean.length === 1 ? clean[0] : clean);
  if (srcId === 'start') { state.x1Flow.start_next = val; return; }
  const s = state.x1Flow.steps.find((x) => x.id === srcId); if (!s) return;
  if (outcome) { s.next = (s.next && typeof s.next === 'object' && !Array.isArray(s.next)) ? s.next : {}; s.next[outcome] = val; }
  else s.next = val;
}
function x1AddLink(srcId, outcome, tgtId) {
  if (!srcId || !tgtId || srcId === tgtId) return;
  const cur = x1GetNexts(srcId, outcome);
  if (cur.includes(tgtId)) return;
  x1SetNexts(srcId, outcome, [...cur, tgtId]);
  x1RenderEdges(); x1ScheduleEdges(); x1ScheduleSave();
}
function x1RemoveLink(srcId, outcome, tgtId) {
  x1SetNexts(srcId, outcome, x1GetNexts(srcId, outcome).filter((id) => id !== tgtId));
  x1RenderEdges(); x1ScheduleSave();
}

let x1EdgesRAF = null;
function x1ScheduleEdges() { if (x1EdgesRAF != null) cancelAnimationFrame(x1EdgesRAF); x1EdgesRAF = requestAnimationFrame(() => { x1EdgesRAF = null; x1RenderEdges(); }); }

function x1NodeRect(id) {
  const el = $('#x1Content').querySelector(`.node[data-id="${id}"]`); if (!el) return null;
  return { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: el.offsetWidth, h: el.offsetHeight };
}
// Y da bolinha de saída de um outcome: nodes com 2+ saídas têm as bolinhas
// empilhadas (topo/baixo); a linha sai da bolinha certa, não do centro.
function x1PortAnchorY(srcId, ra, outcome) {
  const step = srcId === 'start' ? null : (state.x1Flow.steps || []).find((s) => s.id === srcId);
  const ports = x1OutPorts(step);
  if (ports.length <= 1) return ra.y + ra.h / 2;
  const idx = Math.max(0, ports.findIndex((p) => p.outcome === outcome));
  const spacing = 31;
  return ra.y + ra.h / 2 + (idx - (ports.length - 1) / 2) * spacing;
}
function x1RenderEdges() {
  const svg = $('#x1Edges'); svg.innerHTML = '';
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = '<linearGradient id="x1eg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2fe0c6"/><stop offset="1" stop-color="#8b6cff"/></linearGradient>';
  svg.appendChild(defs);
  const links = [];
  for (const outcome of x1AllOutcomes('start')) x1GetNexts('start', outcome).forEach((tgt) => links.push(['start', outcome, tgt]));
  (state.x1Flow.steps || []).forEach((s) => { for (const outcome of x1AllOutcomes(s.id)) x1GetNexts(s.id, outcome).forEach((tgt) => links.push([s.id, outcome, tgt])); });
  for (const [src, outcome, tgt] of links) {
    const ra = x1NodeRect(src), rb = x1NodeRect(tgt); if (!ra || !rb) continue;
    const a = { x: ra.x + ra.w, y: x1PortAnchorY(src, ra, outcome) }, b = { x: rb.x, y: rb.y + rb.h / 2 }, d = edgePath(a, b);
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.setAttribute('d', d); hit.setAttribute('class', 'hit');
    hit.addEventListener('click', () => { if (confirm('Remover esta conexão?')) x1RemoveLink(src, outcome, tgt); });
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d); p.setAttribute('class', 'edge'); p.setAttribute('stroke', 'url(#x1eg)');
    svg.appendChild(hit); svg.appendChild(p);
  }
}
// Helpers que faltavam no gox1 (herdados do gogrupo). Sem edgePath, as arestas
// não desenhavam — a conexão salvava mas ficava invisível, parecendo que "não
// ligou". Sem closeNodeContextMenu, o menu de duplicar/excluir quebrava.
function edgePath(a, b) { const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45); return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`; }
function closeNodeContextMenu() { document.querySelectorAll('.node-ctx-menu').forEach((m) => { m._cleanup?.(); m.remove(); }); }
function autoGrowTextarea(el) {
  const cs = getComputedStyle(el);
  const minH = parseFloat(el.style.minHeight || cs.minHeight) || 80;
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, minH) + 'px';
}

function x1BeginConnect(srcId, outcome) {
  const svg = $('#x1Edges'), temp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  temp.setAttribute('class', 'temp'); svg.appendChild(temp);
  const ra = x1NodeRect(srcId), a = { x: ra.x + ra.w, y: ra.y + ra.h / 2 };
  const mv = (ev) => temp.setAttribute('d', edgePath(a, x1ScreenToContent(ev.clientX, ev.clientY)));
  const up = (ev) => {
    document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); temp.remove();
    const stack = document.elementsFromPoint(ev.clientX, ev.clientY);
    const targetNode = stack.map((el) => el.closest('.node')).find(Boolean);
    if (targetNode && targetNode.dataset.id !== srcId && targetNode.dataset.id !== 'start') x1AddLink(srcId, outcome, targetNode.dataset.id);
    else if (ev.target.closest('#x1Canvas')) showX1QuickAddMenu(ev.clientX, ev.clientY, (type) => {
      const node = x1AddNode(type, x1ScreenToContent(ev.clientX, ev.clientY));
      x1AddLink(srcId, outcome, node.id);
    });
  };
  document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
}
// Menu rápido de "criar nó aqui" do X1 — mesmo padrão visual do Gogrupo
// (showQuickAddMenu), com os 6 tipos de node do X1.
function showX1QuickAddMenu(x, y, onPick) {
  document.querySelectorAll('.node-menu').forEach((m) => m.remove());
  const menu = document.createElement('div'); menu.className = 'node-menu';
  menu.innerHTML = `<button data-t="message">${ICON.message} Mensagem</button><button data-t="timer">${ICON.timer} Timer</button>
    <button data-t="wait_reply">${ICON.wait_reply} Aguarda resposta</button><button data-t="condition">${ICON.condition} Condicional</button>
    <button data-t="tag">${ICON.tag} Etiqueta</button><button data-t="ai">${ICON.ai} Bloco de IA</button>
    <button data-t="notify">${ICON.notify} Notificação</button><button data-t="webhook">${ICON.webhook} Webhook</button>
    <button data-t="distributor">${ICON.distributor} Distribuidor</button>
    <button data-t="pixel">${ICON.pixel} Pixel</button>`;
  document.body.appendChild(menu);
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth) menu.style.left = (x - r.width) + 'px';
    if (r.bottom > window.innerHeight) menu.style.top = (y - r.height) + 'px';
  });
  menu.querySelectorAll('button').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); menu.remove(); onPick(b.dataset.t); }));
  setTimeout(() => document.addEventListener('mousedown', function c(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', c); } }), 10);
}

// Resumos que faltavam (a ausência delas fazia a renderização do canvas
// estourar em qualquer node de mensagem/timer, deixando as portas sem handler
// de conexão — o que impedia ligar os nodes).
function nodeSummaryTimer(s) {
  if (s.mode === 'window') {
    const from = s.window_from || '07:00', to = s.window_to || '09:00';
    return `${s.next_day ? 'amanhã ' : ''}entre ${from} e ${to}`;
  }
  const unit = { min: 'min', hora: 'h', dia: 'd' }[s.unit] || 'min';
  const v = s.value ?? 0;
  const hasTo = s.value_to != null && s.value_to !== '' && Number(s.value_to) !== Number(v);
  return `espera ${v}${hasTo ? '–' + s.value_to : ''} ${unit}`;
}
function nodeSummaryMsg(s) {
  const blocks = s.blocks || [];
  if (!blocks.length) return 'mensagem vazia';
  const firstText = blocks.find((b) => b.kind === 'text' && (b.variants || []).some((v) => v));
  if (firstText) { const t = (firstText.variants.find((v) => v) || '').replace(/\s+/g, ' ').trim(); return t.length > 42 ? t.slice(0, 42) + '…' : t; }
  const kinds = blocks.map((b) => ({ text: 'texto', image: 'foto', video: 'vídeo', audio: 'áudio', delay: 'delay' }[b.kind] || b.kind));
  return `${blocks.length} bloco(s): ${[...new Set(kinds)].join(', ')}`;
}

function x1NodeSummary(s) {
  if (s.type === 'timer') return nodeSummaryTimer(s);
  if (s.type === 'message') return nodeSummaryMsg(s);
  if (s.type === 'wait_reply') {
    if (s.wait_forever) return 'aguarda indefinidamente';
    const u = { min: 'min', hora: 'h', dia: 'd' }[s.timeout_unit] || 'min';
    return `aguarda até ${s.timeout_value ?? s.timeout_minutes ?? 30}${u}`;
  }
  if (s.type === 'condition') {
    if (Array.isArray(s.conditions) && s.conditions.length) {
      const first = s.conditions[0];
      const label = first.field === '__tag' ? `etiqueta ${first.value || '?'}` : `${first.field || '?'} ${first.op || ''}`.trim();
      return s.conditions.length > 1 ? `${label} ${s.logic === 'any' ? 'ou' : 'e'} +${s.conditions.length - 1}` : label;
    }
    return s.check === 'has_tag' ? `tem etiqueta #${s.tag || '?'}` : s.check === 'not_has_tag' ? `não tem etiqueta #${s.tag || '?'}` : 'condição';
  }
  if (s.type === 'tag') return `${s.action === 'remove' ? 'remove' : 'adiciona'} etiqueta #${s.tag || '?'}`;
  if (s.type === 'notify') return s.number ? `avisa ${s.number}` : 'notificação (sem número)';
  if (s.type === 'ai') return s.identify_receipt ? `IA · lê comprovante (${s.model || 'gpt-4.1'})` : `IA · ${s.model || 'gpt-4.1'}`;
  if (s.type === 'webhook') return s.url ? `POST → ${String(s.url).replace(/^https?:\/\//, '').slice(0, 28)}…` : 'webhook (sem URL)';
  if (s.type === 'distributor') { const n = (state.x1NodeCounts || {})[s.id] || 0; return `revezamento entre os caminhos${n ? ` · ${n} contatos passaram` : ''}`; }
  if (s.type === 'pixel') { const px = (state.x1PixelsCache || []).find((p) => String(p.id) === String(s.pixel_id)); return `dispara ${s.event_name || 'Purchase'}${px ? ` no pixel ${px.name}` : ' (sem pixel)'}`; }
  return '';
}
function x1OutPorts(s) {
  if (s && s.type === 'wait_reply') return [{ outcome: 'replied', label: 'respondeu' }, { outcome: 'timeout', label: 'não respondeu' }];
  if (s && s.type === 'condition') return [{ outcome: 'then', label: 'sim' }, { outcome: 'else', label: 'não' }];
  if (s && s.type === 'ai') return s.identify_receipt
    ? [{ outcome: 'ok', label: 'leu/respondeu' }, { outcome: 'receipt', label: 'identificou comprovante' }, { outcome: 'fail', label: 'erro' }]
    : [{ outcome: 'ok', label: 'ok' }, { outcome: 'fail', label: 'erro' }];
  if (s && s.type === 'pixel') return [{ outcome: 'ok', label: 'enviou' }, { outcome: 'fail', label: 'falhou' }];
  return [{ outcome: null, label: null }];
}

function x1RenderCanvas() {
  const content = $('#x1Content'); content.querySelectorAll('.node').forEach((n) => n.remove());
  const f = state.x1Flow;
  content.appendChild(x1MakeNodeEl('start', f.start_x ?? 80, f.start_y ?? 200, { kind: 'GATILHO', title: 'Início', ico: ICON.message, body: 'dispara quando uma mensagem chega' }, { type: 'start' }));
  (f.steps || []).forEach((s) => {
    try {
      let cfg;
      if (s.type === 'timer') cfg = { kind: 'ESPERA', title: 'Timer', ico: ICON.timer, body: esc(x1NodeSummary(s)) };
      else if (s.type === 'wait_reply') cfg = { kind: 'AGUARDA', title: 'Aguarda resposta', ico: ICON.wait_reply, body: esc(x1NodeSummary(s)) };
      else if (s.type === 'condition') cfg = { kind: 'CONDIÇÃO', title: 'Condicional', ico: ICON.condition, body: esc(x1NodeSummary(s)) };
      else if (s.type === 'tag') cfg = { kind: 'ETIQUETA', title: 'Etiqueta', ico: ICON.tag, body: esc(x1NodeSummary(s)) };
      else if (s.type === 'notify') cfg = { kind: 'NOTIFICAÇÃO', title: 'Notificação', ico: ICON.notify, body: esc(x1NodeSummary(s)) };
      else if (s.type === 'ai') cfg = { kind: 'IA', title: 'Bloco de IA', ico: ICON.ai, body: esc(x1NodeSummary(s)) };
      else if (s.type === 'webhook') cfg = { kind: 'WEBHOOK', title: 'Webhook', ico: ICON.webhook, body: esc(x1NodeSummary(s)) };
      else if (s.type === 'distributor') cfg = { kind: 'DISTRIBUIDOR', title: 'Distribuidor', ico: ICON.distributor, body: esc(x1NodeSummary(s)) };
      else if (s.type === 'pixel') cfg = { kind: 'PIXEL', title: 'Pixel', ico: ICON.pixel, body: esc(x1NodeSummary(s)) };
      else cfg = { kind: 'MENSAGEM' + (s.device ? ' · ' + esc(s.device) : ''), title: 'Mensagem', ico: ICON.message, body: esc(x1NodeSummary(s)) };
      content.appendChild(x1MakeNodeEl(s.id, s.x ?? 380, s.y ?? 160, cfg, s));
    } catch (err) {
      // Node problemático não pode derrubar o resto do canvas.
      const cfg = { kind: (s.type || 'NODE').toUpperCase(), title: 'Node', ico: ICON.message, body: '(erro ao renderizar)' };
      content.appendChild(x1MakeNodeEl(s.id, s.x ?? 380, s.y ?? 160, cfg, s));
    }
  });
  x1RenderEdges();
  x1ScheduleEdges();
  x1UpdateMinimap();
}

function x1MakeNodeEl(id, x, y, cfg, step) {
  const el = document.createElement('div');
  el.className = 'node ' + (step.type || 'message') + (state.x1Sel === id ? ' sel' : '') + (x1MultiSel.has(id) ? ' multi-sel' : '');
  el.dataset.id = id; el.style.left = x + 'px'; el.style.top = y + 'px';
  const NODE_COLORS = { start: '#8b5cf6', trigger: '#8b5cf6', message: '#22c55e', wait_reply: '#f97316', condition: '#3b82f6', tag: '#ec4899', ai: '#06b6d4', notify: '#eab308', webhook: '#94a3b8', distributor: '#6366f1', pixel: '#1877f2' };
  el.style.setProperty('--nacc', id === 'start' ? NODE_COLORS.start : (NODE_COLORS[step.type] || '#8b5cf6'));
  const ports = x1OutPorts(step);
  const portsHtml = ports.length > 1
    ? `<div class="x1-multi-ports">${ports.map((p) => { const cls = p.outcome === 'fail' ? 'port-fail' : p.outcome === 'receipt' ? 'port-warn' : 'port-ok'; return `<div class="x1-port-row"><div class="port out ${cls}" data-portout data-outcome="${p.outcome}" title="${p.label}"></div></div>`; }).join('')}</div>`
    : `<div class="port out" data-portout></div>`;
  el.innerHTML = `<div class="nhead"><div class="nico">${cfg.ico}</div><div><div class="nkind">${cfg.kind}</div><div class="ntitle">${cfg.title}</div></div></div>
    <div class="nbody">${cfg.body}</div>${id !== 'start' ? '<div class="port in" data-portin></div>' : ''}${portsHtml}`;
  const head = el.querySelector('.nhead'); let moved = false;
  head.addEventListener('mousedown', (e) => {
    if (x1MultiSel.onNodeMouseDown(id, e)) return; // shift-click ou drag em grupo
    e.stopPropagation(); moved = false;
    const startX = e.clientX, startY = e.clientY, ox = parseFloat(el.style.left), oy = parseFloat(el.style.top);
    const mv = (ev) => {
      const dx = (ev.clientX - startX) / state.x1View.zoom, dy = (ev.clientY - startY) / state.x1View.zoom;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      const nx = ox + dx, ny = oy + dy;
      el.style.left = nx + 'px'; el.style.top = ny + 'px'; x1RenderEdges();
      if (id === 'start') { state.x1Flow.start_x = nx; state.x1Flow.start_y = ny; }
      else { const s = state.x1Flow.steps.find((x) => x.id === id); if (s) { s.x = nx; s.y = ny; } }
    };
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); if (moved) x1ScheduleSave(); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  });
  head.addEventListener('click', (e) => { e.stopPropagation(); if (!moved && !x1MultiSel.isMulti()) x1SelectNode(id); });
  if (id !== 'start') el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); if (x1MultiSel.onNodeContextMenu(id, e)) return; x1ShowNodeContextMenu(id, e.clientX, e.clientY); });
  el.querySelectorAll('[data-portout]').forEach((p) => p.addEventListener('mousedown', (e) => { e.stopPropagation(); x1BeginConnect(id, p.dataset.outcome || null); }));
  return el;
}

function x1ShowNodeContextMenu(id, x, y) {
  closeNodeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'node-ctx-menu'; menu.style.left = x + 'px'; menu.style.top = y + 'px';
  menu.innerHTML = `<button data-act="dup">⎘ Duplicar</button><button data-act="del" class="danger">🗑 Excluir</button>`;
  document.body.appendChild(menu);
  menu.querySelector('[data-act="dup"]').addEventListener('click', () => { closeNodeContextMenu(); x1DuplicateNode(id); });
  menu.querySelector('[data-act="del"]').addEventListener('click', () => { closeNodeContextMenu(); if (confirm('Excluir este nó?')) x1DeleteNode(id); });
  const onDocClick = (ev) => { if (!menu.contains(ev.target)) closeNodeContextMenu(); };
  setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
  menu._cleanup = () => document.removeEventListener('mousedown', onDocClick);
}
function x1DuplicateNode(id) {
  const src = state.x1Flow.steps.find((s) => s.id === id); if (!src) return;
  const copy = structuredClone(src); copy.id = uid(); copy.x = (src.x ?? 380) + 40; copy.y = (src.y ?? 160) + 40; copy.next = null;
  if (Array.isArray(copy.blocks)) copy.blocks.forEach((b) => { b.id = uid(); });
  state.x1Flow.steps.push(copy); x1RenderCanvas(); x1ScheduleSave(); x1SelectNode(copy.id);
  toast('Nó duplicado.');
}
function x1DeleteNode(id) {
  x1SetNexts('start', null, x1GetNexts('start', null).filter((n) => n !== id));
  state.x1Flow.steps.forEach((s) => {
    for (const outcome of x1AllOutcomes(s.id)) x1SetNexts(s.id, outcome, x1GetNexts(s.id, outcome).filter((n) => n !== id));
  });
  state.x1Flow.steps = state.x1Flow.steps.filter((s) => s.id !== id);
  state.x1Sel = null; x1RenderCanvas(); x1ScheduleSave();
}

$('#x1AddNodeFab').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showX1QuickAddMenu(r.left - 200, r.top - 220, (type) => x1AddNode(type));
});
function x1AddNode(type, atPos) {
  const center = atPos || (() => { const r = x1CanvasEl().getBoundingClientRect(); return x1ScreenToContent(r.left + r.width / 2, r.top + r.height / 2); })();
  const base = { id: uid(), x: center.x - 116, y: center.y - 60, next: null };
  let node;
  if (type === 'timer') node = { ...base, type: 'timer', mode: 'relative', value: 15, value_to: '', unit: 'min' };
  else if (type === 'wait_reply') node = { ...base, type: 'wait_reply', timeout_value: 30, timeout_unit: 'min', wait_forever: false, buffer_enabled: false, buffer_seconds: 8, quote_reply: false, react_on_reply: false, require_media: false, save_field: 'resposta', next: { replied: null, timeout: null } };
  else if (type === 'condition') node = { ...base, type: 'condition', logic: 'all', conditions: [{ field: '', op: 'exists', value: '' }], next: { then: null, else: null } };
  else if (type === 'tag') node = { ...base, type: 'tag', action: 'add', tag: '' };
  else if (type === 'notify') node = { ...base, type: 'notify', number: '', text: '' };
  else if (type === 'ai') node = { ...base, type: 'ai', model: 'gpt-4.1', prompt: '', input_text: '', identify_receipt: true, understand_image: true, understand_pdf: true, receipt_prefix: 'comprovante', save_field: 'ai.response', next: { ok: null, fail: null } };
  else if (type === 'webhook') node = { ...base, type: 'webhook', url: '', method: 'POST', payload: [], headers: [], save_response: false, save_prefix: 'webhook' };
  else if (type === 'distributor') node = { ...base, type: 'distributor', next: [] };
  else if (type === 'pixel') node = { ...base, type: 'pixel', pixel_id: '', event_name: 'Purchase', page_id: '', value: '{comprovante.valor}', currency: 'BRL', next: { ok: null, fail: null } };
  else node = { ...base, type: 'message', device: '', blocks: [{ id: uid(), kind: 'text', variants: [''] }] };
  state.x1Flow.steps.push(node); x1RenderCanvas(); x1ScheduleSave(); x1SelectNode(node.id);
  return node;
}

function x1SelectNode(id) {
  state.x1Sel = id; x1RenderCanvas();
  if (id === 'start') return;
  const s = state.x1Flow.steps.find((x) => x.id === id); if (!s) return;
  state.x1DrawerStep = s;
  let body, title;
  if (s.type === 'timer') { title = 'Timer'; body = timerForm(s); }
  else if (s.type === 'wait_reply') { title = 'Aguarda resposta'; body = x1WaitReplyForm(s); }
  else if (s.type === 'condition') { title = 'Condicional'; body = x1ConditionForm(s); }
  else if (s.type === 'tag') { title = 'Etiqueta'; body = x1TagForm(s); }
  else if (s.type === 'notify') { title = 'Notificação'; body = x1NotifyForm(s); }
  else if (s.type === 'ai') { title = 'Bloco de IA'; body = x1AiForm(s); }
  else if (s.type === 'webhook') { title = 'Webhook'; body = x1WebhookForm(s); }
  else if (s.type === 'distributor') { title = 'Distribuidor'; body = '<p class="hint">Este nó reveza os contatos entre os caminhos conectados: o 1º contato segue pelo 1º caminho, o 2º pelo 2º caminho, e assim por diante, voltando ao início quando chega no último. Cada contato passa por SÓ UM caminho (não por todos).</p>'; }
  else if (s.type === 'pixel') { title = 'Pixel'; body = x1PixelForm(s); }
  else { title = 'Mensagem'; body = x1MsgForm(s); }
  openDrawer(title, body, '');
  if (s.type === 'timer') bindTimer(s);
  else if (s.type === 'wait_reply') x1BindWaitReply(s);
  else if (s.type === 'condition') x1BindCondition(s);
  else if (s.type === 'tag') x1BindTag(s);
  else if (s.type === 'notify') x1BindNotify(s);
  else if (s.type === 'ai') x1BindAi(s);
  else if (s.type === 'webhook') x1BindWebhook(s);
  else if (s.type === 'pixel') x1BindPixel(s);
  else if (s.type === 'message') x1BindMsg(s);
}

function x1PixelForm(s) {
  const pixels = state.x1PixelsCache || [];
  const opts = pixels.length
    ? pixels.map((p) => `<option value="${p.id}" ${String(s.pixel_id) === String(p.id) ? 'selected' : ''}>${esc(p.name)} · ID ${esc(p.pixel_id)}</option>`).join('')
    : '';
  return `<div class="field"><label class="lbl">Pixel configurado</label>
      <select id="x1PxSel">${pixels.length ? `<option value="">(escolha)</option>${opts}` : '<option value="">nenhum pixel cadastrado</option>'}</select>
      <div class="hint" style="margin-top:6px">${pixels.length ? 'Cadastre mais em Configurações → Facebook — Pixels.' : 'Cadastre um pixel em Configurações → Facebook — Pixels.'}</div></div>
    <div class="field"><label class="lbl">Tipo do evento</label>
      <select id="x1PxEvent"><option value="Purchase" ${s.event_name === 'Purchase' ? 'selected' : ''}>Compra (Purchase)</option>
      <option value="Lead" ${s.event_name === 'Lead' ? 'selected' : ''}>Lead</option>
      <option value="InitiateCheckout" ${s.event_name === 'InitiateCheckout' ? 'selected' : ''}>Iniciou checkout</option></select></div>
    <div class="field"><label class="lbl">Page ID <span class="hint">(obrigatório para WhatsApp)</span></label>
      <input id="x1PxPage" value="${esc(s.page_id || '')}" placeholder="ID da página do Facebook vinculada ao WhatsApp"/></div>
    <div class="field"><label class="lbl">Valor do item</label>
      <input id="x1PxValue" value="${esc(s.value || '')}" placeholder="ex: {comprovante.valor}"/>
      <div class="hint" style="margin-top:6px">Aceita {campo}, ex.: {comprovante.valor} ou {valor.pix}.</div></div>
    <div class="field"><label class="lbl">Moeda</label>
      <select id="x1PxCur"><option value="BRL" ${(s.currency || 'BRL') === 'BRL' ? 'selected' : ''}>BRL — Real</option><option value="USD" ${s.currency === 'USD' ? 'selected' : ''}>USD — Dólar</option></select></div>
    <p class="hint">Dispara o evento na Conversions API do Facebook ao chegar aqui. Saídas: <strong style="color:#22c55e">verde</strong> = enviou · <strong style="color:#ef4444">vermelha</strong> = falhou.</p>`;
}
function x1BindPixel(s) {
  $('#x1PxSel').addEventListener('change', (e) => { s.pixel_id = e.target.value; x1RenderCanvas(); x1ScheduleSave(); });
  $('#x1PxEvent').addEventListener('change', (e) => { s.event_name = e.target.value; x1RenderCanvas(); x1ScheduleSave(); });
  $('#x1PxPage').addEventListener('input', (e) => { s.page_id = e.target.value.trim(); x1ScheduleSave(); });
  $('#x1PxValue').addEventListener('input', (e) => { s.value = e.target.value; x1ScheduleSave(); });
  $('#x1PxCur').addEventListener('change', (e) => { s.currency = e.target.value; x1ScheduleSave(); });
}

// Helpers de form que faltavam no gox1 (herdados do gogrupo). Sem eles, abrir
// um node de Timer ou de Mensagem estourava erro. O gox1 usa só timer relativo.
function deviceOptions(sel) { return state.devices.map((d) => `<option value="${esc(d.name)}" ${sel === d.name ? 'selected' : ''}>${esc(d.name)}${(d.state === 'open' || d.state === 'connected') ? ' (conectado)' : ''}</option>`).join(''); }
function timerForm(s) {
  const isWindow = s.mode === 'window';
  return `<div class="field"><label class="lbl">Tipo de espera</label>
      <div class="seg" id="x1tMode"><button data-m="relative" class="${!isWindow ? 'active' : ''}">Tempo corrido</button><button data-m="window" class="${isWindow ? 'active' : ''}">Janela de horário</button></div></div>
    <div id="x1tRel" ${isWindow ? 'hidden' : ''}>
      <div class="field"><label class="lbl">Esperar entre</label>
        <div style="display:flex;gap:8px;align-items:center"><input type="number" id="tVal" min="0" value="${s.value ?? 15}" style="flex:1"/>
        <span class="hint">e</span><input type="number" id="tValTo" min="0" placeholder="(opcional)" value="${s.value_to ?? ''}" style="flex:1"/>
        <select id="tUnit" style="width:120px"><option value="min" ${s.unit === 'min' ? 'selected' : ''}>minutos</option><option value="hora" ${s.unit === 'hora' ? 'selected' : ''}>horas</option><option value="dia" ${s.unit === 'dia' ? 'selected' : ''}>dias</option></select></div>
        <div class="hint" style="margin-top:6px">Sorteia um tempo entre os dois valores. Deixe o 2º campo vazio para tempo fixo.</div></div></div>
    <div id="x1tWin" ${!isWindow ? 'hidden' : ''}>
      <div class="field"><label class="lbl">Segurar até um horário entre (fuso de Brasília)</label>
        <div style="display:flex;gap:8px;align-items:center"><input type="time" id="tWinFrom" value="${esc(s.window_from || '07:00')}" style="flex:1"/><span class="hint">e</span><input type="time" id="tWinTo" value="${esc(s.window_to || '09:00')}" style="flex:1"/></div>
        <div class="hint" style="margin-top:6px">Sorteia um horário dentro da janela (ex.: 7h–9h) — assim os leads não disparam todos no mesmo minuto.</div></div>
      <div class="field"><label class="toggle-row"><input type="checkbox" id="tWinNextDay" ${s.next_day ? 'checked' : ''}/><span><span class="tl">Sempre no dia seguinte</span><br><span class="ts">Mesmo que a janela de hoje ainda não tenha passado</span></span></label></div></div>`;
}
function bindTimer(s) {
  $('#x1tMode')?.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    s.mode = b.dataset.m; $('#x1tMode').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    $('#x1tRel').hidden = s.mode === 'window'; $('#x1tWin').hidden = s.mode !== 'window'; x1RenderCanvas(); x1ScheduleSave();
  }));
  $('#tVal')?.addEventListener('input', (e) => { s.value = +e.target.value; x1RenderCanvas(); x1ScheduleSave(); });
  $('#tValTo')?.addEventListener('input', (e) => { s.value_to = e.target.value; x1RenderCanvas(); x1ScheduleSave(); });
  $('#tUnit')?.addEventListener('change', (e) => { s.unit = e.target.value; x1RenderCanvas(); x1ScheduleSave(); });
  $('#tWinFrom')?.addEventListener('change', (e) => { s.window_from = e.target.value; x1RenderCanvas(); x1ScheduleSave(); });
  $('#tWinTo')?.addEventListener('change', (e) => { s.window_to = e.target.value; x1RenderCanvas(); x1ScheduleSave(); });
  $('#tWinNextDay')?.addEventListener('change', (e) => { s.next_day = e.target.checked; x1ScheduleSave(); });
}

function x1WaitReplyForm(s) {
  const unit = s.timeout_unit || 'min';
  const val = s.timeout_value ?? s.timeout_minutes ?? 30;
  return `<div class="field"><label class="toggle-row"><input type="checkbox" id="x1WaitForever" ${s.wait_forever ? 'checked' : ''}/>
      <span><span class="tl">Aguardar indefinidamente</span><br><span class="ts">Só avança quando o lead responder (sem encerrar por tempo)</span></span></label></div>
    <div class="field" id="x1WaitTimeoutBox" ${s.wait_forever ? 'hidden' : ''}><label class="lbl">Tempo máximo aguardando a resposta</label>
      <div style="display:flex;gap:8px"><input type="number" min="1" id="x1WaitVal" value="${val}" style="flex:1"/>
      <select id="x1WaitUnit" style="width:130px"><option value="min" ${unit === 'min' ? 'selected' : ''}>Minutos</option><option value="hora" ${unit === 'hora' ? 'selected' : ''}>Horas</option><option value="dia" ${unit === 'dia' ? 'selected' : ''}>Dias</option></select></div></div>
    <div class="field"><label class="toggle-row"><input type="checkbox" id="x1WaitBuffer" ${s.buffer_enabled ? 'checked' : ''}/>
      <span><span class="tl">Ativar buffer de mensagens</span><br><span class="ts">Junta mensagens enviadas em sequência antes de avançar</span></span></label></div>
    <div class="field" id="x1WaitBufBox" ${s.buffer_enabled ? '' : 'hidden'}><label class="lbl">Tempo de espera entre mensagens (seg)</label>
      <input type="number" min="1" id="x1WaitBufSec" value="${s.buffer_seconds ?? 8}"/></div>
    <div class="field"><label class="toggle-row"><input type="checkbox" id="x1WaitQuote" ${s.quote_reply ? 'checked' : ''}/>
      <span><span class="tl">Responder como resposta à mensagem do lead</span><br><span class="ts">A próxima mensagem sai citando a do lead</span></span></label></div>
    <div class="field"><label class="toggle-row"><input type="checkbox" id="x1WaitReact" ${s.react_on_reply ? 'checked' : ''}/>
      <span><span class="tl">Reagir na mensagem do lead</span><br><span class="ts">Reage com um emoji na resposta do lead</span></span></label></div>
    <div class="field"><label class="lbl">Campo para salvar a resposta do lead</label>
      <input id="x1WaitSave" value="${esc(s.save_field || '')}" placeholder="ex: resposta"/>
      <div class="hint" style="margin-top:6px">A resposta fica guardada nesse campo/etiqueta, com histórico. Foto/vídeo/áudio também contam como resposta.</div></div>
    <div class="field"><label class="toggle-row"><input type="checkbox" id="x1WaitReqMedia" ${s.require_media ? 'checked' : ''}/>
      <span><span class="tl">Só aceita foto, vídeo, áudio ou documento</span><br><span class="ts">Ignora textos como "ok"/"blz" mandados antes do arquivo — continua esperando até chegar mídia de verdade. Use nos que esperam comprovante.</span></span></label></div>
    <p class="hint">Saídas: <strong style="color:#22c55e">verde</strong> = respondeu · <strong style="color:#ef4444">vermelha</strong> = não respondeu (tempo esgotou).</p>`;
}
function x1BindWaitReply(s) {
  $('#x1WaitForever').addEventListener('change', (e) => { s.wait_forever = e.target.checked; $('#x1WaitTimeoutBox').hidden = e.target.checked; x1RenderCanvas(); x1ScheduleSave(); });
  $('#x1WaitVal').addEventListener('input', (e) => { s.timeout_value = +e.target.value; x1RenderCanvas(); x1ScheduleSave(); });
  $('#x1WaitUnit').addEventListener('change', (e) => { s.timeout_unit = e.target.value; x1RenderCanvas(); x1ScheduleSave(); });
  $('#x1WaitBuffer').addEventListener('change', (e) => { s.buffer_enabled = e.target.checked; $('#x1WaitBufBox').hidden = !e.target.checked; x1ScheduleSave(); });
  $('#x1WaitBufSec').addEventListener('input', (e) => { s.buffer_seconds = +e.target.value; x1ScheduleSave(); });
  $('#x1WaitQuote').addEventListener('change', (e) => { s.quote_reply = e.target.checked; x1ScheduleSave(); });
  $('#x1WaitReact').addEventListener('change', (e) => { s.react_on_reply = e.target.checked; x1ScheduleSave(); });
  $('#x1WaitSave').addEventListener('input', (e) => { s.save_field = e.target.value.trim(); x1ScheduleSave(); });
  $('#x1WaitReqMedia').addEventListener('change', (e) => { s.require_media = e.target.checked; x1ScheduleSave(); });
}

let x1FieldsCache = [];
const X1_OPS = [
  { v: 'exists', l: 'existe / preenchido' }, { v: 'not_exists', l: 'não existe / vazio' },
  { v: 'equals', l: 'igual a' }, { v: 'not_equals', l: 'diferente de' },
  { v: 'contains', l: 'contém' }, { v: 'not_contains', l: 'não contém' },
  { v: 'gt', l: 'maior que' }, { v: 'lt', l: 'menor que' },
  { v: 'gte', l: 'maior ou igual' }, { v: 'lte', l: 'menor ou igual' },
  { v: 'type_is', l: 'tipo de resposta é' }, { v: 'not_type_is', l: 'tipo de resposta não é' }
];
const X1_TAG_OPS = [{ v: 'has', l: 'tem a etiqueta' }, { v: 'not_has', l: 'não tem a etiqueta' }];
// Mesmos 5 tipos que o Leona oferece no seletor "Tipo" do condicional — olha
// o tipo da ÚLTIMA mensagem que o cliente mandou e foi salva nesse campo.
const X1_TYPE_OPTIONS = [
  { v: 'texto', l: 'Texto' }, { v: 'imagem', l: 'Imagem' }, { v: 'video', l: 'Vídeo' },
  { v: 'documento', l: 'Documento' }, { v: 'audio', l: 'Áudio' }
];

// Migra o formato antigo (check/tag) para o novo (conditions/logic).
function x1MigrateCondition(s) {
  if (Array.isArray(s.conditions)) return;
  if (s.check === 'has_tag' || s.check === 'not_has_tag') {
    s.conditions = [{ field: '__tag', op: s.check === 'not_has_tag' ? 'not_has' : 'has', value: s.tag || '' }];
  } else {
    s.conditions = [{ field: '', op: 'exists', value: '' }];
  }
  s.logic = s.logic || 'all';
  delete s.check; delete s.tag;
}

function x1FieldOptions(sel) {
  const custom = x1FieldsCache.filter((f) => !['name', 'number', 'jid'].includes(f));
  return `<optgroup label="Sistema"><option value="name" ${sel === 'name' ? 'selected' : ''}>Nome</option><option value="number" ${sel === 'number' ? 'selected' : ''}>Número</option></optgroup>
    <optgroup label="Etiqueta"><option value="__tag" ${sel === '__tag' ? 'selected' : ''}>Etiqueta</option></optgroup>
    ${custom.length ? `<optgroup label="Campos custom">${custom.map((f) => `<option value="${esc(f)}" ${sel === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}</optgroup>` : ''}
    <option value="__other" ${sel && sel !== '__tag' && sel !== 'name' && sel !== 'number' && !custom.includes(sel) ? 'selected' : ''}>Outro campo…</option>`;
}

function x1ConditionForm(s) {
  x1MigrateCondition(s);
  const rows = s.conditions.map((c, i) => {
    const isTag = c.field === '__tag';
    const isOther = c.field && c.field !== '__tag' && c.field !== 'name' && c.field !== 'number' && !x1FieldsCache.includes(c.field);
    const ops = isTag ? X1_TAG_OPS : X1_OPS;
    const needsValue = c.op !== 'exists' && c.op !== 'not_exists';
    const isTypeOp = c.op === 'type_is' || c.op === 'not_type_is';
    const valueField = isTypeOp
      ? `<div class="field" style="margin-bottom:0"><label class="lbl">Tipo</label>
          <select data-cv="${i}">${X1_TYPE_OPTIONS.map((o) => `<option value="${o.v}" ${c.value === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}</select></div>`
      : `<div class="field" style="margin-bottom:0"><label class="lbl">Valor</label><input data-cv="${i}" value="${esc(c.value || '')}" placeholder="${isTag ? 'ex: vip' : 'valor para comparar'}"/></div>`;
    return `<div class="x1-cond-row" style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px">
      <div class="field" style="margin-bottom:6px"><label class="lbl">Campo</label>
        <select data-cf="${i}">${x1FieldOptions(isOther ? '__other' : c.field)}</select>
        ${isOther ? `<input data-cfo="${i}" value="${esc(c.field)}" placeholder="nome do campo (ex: comprovante.valor)" style="margin-top:6px"/>` : ''}</div>
      <div class="field" style="margin-bottom:6px"><label class="lbl">Condição</label>
        <select data-co="${i}">${ops.map((o) => `<option value="${o.v}" ${c.op === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}</select></div>
      ${needsValue ? valueField : ''}
      ${isTypeOp ? `<p class="hint" style="margin-top:6px">Olha o tipo da última mensagem que o cliente mandou e foi salva nesse campo (pelo "Aguarda resposta" com "salvar em"). Funciona só para campos preenchidos por resposta do cliente.</p>` : ''}
      ${s.conditions.length > 1 ? `<button class="btn sm danger" data-cd="${i}" style="margin-top:8px">Remover condição</button>` : ''}
    </div>`;
  }).join('');
  return `<div class="field"><label class="lbl">A regra corresponde a…</label>
      <select id="x1CondLogic"><option value="all" ${s.logic !== 'any' ? 'selected' : ''}>TODAS as condições (e)</option><option value="any" ${s.logic === 'any' ? 'selected' : ''}>QUALQUER condição (ou)</option></select></div>
    <div id="x1CondRows">${rows}</div>
    <button class="btn sm ghost" id="x1CondAdd">+ adicionar condição</button>
    <p class="hint" style="margin-top:10px">Saída "sim" segue se a regra for verdadeira; "não" caso contrário. Campos vêm do bloco de IA, do webhook ou do sistema.</p>`;
}
async function x1BindCondition(s) {
  // Carrega o catálogo de campos e re-renderiza se vier algo novo.
  try {
    const fields = await api('/api/x1/fields');
    if (Array.isArray(fields) && fields.join(',') !== x1FieldsCache.join(',')) {
      x1FieldsCache = fields; return x1SelectNode(s.id);
    }
  } catch {}
  const rerender = () => x1SelectNode(s.id);
  $('#x1CondLogic').addEventListener('change', (e) => { s.logic = e.target.value; x1RenderCanvas(); x1ScheduleSave(); });
  $('#x1CondAdd').addEventListener('click', () => { s.conditions.push({ field: '', op: 'exists', value: '' }); rerender(); x1ScheduleSave(); });
  document.querySelectorAll('[data-cf]').forEach((el) => el.addEventListener('change', (e) => {
    const i = +el.dataset.cf, v = e.target.value; const c = s.conditions[i];
    if (v === '__other') { c.field = c.field && c.field !== '__tag' ? c.field : ''; }
    else { c.field = v; if (v === '__tag' && c.op !== 'not_has') c.op = 'has'; if (v !== '__tag' && (c.op === 'has' || c.op === 'not_has')) c.op = 'exists'; }
    rerender();
    x1ScheduleSave();
  }));
  document.querySelectorAll('[data-cfo]').forEach((el) => el.addEventListener('input', (e) => { s.conditions[+el.dataset.cfo].field = e.target.value.trim(); x1ScheduleSave(); }));
  document.querySelectorAll('[data-co]').forEach((el) => el.addEventListener('change', (e) => {
    const c = s.conditions[+el.dataset.co];
    c.op = e.target.value;
    const isTypeOp = c.op === 'type_is' || c.op === 'not_type_is';
    if (isTypeOp && !X1_TYPE_OPTIONS.some((o) => o.v === c.value)) c.value = 'imagem';
    rerender();
    x1ScheduleSave();
  }));
  document.querySelectorAll('[data-cv]').forEach((el) => {
    const handler = (e) => { s.conditions[+el.dataset.cv].value = e.target.value; x1ScheduleSave(); };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });
  document.querySelectorAll('[data-cd]').forEach((el) => el.addEventListener('click', () => { s.conditions.splice(+el.dataset.cd, 1); rerender(); x1ScheduleSave(); }));
}

function x1TagForm(s) {
  const tags = state.x1TagsCache || [];
  const opts = tags.map((t) => `<option value="${esc(t.name)}">${t.stores_value ? '(guarda valor)' : ''}</option>`).join('');
  return `<div class="field"><label class="lbl">Ação</label><select id="x1TagAction">
      <option value="add" ${s.action !== 'remove' ? 'selected' : ''}>Adicionar etiqueta</option>
      <option value="remove" ${s.action === 'remove' ? 'selected' : ''}>Remover etiqueta</option>
    </select></div>
    <div class="field"><label class="lbl">Etiqueta</label>
      <input id="x1TagName" list="x1TagOptions" value="${esc(s.tag || '')}" placeholder="escolha ou digite"/>
      <datalist id="x1TagOptions">${opts}</datalist>
      <div class="hint" style="margin-top:6px">${tags.length ? 'Escolha uma etiqueta criada ou digite uma nova.' : 'Nenhuma etiqueta criada — crie em Configurações → Etiquetas.'}</div></div>`;
}
function x1BindTag(s) {
  $('#x1TagAction').addEventListener('change', (e) => { s.action = e.target.value; x1RenderCanvas(); x1ScheduleSave(); });
  $('#x1TagName').addEventListener('input', (e) => { s.tag = e.target.value.trim(); x1RenderCanvas(); x1ScheduleSave(); });
}

// Notificação: o dispositivo do fluxo manda uma mensagem para um número fixo.
function x1NotifyForm(s) {
  return `<div class="field"><label class="lbl">Número que vai receber o aviso</label>
      <input id="x1NotifyNum" value="${esc(s.number || '')}" placeholder="ex: 5511999999999 (com DDI e DDD)"/>
      <div class="hint" style="margin-top:6px">Só números. O dispositivo vinculado ao fluxo é quem envia.</div></div>
    <div class="field"><label class="lbl">Mensagem</label>
      <textarea id="x1NotifyText" rows="4" placeholder="Ex: Novo comprovante de {name} ({number}) no valor de {comprovante.valor}">${esc(s.text || '')}</textarea>
      <div class="hint" style="margin-top:6px">Use <code>{name}</code>, <code>{number}</code> e campos do contato como <code>{comprovante.valor}</code>.</div></div>`;
}
function x1BindNotify(s) {
  $('#x1NotifyNum').addEventListener('input', (e) => { s.number = e.target.value.trim(); x1RenderCanvas(); x1ScheduleSave(); });
  $('#x1NotifyText').addEventListener('input', (e) => { s.text = e.target.value; x1ScheduleSave(); });
}

// Webhook: POST para uma URL (ex.: Supabase) com o número do contato + campos.
function x1WebhookForm(s) {
  s.payload = s.payload || []; s.headers = s.headers || [];
  const kvRows = (arr, kind) => arr.map((kv, i) => `<div class="row-gap" data-kv="${kind}" style="margin-bottom:6px">
      <input data-kvk="${kind}:${i}" value="${esc(kv.key || '')}" placeholder="chave" style="flex:1"/>
      <input data-kvv="${kind}:${i}" value="${esc(kv.value || '')}" placeholder="valor (aceita {campo})" style="flex:1.4"/>
      <button class="btn sm danger" data-kvd="${kind}:${i}">✕</button></div>`).join('');
  return `<div class="field"><label class="lbl">URL do webhook</label>
      <input id="x1WhUrl" value="${esc(s.url || '')}" placeholder="https://xxxx.supabase.co/functions/v1/liberar-acesso"/></div>
    <div class="field"><label class="lbl">Método</label>
      <select id="x1WhMethod"><option ${s.method !== 'GET' ? 'selected' : ''}>POST</option><option ${s.method === 'GET' ? 'selected' : ''}>GET</option></select></div>
    <div class="field"><label class="lbl">Campos enviados (além de number, name, jid e campos do contato)</label>
      <div id="x1WhPayload">${kvRows(s.payload, 'p')}</div>
      <button class="btn sm ghost" id="x1WhAddPayload">+ campo</button></div>
    <div class="field"><label class="lbl">Cabeçalhos (ex.: Authorization)</label>
      <div id="x1WhHeaders">${kvRows(s.headers, 'h')}</div>
      <button class="btn sm ghost" id="x1WhAddHeader">+ cabeçalho</button></div>
    <div class="field"><label class="toggle-row"><input type="checkbox" id="x1WhSave" ${s.save_response ? 'checked' : ''}/>
      <span><span class="tl">Salvar resposta nos campos do contato</span><br><span class="ts">Grava o JSON de resposta como campos (prefixo abaixo)</span></span></label></div>
    <div class="field"><label class="lbl">Prefixo dos campos da resposta</label>
      <input id="x1WhPrefix" value="${esc(s.save_prefix || 'webhook')}" placeholder="webhook"/></div>
    <p class="hint">Sempre envia o número do contato (quem pagou). Ideal para liberar acesso no Supabase.</p>`;
}
function x1BindWebhook(s) {
  const rebind = () => { x1SelectNode(s.id); }; // re-render o form após add/remover linha
  $('#x1WhUrl').addEventListener('input', (e) => { s.url = e.target.value.trim(); x1RenderCanvas(); x1ScheduleSave(); });
  $('#x1WhMethod').addEventListener('change', (e) => { s.method = e.target.value; x1ScheduleSave(); });
  $('#x1WhSave').addEventListener('change', (e) => { s.save_response = e.target.checked; x1ScheduleSave(); });
  $('#x1WhPrefix').addEventListener('input', (e) => { s.save_prefix = e.target.value.trim(); x1ScheduleSave(); });
  $('#x1WhAddPayload').addEventListener('click', () => { s.payload.push({ key: '', value: '' }); rebind(); });
  $('#x1WhAddHeader').addEventListener('click', () => { s.headers.push({ key: '', value: '' }); rebind(); });
  const arrOf = (kind) => (kind === 'p' ? s.payload : s.headers);
  document.querySelectorAll('[data-kvk]').forEach((el) => el.addEventListener('input', (e) => { const [k, i] = el.dataset.kvk.split(':'); arrOf(k)[+i].key = e.target.value.trim(); x1ScheduleSave(); }));
  document.querySelectorAll('[data-kvv]').forEach((el) => el.addEventListener('input', (e) => { const [k, i] = el.dataset.kvv.split(':'); arrOf(k)[+i].value = e.target.value; x1ScheduleSave(); }));
  document.querySelectorAll('[data-kvd]').forEach((el) => el.addEventListener('click', () => { const [k, i] = el.dataset.kvd.split(':'); arrOf(k).splice(+i, 1); rebind(); }));
}

// Bloco de IA: lê comprovante de imagem e/ou classifica intenção via OpenAI.
function x1AiForm(s) {
  return `<div class="field"><label class="lbl">Modelo (OpenAI)</label>
      <input id="x1AiModel" value="${esc(s.model || 'gpt-4.1')}" placeholder="gpt-4.1"/>
      <div class="hint" style="margin-top:6px">A chave da OpenAI é configurada em <strong>Configurações</strong>.</div></div>
    <div class="field"><label class="toggle-row"><input type="checkbox" id="x1AiReceipt" ${s.identify_receipt ? 'checked' : ''}/>
      <span><span class="tl">Identificar comprovante (PIX)</span><br><span class="ts">Lê a imagem recebida e extrai os dados em campos</span></span></label></div>
    <div class="field"><label class="toggle-row"><input type="checkbox" id="x1AiImage" ${s.understand_image ? 'checked' : ''}/>
      <span><span class="tl">Entender imagem</span><br><span class="ts">Anexa a última imagem recebida do contato à análise</span></span></label></div>
    <div class="field"><label class="toggle-row"><input type="checkbox" id="x1AiPdf" ${s.understand_pdf ? 'checked' : ''}/>
      <span><span class="tl">Entender PDF</span><br><span class="ts">Anexa o último PDF recebido (ex.: comprovante em PDF) à análise</span></span></label></div>
    <div class="field"><p class="hint" style="margin:0">Com "Identificar comprovante" ligado, os dados saem em campos <code>comprovante.valor</code>, <code>comprovante.banco</code>, <code>comprovante.nome_pagador</code>, <code>comprovante.data</code>…</p></div>
    <div class="field"><label class="lbl">Salvar resposta da IA no campo</label>
      <input id="x1AiSave" value="${esc(s.save_field || 'ai.response')}" placeholder="ai.response"/></div>
    <div class="field"><label class="lbl">Mensagem/instrução enviada ao modelo (opcional)</label>
      <textarea id="x1AiInput" rows="3" placeholder="Ex: Classifique a intenção do cliente: interessado, dúvida ou desistiu.">${esc(s.input_text || '')}</textarea>
      <div class="hint" style="margin-top:6px">Aceita <code>{campo}</code>. Se "identificar comprovante" estiver ligado, a instrução de extração é adicionada automaticamente.</div></div>
    <div class="field"><label class="lbl">Comportamento / prompt do sistema (opcional)</label>
      <textarea id="x1AiPrompt" rows="3" placeholder="Você é um assistente que analisa comprovantes e intenção de leads.">${esc(s.prompt || '')}</textarea></div>
    <p class="hint">O node tem duas saídas: <strong>leu</strong> (conseguiu ler/responder) e <strong>não leu</strong> (erro ou não identificou). Ligue um <strong>Condicional</strong> na saída "leu" para avaliar os campos (ex.: <code>comprovante.valor</code> maior que 0).</p>`;
}
function x1BindAi(s) {
  $('#x1AiModel').addEventListener('input', (e) => { s.model = e.target.value.trim(); x1RenderCanvas(); x1ScheduleSave(); });
  $('#x1AiReceipt').addEventListener('change', (e) => { s.identify_receipt = e.target.checked; x1RenderCanvas(); x1ScheduleSave(); });
  $('#x1AiImage').addEventListener('change', (e) => { s.understand_image = e.target.checked; x1ScheduleSave(); });
  $('#x1AiPdf').addEventListener('change', (e) => { s.understand_pdf = e.target.checked; x1ScheduleSave(); });
  $('#x1AiSave').addEventListener('input', (e) => { s.save_field = e.target.value.trim(); x1ScheduleSave(); });
  $('#x1AiInput').addEventListener('input', (e) => { s.input_text = e.target.value; x1ScheduleSave(); });
  $('#x1AiPrompt').addEventListener('input', (e) => { s.prompt = e.target.value; x1ScheduleSave(); });
}

// Builder de mensagem do X1: reaproveita o mesmo formato de blocos do
// Gogrupo (texto, com upload de mídia futuro), simplificado para
// conversa 1:1 — sem variações anti-spam por grupo, já que aqui não há
// "lote" de destinatários, é 1 contato por vez.
function x1MsgForm(s) {
  if (!Array.isArray(s.blocks) || !s.blocks.length) s.blocks = [{ id: uid(), kind: 'text', variants: [''] }];
  return `<div id="x1Blocks">${s.blocks.map((b, i) => x1BlockHTML(b, i)).join('')}</div>
    <div class="row-gap" style="margin-top:10px"><button class="btn ghost sm" data-x1add="text">+ Texto</button><button class="btn ghost sm" data-x1add="image">+ Foto</button><button class="btn ghost sm" data-x1add="video">+ Vídeo</button><button class="btn ghost sm" data-x1add="audio">+ Áudio</button><button class="btn ghost sm" data-x1add="delay">+ Delay</button></div>
    <div class="field" style="margin-top:16px"><label class="lbl">Tempo inteligente — intervalo entre um bloco e o próximo (seg)</label>
      <div style="display:flex;gap:8px;align-items:center"><input type="number" min="0" id="x1GapMin" placeholder="mín" value="${s.gap_min ?? ''}" style="flex:1"/><span class="hint">a</span><input type="number" min="0" id="x1GapMax" placeholder="máx" value="${s.gap_max ?? ''}" style="flex:1"/><span class="hint">seg</span></div>
      <div class="hint" style="margin-top:6px">Sorteia um tempo entre os dois valores antes de mandar o bloco seguinte (ex.: 5 a 10s entre o áudio e a imagem).</div></div>`;
}
function x1BlockHTML(b, i) {
  const reorder = `<button class="rmv" data-x1up="${i}" title="Subir">↑</button><button class="rmv" data-x1down="${i}" title="Descer">↓</button>`;
  const delayRow = (label) => `<div class="field" style="margin-top:8px"><label class="lbl">${label} (seg)</label>
      <div style="display:flex;gap:8px;align-items:center"><input type="number" min="0" data-x1dmin="${i}" placeholder="mín" value="${b.delay_min ?? ''}" style="flex:1"/><span class="hint">a</span><input type="number" min="0" data-x1dmax="${i}" placeholder="máx" value="${b.delay_max ?? ''}" style="flex:1"/><span class="hint">seg</span></div></div>`;
  // Bloco de DELAY: só espera (não envia nada). Pode ser posto entre outros
  // blocos e reordenado.
  if (b.kind === 'delay') return `<div class="block-card" data-x1block="${i}" style="border-color:var(--accent)"><div class="bc-head"><span>${ICON.timer} Delay entre mensagens</span><span>${reorder}<button class="rmv" data-x1rmblock="${i}">&times;</button></span></div>
    <div style="display:flex;gap:8px;align-items:center"><input type="number" min="0" data-x1dmin="${i}" placeholder="mín" value="${b.delay_min ?? 0}" style="flex:1"/><span class="hint">a</span><input type="number" min="0" data-x1dmax="${i}" placeholder="máx" value="${b.delay_max ?? 5}" style="flex:1"/><span class="hint">seg</span></div>
    <div class="hint" style="margin-top:6px">Pausa pura entre os blocos, sorteada entre mín e máx. Não envia nada.</div></div>`;
  if (b.kind === 'text') return `<div class="block-card" data-x1block="${i}"><div class="bc-head"><span>${ICON.text} Texto</span><span>${reorder}<button class="rmv" data-x1rmblock="${i}">&times;</button></span></div>
    <textarea data-x1text="${i}" placeholder="Mensagem…">${esc(b.variants?.[0] || '')}</textarea>${delayRow('Digitando por')}
    <label class="toggle-row" style="margin-top:10px"><input type="checkbox" data-x1lp="${i}" ${b.link_preview === false ? 'checked' : ''}/><span><span class="tl">Desativar prévia de link</span><br><span class="ts">Se o texto tiver um link, manda sem a miniatura/título — só o texto puro</span></span></label></div>`;
  const icon = b.kind === 'image' ? ICON.image : b.kind === 'video' ? ICON.video : ICON.audio;
  const label = b.kind === 'image' ? 'Foto' : b.kind === 'video' ? 'Vídeo' : 'Áudio';
  const capField = b.kind !== 'audio' ? `<textarea data-x1cap="${i}" placeholder="Legenda (opcional)" style="min-height:44px;margin-top:8px">${esc(b.caption || '')}</textarea>` : '';
  const pttField = b.kind === 'audio' ? `<label class="toggle-row" style="margin-top:10px"><input type="checkbox" data-x1ptt="${i}" ${b.ptt === false ? '' : 'checked'}/><span><span class="tl">Enviar como gravado (mensagem de voz)</span><br><span class="ts">Desligado = envia como arquivo de áudio</span></span></label>` : '';
  return `<div class="block-card" data-x1block="${i}"><div class="bc-head"><span>${icon} ${label}</span><span>${reorder}<button class="rmv" data-x1rmblock="${i}">&times;</button></span></div>
    <p class="hint">${b.file_name ? esc(b.file_name) : 'Nenhum arquivo selecionado.'}</p>
    ${b.media_path ? x1MediaPreview(b) : ''}
    <input type="file" data-x1file="${i}" accept="${b.kind}/*" hidden/><button class="btn ghost sm" data-x1pick="${i}">Escolher arquivo</button>
    ${capField}
    ${delayRow(b.kind === 'audio' ? 'Gravando por' : 'Aguardar antes de enviar')}
    ${pttField}
    <label class="toggle-row" style="margin-top:10px"><input type="checkbox" data-x1vo="${i}" ${b.view_once ? 'checked' : ''}/><span><span class="tl">Visualização única</span></span></label></div>`;
}
function x1MediaUrl(b) { return b.media_url || ('/api/x1/flow-media/view?path=' + encodeURIComponent(b.media_path)); }
function x1MediaPreview(b) {
  const url = x1MediaUrl(b);
  if (b.kind === 'image') return `<img src="${url}" alt="preview" style="max-width:100%;max-height:180px;border-radius:8px;margin:6px 0;display:block"/>`;
  if (b.kind === 'video') return `<video src="${url}" controls style="max-width:100%;max-height:200px;border-radius:8px;margin:6px 0;display:block"></video>`;
  if (b.kind === 'audio') return `<audio src="${url}" controls style="width:100%;margin:6px 0;display:block"></audio>`;
  return '';
}
function x1RerenderBlocks(s) { $('#x1Blocks').innerHTML = s.blocks.map((b, i) => x1BlockHTML(b, i)).join(''); x1BindBlocks(s); $('#x1Blocks').querySelectorAll('textarea').forEach(autoGrowTextarea); x1RenderCanvas(); }
function x1BindMsg(s) {
  $('#drawerBody').querySelectorAll('[data-x1add]').forEach((b) => b.addEventListener('click', () => {
    const kind = b.dataset.x1add;
    const nb = kind === 'delay' ? { id: uid(), kind: 'delay', delay_min: 0, delay_max: 5 } : { id: uid(), kind, variants: [''] };
    s.blocks.push(nb); x1RerenderBlocks(s); x1ScheduleSave();
  }));
  $('#x1GapMin')?.addEventListener('input', (e) => { s.gap_min = e.target.value === '' ? undefined : +e.target.value; x1ScheduleSave(); });
  $('#x1GapMax')?.addEventListener('input', (e) => { s.gap_max = e.target.value === '' ? undefined : +e.target.value; x1ScheduleSave(); });
  x1BindBlocks(s);
}
function x1BindBlocks(s) {
  $('#x1Blocks').querySelectorAll('[data-x1text]').forEach((el) => el.addEventListener('input', (e) => { s.blocks[+el.dataset.x1text].variants = [e.target.value]; autoGrowTextarea(e.target); x1RenderCanvas(); x1ScheduleSave(); }));
  $('#x1Blocks').querySelectorAll('[data-x1cap]').forEach((el) => el.addEventListener('input', (e) => { s.blocks[+el.dataset.x1cap].caption = e.target.value; autoGrowTextarea(e.target); x1ScheduleSave(); }));
  $('#x1Blocks').querySelectorAll('[data-x1vo]').forEach((el) => el.addEventListener('change', (e) => { s.blocks[+el.dataset.x1vo].view_once = e.target.checked; x1ScheduleSave(); }));
  $('#x1Blocks').querySelectorAll('[data-x1lp]').forEach((el) => el.addEventListener('change', (e) => { s.blocks[+el.dataset.x1lp].link_preview = e.target.checked ? false : undefined; x1ScheduleSave(); }));
  $('#x1Blocks').querySelectorAll('[data-x1ptt]').forEach((el) => el.addEventListener('change', (e) => { s.blocks[+el.dataset.x1ptt].ptt = e.target.checked; x1ScheduleSave(); }));
  const num = (v) => (v === '' ? undefined : +v);
  $('#x1Blocks').querySelectorAll('[data-x1dmin]').forEach((el) => el.addEventListener('input', (e) => { s.blocks[+el.dataset.x1dmin].delay_min = num(e.target.value); x1ScheduleSave(); }));
  $('#x1Blocks').querySelectorAll('[data-x1dmax]').forEach((el) => el.addEventListener('input', (e) => { s.blocks[+el.dataset.x1dmax].delay_max = num(e.target.value); x1ScheduleSave(); }));
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= s.blocks.length) return; const t = s.blocks[i]; s.blocks[i] = s.blocks[j]; s.blocks[j] = t; x1RerenderBlocks(s); x1RenderCanvas(); x1ScheduleSave(); };
  $('#x1Blocks').querySelectorAll('[data-x1up]').forEach((el) => el.addEventListener('click', () => move(+el.dataset.x1up, -1)));
  $('#x1Blocks').querySelectorAll('[data-x1down]').forEach((el) => el.addEventListener('click', () => move(+el.dataset.x1down, +1)));
  $('#x1Blocks').querySelectorAll('[data-x1rmblock]').forEach((el) => el.addEventListener('click', () => { s.blocks.splice(+el.dataset.x1rmblock, 1); x1RerenderBlocks(s); x1ScheduleSave(); }));
  $('#x1Blocks').querySelectorAll('[data-x1pick]').forEach((el) => el.addEventListener('click', () => $(`[data-x1file="${el.dataset.x1pick}"]`).click()));
  $('#x1Blocks').querySelectorAll('[data-x1file]').forEach((el) => el.addEventListener('change', async (e) => {
    const i = +el.dataset.x1file, file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('media', file);
    try {
      const r = await fetch('/api/x1/flow-media', { method: 'POST', body: fd }).then((x) => x.json());
      s.blocks[i].media_path = r.media_path; s.blocks[i].file_name = r.file_name; s.blocks[i].mime = r.mime; s.blocks[i].media_url = r.media_url;
      x1RerenderBlocks(s); x1ScheduleSave();
    } catch (err) { toast('Falha ao enviar arquivo.', true); }
  }));
}


/* ============ Boot ============ */
// Listeners de configuração usando event delegation — funciona mesmo
// quando os elementos são renderizados dinamicamente
document.addEventListener('click', async (e) => {
  if (e.target.id === 'saveConfig') {
    try {
      await api('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ evolution_url: $('#cfgUrl').value, api_key: $('#cfgKey').value }) });
      toast('Conexão salva.'); refreshConn();
    } catch (err) { toast(err.message, true); }
  }
  if (e.target.id === 'saveOpenaiKey') {
    try {
      await api('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openai_key: $('#cfgOpenaiKey').value }) });
      toast('Chave da OpenAI salva.'); refreshConn();
    } catch (err) { toast(err.message, true); }
  }
  if (e.target.id === 'whCheck') { await x1CheckWebhooks(); }
  if (e.target.id === 'x1AsaasSaveBtn') {
    try {
      await api('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        asaas_webhook_secret: $('#x1AsaasSecret').value, asaas_pixel_id: $('#x1AsaasPixel').value, asaas_page_id: $('#x1AsaasPageId').value, asaas_flow_id: $('#x1AsaasFlow').value
      }) });
      toast('Configuração da Asaas salva.'); loadX1Settings();
    } catch (err) { toast(err.message, true); }
  }
  if (e.target.id === 'x1AsaasTestBtn') {
    const phone = $('#x1AsaasTestPhone').value.trim();
    if (!phone) { toast('Digite um telefone.', true); return; }
    $('#x1AsaasTestResult').textContent = 'Enviando...';
    try {
      const r = await api('/api/x1/asaas-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, amount: $('#x1AsaasTestAmount').value }) });
      $('#x1AsaasTestResult').textContent = JSON.stringify(r, null, 2);
      if (r.matched_contact) toast(`Casou com ${r.contact_name || phone}${r.flow_triggered ? ' e disparou o fluxo "' + r.flow_name + '".' : ' mas nenhum fluxo disparou (selecione o Fluxo B acima).'}`);
      else toast('Não achou contato com esse telefone.', true);
    } catch (err) { $('#x1AsaasTestResult').textContent = 'Erro: ' + err.message; toast(err.message, true); }
  }
  if (e.target.id === 'x1AddPixelBtn') {
    const name = $('#x1PxName').value.trim(), pixel_id = $('#x1PxId').value.trim(), access_token = $('#x1PxToken').value.trim();
    if (!name || !pixel_id || !access_token) { toast('Preencha nome, ID e token do pixel.', true); return; }
    try {
      const pixels = await api('/api/x1/pixels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, pixel_id, access_token, platform: 'Facebook' }) });
      $('#x1PxName').value = ''; $('#x1PxId').value = ''; $('#x1PxToken').value = '';
      renderX1Pixels(pixels); toast('Pixel cadastrado.');
    } catch (err) { toast(err.message, true); }
  }
  if (e.target.id === 'x1AddTagBtn') {
    const name = $('#x1NewTagName').value.trim();
    if (!name) { toast('Digite o nome da etiqueta.', true); return; }
    try {
      const tags = await api('/api/x1/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, stores_value: $('#x1NewTagStores').checked }) });
      $('#x1NewTagName').value = ''; $('#x1NewTagStores').checked = false;
      renderX1Tags(tags); toast('Etiqueta criada.');
    } catch (err) { toast(err.message, true); }
  }
  if (e.target.id === 'whFixAll') {
    e.target.disabled = true;
    try {
      const list = await api('/api/x1/webhook-status');
      const base = window.location.origin;
      await Promise.all(list.map((d) => api('/api/x1/webhook-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instance: d.device, base_url: base }) }).catch(() => {})));
      toast('Webhooks apontados para o GoX1.');
      await x1CheckWebhooks();
    } catch (err) { toast(err.message, true); }
    e.target.disabled = false;
  }
});

// Filtros da lista de chats
document.addEventListener('change', (e) => {
  if (e.target.id === 'x1DeviceFilter') { x1DeviceFilterValue = e.target.value; renderX1ChatList(); }
});
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#x1ChatFilter button');
  if (btn) {
    x1ChatFilterValue = btn.dataset.f;
    document.querySelectorAll('#x1ChatFilter button').forEach((b) => b.classList.toggle('active', b === btn));
    renderX1ChatList();
  }
});

(async function init() {
  refreshConn();
  setInterval(refreshConn, 30000);
  loadX1Chats();
})();
