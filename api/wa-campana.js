// ───────────────────────────────────────────────────────────
// WA-CAMPANA — envío de campañas/ofertas por WhatsApp (plantillas Meta)
// ───────────────────────────────────────────────────────────
// El envío masivo de texto libre fuera de la ventana de 24 h está prohibido
// por Meta (= ban del número). Por eso las campañas SOLO salen con una
// PLANTILLA APROBADA (template message). Este endpoint recibe la oferta de la
// semana + la lista de destinatarios y manda a cada uno el template, en lotes
// para no saturar. Valida admin (Supabase JWT → profiles.rol), guarda cada
// envío en wa_mensajes (para verlo en el chat) y registra la campaña.
//
// Body JSON: { oferta, destinatarios:[{telefono,nombre}], prueba?:bool,
//              plantilla?='ofertas_semana', idioma?='es' }
// ───────────────────────────────────────────────────────────
export const config = { maxDuration: 60 }

const SB_URL = process.env.VITE_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const WA_TOKEN = process.env.WHATSAPP_TOKEN
const PHONE_FALLBACK = '1162649446931346'

// Quita el "9" argentino: WhatsApp recibe 549XXXXXXXXXX pero solo envía a 54XXXXXXXXXX.
const normalizarDestino = (n) => String(n || '').replace(/[^0-9]/g, '').replace(/^549(\d+)$/, '54$1')
const primerNombre = (n) => {
  const t = String(n || '').trim().split(/\s+/)[0]
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : 'cliente'
}
// Cómo se ve el mensaje final (debe espejar el body de la plantilla ofertas_semana).
const renderMensaje = (nombre, oferta) =>
  `¡Hola ${nombre}! 🥩 En Carnicerías Fabricius esta semana tenemos: ${oferta}. ¡Te esperamos!`

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

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

    // ── Datos de la campaña ──
    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
    const oferta = String(body?.oferta || '').trim()
    const plantilla = String(body?.plantilla || 'ofertas_semana').trim()
    const idioma = String(body?.idioma || 'es').trim()
    const prueba = body?.prueba === true
    const destinatariosRaw = Array.isArray(body?.destinatarios) ? body.destinatarios : []
    if (!oferta) return res.status(400).json({ error: 'falta la oferta' })

    // Normalizar + deduplicar por teléfono; descartar números inválidos.
    const vistos = new Set()
    const destinatarios = []
    for (const d of destinatariosRaw) {
      const tel = normalizarDestino(d?.telefono)
      if (tel.length < 8 || vistos.has(tel)) continue
      vistos.add(tel)
      destinatarios.push({ tel, nombre: primerNombre(d?.nombre) })
    }
    if (destinatarios.length === 0) return res.status(400).json({ error: 'sin destinatarios válidos' })

    // phone_id del negocio (lo guarda el webhook en wa_config)
    let phoneId = PHONE_FALLBACK
    try {
      const cj = await (await fetch(`${SB_URL}/rest/v1/wa_config?clave=eq.phone_id&select=valor`, { headers: svc })).json()
      if (cj?.[0]?.valor) phoneId = cj[0].valor
    } catch {}

    // ── Enviar (en lotes para no saturar la API ni el tiempo de la función) ──
    async function enviarUno({ tel, nombre }) {
      try {
        const wr = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
          method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp', to: tel, type: 'template',
            template: {
              name: plantilla, language: { code: idioma },
              components: [{ type: 'body', parameters: [
                { type: 'text', text: nombre },
                { type: 'text', text: oferta },
              ] }],
            },
          }),
        })
        if (!wr.ok) {
          const txt = (await wr.text().catch(() => '')).slice(0, 300)
          return { tel, ok: false, error: `${wr.status} ${txt}` }
        }
        // Guardar el saliente para verlo en Conversaciones (best-effort).
        fetch(`${SB_URL}/rest/v1/wa_mensajes`, {
          method: 'POST', headers: { ...svc, Prefer: 'return=minimal' },
          body: JSON.stringify({ telefono: tel, direccion: 'out', autor: 'campana', tipo: 'text', texto: renderMensaje(nombre, oferta) }),
        }).catch(() => {})
        return { tel, ok: true }
      } catch (e) {
        return { tel, ok: false, error: String(e?.message || e) }
      }
    }

    const resultados = []
    const LOTE = 8
    for (let i = 0; i < destinatarios.length; i += LOTE) {
      const lote = destinatarios.slice(i, i + LOTE)
      resultados.push(...await Promise.all(lote.map(enviarUno)))
      if (i + LOTE < destinatarios.length) await sleep(350) // respiro entre lotes
    }

    const enviados = resultados.filter(r => r.ok).length
    const fallidos = resultados.length - enviados
    const errores = resultados.filter(r => !r.ok).map(r => ({ tel: r.tel, error: r.error }))

    // Registrar la campaña (las pruebas a un número no se guardan).
    if (!prueba) {
      fetch(`${SB_URL}/rest/v1/wa_campanas`, {
        method: 'POST', headers: { ...svc, Prefer: 'return=minimal' },
        body: JSON.stringify({ plantilla, oferta, total: destinatarios.length, enviados, fallidos, detalle: errores.slice(0, 50), creado_por: uid }),
      }).catch(() => {})
    }

    return res.status(200).json({ ok: true, prueba, total: destinatarios.length, enviados, fallidos, errores: errores.slice(0, 20) })
  } catch (err) {
    console.error('wa-campana error', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
}
