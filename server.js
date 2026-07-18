import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getConfig, saveConfig, UPLOADS_DIR, DATA_DIR_PATH, flushSync,
  listContacts, getContact, setContactTags, allX1TagNames, upsertContact,
  listConversations, getConversation, setConversationStatus, appendMessage,
  listX1Flows, getX1Flow, createX1Flow, updateX1Flow, duplicateX1Flow, deleteX1Flow,
  getX1Run, ensureX1Run, clearX1Run, deleteX1Chat, replaceContactFields, setConversationDevice,
  getX1Settings, setX1Settings, setX1KeywordTriggers, listX1Fields, getX1NodeCounts,
  getX1DeviceTriggers, setX1DeviceTriggers, listX1DeviceTriggers, deleteX1DeviceTriggers,
  listX1Tags, createX1Tag, deleteX1Tag,
  setX1FlowActive, listX1Pixels, createX1Pixel, deleteX1Pixel, getX1Pixel,
  setContactFields
} from './db.js';
import {
  fetchInstances, createInstance, connectInstance, connectionState,
  logoutInstance, deleteInstance, setInstanceWebhook, getInstanceWebhook, sendText, sendMedia, sendAudio
} from './evolution.js';
import { readFileSync } from 'node:fs';
import { startX1Engine, handleIncomingMessage, kickX1Engine } from './x1-engine.js';
import { sendPixelEvent } from './meta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const PKG = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const BOOTED_AT = Date.now();

// Rede de segurança: um erro não tratado em qualquer lugar (motor em
// background, webhook, etc.) por padrão derruba o processo Node inteiro —
// e é o Easypanel reiniciando o container depois disso que explicaria
// reinícios/travamentos difíceis de rastrear. Loga o erro (aparece nos logs
// do container) e segue rodando em vez de matar o servidor.
process.on('uncaughtException', (e) => console.error('[GoX1] uncaughtException:', e?.stack || e));
process.on('unhandledRejection', (e) => console.error('[GoX1] unhandledRejection:', e?.stack || e));

app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true, lastModified: true,
  setHeaders: (res, filePath) => { if (/\.(html|js|css)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache'); }
}));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]/g, '_')}`)
});
const upload = multer({ storage, limits: { fileSize: 80 * 1024 * 1024 } });

/* ---- Config ---- */
app.get('/api/config', (req, res) => {
  const c = getConfig();
  res.json({
    configured: !!(c.evolution_url && c.api_key), evolution_url: c.evolution_url || '', has_key: !!c.api_key, has_openai: !!c.openai_key,
    url_gogrupo: c.url_gogrupo || '', url_gofire: c.url_gofire || '',
    has_asaas_secret: !!c.asaas_webhook_secret, asaas_pixel_id: c.asaas_pixel_id || '', asaas_page_id: c.asaas_page_id || '', asaas_flow_id: c.asaas_flow_id || '',
    version: PKG.version, uptime_s: Math.round((Date.now() - BOOTED_AT) / 1000)
  });
});
// Rota independente de tudo (não toca em disco nem na Evolution) — se ela
// também travar no navegador, o problema é de rede/proxy/infra, não do código.
app.get('/api/health', (req, res) => res.json({ ok: true, version: PKG.version, t: Date.now() }));
app.post('/api/config', (req, res) => {
  const { evolution_url, api_key, openai_key, url_gogrupo, url_gofire, asaas_webhook_secret, asaas_pixel_id, asaas_page_id, asaas_flow_id } = req.body;
  const cur = getConfig();
  saveConfig({
    evolution_url: evolution_url || cur.evolution_url,
    api_key: api_key?.trim() ? api_key : cur.api_key,
    openai_key: openai_key?.trim() ? openai_key.trim() : (openai_key === '' ? '' : cur.openai_key),
    url_gogrupo: url_gogrupo ?? cur.url_gogrupo,
    url_gofire: url_gofire ?? cur.url_gofire,
    asaas_webhook_secret: asaas_webhook_secret?.trim() ? asaas_webhook_secret.trim() : cur.asaas_webhook_secret,
    asaas_pixel_id: asaas_pixel_id !== undefined ? asaas_pixel_id : cur.asaas_pixel_id,
    asaas_page_id: asaas_page_id !== undefined ? asaas_page_id : cur.asaas_page_id,
    asaas_flow_id: asaas_flow_id !== undefined ? asaas_flow_id : cur.asaas_flow_id
  });
  res.json({ ok: true });
});

// Catálogo de campos customizados (para o construtor de condições no editor).
app.get('/api/x1/fields', (req, res) => res.json(listX1Fields()));

// Etiquetas criadas pelo usuário.
app.get('/api/x1/tags', (req, res) => res.json(listX1Tags()));
app.post('/api/x1/tags', (req, res) => res.json(createX1Tag(req.body.name, req.body.stores_value)));
app.delete('/api/x1/tags/:name', (req, res) => res.json(deleteX1Tag(decodeURIComponent(req.params.name))));

/* ---- Dispositivos ---- */
app.get('/api/devices', async (req, res) => {
  try { res.json(await fetchInstances(getConfig())); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/devices', async (req, res) => {
  const name = (req.body.name || '').trim().replace(/\s+/g, '-');
  if (!name) return res.status(400).json({ error: 'Informe um nome.' });
  try {
    const created = await createInstance(getConfig(), name);
    let qr = { base64: created?.qrcode?.base64 || null, code: created?.qrcode?.code || null };
    if (!qr.base64) { try { qr = await connectInstance(getConfig(), name); } catch {} }
    res.json({ ok: true, name, qr });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/devices/:name/qr', async (req, res) => {
  try { res.json(await connectInstance(getConfig(), req.params.name)); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/devices/:name/state', async (req, res) => {
  try { res.json({ state: await connectionState(getConfig(), req.params.name) }); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/devices/:name/logout', async (req, res) => {
  try { await logoutInstance(getConfig(), req.params.name); res.json({ ok: true }); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.delete('/api/devices/:name', async (req, res) => {
  try { try { await logoutInstance(getConfig(), req.params.name); } catch {} await deleteInstance(getConfig(), req.params.name); res.json({ ok: true }); } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ---- Webhook ---- */
// URLs padrão dos apps irmãos (usadas se a config estiver vazia).
const SIBLING_DEFAULTS = {
  gogrupo: 'https://gogroup-gogrupo.ntwddx.easypanel.host',
  gofire: 'https://gogroup-gofire.ntwddx.easypanel.host',
  gox1: 'https://gogroup-gox1.ntwddx.easypanel.host'
};
// Bases dos apps que devem RECEBER o relay a partir do gox1 (gofire e gogrupo).
function relayBases() {
  const c = getConfig();
  return [c.url_gofire || SIBLING_DEFAULTS.gofire, c.url_gogrupo || SIBLING_DEFAULTS.gogrupo]
    .map((u) => String(u).replace(/\/+$/, '')).filter(Boolean);
}
async function relayToSiblings(instance, body) {
  await Promise.all(relayBases().map((base) =>
    fetch(`${base}/webhook/in/${encodeURIComponent(instance)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gg-relay': '1' },
      body: JSON.stringify(body)
    }).catch(() => {})
  ));
}
// Recebe um evento de webhook: processa localmente (chat) e, se não for um
// relay, repassa para os apps irmãos — assim o número fica "unificado" e todos
// recebem, independentemente de para qual app o webhook da Evolution aponta.
function receiveWebhook(instance, body, isRelay) {
  try {
    const { event, data } = body || {};
    if (String(event || '').toUpperCase().replace(/\./g, '_') === 'MESSAGES_UPSERT') {
      handleIncomingMessage(instance, data);
    }
    if (!isRelay) relayToSiblings(instance, body);
  } catch {}
}

app.post('/webhook/in/:instance', (req, res) => {
  receiveWebhook(req.params.instance, req.body || {}, req.get('x-gg-relay') === '1');
  res.status(200).send('OK');
});
app.post('/webhook/x1/:instance', (req, res) => {
  // Compat: setups antigos apontam aqui. Também processa e repassa.
  receiveWebhook(req.params.instance, req.body || {}, req.get('x-gg-relay') === '1');
  res.status(200).send('OK');
});
app.post('/api/x1/webhook-setup', async (req, res) => {
  const { instance, base_url } = req.body;
  if (!instance || !base_url) return res.status(400).json({ error: 'Informe o dispositivo e a URL.' });
  const webhookUrl = `${base_url.replace(/\/+$/, '')}/webhook/in/${encodeURIComponent(instance)}`;
  try {
    await setInstanceWebhook(getConfig(), instance, webhookUrl);
    res.json({ ok: true, webhook_url: webhookUrl });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// O telefone vem só DDD+número (sem "55") — é assim que o Worker do checkout
// salva o mobilePhone no cliente Asaas. Gera os jids candidatos pra casar com
// o contato do WhatsApp — tenta com/sem o 9º dígito, já que números de
// WhatsApp antigos podem estar salvos sem ele.
function asaasPhoneToJidCandidates(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return [];
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
  const out = new Set([withCountry]);
  // 55 + DDD(2) + resto. Se resto tem 9 dígitos (começa com 9), tenta sem o 9;
  // se tem 8, tenta com um 9 inserido.
  const ddd = withCountry.slice(2, 4);
  const rest = withCountry.slice(4);
  if (rest.length === 9 && rest[0] === '9') out.add(`55${ddd}${rest.slice(1)}`);
  else if (rest.length === 8) out.add(`55${ddd}9${rest}`);
  return [...out].map((d) => `${d}@s.whatsapp.net`);
}

// Lógica central de "compra aprovada" — compartilhada entre o webhook real
// (/webhook/asaas, chamado pelo Worker do checkout depois de confirmar o
// pagamento na Asaas) e o simulador de teste (/api/x1/asaas-test, que roda
// isto direto, sem precisar da secret, já que é disparado de dentro do
// próprio painel).
async function processAsaasPurchase({ rawPhone, amount, productName, orderId }) {
  const cfg = getConfig();
  const candidates = asaasPhoneToJidCandidates(rawPhone);
  let jid = null, contact = null;
  for (const cand of candidates) { const c = getContact(cand); if (c) { jid = cand; contact = c; break; } }

  if (contact) {
    setContactFields(jid, {
      'compra.valor': amount, 'compra.produto': productName,
      'compra.pedido_id': orderId, 'compra.status': 'aprovada'
    });
    let flowTriggered = false, flowName = null;
    if (cfg.asaas_flow_id) {
      const flowB = getX1Flow(cfg.asaas_flow_id);
      if (flowB) {
        ensureX1Run(jid, flowB.id, flowB.start_next, true); // force=true: assume o fluxo B agora, mesmo que o A esteja em andamento
        kickX1Engine(); // processa já, não espera o ciclo de 5s
        flowTriggered = true; flowName = flowB.name;
        console.log(`[GoX1] Asaas: compra aprovada (pedido ${orderId}, R$${amount}) casada com ${jid} → disparando fluxo "${flowB.name}".`);
      } else {
        console.warn('[GoX1] asaas_flow_id configurado mas o fluxo não existe mais. Configure de novo em Configurações → Asaas.');
      }
    } else {
      console.warn('[GoX1] Compra da Asaas casada com um contato, mas nenhum "Fluxo B" está selecionado em Configurações → Asaas. Nada foi disparado.');
    }
    return { received: true, matched_contact: true, jid, contact_name: contact.name || null, flow_triggered: flowTriggered, flow_name: flowName };
  }

  // Sem contato correspondente: não tem como rodar um fluxo (precisa de um
  // jid). Dispara o pixel direto, como combinado, só pra não perder a
  // conversão — sem ctwa_clid porque não sabemos de qual contato/anúncio veio.
  console.warn(`[GoX1] Asaas: compra aprovada (pedido ${orderId}) sem contato correspondente no WhatsApp para o telefone ${rawPhone}. Disparando o pixel de reserva, sem vínculo com contato.`);
  let pixelFired = false, pixelError = null;
  if (cfg.asaas_pixel_id) {
    const pixel = getX1Pixel(cfg.asaas_pixel_id);
    if (pixel) {
      try {
        await sendPixelEvent(pixel, { eventName: 'Purchase', pageId: cfg.asaas_page_id, value: amount, currency: 'BRL', phone: rawPhone });
        pixelFired = true;
      } catch (e) { pixelError = e.message; console.error('[GoX1] Falha ao disparar pixel de reserva da Asaas:', e.message); }
    } else {
      console.warn('[GoX1] asaas_pixel_id configurado mas pixel não encontrado.');
    }
  } else {
    console.warn('[GoX1] Compra da Asaas sem contato e sem pixel de reserva selecionado em Configurações → Asaas.');
  }
  return { received: true, matched_contact: false, jid: null, pixel_fired: pixelFired, pixel_error: pixelError };
}

// Recebe a confirmação de "compra aprovada" repassada pelo Worker do checkout
// (que já validou o webhook da Asaas e buscou o telefone do cliente). Casa
// com o contato do WhatsApp pelo telefone (tentando as duas variantes
// com/sem o 9º dígito). Se casar, DISPARA O FLUXO B pra esse contato
// (sobrescrevendo qualquer fluxo em andamento) — é o próprio fluxo, montado
// no editor, que marca a tag, manda a mensagem do link e dispara o Purchase
// pro pixel (via node Pixel, com o ctwa_clid do contato lido
// automaticamente). Se NÃO casar (compra de alguém que nunca conversou), não
// tem jid pra rodar um fluxo — nesse caso dispara o pixel direto pelo
// servidor, sem contato/ctwa_clid, só pra não perder o dado de conversão pro
// Meta.
app.post('/webhook/asaas', async (req, res) => {
  const body = req.body || {};
  try {
    const cfg = getConfig();
    if (!cfg.asaas_webhook_secret) {
      console.warn('[GoX1] Webhook da Asaas chamado mas asaas_webhook_secret não está configurado em Configurações. Ignorando por segurança.');
      return res.status(200).json({ ignored: true, reason: 'secret_nao_configurado' });
    }
    const secretRecebido = req.get('x-relay-secret') || body.secret || '';
    if (String(secretRecebido) !== String(cfg.asaas_webhook_secret)) {
      console.warn('[GoX1] Webhook da Asaas: secret não confere.');
      return res.status(401).json({ error: 'secret inválida' });
    }
    if (!['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(String(body.event || ''))) {
      return res.status(200).json({ ignored: true, reason: 'evento não é PAYMENT_RECEIVED/PAYMENT_CONFIRMED' });
    }
    const payment = body.payment || {};
    const result = await processAsaasPurchase({
      rawPhone: body.customer_phone || '', amount: payment.value,
      productName: payment.description || '', orderId: payment.id || ''
    });
    res.status(200).json(result);
  } catch (e) {
    console.error('[GoX1] Erro processando webhook da Asaas:', e?.message || e);
    res.status(200).json({ error: e?.message || String(e) }); // 200 pra Asaas/Worker não ficar reenviando indefinidamente
  }
});

// Simulador de teste, usado pelo botão "Simular compra aprovada" em
// Configurações. Roda a MESMA lógica do webhook real, sem precisar da secret
// (é uma chamada interna, feita de dentro do próprio painel) — serve pra
// testar o casamento de telefone e o disparo do Fluxo B com um número de
// contato de verdade, sem gastar dinheiro numa compra real.
app.post('/api/x1/asaas-test', async (req, res) => {
  try {
    const { phone, amount } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'Informe um telefone.' });
    const result = await processAsaasPurchase({
      rawPhone: phone, amount: Number(amount) || 0,
      productName: 'Sortudo (simulação)', orderId: `simulacao-${Date.now()}`
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e?.message || String(e) }); }
});

// Diagnóstico: mostra, para cada dispositivo conectado, para qual URL o webhook
// está apontando hoje (ajuda a ver se está no GoX1, no GoFire ou vazio).
app.get('/api/x1/webhook-status', async (req, res) => {
  try {
    const config = getConfig();
    const instances = await fetchInstances(config);
    const connected = instances.filter((i) => i.state === 'open' || i.state === 'connected');
    const out = [];
    for (const inst of connected) {
      let url = '';
      try {
        const wh = await getInstanceWebhook(config, inst.name);
        url = wh?.url || wh?.webhook?.url || (Array.isArray(wh) ? wh[0]?.url : '') || '';
      } catch { url = ''; }
      out.push({ device: inst.name, url });
    }
    res.json(out);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ---- Contatos ---- */
app.get('/api/x1/contacts', (req, res) => res.json(listContacts()));
app.get('/api/x1/contacts/:jid', (req, res) => {
  const c = getContact(decodeURIComponent(req.params.jid));
  if (!c) return res.status(404).json({ error: 'Não encontrado.' });
  res.json(c);
});
// Info do fluxo em andamento do contato (para o painel do chat).
app.get('/api/x1/contacts/:jid/run', (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  const run = getX1Run(jid);
  if (!run) {
    const c = getContact(jid);
    return res.json({ in_flow: false, last_flow_end: c?.last_flow_end || null });
  }
  const flow = getX1Flow(run.flow_id);
  const frontier = (run.frontier || []).map((nid) => {
    const s = (flow && flow.steps || []).find((x) => x.id === nid);
    return { nodeId: nid, type: s ? s.type : (nid === flow?.start_next ? 'inicio' : 'desconhecido') };
  });
  const waits = Object.values(run.waits || {});
  const waiting = run.waiting || (waits.length ? { mode: waits.some((w) => w.mode === 'reply') ? 'reply' : 'timer' } : null);
  res.json({ in_flow: true, flow_id: run.flow_id, flow_name: flow ? flow.name : `#${run.flow_id}`, paused: flow ? flow.active === false : false, waiting, frontier, device: getConversation(jid)?.device || null });
});
app.post('/api/x1/contacts/:jid/start-flow', (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  const flow = getX1Flow(req.body.flow_id);
  if (!flow) return res.status(400).json({ error: 'Fluxo não encontrado.' });
  if (!flow.start_next) return res.status(400).json({ error: 'O fluxo não tem nenhum node ligado ao "Início". Abra o fluxo, conecte o Início a um node e salve.' });
  if (flow.active === false) return res.status(400).json({ error: 'O fluxo está PAUSADO. Ative-o no editor (botão "Ativar fluxo") antes de disparar.' });
  const conv = getConversation(jid);
  if (!conv || !conv.device) return res.status(400).json({ error: 'Esta conversa não tem um dispositivo associado ainda. Ela precisa ter recebido ao menos uma mensagem por um número conectado.' });
  ensureX1Run(jid, flow.id, flow.start_next, true); // manual: reinicia do zero
  kickX1Engine();
  const first = (flow.steps || []).find((s) => s.id === flow.start_next);
  const firstType = first ? first.type : 'desconhecido';
  const note = firstType === 'wait_reply'
    ? 'Atenção: este fluxo começa com "Aguarda resposta" — ele NÃO envia nada até o lead responder.'
    : `Disparado. Deve enviar em segundos pelo dispositivo ${conv.device}.`;
  res.json({ ok: true, flow_name: flow.name, device: conv.device, first_node: firstType, note });
});
app.post('/api/x1/contacts/:jid/stop-flow', (req, res) => {
  res.json({ ok: clearX1Run(decodeURIComponent(req.params.jid)) });
});
app.delete('/api/x1/contacts/:jid/chat', (req, res) => {
  res.json({ ok: deleteX1Chat(decodeURIComponent(req.params.jid)) });
});
// Edição do contato pelo painel (nome, dispositivo de atendimento, etiquetas, campos).
app.post('/api/x1/contacts/:jid/edit', (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  const { name, device, tags, fields } = req.body || {};
  if (name != null) upsertContact(jid, { name: String(name).trim() });
  if (device) setConversationDevice(jid, String(device));
  if (Array.isArray(tags)) setContactTags(jid, tags.map((t) => String(t).trim()).filter(Boolean));
  if (fields && typeof fields === 'object') replaceContactFields(jid, fields);
  res.json({ ok: true });
});
// Teste de envio direto por um dispositivo (prova a sessão da Evolution, fora do fluxo).
app.post('/api/x1/devices/:name/test-send', async (req, res) => {
  const device = decodeURIComponent(req.params.name);
  const number = String(req.body.number || '').replace(/\D/g, '');
  if (!number) return res.status(400).json({ error: 'Informe o número (com DDI+DDD).' });
  try {
    const [st, instances] = await Promise.all([
      connectionState(getConfig(), device).catch(() => 'unknown'),
      fetchInstances(getConfig()).catch(() => [])
    ]);
    const info = instances.find((i) => i.name === device);
    const r = await sendText(getConfig(), device, `${number}@s.whatsapp.net`, `Teste de envio do GoX1 (${device}) — ${new Date().toLocaleTimeString('pt-BR')}`, {});
    res.json({
      ok: true, state: st, message_id: r?.key?.id || r?.messageId || null,
      own_number: info?.number || null, profile_name: info?.profileName || null
    });
  } catch (e) { res.status(502).json({ error: String(e.message || e).slice(0, 300) }); }
});
app.post('/api/x1/contacts/:jid/tags', (req, res) => {
  const c = setContactTags(decodeURIComponent(req.params.jid), req.body.tags || []);
  if (!c) return res.status(404).json({ error: 'Não encontrado.' });
  res.json(c);
});
app.get('/api/x1/tags', (req, res) => res.json({ names: allX1TagNames() }));

/* ---- Conversas ---- */
app.get('/api/x1/conversations', (req, res) => res.json(listConversations()));
app.get('/api/x1/conversations/:jid', (req, res) => {
  const c = getConversation(decodeURIComponent(req.params.jid));
  if (!c) return res.status(404).json({ error: 'Não encontrada.' });
  res.json(c);
});
app.post('/api/x1/conversations/:jid/status', (req, res) => {
  const c = setConversationStatus(decodeURIComponent(req.params.jid), req.body.status);
  if (!c) return res.status(404).json({ error: 'Não encontrada.' });
  res.json(c);
});
app.post('/api/x1/conversations/:jid/send', async (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  const { device, text } = req.body;
  if (!device || !text) return res.status(400).json({ error: 'Informe dispositivo e texto.' });
  try {
    const resp = await sendText(getConfig(), device, jid, text, {});
    appendMessage(jid, { id: resp?.key?.id || null, fromMe: true, text, kind: 'text', device });
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ---- Fluxos X1 ---- */
app.get('/api/x1/flows', (req, res) => res.json(listX1Flows()));
app.get('/api/x1/flows/:id', (req, res) => {
  const f = getX1Flow(req.params.id);
  if (!f) return res.status(404).json({ error: 'Não encontrado.' });
  res.json(f);
});
app.get('/api/x1/flows/:id/counts', (req, res) => res.json(getX1NodeCounts(req.params.id)));
app.post('/api/x1/flows/:id/active', (req, res) => res.json(setX1FlowActive(req.params.id, req.body.active)));
app.get('/api/x1/device-triggers', (req, res) => res.json(listX1DeviceTriggers()));
app.get('/api/x1/device-triggers/:device', (req, res) => res.json(getX1DeviceTriggers(decodeURIComponent(req.params.device))));
app.post('/api/x1/device-triggers/:device', (req, res) => res.json(setX1DeviceTriggers(decodeURIComponent(req.params.device), req.body || {})));
app.delete('/api/x1/device-triggers/:device', (req, res) => res.json(deleteX1DeviceTriggers(decodeURIComponent(req.params.device))));

// Pixels do Facebook (Conversions API).
app.get('/api/x1/pixels', (req, res) => res.json(listX1Pixels()));
app.post('/api/x1/pixels', (req, res) => res.json(createX1Pixel(req.body)));
app.delete('/api/x1/pixels/:id', (req, res) => res.json(deleteX1Pixel(req.params.id)));
app.post('/api/x1/flows', (req, res) => res.json(createX1Flow(req.body || {})));
app.put('/api/x1/flows/:id', (req, res) => {
  const f = updateX1Flow(req.params.id, req.body || {});
  if (!f) return res.status(404).json({ error: 'Não encontrado.' });
  res.json(f);
});
app.post('/api/x1/flows/:id/duplicate', (req, res) => {
  const f = duplicateX1Flow(req.params.id);
  if (!f) return res.status(404).json({ error: 'Não encontrado.' });
  res.json(f);
});
app.delete('/api/x1/flows/:id', (req, res) => res.json({ ok: deleteX1Flow(req.params.id) }));

/* ---- Upload de mídia ---- */
app.post('/api/x1/flow-media', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo.' });
  res.json({ media_path: req.file.path, mime: req.file.mimetype, file_name: req.file.originalname, media_url: '/api/x1/flow-media/view?path=' + encodeURIComponent(req.file.path) });
});
// Serve a mídia do fluxo para pré-visualização (só arquivos dentro de UPLOADS_DIR).
app.get('/api/x1/flow-media/view', (req, res) => {
  const p = req.query.path ? path.resolve(String(req.query.path)) : '';
  if (!p || !p.startsWith(path.resolve(UPLOADS_DIR))) return res.status(400).end();
  res.sendFile(p, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

/* ---- Configurações ---- */
app.get('/api/x1/settings', (req, res) => res.json(getX1Settings()));
app.post('/api/x1/settings', (req, res) => {
  const patch = {};
  ['welcome_flow_id', 'default_flow_id', 'default_flow_timeout_hours', 'ended_flow_id'].forEach(k => { if (k in req.body) patch[k] = req.body[k]; });
  res.json(setX1Settings(patch));
});
app.post('/api/x1/settings/keywords', (req, res) => res.json(setX1KeywordTriggers(req.body.triggers || [])));

// Handlers globais: um erro não tratado NÃO deve derrubar o processo (se cair,
// o container reinicia e, sem volume persistente, o histórico some).
process.on('uncaughtException', (e) => console.error('[GoX1] uncaughtException:', e?.message || e));
process.on('unhandledRejection', (e) => console.error('[GoX1] unhandledRejection:', e?.message || e));
// No redeploy o easypanel manda SIGTERM: grava tudo antes de sair.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { try { flushSync(); console.log(`[GoX1] ${sig}: dados gravados, encerrando.`); } catch {} process.exit(0); });
}

startX1Engine();
app.listen(PORT, () => {
  const nConvs = (listConversations() || []).length;
  console.log(`GoX1 v${PKG.version} rodando na porta ${PORT}`);
  console.log(`[GoX1] DATA_DIR = ${DATA_DIR_PATH}`);
  console.log(`[GoX1] Carregado do disco: ${nConvs} conversas, ${listX1Flows().length} fluxos.`);
  console.log('[GoX1] Se esse número zera a cada redeploy, o /app/data NÃO está num volume persistente do easypanel.');
});
