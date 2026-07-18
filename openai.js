// Integração mínima com a API da OpenAI (Chat Completions) para o bloco de IA
// do GoX1. Suporta texto e visão (imagem em base64 via data URL). Usada para
// identificar intenção de lead e ler comprovantes de PIX.

export async function openaiChat(apiKey, model, messages, { json = false, maxTokens = 900 } = {}) {
  if (!apiKey) throw new Error('OpenAI: chave da API não configurada.');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || 'gpt-4.1',
      messages,
      temperature: 0.1,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {})
    })
  });
  const txt = await res.text();
  let data; try { data = JSON.parse(txt); } catch { data = null; }
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${String(txt).slice(0, 300)}`);
  return data?.choices?.[0]?.message?.content || '';
}

// Monta o bloco de conteúdo de imagem (data URL base64) para o content do
// usuário na API de visão.
export function imageContent(base64, mimetype) {
  const mime = mimetype || 'image/jpeg';
  const url = base64.startsWith('data:') ? base64 : `data:${mime};base64,${base64}`;
  return { type: 'image_url', image_url: { url } };
}

// Monta o bloco de PDF (arquivo) — a OpenAI aceita PDF via content type "file"
// nos modelos que suportam (ex.: gpt-4.1).
export function pdfContent(base64, filename = 'documento.pdf') {
  const data = base64.startsWith('data:') ? base64 : `data:application/pdf;base64,${base64}`;
  return { type: 'file', file: { filename, file_data: data } };
}

// Extrai o primeiro objeto JSON de um texto (a IA às vezes embrulha em ```json).
export function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}
