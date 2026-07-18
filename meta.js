// Integração com a Conversions API (CAPI) do Facebook/Meta para disparar
// eventos (ex.: Compra) a partir de conversas do WhatsApp. Usada pelo node de
// Pixel do GoX1.
import crypto from 'node:crypto';

const sha256 = (s) => crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');

// Dispara um evento no pixel. Para eventos vindos do WhatsApp, o Meta usa
// action_source "business_messaging" + messaging_channel "whatsapp", e o
// user_data precisa do page_id (e, quando existir, o ctwa_clid do anúncio
// clique-para-WhatsApp). Também mandamos o telefone com hash como reforço.
export async function sendPixelEvent(pixel, { eventName = 'Purchase', pageId, value, currency = 'BRL', phone, ctwaClid } = {}) {
  if (!pixel || !pixel.pixel_id || !pixel.access_token) throw new Error('Pixel sem ID ou token.');
  const user_data = {};
  if (pageId) user_data.page_id = String(pageId).trim();
  if (ctwaClid) user_data.ctwa_clid = String(ctwaClid).trim();
  if (phone) user_data.ph = sha256(String(phone).replace(/\D/g, ''));

  const custom_data = { currency };
  if (value != null && String(value) !== '') {
    const n = parseFloat(String(value).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    if (!Number.isNaN(n)) custom_data.value = n;
  }

  const payload = {
    data: [{
      event_name: eventName || 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data,
      custom_data
    }]
  };

  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(pixel.pixel_id)}/events?access_token=${encodeURIComponent(pixel.access_token)}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Meta CAPI ${res.status}: ${String(txt).slice(0, 250)}`);
  return txt;
}
