import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

export const DATA_DIR_PATH = DATA_DIR;
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const STORE = path.join(DATA_DIR, 'gox1.json');

// Campos padrão (aparecem no construtor de condições mesmo antes de rodar).
export const DEFAULT_X1_FIELDS = [
  'valor.pix', 'nome.pagador', 'nome.recebedor', 'data.pix', 'banco.comprovante',
  'chave.pix', 'doc.pagador', 'doc.recebedor', 'tipo.comprovante',
  'ai.response', 'ai.intent', 'ai.erro', 'resposta'
];

const DEFAULTS = {
  config: { evolution_url: '', api_key: '', openai_key: '', url_gogrupo: '', url_gofire: '' },
  x1: {
    contacts: {},
    conversations: {},
    flows: [],
    runs: {},
    settings: {
      welcome_flow_id: null,
      default_flow_id: null,
      default_flow_timeout_hours: 24,
      ended_flow_id: null,
      keyword_triggers: []
    },
    send_queue: [],
    last_sent_at: {},
    custom_fields: []
  }
};

let store;
let _saveTimer = null;
function save() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    // Limita mensagens por conversa
    for (const conv of Object.values(store.x1.conversations)) {
      if (conv.messages?.length > 300) conv.messages = conv.messages.slice(-300);
    }
    try {
      const tmp = STORE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
      try { if (fs.existsSync(STORE)) fs.copyFileSync(STORE, STORE + '.bak'); } catch {}
      fs.renameSync(tmp, STORE);
    } catch {
      try { fs.writeFileSync(STORE, JSON.stringify(store, null, 2)); } catch {}
    }
  }, 2000);
}

function load() {
  const tryParse = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
  const raw = tryParse(STORE) || tryParse(STORE + '.bak');
  if (raw) { store = raw; } else { store = structuredClone(DEFAULTS); }
  store.config = { ...DEFAULTS.config, ...(store.config || {}) };
  // Variáveis de ambiente têm prioridade sobre o arquivo salvo
  if (process.env.EVOLUTION_URL) store.config.evolution_url = process.env.EVOLUTION_URL;
  if (process.env.EVOLUTION_API_KEY) store.config.api_key = process.env.EVOLUTION_API_KEY;
  if (process.env.OPENAI_API_KEY) store.config.openai_key = process.env.OPENAI_API_KEY;
  if (process.env.URL_GOGRUPO) store.config.url_gogrupo = process.env.URL_GOGRUPO;
  if (process.env.URL_GOFIRE) store.config.url_gofire = process.env.URL_GOFIRE;
  store.x1 ||= structuredClone(DEFAULTS.x1);
  store.x1.contacts ||= {};
  store.x1.conversations ||= {};
  store.x1.flows ||= [];
  store.x1.runs ||= {};
  store.x1.settings ||= structuredClone(DEFAULTS.x1.settings);
  store.x1.settings.keyword_triggers ||= [];
  store.x1.settings.flow_devices ||= [];
  store.x1.device_triggers ||= {};
  store.x1.send_queue ||= [];
  store.x1.last_sent_at ||= {};
  store.x1.custom_fields ||= [];
  store.x1.tags ||= [];
  store.x1.pixels ||= [];
  store.x1.seen_messages ||= {};
  for (const k of DEFAULT_X1_FIELDS) if (!store.x1.custom_fields.includes(k)) store.x1.custom_fields.push(k);
  save();
}
load();

export function getConfig() { return { ...store.config }; }
export function saveConfig(patch) { store.config = { ...store.config, ...patch }; save(); }

// Grava AGORA, de forma síncrona, cancelando o debounce. Usado ao encerrar
// (SIGTERM no redeploy) para não perder os últimos segundos de atividade.
export function flushSync() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  try {
    for (const conv of Object.values(store.x1.conversations)) {
      if (conv.messages?.length > 300) conv.messages = conv.messages.slice(-300);
    }
    fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
  } catch (e) { /* nada a fazer */ }
}

/* ---- Contatos ---- */
export function listContacts() { return Object.values(store.x1.contacts).map(c => structuredClone(c)).sort((a, b) => b.last_seen - a.last_seen); }
export function getContact(jid) { return store.x1.contacts[jid] ? structuredClone(store.x1.contacts[jid]) : null; }
export function upsertContact(jid, patch) {
  const now = Date.now();
  const cur = store.x1.contacts[jid] || { jid, name: null, tags: [], created_at: now, last_seen: now };
  store.x1.contacts[jid] = { ...cur, ...patch, jid, last_seen: now };
  save(); return structuredClone(store.x1.contacts[jid]);
}
export function setContactTags(jid, tags) {
  if (!store.x1.contacts[jid]) return null;
  store.x1.contacts[jid].tags = tags || [];
  save(); return structuredClone(store.x1.contacts[jid]);
}
// Substitui TODOS os campos adicionais (edição manual pelo painel).
export function replaceContactFields(jid, fields) {
  const c = store.x1.contacts[jid]; if (!c) return null;
  c.fields = fields && typeof fields === 'object' ? { ...fields } : {};
  save(); return structuredClone(c);
}
// Troca o dispositivo de atendimento da conversa (usado nos envios do fluxo).
export function setConversationDevice(jid, device) {
  const conv = store.x1.conversations[jid]; if (!conv) return null;
  conv.device = device || conv.device; save(); return structuredClone(conv);
}
export function addContactTag(jid, tag) {
  const c = store.x1.contacts[jid]; if (!c) return;
  if (!c.tags) c.tags = [];
  if (!c.tags.includes(tag)) { c.tags.push(tag); save(); }
}
export function removeContactTag(jid, tag) {
  const c = store.x1.contacts[jid]; if (!c) return;
  c.tags = (c.tags || []).filter(t => t !== tag); save();
}
export function allX1TagNames() { return [...new Set(Object.values(store.x1.contacts).flatMap(c => c.tags || []))].sort(); }

/* ---- Campos customizados do contato (preenchidos por webhook, IA, etc.) ---- */
// Guarda um valor em contact.fields[key] e registra a chave no catálogo global
// (usado pelo condicional para listar os campos disponíveis).
export function setContactField(jid, key, value) {
  const c = store.x1.contacts[jid]; if (!c || !key) return;
  c.fields = c.fields || {};
  c.fields[key] = value;
  store.x1.custom_fields = store.x1.custom_fields || [];
  if (!store.x1.custom_fields.includes(key)) store.x1.custom_fields.push(key);
  save();
}
export function setContactFields(jid, obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) setContactField(jid, k, v);
}
export function getContactField(jid, key) {
  const c = store.x1.contacts[jid]; return c && c.fields ? c.fields[key] : undefined;
}
export function listX1Fields() { return [...(store.x1.custom_fields || [])].sort(); }
export function registerX1Field(key) {
  if (!key) return;
  store.x1.custom_fields = store.x1.custom_fields || [];
  if (!store.x1.custom_fields.includes(key)) { store.x1.custom_fields.push(key); save(); }
}

// Contagem de passagem por node (ex.: quantos contatos o distribuidor mandou
// para os caminhos). Chave: flowId → nodeId → total.
export function incrementX1NodeCount(flowId, nodeId) {
  store.x1.node_counts = store.x1.node_counts || {};
  const f = (store.x1.node_counts[flowId] = store.x1.node_counts[flowId] || {});
  f[nodeId] = (f[nodeId] || 0) + 1;
  save();
}
export function getX1NodeCounts(flowId) { return (store.x1.node_counts && store.x1.node_counts[flowId]) || {}; }

/* ---- Etiquetas criadas pelo usuário (catálogo) ---- */
// Cada etiqueta: { name, stores_value }. Se guarda valor, também entra no
// catálogo de campos (para o condicional ler o valor com histórico).
export function listX1Tags() { return [...(store.x1.tags || [])]; }
export function createX1Tag(name, storesValue) {
  name = String(name || '').trim();
  if (!name) return listX1Tags();
  store.x1.tags = store.x1.tags || [];
  const ex = store.x1.tags.find((t) => t.name === name);
  if (ex) ex.stores_value = !!storesValue;
  else store.x1.tags.push({ name, stores_value: !!storesValue });
  if (storesValue) registerX1Field(name);
  save(); return listX1Tags();
}
export function deleteX1Tag(name) {
  store.x1.tags = (store.x1.tags || []).filter((t) => t.name !== name);
  save(); return listX1Tags();
}

// Pausar/ativar um fluxo inteiro. Fluxo pausado (active=false) não dispara para
// novos leads e não avança os leads que já estão nele — até ser reativado.
export function setX1FlowActive(id, active) {
  const f = store.x1.flows.find((x) => x.id === +id);
  if (!f) return;
  f.active = !!active; f.updated_at = Date.now(); save();
  return structuredClone(f);
}

/* ---- Pixels do Facebook (Conversions API) ---- */
export function listX1Pixels() {
  return (store.x1.pixels || []).map((p) => ({ id: p.id, name: p.name, platform: p.platform, pixel_id: p.pixel_id, has_token: !!p.access_token }));
}
export function getX1Pixel(id) { return (store.x1.pixels || []).find((p) => p.id === +id); }
export function createX1Pixel(data) {
  store.x1.pixels = store.x1.pixels || [];
  const px = { id: ++_seq, name: data.name || 'Pixel', platform: data.platform || 'Facebook', pixel_id: String(data.pixel_id || '').trim(), access_token: String(data.access_token || '').trim() };
  store.x1.pixels.push(px); save(); return listX1Pixels();
}
export function deleteX1Pixel(id) {
  store.x1.pixels = (store.x1.pixels || []).filter((p) => p.id !== +id);
  save(); return listX1Pixels();
}

// Guarda a resposta de um contato num campo E mantém histórico (para trilha de
// respostas). meta pode conter { kind, media } etc.
export function saveContactReply(jid, field, value, meta) {
  const c = store.x1.contacts[jid]; if (!c || !field) return;
  c.fields = c.fields || {};
  c.fields[field] = value;
  c.field_history = c.field_history || {};
  const h = (c.field_history[field] = c.field_history[field] || []);
  h.push({ value, t: Date.now(), ...(meta || {}) });
  if (h.length > 50) c.field_history[field] = h.slice(-50);
  registerX1Field(field);
  save();
}
export function getContactFieldHistory(jid, field) {
  const c = store.x1.contacts[jid];
  return c && c.field_history ? (c.field_history[field] || []) : [];
}

/* ---- Conversas ---- */
export function listConversations() { return Object.values(store.x1.conversations).map(c => structuredClone(c)).sort((a, b) => b.updated_at - a.updated_at); }
export function getConversation(jid) { return store.x1.conversations[jid] ? structuredClone(store.x1.conversations[jid]) : null; }
export function appendMessage(jid, { id, fromMe, text, kind, device }) {
  const conv = store.x1.conversations[jid] || { jid, messages: [], status: 'waiting', updated_at: Date.now() };
  conv.messages.push({ id: id || null, fromMe: !!fromMe, text: text || '', kind: kind || 'text', t: Date.now() });
  if (conv.messages.length > 300) conv.messages = conv.messages.slice(-300);
  if (!fromMe) conv.status = 'waiting';
  if (device && !conv.device) conv.device = device;
  conv.updated_at = Date.now();
  store.x1.conversations[jid] = conv;
  save(); return structuredClone(conv);
}
export function setConversationStatus(jid, status) {
  const conv = store.x1.conversations[jid]; if (!conv) return null;
  conv.status = status; conv.updated_at = Date.now();
  save(); return structuredClone(conv);
}

/* ---- Fluxos X1 ---- */
let _seq = Date.now();
export function listX1Flows() { return [...store.x1.flows].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).map(f => structuredClone(f)); }
export function getX1Flow(id) { const f = store.x1.flows.find(x => x.id === +id); return f ? structuredClone(f) : undefined; }
export function createX1Flow(data) {
  const now = Date.now();
  const flow = { id: ++_seq, name: data.name || 'Fluxo sem nome', device: data.device || '', steps: [], start_next: null, updated_at: now, created_at: now };
  store.x1.flows.push(flow); save(); return structuredClone(flow);
}
export function updateX1Flow(id, patch) {
  const f = store.x1.flows.find(x => x.id === +id); if (!f) return undefined;
  Object.assign(f, patch, { updated_at: Date.now() }); save(); return structuredClone(f);
}
export function duplicateX1Flow(id) {
  const f = getX1Flow(id); if (!f) return undefined;
  const copy = { ...structuredClone(f), id: ++_seq, name: f.name + ' (cópia)', updated_at: Date.now(), created_at: Date.now() };
  // Regenera os IDs dos nodes e remapeia TODAS as conexões (id único, lista do
  // distribuidor e objeto por saída). Sem isso, dois fluxos com os mesmos IDs
  // confundiam o motor de envio.
  const map = new Map();
  for (const s of copy.steps || []) { const nid = 'n' + (++_seq).toString(36); map.set(s.id, nid); s.id = nid; }
  const remap = (v) => {
    if (v == null) return v;
    if (typeof v === 'string') return map.get(v) || null;
    if (Array.isArray(v)) return v.map((x) => map.get(x)).filter(Boolean);
    if (typeof v === 'object') { const o = {}; for (const [k, t] of Object.entries(v)) o[k] = remap(t); return o; }
    return v;
  };
  for (const s of copy.steps || []) s.next = remap(s.next);
  copy.start_next = remap(copy.start_next);
  store.x1.flows.push(copy); save(); return structuredClone(copy);
}
export function deleteX1Flow(id) { const before = store.x1.flows.length; store.x1.flows = store.x1.flows.filter(f => f.id !== +id); save(); return store.x1.flows.length < before; }

/* ---- Runs X1 ---- */
export function getX1Run(jid) { return store.x1.runs[jid] ? structuredClone(store.x1.runs[jid]) : null; }
export function listX1Runs() { return Object.values(store.x1.runs).map(r => structuredClone(r)); }
export function ensureX1Run(jid, flowId, firstNodeId, force = false) {
  const cur = store.x1.runs[jid];
  // Já está NESTE fluxo com etapas pendentes: não reseta (evita reenviar tudo
  // a cada mensagem/gatilho). Disparo manual usa force=true.
  if (!force && cur && cur.flow_id === +flowId && (cur.frontier || []).length) return;
  store.x1.runs[jid] = { jid, flow_id: +flowId, done: { start: true }, frontier: [firstNodeId].filter(Boolean), waiting: null, pending: {} };
  save();
}
// Para o fluxo do contato (remove o run em andamento).
export function clearX1Run(jid) { if (store.x1.runs[jid]) { delete store.x1.runs[jid]; save(); return true; } return false; }

// Apaga TUDO deste contato no GoX1 (conversa, contato e fluxo em andamento).
// É só interno do GoX1 — não mexe no WhatsApp. Deixa o contato "virgem" de novo,
// então o fluxo de boas-vindas volta a disparar quando ele mandar mensagem.
export function deleteX1Chat(jid) {
  let any = false;
  if (store.x1.conversations[jid]) { delete store.x1.conversations[jid]; any = true; }
  if (store.x1.contacts[jid]) { delete store.x1.contacts[jid]; any = true; }
  if (store.x1.runs[jid]) { delete store.x1.runs[jid]; any = true; }
  // Limpa também a fila de envio: sem isso, mensagens pendentes do run antigo
  // "vazavam" para o chat recém-zerado (mensagem fantasma do histórico).
  const before = store.x1.send_queue.length;
  store.x1.send_queue = store.x1.send_queue.filter((x) => x.jid !== jid);
  if (store.x1.send_queue.length !== before) any = true;
  if (any) save();
  return any;
}
export function advanceX1Contact(jid, nodeId, flow, outcome, onlyIndex) {
  const run = store.x1.runs[jid]; if (!run) return;
  run.done[nodeId] = true;
  run.frontier = run.frontier.filter(id => id !== nodeId);
  if (run.waits) delete run.waits[nodeId];
  if (run.waiting && run.waiting.nodeId === nodeId) run.waiting = null;
  else if (!run.waits || !Object.keys(run.waits).length) run.waiting = null;
  const step = nodeId === 'start' ? null : (flow.steps || []).find(s => s.id === nodeId);
  let nexts = [];
  if (step) {
    const nx = step.next;
    if (nx && typeof nx === 'object' && !Array.isArray(nx)) {
      // next por outcome: { then, else } / { ok, fail } / { replied, timeout }
      const t = outcome != null ? nx[outcome] : null;
      nexts = Array.isArray(t) ? t.filter(Boolean) : (t ? [t] : []);
    } else if (Array.isArray(nx)) {
      nexts = nx.filter(Boolean);
    } else if (nx) {
      nexts = [nx];
    }
  } else if (nodeId === 'start') {
    nexts = Array.isArray(flow.start_next) ? flow.start_next.filter(Boolean) : (flow.start_next ? [flow.start_next] : []);
  }
  // Revezamento (usado pelo Distribuidor): em vez de abrir TODOS os caminhos,
  // escolhe só um — por índice de rodízio — e ignora os demais para este lead.
  if (Number.isInteger(onlyIndex) && nexts.length > 1) {
    const idx = ((onlyIndex % nexts.length) + nexts.length) % nexts.length;
    nexts = [nexts[idx]];
  }
  for (const n of nexts) { if (typeof n === 'string' && !run.done[n] && !run.frontier.includes(n)) run.frontier.push(n); }
  if (!run.frontier.length) {
    // O run vai sumir agora — sem isso, "onde o fluxo parou" ficava
    // impossível de descobrir depois (a pergunta mais comum quando algo dá
    // errado no meio do funil). Guarda um retrato no CONTATO, que sobrevive
    // ao run: em qual nó, com qual saída, e quando.
    const c = store.x1.contacts[jid];
    if (c) {
      c.last_flow_end = {
        flow_id: run.flow_id,
        flow_name: flow?.name || `#${run.flow_id}`,
        last_node_id: nodeId,
        last_node_type: step?.type || (nodeId === 'start' ? 'inicio' : null),
        outcome: outcome || null,
        had_next_for_outcome: nexts.length > 0, // false = "morreu" por falta de saída configurada
        ended_at: Date.now()
      };
    }
    delete store.x1.runs[jid];
  }
  save();
}
export function setX1ContactWaiting(jid, nodeId, wakeAt, mode) {
  const run = store.x1.runs[jid]; if (!run) return;
  // Esperas POR NODE: ramos paralelos (pós-distribuidor) podem ter vários
  // timers/aguarda-resposta ao mesmo tempo sem um sobrescrever o outro.
  run.waits = run.waits || {};
  run.waits[nodeId] = { wake_at: wakeAt, mode: mode || 'timer' };
  run.waiting = { nodeId, wake_at: wakeAt, mode: mode || 'timer' }; // compat/painel
  save();
}
export function getX1Wait(run, nodeId) {
  if (run.waits && run.waits[nodeId]) return run.waits[nodeId];
  if (run.waiting && run.waiting.nodeId === nodeId) return { wake_at: run.waiting.wake_at, mode: run.waiting.mode };
  return null;
}
export function listX1ReplyWaits(run, flow) {
  const out = [];
  const seen = new Set();
  for (const [nid, w] of Object.entries(run.waits || {})) {
    if (w.mode === 'reply' && (run.frontier || []).includes(nid)) { out.push(nid); seen.add(nid); }
  }
  if (run.waiting && run.waiting.mode === 'reply' && !seen.has(run.waiting.nodeId) && (run.frontier || []).includes(run.waiting.nodeId)) out.push(run.waiting.nodeId);
  return out;
}
// Atualiza campos livres do run (usado pelo buffer do "aguarda resposta").
export function updateX1Run(jid, patch) {
  const r = store.x1.runs[jid]; if (!r) return; Object.assign(r, patch); save();
}
// Marca que a próxima mensagem enviada deve CITAR a mensagem do lead.
export function setContactQuoteKey(jid, key) {
  const c = store.x1.contacts[jid]; if (!c) return; c._quote_key = key; save();
}
export function takeContactQuoteKey(jid) {
  const c = store.x1.contacts[jid]; if (!c || !c._quote_key) return null;
  const k = c._quote_key; delete c._quote_key; save(); return k;
}

/* ---- Fila de envio X1 ---- */
export function enqueueX1Send(jid, nodeId, device) {
  // Dedup: nunca empilha o mesmo node para o mesmo contato duas vezes.
  if (store.x1.send_queue.some((x) => x.jid === jid && x.node_id === nodeId)) return;
  store.x1.send_queue.push({ jid, node_id: nodeId, device }); save();
}
export function dequeueX1Send(device) {
  const idx = store.x1.send_queue.findIndex(x => x.device === device);
  if (idx === -1) return null;
  const [item] = store.x1.send_queue.splice(idx, 1); save(); return item;
}
export function listX1QueueDevices() { return [...new Set(store.x1.send_queue.map(x => x.device))]; }
export function markX1Sent(device, ts) { store.x1.last_sent_at[device] = ts; save(); }
export function getX1LastSentAt(device) { return store.x1.last_sent_at[device] || 0; }

/* ---- Dedup de mensagens do webhook (PRECISA sobreviver a reinícios) ----
   A Evolution reenvia o mesmo webhook (retry) quando não consegue entregar na
   hora (ex.: instabilidade de rede/DNS no easypanel). Se essa dedup vivesse só
   em memória (um Set comum), cada reinício do processo zerava a memória e uma
   entrega atrasada da Evolution era tratada como mensagem NOVA de novo — o que
   podia re-disparar o fluxo inteiro do zero pro mesmo contato repetidamente
   (bug real observado: mesmo bloco de mensagens reenviado a cada restart).
   Guardando no disco, a dedup sobrevive a qualquer reinício do container. */
export function wasMessageSeen(id) {
  if (!id) return false;
  return !!(store.x1.seen_messages && store.x1.seen_messages[id]);
}
export function markMessageSeen(id) {
  if (!id) return;
  store.x1.seen_messages = store.x1.seen_messages || {};
  store.x1.seen_messages[id] = Date.now();
  // Poda: evita crescer pra sempre. Mantém só o que é recente/relevante para
  // cobrir os reenvios da Evolution (ela desiste depois de poucos minutos).
  const entries = Object.entries(store.x1.seen_messages);
  if (entries.length > 5000) {
    const cutoffMs = Date.now() - 24 * 3600 * 1000;
    let kept = entries.filter(([, t]) => t >= cutoffMs);
    kept.sort((a, b) => b[1] - a[1]);
    if (kept.length > 3000) kept = kept.slice(0, 3000);
    store.x1.seen_messages = Object.fromEntries(kept);
  }
  save();
}

/* ---- Configurações ---- */
export function getX1Settings() { return structuredClone(store.x1.settings); }
export function setX1Settings(patch) { Object.assign(store.x1.settings, patch); save(); return getX1Settings(); }
export function setX1KeywordTriggers(list) { store.x1.settings.keyword_triggers = (list || []).filter(t => t && t.value && t.flow_id); save(); return getX1Settings(); }

/* ---- Disparos por dispositivo (cada número tem seus próprios gatilhos) ---- */
const EMPTY_TRG = { welcome_flow_id: null, default_flow_id: null, default_flow_timeout_hours: 24, keyword_triggers: [] };
export function getX1DeviceTriggers(device) {
  const t = (store.x1.device_triggers || {})[device];
  return t ? { ...EMPTY_TRG, ...t } : { ...EMPTY_TRG };
}
export function setX1DeviceTriggers(device, cfg) {
  if (!device) return;
  store.x1.device_triggers = store.x1.device_triggers || {};
  store.x1.device_triggers[device] = {
    welcome_flow_id: cfg.welcome_flow_id ? +cfg.welcome_flow_id : null,
    default_flow_id: cfg.default_flow_id ? +cfg.default_flow_id : null,
    default_flow_timeout_hours: +cfg.default_flow_timeout_hours || 24,
    keyword_triggers: (cfg.keyword_triggers || []).filter((t) => t && t.value && t.flow_id)
  };
  save(); return getX1DeviceTriggers(device);
}
// Lista os dispositivos que TÊM alguma configuração de disparo (para a tela).
export function listX1DeviceTriggers() {
  const m = store.x1.device_triggers || {};
  return Object.entries(m)
    .filter(([, c]) => c && (c.welcome_flow_id || c.default_flow_id || (c.keyword_triggers || []).length))
    .map(([device, c]) => ({ device, ...c }));
}
export function deleteX1DeviceTriggers(device) {
  if (store.x1.device_triggers && store.x1.device_triggers[device]) { delete store.x1.device_triggers[device]; save(); }
  return listX1DeviceTriggers();
}
