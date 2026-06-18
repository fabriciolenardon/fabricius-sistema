// ───────────────────────────────────────────────────────────
// WA-ENVIAR-COMBOS — el admin manda las fotos de combos a un chat
// ───────────────────────────────────────────────────────────
// Para cuando Iris se lo saltea, o para reactivar chats viejos (clientes
// que escribieron antes de que Iris estuviera configurada). Envía las
// imágenes de combos activas (combos_imagenes) al contacto. Valida admin
// (Supabase JWT → profiles.rol). El token nunca llega al navegador.
// Body JSON: { to }
// ───────────────────────────────────────────────────────────
export const config = { maxDuration: 30 }

const SB_URL = process.env.VITE_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const WA_TOKEN = process.env.WHATSAPP_TOKEN
const PHONE_FALLBACK = '1162649446931346'

const normalizarDestino = (n) => String(n || '').replace(/[^0-9]/g, '').replace(/^549(\d+)$/, '54$1')

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
    if (!SB_URL || !SB_KEY || !WA_TOKEN) return res.status(500).json({ error: 'config faltante' })

    // ── Validar admin ──
    const authz = req.headers.authorization || ''
    const userToken = authz.startsWith('Bearer ') ? authz.slice(7) : ''
    if (!userToken) return res.status(401).json({ error: 'sin sesión' })
    const ures = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${userToken}` } })
    if (!ures.ok) return res.status(401).json({ error: 'sesión inválida' })
    const uid = (await ures.json())?.id
    if (!uid) return res.status(401).json({ error: 'sin usuario' })
    const svc = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }
    const prof = await (await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${uid}&select=rol`, { headers: svc })).json()
    if (prof?.[0]?.rol !== 'admin') return res.status(403).json({ error: 'solo admin' })

    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
    const toRaw = String(body?.to || '')
    const destino = normalizarDestino(toRaw)
    if (destino.length < 8) return res.status(400).json({ error: 'destino inválido' })

    // Imágenes de combos activas
    const imgs = await (await fetch(`${SB_URL}/rest/v1/combos_imagenes?select=url&activo=eq.true&order=orden,creado_at`, { headers: svc })).json()
    const urls = (Array.isArray(imgs) ? imgs : []).map(i => i.url).filter(Boolean)
    if (urls.length === 0) return res.status(400).json({ error: 'No hay fotos de combos cargadas. Subilas en WhatsApp → Combos.' })

    // phone_id del negocio
    let phoneId = PHONE_FALLBACK
    try {
      const cj = await (await fetch(`${SB_URL}/rest/v1/wa_config?clave=eq.phone_id&select=valor`, { headers: svc })).json()
      if (cj?.[0]?.valor) phoneId = cj[0].valor
    } catch {}

    let enviadas = 0
    for (const url of urls) {
      const wr = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: destino, type: 'image', image: { link: url } }),
      })
      if (wr.ok) {
        enviadas++
        fetch(`${SB_URL}/rest/v1/wa_mensajes`, {
          method: 'POST', headers: { ...svc, Prefer: 'return=minimal' },
          body: JSON.stringify({ telefono: toRaw.replace(/[^0-9]/g, ''), direccion: 'out', autor: 'humano', tipo: 'text', texto: '📷 (combo enviado)' }),
        }).catch(() => {})
      } else {
        console.error('wa-enviar-combos', wr.status, (await wr.text().catch(() => '')).slice(0, 200))
      }
    }
    if (enviadas > 0) {
      fetch(`${SB_URL}/rest/v1/wa_contactos?telefono=eq.${toRaw.replace(/[^0-9]/g, '')}`, {
        method: 'PATCH', headers: { ...svc, Prefer: 'return=minimal' },
        body: JSON.stringify({ ultimo_mensaje: '📷 Combos', ultimo_at: new Date().toISOString(), no_leidos: 0 }),
      }).catch(() => {})
    }

    return res.status(200).json({ ok: enviadas > 0, enviadas, total: urls.length })
  } catch (err) {
    console.error('wa-enviar-combos error', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
}
