// ───────────────────────────────────────────────────────────
// TEMPORAL — registrar un número en la Cloud API (resuelve #133010)
// ───────────────────────────────────────────────────────────
// El botón "Turn on" del WhatsApp Manager quedó deshabilitado, así que
// registramos el número por API: POST /{phone_id}/register con un PIN.
// Usa el WHATSAPP_TOKEN del entorno (nunca se expone). Protegido por un
// secreto que debe coincidir con WHATSAPP_VERIFY_TOKEN.
//
// ⚠️ BORRAR este archivo una vez registrado el número.
// ───────────────────────────────────────────────────────────
export const config = { maxDuration: 30 }

export default async function handler(req, res) {
  try {
    const secret = req.query.secret
    if (!secret || secret !== (process.env.WHATSAPP_VERIFY_TOKEN || 'fabricius-iris-2026')) {
      return res.status(403).json({ error: 'forbidden' })
    }
    const token = process.env.WHATSAPP_TOKEN
    if (!token) return res.status(500).json({ error: 'falta WHATSAPP_TOKEN' })

    const phoneId = req.query.phone || '1162649446931346'
    const pin = req.query.pin
    if (!pin || !/^\d{6}$/.test(pin)) return res.status(400).json({ error: 'pin de 6 digitos requerido' })

    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
    })
    const body = await r.text()
    return res.status(r.status).send(body)
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) })
  }
}
