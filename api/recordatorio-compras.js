// ───────────────────────────────────────────────────────────
// RECORDATORIO DE COMPRAS — Iris avisa sola por WhatsApp qué encargar
// ───────────────────────────────────────────────────────────
// Lo dispara un cron de Vercel TODOS LOS DÍAS (ver vercel.json), pero solo
// ENVÍA los días configurados (por defecto domingo, para el pedido del lunes).
// Arma la base del pedido: lo COMPRADO la última semana vs el STOCK actual.
//
// Env (Vercel): WHATSAPP_TOKEN, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   WHATSAPP_AVISOS_TO (a quién avisar). Protección: header de Vercel cron o
//   ?secret=WHATSAPP_VERIFY_TOKEN (para probarlo a mano).
// ───────────────────────────────────────────────────────────
export const config = { maxDuration: 30 }

const TZ = 'America/Argentina/Cordoba'
const SB_URL = process.env.VITE_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const WA_TOKEN = process.env.WHATSAPP_TOKEN
const AVISOS_TO = process.env.WHATSAPP_AVISOS_TO
const VERIFY = process.env.WHATSAPP_VERIFY_TOKEN || 'fabricius-iris-2026'
const PHONE_FALLBACK = '1162649446931346'
// Días en que se envía (0=domingo). Avisar el domingo para el pedido del lunes.
const DIAS_AVISO = [0]

const fechaARG = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const diaSemanaARG = d => new Date(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)).getDay()
const fmtKg = n => (Number(n) || 0).toLocaleString('es-AR')

export default async function handler(req, res) {
  try {
    // Protección: solo el cron de Vercel o una llamada con el secret.
    const esCron = (req.headers['user-agent'] || '').includes('vercel-cron')
    const okSecret = req.query.secret === VERIFY
    if (!esCron && !okSecret) return res.status(403).json({ error: 'forbidden' })
    if (!SB_URL || !SB_KEY || !WA_TOKEN || !AVISOS_TO) return res.status(200).json({ ok: false, motivo: 'config faltante' })

    const hoy = new Date()
    const dow = diaSemanaARG(hoy)
    const forzar = req.query.forzar === '1' // para probar cualquier día
    if (!forzar && !DIAS_AVISO.includes(dow)) {
      return res.status(200).json({ ok: true, enviado: false, motivo: `hoy (dow ${dow}) no es día de aviso` })
    }

    const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
    const hasta = fechaARG(hoy)
    const desde = fechaARG(new Date(hoy.getTime() - 7 * 86400000))
    const [compras, stock, cfg] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/entradas_deposito?select=tipo,cantidad,kg,kg_real&eliminado=eq.false&fecha=gte.${desde}&fecha=lte.${hasta}`, { headers }).then(r => r.json()),
      fetch(`${SB_URL}/rest/v1/stock_actual?select=tipo,kg_disponible`, { headers }).then(r => r.json()),
      fetch(`${SB_URL}/rest/v1/wa_config?clave=eq.phone_id&select=valor`, { headers }).then(r => r.json()).catch(() => []),
    ])
    const phoneId = (Array.isArray(cfg) && cfg[0]?.valor) || PHONE_FALLBACK

    const st = {}; (Array.isArray(stock) ? stock : []).forEach(s => { st[s.tipo] = Number(s.kg_disponible) || 0 })
    const acc = {}
    ;(Array.isArray(compras) ? compras : []).forEach(e => {
      const t = e.tipo || 'otro'
      if (!acc[t]) acc[t] = { u: 0, kg: 0 }
      acc[t].u += Number(e.cantidad) || 1
      acc[t].kg += Number(e.kg_real) > 0 ? Number(e.kg_real) : (Number(e.kg) || 0)
    })
    const NOMBRE = { bovino_mr: 'Media res', cerdo: 'Cerdo', pollo: 'Pollo', cajon_bovino: 'Cajones bovino', embutido: 'Embutidos' }
    const lineas = Object.entries(acc).map(([t, v]) => `• ${NOMBRE[t] || t}: semana pasada ${v.u} u (${fmtKg(v.kg)} kg) · stock hoy ${fmtKg(st[t] || 0)} kg`).join('\n')

    const cuerpo = lineas
      ? `🛒 *¡Buen domingo, jefe!* Mañana es día de pedido. Te dejo la base según la última semana y el stock de hoy:\n\n${lineas}\n\nAcordate de ajustar por lo que quedó (si sobró, encargá menos). Si querés, escribime y te armo el pedido fino. 💪🥩`
      : `🛒 ¡Buen domingo, jefe! Mañana es día de pedido, pero no registré compras la última semana para darte una base. Revisá el stock y cargá lo que haga falta. 💪`

    await enviarWA(phoneId, AVISOS_TO, cuerpo)
    return res.status(200).json({ ok: true, enviado: true })
  } catch (err) {
    console.error('recordatorio-compras error', err)
    return res.status(200).json({ ok: false, error: String(err?.message || err) })
  }
}

function normalizarAR(n) { return String(n || '').replace(/^549(\d+)$/, '54$1') }
async function enviarWA(phoneId, to, texto) {
  const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: normalizarAR(to), type: 'text', text: { body: String(texto).slice(0, 4000) } }),
  })
  if (!r.ok) console.error('recordatorio envío WA', r.status, await r.text().catch(() => ''))
}
