import fs from 'node:fs';
import {
  getConfig, getX1Settings, getX1DeviceTriggers, upsertContact, getContact, getConversation, appendMessage,
  listX1Flows, getX1Flow, ensureX1Run, getX1Run, listX1Runs, advanceX1Contact, setX1ContactWaiting, updateX1Run, getX1Wait, listX1ReplyWaits, clearX1Run,
  enqueueX1Send, dequeueX1Send, listX1QueueDevices, markX1Sent, getX1LastSentAt,
  addContactTag, removeContactTag, setContactFields, setContactField, getContactField, saveContactReply, incrementX1NodeCount, getX1NodeCounts,
  setContactQuoteKey, takeContactQuoteKey, getX1Pixel, wasMessageSeen, markMessageSeen
} from './db.js';
import { sendText, sendMedia, sendAudio, getBase64FromMediaMessage, sendReaction, setPresence, connectionState } from './evolution.js';
import { openaiChat, imageContent, pdfContent, extractJson } from './openai.js';
import { sendPixelEvent } from './meta.js';

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function spintax(text) {
  if (!text) return '';
  let out = text, guard = 0; const re = /\{([^{}]*)\}/;
  while (re.test(out) && guard++ < 30) out = out.replace(re, (_, inner) => pick(inner.split('|')));
  return out;
}

// Substitui {campo} pelos dados do contato: {name}, {number}, {jid} e qualquer
// campo customizado em contact.fields (ex.: {comprovante.valor}). Placeholder
// sem valor vira string vazia. Usado em notificação e webhook.
function interpolate(str, contact) {
  if (!str) return '';
  return String(str).replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, key) => {
    if (key === 'name') return contact?.name || '';
    if (key === 'number' || key === 'phone') return (contact?.jid || '').split('@')[0];
    if (key === 'jid') return contact?.jid || '';
    const v = contact?.fields ? contact.fields[key] : undefined;
    return v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
}
function digitsToJid(numberRaw) {
  const d = String(numberRaw || '').replace(/\D/g, '');
  return d ? `${d}@s.whatsapp.net` : null;
}

// Extrai o texto de uma mensagem do payload da Evolution — cobre os
// formatos mais comuns (texto simples, texto estendido, legendas de
// mídia). Mensagens sem texto retornam string vazia.
function extractText(message) {
  if (!message) return '';
  return message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || message.videoMessage?.caption || '';
}

// Dedup por id de mensagem — persistido no disco (ver db.js: wasMessageSeen /
// markMessageSeen). Precisa sobreviver a reinícios do processo: a Evolution
// reenvia webhooks que falharam antes (retry), e se a dedup fosse só em
// memória, um restart fazia essas entregas atrasadas parecerem mensagens
// novas de novo, re-disparando o fluxo do zero pro mesmo contato.
function alreadySeen(id) {
  if (!id) return false;
  if (wasMessageSeen(id)) return true;
  markMessageSeen(id);
  return false;
}

// Processa um payload de webhook MESSAGES_UPSERT. Ignora mensagens enviadas
// por nós mesmos (fromMe), de grupos (@g.us — o X1 é só conversas 1:1),
// JIDs não resolvíveis (@lid) e duplicadas. Decide o que fazer com a
// mensagem do contato: contar como resposta de um wait_reply em andamento,
// ou disparar um gatilho (palavra-chave > boas-vindas > resposta padrão).
export function handleIncomingMessage(instanceName, data) {
  if (!data || !data.key) return;
  const { remoteJid, fromMe, id: messageId } = data.key;
  if (fromMe) return;
  if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@lid')) return;
  if (alreadySeen(messageId)) return;

  const text = extractText(data.message);
  const pushName = data.pushName || null;

  const isNewContact = !getContact(remoteJid);
  const patch = pushName ? { name: pushName } : {};
  // Guarda a chave da última mídia recebida (imagem/vídeo/documento/áudio) —
  // será usada pelo bloco de IA para baixar e analisar (ex.: comprovante PIX).
  const mediaTypes = ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'documentWithCaptionMessage'];
  const hasMedia = data.message && mediaTypes.some((k) => data.message[k]);
  if (hasMedia) patch.last_media = { key: data.key, messageType: data.messageType || null, device: instanceName, t: Date.now() };
  // CTWA (clique-para-WhatsApp): guarda o ctwa_clid do anúncio, se vier no
  // referral, para atribuição do pixel via Conversions API.
  const ctx = (data.message && (data.message.extendedTextMessage?.contextInfo || data.message.imageMessage?.contextInfo)) || data.contextInfo || {};
  const clid = ctx?.externalAdReply?.ctwaClid || data.message?.ctwaClid || data.ctwaClid || data.key?.ctwaClid;
  if (clid) patch.ctwa_clid = clid;
  upsertContact(remoteJid, patch);
  // Registra a conversa já atribuída ao dispositivo que RECEBEU a mensagem,
  // para o filtro por dispositivo no chat ao vivo funcionar corretamente.
  appendMessage(remoteJid, { id: messageId, fromMe: false, text, kind: data.messageType || 'text', device: instanceName });

  // se o contato está parado num 'wait_reply', isso conta como resposta —
  // tem prioridade sobre qualquer gatilho novo, pois o fluxo já está em
  // andamento esperando exatamente isso.
  const run = getX1Run(remoteJid);
  if (run) {
    const flow = getX1Flow(run.flow_id);
    if (flow && flow.active === false) return; // fluxo pausado: registra a mensagem, mas não avança
    const replyNodes = flow ? listX1ReplyWaits(run, flow) : [];
    if (flow && replyNodes.length) {
      const val = text && text.trim() ? text : `[${(data.messageType || 'mídia').replace('Message', '')}]`;
      let buffered = false;
      for (const nid of replyNodes) {
        const wnode = (flow.steps || []).find((s) => s.id === nid);
        // "Só aceita mídia": um "ok"/"blz" mandado antes do arquivo de verdade
        // não conta como resposta — ignora essa mensagem inteira pra este node
        // (nem reage, nem cita, nem salva) e continua esperando a mídia.
        if (wnode && wnode.require_media && !hasMedia) continue;
        if (wnode && wnode.react_on_reply && data.key && data.key.id) {
          sendReaction(getConfig(), instanceName, remoteJid, data.key.id, false, pick(['👍', '❤️', '🙏', '✅', '🔥'])).catch(() => {});
        }
        if (wnode && wnode.quote_reply && data.key) setContactQuoteKey(remoteJid, data.key);
        if (wnode && wnode.buffer_enabled) {
          const buffers = { ...(run.buffers || {}) };
          const prev = buffers[nid]?.text || run.reply_buffer || '';
          buffers[nid] = { text: (prev ? prev + ' ' : '') + val, until: Date.now() + (Number(wnode.buffer_seconds) || 8) * 1000 };
          updateX1Run(remoteJid, { buffers, reply_buffer: null, buffer_until: null });
          buffered = true;
          continue; // este node avança quando o buffer fechar (no scan)
        }
        if (wnode && wnode.save_field) saveContactReply(remoteJid, wnode.save_field, val, { kind: data.messageType || 'text', has_media: hasMedia });
        advanceX1Contact(remoteJid, nid, flow, 'replied');
      }
      if (replyNodes.length || buffered) return;
    }
  }

  // Disparos por dispositivo: cada número tem seus próprios gatilhos. Se o
  // dispositivo não tem config, nada dispara (chips em aquecimento ficam de fora).
  const dt = getX1DeviceTriggers(instanceName);
  let flowId = null;

  const keywordMatch = (dt.keyword_triggers || []).find((t) => {
    const v = (t.value || '').trim().toLowerCase(); if (!v) return false;
    const tx = text.toLowerCase();
    return t.match === 'equals' ? tx === v : tx.includes(v);
  });
  if (keywordMatch) flowId = keywordMatch.flow_id;
  else if (isNewContact && dt.welcome_flow_id) flowId = dt.welcome_flow_id;
  else if (!run && dt.default_flow_id) flowId = dt.default_flow_id;

  if (!flowId) return; // sem gatilho aplicável e não está em wait_reply — fica só registrado na conversa
  const flow = getX1Flow(flowId);
  if (!flow || !flow.start_next) return;
  if (flow.active === false) return; // fluxo pausado não dispara para novos leads

  ensureX1Run(remoteJid, flowId, flow.start_next);
}

function stepById(flow, nodeId) {
  if (!nodeId || nodeId === 'start') return null;
  return (flow.steps || []).find((s) => s.id === nodeId) || null;
}

// Tempo máximo do "aguarda resposta" em minutos (valor + unidade, com
// compatibilidade com timeout_minutes antigo).
function waitTimeoutMinutes(step) {
  if (step.timeout_value != null && step.timeout_value !== '') {
    const v = Number(step.timeout_value) || 30;
    const mult = { min: 1, hora: 60, dia: 1440 }[step.timeout_unit] || 1;
    return Math.max(1, v * mult);
  }
  return Number(step.timeout_minutes) || 30;
}

function timerTargetX1(step) {
  if (step.mode === 'window') return nextWindowTarget(step);
  const mult = { min: 60000, hora: 3600000, dia: 86400000 }[step.unit] || 60000;
  const lo = Number(step.value) || 0, hi = step.value_to != null && step.value_to !== '' ? Number(step.value_to) : lo;
  const m = rand(Math.min(lo, hi), Math.max(lo, hi));
  return Date.now() + m * mult;
}

// Calcula o instante (UTC) de um horário sorteado dentro de uma janela, em
// horário de Brasília (-3). Ex.: janela 07:00–09:00 → segura o contato até um
// horário aleatório entre 7h e 9h do próximo dia (ou do dia atual se a janela
// ainda não passou e "next_day" estiver desligado). O aleatório dentro da
// janela evita disparar todo mundo no mesmo minuto.
function nextWindowTarget(step) {
  const OFF = -180; // minutos do fuso de Brasília
  const parse = (s, def) => { const [h, m] = String(s || def).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const startMin = parse(step.window_from, '07:00');
  let endMin = parse(step.window_to, step.window_from || '09:00');
  if (endMin < startMin) endMin = startMin; // janela inválida vira instante fixo
  const nowUtc = Date.now();
  const br = new Date(nowUtc + OFF * 60000); // "agora" em BRT lido via getUTC*
  const y = br.getUTCFullYear(), mo = br.getUTCMonth(), d = br.getUTCDate();
  const nowMin = br.getUTCHours() * 60 + br.getUTCMinutes();
  const dayAdd = (nowMin >= endMin || step.next_day) ? 1 : 0;
  const rndMin = startMin + Math.floor(Math.random() * (endMin - startMin + 1));
  const targetBrWall = Date.UTC(y, mo, d + dayAdd) + rndMin * 60000;
  let targetUtc = targetBrWall - OFF * 60000;
  if (targetUtc < nowUtc + 30000) targetUtc = nowUtc + 60000;
  return targetUtc;
}

// Resolve o valor de um campo do contato: name/number/jid, etiquetas ou
// qualquer campo customizado (ex.: comprovante.valor, ai.response).
function resolveField(contact, field) {
  if (!field) return undefined;
  if (field === 'name') return contact.name || '';
  if (field === 'number' || field === 'phone') return (contact.jid || '').split('@')[0];
  if (field === 'jid') return contact.jid || '';
  return contact.fields ? contact.fields[field] : undefined;
}
function toNum(v) {
  if (v == null) return NaN;
  // aceita "R$ 1.234,56" / "1234.56" / "1,50"
  const s = String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(s); return n;
}
// Normaliza o messageType bruto da Evolution (imageMessage, videoMessage...)
// para os 5 tipos que o condicional oferece, igual ao "Tipo" do Leona.
function normalizeMsgKind(kind) {
  switch (kind) {
    case 'imageMessage': return 'imagem';
    case 'videoMessage': return 'video';
    case 'documentMessage': case 'documentWithCaptionMessage': return 'documento';
    case 'audioMessage': return 'audio';
    default: return 'texto'; // conversation, extendedTextMessage, buffer, etc.
  }
}
// Tipo da ÚLTIMA resposta salva nesse campo (olha o field_history, que guarda
// o "kind" de cada gravação). Sem histórico = trata como texto.
function resolveFieldType(contact, field) {
  const hist = contact.field_history && contact.field_history[field];
  if (!hist || !hist.length) return 'texto';
  return normalizeMsgKind(hist[hist.length - 1].kind);
}
function evalOne(contact, cond) {
  if (!cond || !cond.op) return false;
  if (cond.field === '__tag') {
    const has = (contact.tags || []).includes(cond.value);
    return cond.op === 'not_has' ? !has : has;
  }
  // "Tipo de resposta": compara o tipo da última mensagem salva nesse campo
  // (texto/imagem/vídeo/documento/áudio), igual ao seletor "Tipo" do Leona.
  if (cond.op === 'type_is' || cond.op === 'not_type_is') {
    const t = resolveFieldType(contact, cond.field);
    const match = t === String(cond.value || '').toLowerCase().trim();
    return cond.op === 'not_type_is' ? !match : match;
  }
  const raw = resolveField(contact, cond.field);
  const a = String(raw ?? '').toLowerCase().trim();
  const b = String(cond.value ?? '').toLowerCase().trim();
  switch (cond.op) {
    case 'exists': return raw != null && String(raw).trim() !== '';
    case 'not_exists': return raw == null || String(raw).trim() === '';
    case 'equals': return a === b;
    case 'not_equals': return a !== b;
    case 'contains': return a.includes(b);
    case 'not_contains': return !a.includes(b);
    case 'gt': return toNum(raw) > toNum(cond.value);
    case 'lt': return toNum(raw) < toNum(cond.value);
    case 'gte': return toNum(raw) >= toNum(cond.value);
    case 'lte': return toNum(raw) <= toNum(cond.value);
    default: return false;
  }
}
// Resolve a condição de um node 'condition' contra o contato atual. Suporta o
// formato novo (várias condições com lógica todas/qualquer) e o antigo
// (has_tag/not_has_tag).
function evalCondition(step, contact) {
  if (Array.isArray(step.conditions) && step.conditions.length) {
    const results = step.conditions.map((c) => evalOne(contact, c));
    return step.logic === 'any' ? results.some(Boolean) : results.every(Boolean);
  }
  if (step.check === 'has_tag') return (contact.tags || []).includes(step.tag);
  if (step.check === 'not_has_tag') return !(contact.tags || []).includes(step.tag);
  return false;
}

// Varre todos os contatos com run ativa e processa o que estiver na
// frontier de cada um: timer (espera ou timeout do wait_reply), condition,
// tag, distributor (fan-out simples) e mensagem (enfileira para envio).
function scanX1Contacts() {
  const flowMap = new Map(listX1Flows().map((f) => [f.id, f]));
  for (const run of listX1Runs()) {
    const flow = flowMap.get(run.flow_id);
    if (!flow) { clearX1Run(run.jid); continue; } // fluxo apagado: encerra o run órfão
    if (flow.active === false) continue;
    const jid = run.jid;

    for (const nodeId of [...run.frontier]) {
      if (typeof nodeId !== 'string') { run.frontier = run.frontier.filter((x) => x !== nodeId); if (!run.frontier.length) advanceX1Contact(jid, '__cleanup__', flow); continue; }
      if (run.done[nodeId]) continue;
      try {
      const step = stepById(flow, nodeId);
      if (!step) { advanceX1Contact(jid, nodeId, flow); continue; }

      if (step.type === 'timer') {
        const w = getX1Wait(run, nodeId);
        if (w && w.mode === 'timer') {
          if (Date.now() >= w.wake_at) advanceX1Contact(jid, nodeId, flow);
        } else {
          setX1ContactWaiting(jid, nodeId, timerTargetX1(step), 'timer');
        }
        continue;
      }

      if (step.type === 'wait_reply') {
        const w = getX1Wait(run, nodeId);
        if (w && w.mode === 'reply') {
          const buf = (run.buffers || {})[nodeId] || (run.buffer_until ? { text: run.reply_buffer, until: run.buffer_until } : null);
          if (buf) {
            // Buffer ativo: quando o tempo entre mensagens passa, salva o texto
            // acumulado e avança (por node — ramos paralelos não se misturam).
            if (Date.now() >= buf.until) {
              if (step.save_field && buf.text != null) saveContactReply(jid, step.save_field, buf.text, { kind: 'buffer' });
              const buffers = { ...(run.buffers || {}) }; delete buffers[nodeId];
              updateX1Run(jid, { buffers, reply_buffer: null, buffer_until: null });
              advanceX1Contact(jid, nodeId, flow, 'replied');
            }
          } else if (!step.wait_forever && Date.now() >= w.wake_at) {
            advanceX1Contact(jid, nodeId, flow, 'timeout');
          }
        } else {
          setX1ContactWaiting(jid, nodeId, Date.now() + waitTimeoutMinutes(step) * 60000, 'reply');
        }
        continue;
      }

      if (step.type === 'condition') {
        const contact = getContact(jid);
        if (!contact) { advanceX1Contact(jid, nodeId, flow, 'else'); continue; }
        const outcome = evalCondition(step, contact) ? 'then' : 'else';
        advanceX1Contact(jid, nodeId, flow, outcome);
        continue;
      }

      if (step.type === 'tag') {
        if (step.action === 'remove') removeContactTag(jid, step.tag);
        else addContactTag(jid, step.tag);
        advanceX1Contact(jid, nodeId, flow);
        continue;
      }

      if (step.type === 'distributor' || step.type === 'trigger') {
        if (step.type === 'distributor') {
          // Revezamento: cada passagem pelo Distribuidor manda o lead por UM
          // caminho só, alternando em sequência (lead 1 → caminho A, lead 2 →
          // caminho B, lead 3 → caminho A de novo...). O contador já persistido
          // (usado para mostrar "N por caminho" no editor) também serve de
          // índice de rodízio — pega o valor ANTES de incrementar.
          const countBefore = (getX1NodeCounts(flow.id) || {})[nodeId] || 0;
          incrementX1NodeCount(flow.id, nodeId);
          advanceX1Contact(jid, nodeId, flow, undefined, countBefore);
        } else {
          advanceX1Contact(jid, nodeId, flow);
        }
        continue;
      }

      // Nodes assíncronos (notificação, webhook, IA, pixel) são tratados por
      // processX1AsyncNodes — aqui apenas não caem no envio de mensagem.
      if (step.type === 'notify' || step.type === 'webhook' || step.type === 'ai' || step.type === 'pixel') {
        continue;
      }

      // message: enfileira para a fila de envio. Usa o dispositivo da CONVERSA
      // (o número que o lead chamou) como principal.
      const conv = getConversation(jid);
      const device = step.device || (conv && conv.device) || flow.device || getConfig().notify_device || '';
      if (!device) { console.warn(`[GoX1] node ${nodeId} (${jid}): sem dispositivo para enviar — a conversa não tem device e nenhum fallback configurado.`); continue; }
      enqueueX1Send(jid, nodeId, device);
      } catch (e) {
        console.error(`[GoX1] erro processando node ${nodeId} (${jid}) do fluxo ${run.flow_id}: ${e?.message || e}`);
        advanceX1Contact(jid, nodeId, flow); // não trava o contato neste node
      }
    }
  }
}

// Processa um item da fila de envio de UM dispositivo por tick, respeitando
// o throttle anti-bloqueio desde o último envio DAQUELE dispositivo
// especificamente — diferente do Gogrupo/GoFire, aqui cada device tem seu
// próprio ritmo porque cada conversa é independente e pode ter um device
// só seu, sem disputar fila com os outros.
function readMediaBase64(p) { try { return fs.readFileSync(p).toString('base64'); } catch { return null; } }

// Reenvia até 2 vezes (backoff curto) antes de desistir. A maioria das
// falhas de envio são soluços passageiros da Evolution/WhatsApp (timeout,
// conexão instável) — sem isso, qualquer soluço fazia o bloco simplesmente
// sumir (log de erro e segue em frente, sem tentar de novo).
async function sendWithRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (attempt < 3) { console.warn(`[GoX1] ${label}: tentativa ${attempt} falhou (${e?.message || e}), tentando de novo…`); await sleep(1200 * attempt); }
    }
  }
  throw lastErr;
}

// Mostra "digitando/gravando" por alguns segundos SEM depender do delay da
// Evolution (que às vezes mostra a presença mas não entrega a mensagem).
async function showPresence(config, device, jid, kind, ms) {
  try { await setPresence(config, device, jid, kind === 'audio' ? 'recording' : 'composing'); } catch {}
  await sleep(Math.max(300, ms));
  try { await setPresence(config, device, jid, 'paused'); } catch {}
}

async function processX1Queue(config) {
  for (const device of listX1QueueDevices()) {
    const minGapMs = rand(3, 10) * 1000; // conversas individuais toleram ritmo mais rápido que disparo em massa
    if (Date.now() - getX1LastSentAt(device) < minGapMs) continue;

    const item = dequeueX1Send(device);
    if (!item) continue;
    // Resolve o fluxo PELO RUN do contato (não por busca de node — fluxos
    // duplicados podiam ter nodes com o mesmo id e apontar pro fluxo errado).
    const curRun = getX1Run(item.jid);
    const flow = curRun ? getX1Flow(curRun.flow_id) : null;
    const step = flow ? stepById(flow, item.node_id) : null;
    if (!curRun || !flow || !step) continue; // run terminou/fluxo mudou: descarta
    if (flow.active === false) continue; // fluxo pausado: segura o envio
    if (curRun.done[item.node_id]) continue; // já concluído: item obsoleto
    // Conexão do aparelho: só ADIA se estiver EXPLICITAMENTE desconectado.
    // Estado desconhecido/ambíguo NÃO bloqueia (fail-open) — no v23 um formato
    // de resposta diferente da Evolution virava "unknown" e adiava pra sempre.
    try {
      const st = String(await connectionState(config, device)).toLowerCase();
      const DISC = new Set(['close', 'closed', 'connecting', 'disconnected', 'refused', 'unpaired', 'logout', 'logged_out']);
      if (DISC.has(st)) {
        console.warn(`[GoX1] ${device} desconectado (${st}) — envio adiado.`);
        enqueueX1Send(item.jid, item.node_id, device);
        markX1Sent(device, Date.now());
        continue;
      }
      if (st !== 'open' && st !== 'connected') console.warn(`[GoX1] estado de conexão ambíguo de ${device}: "${st}" — enviando mesmo assim.`);
    } catch { /* estado indisponível: tenta mesmo assim */ }

    try {
      const blocks = step.blocks || [];
      const gMin = Number(step.gap_min ?? 0), gMax = Number(step.gap_max ?? 0);
      // Se o "aguarda resposta" pediu para citar a mensagem do lead, o primeiro
      // envio deste node vai como resposta (quoted) a ela.
      let quoteKey = takeContactQuoteKey(item.jid);
      let anyFailed = false;
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        if (b.kind === 'delay') {
          const lo = Number(b.delay_min ?? 0), hi = Number(b.delay_max ?? lo);
          await sleep(rand(Math.min(lo, hi), Math.max(lo, hi)) * 1000);
          continue;
        }
        const dMin = Number(b.delay_min ?? 0), dMax = Number(b.delay_max ?? 0);
        const presenceMs = (dMin || dMax)
          ? rand(Math.min(dMin, dMax), Math.max(dMin, dMax)) * 1000
          : (b.kind === 'text' ? rand(1, 3) * 1000 : b.kind === 'audio' ? rand(2, 5) * 1000 : 800);
        const quoted = quoteKey ? { key: quoteKey } : undefined; quoteKey = null;
        let sentOk = false;
        try {
          let resp = null;
          if (b.kind === 'text') {
            const text = spintax(pick(b.variants || ['']));
            await showPresence(config, device, item.jid, 'text', presenceMs);
            resp = await sendWithRetry(() => sendText(config, device, item.jid, text, { quoted, linkPreview: b.link_preview === false ? false : undefined }), `texto → ${item.jid}`);
            appendMessage(item.jid, { fromMe: true, text, kind: 'text', device });
          } else if (b.kind === 'audio' && b.media_path) {
            const media = readMediaBase64(b.media_path);
            if (!media) { console.warn(`[GoX1] áudio ausente (${b.media_path}) — bloco pulado.`); continue; }
            await showPresence(config, device, item.jid, 'audio', presenceMs);
            if (b.ptt === false) resp = await sendWithRetry(() => sendMedia(config, device, item.jid, { mediatype: 'audio', mimetype: b.mime, media, fileName: b.file_name, viewOnce: !!b.view_once }, {}), `áudio → ${item.jid}`);
            else resp = await sendWithRetry(() => sendAudio(config, device, item.jid, media, { viewOnce: !!b.view_once }), `áudio → ${item.jid}`);
            appendMessage(item.jid, { fromMe: true, text: '[áudio]', kind: 'audio', device });
          } else if ((b.kind === 'image' || b.kind === 'video') && b.media_path) {
            const media = readMediaBase64(b.media_path);
            if (!media) { console.warn(`[GoX1] ${b.kind} ausente (${b.media_path}) — bloco pulado.`); continue; }
            await showPresence(config, device, item.jid, 'text', presenceMs);
            resp = await sendWithRetry(() => sendMedia(config, device, item.jid, { mediatype: b.kind, mimetype: b.mime, media, fileName: b.file_name, caption: spintax(b.caption || ''), viewOnce: !!b.view_once }, {}), `${b.kind} → ${item.jid}`);
            appendMessage(item.jid, { fromMe: true, text: b.caption ? spintax(b.caption) : `[${b.kind === 'image' ? 'foto' : 'vídeo'}]`, kind: b.kind, device });
          }
          sentOk = true;
          const mid = resp?.key?.id || resp?.messageId || '?';
          console.log(`[GoX1] bloco ${b.kind} enviado → ${item.jid} via ${device} (id ${mid})`);
        } catch (be) {
          anyFailed = true;
          console.error(`[GoX1] FALHA no bloco ${b.kind} → ${item.jid} via ${device} (depois de 3 tentativas): ${be?.message || be}`);
        }
        // Intervalo mínimo depois de mídia (áudio/foto/vídeo): a Evolution
        // aceita a chamada e devolve antes do WhatsApp terminar de subir o
        // arquivo — sem essa folga, um texto mandado logo em seguida podia
        // chegar no aparelho do lead ANTES da mídia, fora de ordem. Só se
        // aplica quando o node não tem um gap próprio configurado maior.
        if (sentOk && b.kind !== 'text' && b.kind !== 'delay') {
          const minMediaGapMs = rand(1200, 2200);
          if (!(gMin || gMax) || (Math.max(gMin, gMax) * 1000) < minMediaGapMs) await sleep(minMediaGapMs);
        }
        if (bi < blocks.length - 1 && (gMin || gMax)) {
          await sleep(rand(Math.min(gMin, gMax), Math.max(gMin, gMax)) * 1000);
        }
      }
      // Falha visível: marca o contato pra você achar na hora, sem precisar
      // vasculhar log — some se um envio seguinte no mesmo contato for bem.
      if (anyFailed) addContactTag(item.jid, 'Falha de envio');
      else if ((getContact(item.jid)?.tags || []).includes('Falha de envio')) removeContactTag(item.jid, 'Falha de envio');
      markX1Sent(device, Date.now());
      advanceX1Contact(item.jid, item.node_id, flow);
    } catch (e) {
      markX1Sent(device, Date.now());
      console.error(`[GoX1] FALHA ao enviar node ${item.node_id} → ${item.jid} via ${device}: ${e?.message || e}`);
    }
  }
}

let running = false;

// Evita processar o mesmo node assíncrono duas vezes enquanto a 1ª execução
// ainda está em andamento (o advance só ocorre ao terminar).
const asyncInFlight = new Set();

// Processa nodes assíncronos na frontier de cada contato: notificação (manda
// mensagem para um número fixo) e webhook (POST para uma URL, ex.: Supabase).
async function processX1AsyncNodes(config) {
  const flowMap = new Map(listX1Flows().map((f) => [f.id, f]));
  for (const run of listX1Runs()) {
    const flow = flowMap.get(run.flow_id);
    if (!flow || flow.active === false) continue;
    const jid = run.jid;
    for (const nodeId of [...run.frontier]) {
      if (run.done[nodeId]) continue;
      const step = stepById(flow, nodeId);
      if (!step) continue;
      if (step.type !== 'notify' && step.type !== 'webhook' && step.type !== 'ai' && step.type !== 'pixel') continue;
      const guardKey = `${jid}:${nodeId}`;
      if (asyncInFlight.has(guardKey)) continue;
      asyncInFlight.add(guardKey);
      try {
        const contact = getContact(jid) || { jid };
        if (step.type === 'notify') { await runNotifyNode(config, flow, step, contact); advanceX1Contact(jid, nodeId, flow); }
        else if (step.type === 'webhook') { await runWebhookNode(step, contact, jid); advanceX1Contact(jid, nodeId, flow); }
        else if (step.type === 'ai') { const outcome = await runAiNode(config, step, contact, jid); advanceX1Contact(jid, nodeId, flow, outcome); }
        else if (step.type === 'pixel') { const outcome = await runPixelNode(step, contact, jid); advanceX1Contact(jid, nodeId, flow, outcome); }
      } catch (e) {
        // Falha não deve travar o contato — segue o fluxo mesmo assim.
        advanceX1Contact(jid, nodeId, flow, (step.type === 'ai' || step.type === 'pixel') ? 'fail' : undefined);
      } finally { asyncInFlight.delete(guardKey); }
    }
  }
}

// Notificação: o dispositivo do fluxo manda uma mensagem para um número fixo
// definido no node (ex.: avisar o dono que um comprovante chegou).
async function runNotifyNode(config, flow, step, contact) {
  const conv = getConversation(contact.jid);
  const device = step.device || (conv && conv.device) || flow.device || getConfig().notify_device || '';
  const targetJid = digitsToJid(step.number);
  if (!device || !targetJid) return;
  const text = interpolate(step.text || '', contact);
  if (!text.trim()) return;
  await sendText(config, device, targetJid, text, { delay: rand(500, 1200) });
}

// Webhook: POST para a URL definida (ex.: Supabase). Envia o número do contato
// e os campos escolhidos. Se o node tiver "salvar resposta em", grava campos da
// resposta JSON no contato.
async function runWebhookNode(step, contact, jid) {
  if (!step.url) return;
  const method = (step.method || 'POST').toUpperCase();
  // Corpo: começa com número/nome do contato e junta os campos extras do node.
  const body = {
    number: (contact.jid || jid || '').split('@')[0],
    name: contact.name || null,
    jid: contact.jid || jid,
    ...(contact.fields || {})
  };
  // Campos extras/custom definidos no node (com interpolação de {campo}).
  for (const kv of (step.payload || [])) {
    if (kv && kv.key) body[kv.key] = interpolate(kv.value ?? '', contact);
  }
  const headers = { 'Content-Type': 'application/json' };
  for (const h of (step.headers || [])) { if (h && h.key) headers[h.key] = interpolate(h.value ?? '', contact); }

  const res = await fetch(step.url, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(body)
  });
  // Se pedido, salva campos da resposta JSON no contato (ex.: status de acesso).
  if (step.save_response) {
    try {
      const txt = await res.text();
      let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
      if (data && typeof data === 'object') {
        const prefix = step.save_prefix ? String(step.save_prefix) : 'webhook';
        const flat = {};
        for (const [k, v] of Object.entries(data)) flat[`${prefix}.${k}`] = v;
        setContactFields(jid, flat);
      }
    } catch { /* resposta não-JSON: ignora */ }
  }
}

// Bloco de IA: usa a OpenAI para (a) ler comprovante de PIX numa imagem
// recebida e extrair os dados em campos (comprovante.valor, .banco, etc.), e/ou
// (b) responder/classificar a partir do texto. A resposta bruta vai para um
// campo (padrão ai.response) e a saída segue para o condicional avaliar.
async function runAiNode(config, step, contact, jid) {
  const apiKey = config.openai_key;
  const model = step.model || 'gpt-4.1';
  const saveField = step.save_field || 'ai.response';
  const prefix = step.receipt_prefix || 'comprovante';
  try {
    if (!apiKey) { setContactField(jid, 'ai.erro', 'Chave da OpenAI não configurada.'); return 'fail'; }

    const userContent = [];

    // Anexa a mídia do comprovante (imagem OU PDF), conforme o tipo recebido.
    let attachedMedia = false;
    const media = contact.last_media;
    if ((step.identify_receipt || step.understand_image || step.understand_pdf) && media && media.key) {
      const instance = media.device || step.device || (getConfig().notify_device || '');
      if (instance) {
        try {
          const { base64, mimetype } = await getBase64FromMediaMessage(config, instance, media.key);
          if (base64) {
            const isPdf = (mimetype && mimetype.toLowerCase().includes('pdf')) || media.messageType === 'documentMessage' || media.messageType === 'documentWithCaptionMessage';
            if (isPdf && (step.understand_pdf || step.identify_receipt)) { userContent.push(pdfContent(base64, 'comprovante.pdf')); attachedMedia = true; }
            else if (!isPdf && (step.understand_image || step.identify_receipt)) { userContent.push(imageContent(base64, mimetype)); attachedMedia = true; }
          }
        } catch (e) { /* segue sem a mídia */ }
      }
    }

    // Texto enviado ao modelo (interpolado). Se vazio, usa uma instrução padrão.
    const inputText = interpolate(step.input_text || '', contact).trim();
    let instruction = inputText;
    const wantJson = !!step.identify_receipt;
    if (wantJson) {
      instruction = (inputText ? inputText + '\n\n' : '') +
        'Analise o comprovante de pagamento PIX (na imagem ou PDF em anexo) e responda APENAS um JSON com os campos: ' +
        'tipo (imagem/documento/desconhecido), valor (número, sem R$), banco, chave_pix, data, ' +
        'nome_pagador, nome_recebedor, doc_pagador, doc_recebedor. Use null quando não encontrar.';
    } else if (!instruction) {
      instruction = 'Responda de forma curta e objetiva à última mensagem do cliente.';
    }
    userContent.push({ type: 'text', text: instruction });

    const messages = [];
    const systemPrompt = (step.prompt && step.prompt.trim())
      ? step.prompt.trim()
      : 'Você é um assistente objetivo. Responda em português do Brasil.';
    messages.push({ role: 'system', content: systemPrompt + (wantJson ? ' Responda somente com JSON válido.' : '') });
    messages.push({ role: 'user', content: userContent });

    const answer = await openaiChat(apiKey, model, messages, { json: wantJson });

    // Salva a resposta bruta.
    setContactField(jid, saveField, answer);

    // Se for identificação de comprovante, extrai o JSON e grava nos campos
    // padrão (valor.pix, nome.pagador, etc.).
    if (wantJson) {
      const obj = extractJson(answer);
      if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) setContactField(jid, `${prefix}.${k}`, v);
        // Comprovante identificado (saída amarela) só se veio um valor plausível.
        const temValor = obj.valor != null && String(obj.valor).replace(/[^\d]/g, '') !== '';
        return temValor ? 'receipt' : 'ok';
      }
      setContactField(jid, 'ai.erro', 'Não consegui interpretar o comprovante.');
      return 'fail';
    }
    // Modo texto/intenção: ok se veio resposta.
    return answer && answer.trim() ? 'ok' : 'fail';
  } catch (e) {
    setContactField(jid, 'ai.erro', String(e.message || e).slice(0, 200));
    return 'fail';
  }
}

// Node de Pixel: dispara um evento (ex.: Compra) no pixel do Facebook via
// Conversions API. Valor e Page ID aceitam {campo} do contato.
async function runPixelNode(step, contact, jid) {
  const pixel = getX1Pixel(step.pixel_id);
  if (!pixel) { setContactField(jid, 'pixel.erro', 'Nenhum pixel selecionado/configurado.'); return 'fail'; }
  try {
    const value = interpolate(step.value || '', contact);
    const pageId = interpolate(step.page_id || '', contact);
    const phone = (contact.jid || jid || '').split('@')[0];
    await sendPixelEvent(pixel, {
      eventName: step.event_name || 'Purchase',
      pageId, value, currency: step.currency || 'BRL',
      phone, ctwaClid: contact.ctwa_clid
    });
    setContactField(jid, 'pixel.status', 'enviado');
    return 'ok';
  } catch (e) {
    setContactField(jid, 'pixel.erro', String(e.message || e).slice(0, 200));
    return 'fail';
  }
}

async function tick() {
  if (running) return; running = true;
  try {
    const config = getConfig();
    if (!config.evolution_url || !config.api_key) return;
    scanX1Contacts();
    await processX1AsyncNodes(config);
    await processX1Queue(config);
  } catch (e) { console.error('[GoX1] erro no tick do motor:', e?.message || e); /* não deve parar o motor */ }
  finally { running = false; }
}

export function startX1Engine() { setInterval(tick, 5000); tick(); }
// Processa um ciclo AGORA (usado ao disparar um fluxo manualmente, para não
// esperar os 5s do intervalo).
export function kickX1Engine() { tick().catch(() => {}); }
