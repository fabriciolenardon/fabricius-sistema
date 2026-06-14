// ───────────────────────────────────────────────────────────
// WA-SEND — envío manual de WhatsApp desde el panel (intervención humana)
// ───────────────────────────────────────────────────────────
// El admin escribe desde "Conversaciones" y este endpoint manda el mensaje
// por la Cloud API (el token nunca llega al navegador). Valida que quien
// llama sea admin (Supabase JWT → profiles.rol). Guarda el saliente como
// autor 'humano' y actualiza el contacto.
// ───────────────────────────────────────────────────────────
export const config = { maxDuration: 30 }

const SB_URL = process.env.VITE_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const WA_TOKEN = process.env.WHATSAPP_TOKEN
const PHONE_FALLBACK = '1162649446931346'

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
    if (!SB_URL || !SB_KEY || !WA_TOKEN) return res.status(500).json({ error: 'config faltante' })

    // ── Validar que el llamador es admin ──
    const authz = req.headers.authorization || ''
    const userToken = authz.startsWith('Bearer ') ? authz.slice(7) : ''
    if (!userToken) return res.status(401).json({ error: 'sin sesión' })

    const ures = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${userToken}` } })
    if (!ures.ok) return res.status(401).json({ error: 'sesión inválida' })
    const user = await ures.json()
    const uid = user?.id
    if (!uid) return res.status(401).json({ error: 'sin usuario' })

    const svc = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }
    const prof = await (await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${uid}&select=rol`, { headers: svc })).json()
    if (prof?.[0]?.rol !== 'admin') return res.status(403).json({ error: 'solo admin' })

    // ── Datos del mensaje ──
    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
    const to = String(body?.to || '').replace(/[^0-9]/g, '')
    const text = String(body?.text || '').trim()
    if (!to || !text) return res.status(400).json({ error: 'falta to/text' })

    // phone_id del negocio (lo guarda el webhook en wa_config)
    let phoneId = PHONE_FALLBACK
    try {
      const cj = await (await fetch(`${SB_URL}/rest/v1/wa_config?clave=eq.phone_id&select=valor`, { headers: svc })).json()
      if (cj?.[0]?.valor) phoneId = cj[0].valor
    } catch {}

    const destino = to.replace(/^549(\d+)$/, '54$1') // sacar el 9 argentino
    const wr = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: destino, type: 'text', text: { body: text.slice(0, 4000) } }),
    })
    const wtxt = await wr.text()
    if (!wr.ok) { console.error('wa-send envío', wr.status, wtxt); return res.status(502).json({ error: 'no se pudo enviar', detalle: wtxt }) }

    // Guardar saliente (humano) + actualizar contacto (marca leído)
    await fetch(`${SB_URL}/rest/v1/wa_mensajes`, { method: 'POST', headers: { ...svc, Prefer: 'return=minimal' }, body: JSON.stringify({ telefono: to, direccion: 'out', autor: 'humano', tipo: 'text', texto: text }) })
    await fetch(`${SB_URL}/rest/v1/wa_contactos?telefono=eq.${to}`, { method: 'PATCH', headers: { ...svc, Prefer: 'return=minimal' }, body: JSON.stringify({ ultimo_mensaje: text, ultimo_at: new Date().toISOString(), no_leidos: 0 }) })

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('wa-send error', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
}
