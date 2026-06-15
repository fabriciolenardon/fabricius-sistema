// ───────────────────────────────────────────────────────────
// ENVIAR-PUSH — manda una notificación push a los dispositivos suscritos
// ───────────────────────────────────────────────────────────
// Protegido por ?secret=WHATSAPP_VERIFY_TOKEN (lo llaman el webhook / cron).
// Body: { titulo, body, url }. Usa web-push + VAPID. Limpia las suscripciones
// muertas (410/404). Requiere env VAPID_PRIVATE_KEY.
// ───────────────────────────────────────────────────────────
import webpush from 'web-push'

export const config = { maxDuration: 30 }

const SB_URL = process.env.VITE_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const VERIFY = process.env.WHATSAPP_VERIFY_TOKEN || 'fabricius-iris-2026'
const VAPID_PUBLIC = 'BLzle-N3TvKoPfUARVWVqW-VUyVWZsSpo-81XoxdDqfl5xM-djelKdU3zWtSpJus_tu098PkDwt4qh1JAHdkdS0'
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
    const secret = req.query.secret || (req.headers.authorization || '').replace('Bearer ', '')
    if (secret !== VERIFY) return res.status(403).json({ error: 'forbidden' })
    if (!VAPID_PRIVATE || !SB_URL || !SB_KEY) return res.status(200).json({ ok: false, motivo: 'falta VAPID_PRIVATE_KEY o config Supabase' })

    webpush.setVapidDetails('mailto:fabriciolenardon@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE)

    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
    const payload = JSON.stringify({
      titulo: body?.titulo || '🥩 Carnicerías Fabricius',
      body: body?.body || '',
      url: body?.url || '/admin/whatsapp',
    })

    const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
    const subs = await fetch(`${SB_URL}/rest/v1/push_subscriptions?select=endpoint,subscription`, { headers }).then(r => r.json())
    if (!Array.isArray(subs) || !subs.length) return res.status(200).json({ ok: true, enviados: 0 })

    let ok = 0
    const muertas = []
    await Promise.all(subs.map(async (s) => {
      try { await webpush.sendNotification(s.subscription, payload); ok++ }
      catch (err) { if (err?.statusCode === 410 || err?.statusCode === 404) muertas.push(s.endpoint) }
    }))
    for (const ep of muertas) {
      await fetch(`${SB_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(ep)}`, { method: 'DELETE', headers }).catch(() => {})
    }
    return res.status(200).json({ ok: true, enviados: ok, limpiadas: muertas.length })
  } catch (err) {
    console.error('enviar-push error', err)
    return res.status(200).json({ ok: false, error: String(err?.message || err) })
  }
}
