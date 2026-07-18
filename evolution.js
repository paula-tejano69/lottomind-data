// Integração com a Evolution API v2 — multi-instância.
// Todas as chamadas usam a API key GLOBAL no header `apikey`.
// Nos grupos, o "number" é o JID do grupo (ex.: 12036xxxxx@g.us).

function headers(config) {
  return { 'Content-Type': 'application/json', apikey: config.api_key };
}

async function call(config, method, pathName, body) {
  const url = `${config.evolution_url}${pathName}`;
  const res = await fetch(url, {
    method,
    headers: headers(config),
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await res.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!res.ok) {
    const msg = typeof data === 'object' ? JSON.stringify(data) : String(data);
    throw new Error(`Evolution ${res.status}: ${msg}`);
  }
  return data;
}

/* ---------------- Instâncias (dispositivos) ---------------- */

export async function fetchInstances(config) {
  const data = await call(config, 'GET', '/instance/fetchInstances');
  const arr = Array.isArray(data) ? data : (data?.instances || []);
  return arr.map((it) => {
    const inst = it.instance || it;
    // tenta todos os campos possíveis onde a Evolution pode colocar o número
    const number = inst.number    || inst.owner      || inst.ownerJid  ||
                   inst.jid       || inst.wuid        || it.number      ||
                   it.owner       || it.ownerJid      || null;
    return {
      name: inst.instanceName || inst.name || it.name,
      state: inst.connectionStatus || inst.state || inst.status || 'unknown',
      profileName: inst.profileName || inst.profile_name || null,
      number: number ? String(number).split('@')[0] : null
    };
  }).filter((x) => x.name);
}

export async function createInstance(config, instanceName) {
  return call(config, 'POST', '/instance/create', {
    instanceName,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: true,
    groupsIgnore: false,
    rejectCall: false,
    alwaysOnline: false,
    readMessages: false,
    readStatus: false,
    syncFullHistory: false
  });
}

// Retorna o QR (base64) e/ou o código de pareamento.
export async function connectInstance(config, instanceName) {
  const data = await call(config, 'GET', `/instance/connect/${encodeURIComponent(instanceName)}`);
  return {
    base64: data?.base64 || data?.qrcode?.base64 || null,
    code: data?.code || data?.qrcode?.code || null,
    pairingCode: data?.pairingCode || data?.qrcode?.pairingCode || null,
    count: data?.count ?? data?.qrcode?.count ?? null
  };
}

export async function connectionState(config, instanceName) {
  const data = await call(config, 'GET', `/instance/connectionState/${encodeURIComponent(instanceName)}`);
  return data?.instance?.state || data?.instance?.status || data?.state || data?.status || 'unknown';
}

// Retorna o número (JID) do owner de uma instância — necessário para
// montar a lista de destinatários de status e para envio direto. A
// Evolution retorna isso em ownerJid (ex: "5511999999999@s.whatsapp.net")
// ou como campo number no payload da instância.
export async function fetchInstanceNumber(config, instanceName) {
  const data = await call(config, 'GET', `/instance/connectionState/${encodeURIComponent(instanceName)}`);
  // retorna objeto completo para diagnóstico — o caller loga os campos
  return data;
}

export async function logoutInstance(config, instanceName) {
  return call(config, 'DELETE', `/instance/logout/${encodeURIComponent(instanceName)}`);
}

export async function deleteInstance(config, instanceName) {
  return call(config, 'DELETE', `/instance/delete/${encodeURIComponent(instanceName)}`);
}

/* ---------------- Grupos ---------------- */

export async function listGroups(config, instance) {
  const data = await call(config, 'GET', `/group/fetchAllGroups/${encodeURIComponent(instance)}?getParticipants=false`);
  const arr = Array.isArray(data) ? data : (data?.groups || []);
  return arr.map((g) => ({
    jid: g.id || g.jid || g.remoteJid,
    name: g.subject || g.name || g.id,
    size: g.size ?? g.participants?.length ?? null
  })).filter((g) => g.jid && String(g.jid).endsWith('@g.us'));
}

export async function getParticipantNumbers(config, instance, groupJid) {
  try {
    const data = await call(config, 'GET', `/group/participants/${encodeURIComponent(instance)}?groupJid=${encodeURIComponent(groupJid)}`);
    const parts = data?.participants || data || [];
    return parts.map((p) => (typeof p === 'string' ? p : p.id || p.jid)).filter(Boolean).map((id) => String(id).split('@')[0]);
  } catch { return []; }
}

/* ---------------- Envio ---------------- */

function mentionFields(mentionAll, mentioned) {
  if (!mentionAll) return {};
  const f = { mentionsEveryOne: true };
  if (mentioned && mentioned.length) f.mentioned = mentioned;
  return f;
}

export async function sendText(config, instance, groupJid, text, { mentionAll, mentioned, delay, quoted, linkPreview } = {}) {
  return call(config, 'POST', `/message/sendText/${encodeURIComponent(instance)}`, {
    number: groupJid, text,
    ...(delay ? { delay } : {}),
    ...(quoted ? { quoted } : {}),
    // Evolution manda preview de link (imagem/título) por padrão quando o
    // texto tem uma URL. linkPreview:false desativa — útil quando o link é
    // só um detalhe da frase e o preview quebra o visual da mensagem.
    ...(linkPreview === false ? { linkPreview: false } : {}),
    ...mentionFields(mentionAll, mentioned)
  });
}

export async function sendMedia(config, instance, groupJid, { mediatype, mimetype, media, fileName, caption, viewOnce }, { mentionAll, mentioned, delay } = {}) {
  return call(config, 'POST', `/message/sendMedia/${encodeURIComponent(instance)}`, {
    number: groupJid, mediatype, mimetype, media, fileName,
    ...(caption ? { caption } : {}),
    ...(delay ? { delay } : {}),
    ...(viewOnce ? { viewOnce: true } : {}),
    ...mentionFields(mentionAll, mentioned)
  });
}

// `encoding: true` é o que faz a Evolution converter o arquivo recebido
// (qualquer formato: mp3, wav, m4a, ogg, mp4 etc.) para o codec/contêiner
// que o WhatsApp exige para uma mensagem de voz "gravada" (PTT — onda
// sonora com forma de microfone, em vez de anexo de arquivo comum). Sem
// esse campo, alguns formatos podem chegar como áudio "documento" normal,
// sem o visual/comportamento de nota de voz.
export async function sendAudio(config, instance, groupJid, audioBase64, { delay, viewOnce } = {}) {
  return call(config, 'POST', `/message/sendWhatsAppAudio/${encodeURIComponent(instance)}`, {
    number: groupJid, audio: audioBase64, encoding: true,
    ...(delay ? { delay } : {}),
    ...(viewOnce ? { viewOnce: true } : {})
  });
}

/* ---------------- GoFire (aquecimento) ---------------- */

// Entra num grupo a partir do código de convite (extraído da URL completa,
// ex.: "https://chat.whatsapp.com/ABC123..." -> "ABC123...").
export async function joinGroupByInvite(config, instance, inviteCode) {
  return call(config, 'GET', `/group/acceptInviteCode/${encodeURIComponent(instance)}?inviteCode=${encodeURIComponent(inviteCode)}`);
}
// Busca informações do grupo (incluindo o JID) a partir do código de
// convite, sem precisar ter entrado nele ainda — usado para descobrir o
// JID e então poder mandar mensagem lá depois de entrar.
export async function fetchGroupInviteInfo(config, instance, inviteCode) {
  const data = await call(config, 'GET', `/group/inviteInfo/${encodeURIComponent(instance)}?inviteCode=${encodeURIComponent(inviteCode)}`);
  return { jid: data?.id || data?.jid || data?.groupJid || null, name: data?.subject || data?.name || null };
}
export function extractInviteCode(urlOrCode) {
  const m = String(urlOrCode).match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
  return m ? m[1] : String(urlOrCode).trim();
}

// Posta um status de texto, visível para os JIDs informados (statusJidList
// não pode ficar vazio — algumas versões da Evolution travam a requisição
// indefinidamente nesse caso).
export async function sendStatusText(config, instance, text, statusJidList) {
  return call(config, 'POST', `/message/sendStatus/${encodeURIComponent(instance)}`, {
    type: 'text', content: text, backgroundColor: '#075E54', font: 1,
    allContacts: false, statusJidList
  });
}

// Posta um status com foto ou vídeo (reaproveita os mesmos arquivos usados
// para envio direto). `content` aqui é a mídia em base64.
export async function sendStatusMedia(config, instance, type, mediaBase64, caption, statusJidList) {
  return call(config, 'POST', `/message/sendStatus/${encodeURIComponent(instance)}`, {
    type, content: mediaBase64, caption: caption || '',
    allContacts: false, statusJidList
  });
}

// Reage com um emoji a uma mensagem já existente na conversa. Exige o id
// da mensagem original — não pode ser inventado, por isso o motor guarda
// um histórico curto de mensagens trocadas entre cada par de devices.
export async function sendReaction(config, instance, remoteJid, messageId, fromMe, emoji) {
  return call(config, 'POST', `/message/sendReaction/${encodeURIComponent(instance)}`, {
    key: { remoteJid, fromMe, id: messageId },
    reaction: emoji
  });
}

// Marca uma mensagem como lida (usado para simular "visualizar" algo que o
// device recebeu, incluindo status). Best-effort: algumas versões da
// Evolution têm bugs conhecidos nesse endpoint — o motor trata falha aqui
// como não-fatal.
export async function markAsRead(config, instance, remoteJid, messageId, fromMe) {
  return call(config, 'PUT', `/chat/markMessageAsRead/${encodeURIComponent(instance)}`, {
    read_messages: [{ remoteJid, fromMe, id: messageId }]
  });
}

/* ---------------- Webhook compartilhado (GoX1 + GoFire) ---------------- */

// Configura o webhook de uma instância para apontar para o endpoint único
// do app — o app despacha o evento internamente para o GoX1 (mensagens de
// contatos reais) e/ou para o GoFire (status de contatos salvos), conforme
// o conteúdo do payload. A Evolution só permite 1 webhook por instância,
// por isso esse compartilhamento é necessário quando o mesmo dispositivo é
// usado nos dois produtos. Escuta apenas MESSAGES_UPSERT — status também
// chegam por esse evento (remoteJid = "status@broadcast").
export async function setInstanceWebhook(config, instance, webhookUrl) {
  const events = ['MESSAGES_UPSERT'];
  // A Evolution v2 espera o corpo embrulhado em { webhook: {...} }; versões
  // mais antigas aceitam o formato "plano". Tentamos o v2 e caímos no plano.
  try {
    return await call(config, 'POST', `/webhook/set/${encodeURIComponent(instance)}`, {
      webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events }
    });
  } catch (e) {
    return call(config, 'POST', `/webhook/set/${encodeURIComponent(instance)}`, {
      enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events
    });
  }
}
export async function getInstanceWebhook(config, instance) {
  return call(config, 'GET', `/webhook/find/${encodeURIComponent(instance)}`);
}

// Baixa uma mídia recebida (imagem/vídeo/documento/áudio) em base64, a partir
// da chave da mensagem. Usado pelo bloco de IA para analisar comprovantes.
// Retorna { base64, mimetype } — o formato exato varia entre versões da
// Evolution, então tentamos os campos mais comuns.
export async function getBase64FromMediaMessage(config, instance, messageKey) {
  const data = await call(config, 'POST', `/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`, {
    message: { key: messageKey },
    convertToMp4: false
  });
  const base64 = data?.base64 || data?.media || data?.buffer || (typeof data === 'string' ? data : null);
  const mimetype = data?.mimetype || data?.mediaType || data?.mimeType || null;
  return { base64, mimetype };
}

// Define a presença ("composing" = digitando, "recording" = gravando, "paused").
// Best-effort: usado para mostrar "digitando/gravando" sem acoplar ao envio.
export async function setPresence(config, instance, number, presence) {
  return call(config, 'POST', `/chat/sendPresence/${encodeURIComponent(instance)}`, { number, presence, delay: 0 });
}
