// ───────────────────────────────────────────────────────────
// TEMPORAL — diagnóstico/activación de la Cloud API (BORRAR luego)
// ───────────────────────────────────────────────────────────
// Acciones (query ?action=...), protegidas por ?secret=WHATSAPP_VERIFY_TOKEN:
//   register  → POST /{phone}/register {pin}   (resuelve #133010)
//   subscribe → POST /{waba}/subscribed_apps   (suscribe la app a la WABA → webhooks entrantes)
//   send      → POST /{phone}/messages {to,text} (prueba de envío; muestra el error exacto)
//   status    → GET  /{phone}?fields=...        (estado del número)
// Usa WHATSAPP_TOKEN del entorno (nunca se expone).
// ───────────────────────────────────────────────────────────
export const config = { maxDuration: 30 }

const PHONE = '1162649446931346'
const WABA = '979727748275973'
const GV = 'https://graph.facebook.com/v21.0'

export default async function handler(req, res) {
  try {
    const secret = req.query.secret
    if (!secret || secret !== (process.env.WHATSAPP_VERIFY_TOKEN || 'fabricius-iris-2026')) {
      return res.status(403).json({ error: 'forbidden' })
    }
    const token = process.env.WHATSAPP_TOKEN
    if (!token) return res.status(500).json({ error: 'falta WHATSAPP_TOKEN' })
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const action = req.query.action || 'status'
    const phone = req.query.phone || PHONE
    const waba = req.query.waba || WABA

    let url, opts
    if (action === 'register') {
      const pin = req.query.pin
      if (!/^\d{6}$/.test(pin || '')) return res.status(400).json({ error: 'pin 6 digitos' })
      url = `${GV}/${phone}/register`; opts = { method: 'POST', headers: auth, body: JSON.stringify({ messaging_product: 'whatsapp', pin }) }
    } else if (action === 'subscribe') {
      url = `${GV}/${waba}/subscribed_apps`; opts = { method: 'POST', headers: auth }
    } else if (action === 'subscribed') {
      url = `${GV}/${waba}/subscribed_apps`; opts = { headers: auth }
    } else if (action === 'send') {
      const to = req.query.to
      const text = req.query.text || 'Prueba de Iris ✅'
      if (!to) return res.status(400).json({ error: 'falta to' })
      url = `${GV}/${phone}/messages`; opts = { method: 'POST', headers: auth, body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }) }
    } else { // status
      url = `${GV}/${phone}?fields=display_phone_number,verified_name,code_verification_status,quality_rating,platform_type,throughput,name_status`; opts = { headers: auth }
    }

    const r = await fetch(url, opts)
    const body = await r.text()
    return res.status(200).json({ action, httpStatus: r.status, meta: safeJson(body) })
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) })
  }
}

function safeJson(s) { try { return JSON.parse(s) } catch { return s } }
