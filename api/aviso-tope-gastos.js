// ───────────────────────────────────────────────────────────
// AVISO TOPE GASTOS SOCIOS — Iris avisa por WhatsApp cuando los
// gastos de socios del mes llegan al tope configurado
// ───────────────────────────────────────────────────────────
// Lo dispara el panel de Gastos después de registrar/editar un gasto
// de socio. Todo el cálculo es server-side (service role): lee el tope
// de config_sistema (clave 'tope_gastos_socios'), suma los gastos
// tipo='socio' del mes calendario ARG y, si cruzó el 80% o el 100%,
// manda UN aviso por nivel por mes. El dedupe vive en config_sistema
// (clave 'tope_gastos_socios_aviso'); si cambia el mes o el tope se
// rearma. No bloquea nada: Iris avisa, Fabricio decide.
//
// Env (Vercel, ya configuradas para el recordatorio de compras):
//   WHATSAPP_TOKEN, WHATSAPP_AVISOS_TO, VITE_SUPABASE_URL,
//   SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY.
// ───────────────────────────────────────────────────────────
export const config = { maxDuration: 30 }

const TZ = 'America/Argentina/Cordoba'
const SB_URL = process.env.VITE_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const WA_TOKEN = process.env.WHATSAPP_TOKEN
const AVISOS_TO = process.env.WHATSAPP_AVISOS_TO
const PHONE_FALLBACK = '1162649446931346'

const fechaARG = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const fmtP = n => '$' + (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
    if (!SB_URL || !SB_KEY || !WA_TOKEN || !AVISOS_TO) return res.status(200).json({ ok: false, motivo: 'config faltante' })

    // ── Validar que el llamador es admin (mismo esquema que wa-send) ──
    const authz = req.headers.authorization || ''
    const userToken = authz.startsWith('Bearer ') ? authz.slice(7) : ''
    if (!userToken) return res.status(401).json({ error: 'sin sesión' })

    const ures = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${userToken}` } })
    if (!ures.ok) return res.status(401).json({ error: 'sesión inválida' })
    const user = await ures.json()
    if (!user?.id) return res.status(401).json({ error: 'sin usuario' })

    const svc = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }
    const prof = await (await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${user.id}&select=rol`, { headers: svc })).json()
    if (prof?.[0]?.rol !== 'admin') return res.status(403).json({ error: 'solo admin' })

    // ── Tope configurado ──
    const cfgTope = await (await fetch(`${SB_URL}/rest/v1/config_sistema?clave=eq.tope_gastos_socios&select=valor`, { headers: svc })).json()
    const tope = Number(cfgTope?.[0]?.valor?.tope) || 0
    const activo = !!cfgTope?.[0]?.valor?.activo
    if (!activo || tope <= 0) return res.status(200).json({ ok: true, enviado: false, motivo: 'tope inactivo' })

    // ── Gastos de socios del mes calendario ARG (01 → hoy) ──
    const hoy = fechaARG(new Date())
    const mesIni = hoy.slice(0, 8) + '01'
    const mes = hoy.slice(0, 7)
    const gastos = await (await fetch(
      `${SB_URL}/rest/v1/gastos?select=monto,socio,solo_balance&tipo=eq.socio&fecha=gte.${mesIni}&fecha=lte.${hoy}`,
      { headers: svc },
    )).json()
    const lista = (Array.isArray(gastos) ? gastos : []).filter(g => !g.solo_balance)
    const total = lista.reduce((s, g) => s + (Number(g.monto) || 0), 0)
    const fabri = lista.filter(g => g.socio === 'fabricio').reduce((s, g) => s + (Number(g.monto) || 0), 0)
    const ariel = lista.filter(g => g.socio === 'ariel').reduce((s, g) => s + (Number(g.monto) || 0), 0)
    const pct = Math.round((total / tope) * 100)

    // ── Dedupe: un aviso por nivel por mes; si cambia el tope se rearma ──
    const cfgAviso = await (await fetch(`${SB_URL}/rest/v1/config_sistema?clave=eq.tope_gastos_socios_aviso&select=valor`, { headers: svc })).json()
    const prev = cfgAviso?.[0]?.valor || {}
    const niveles = (prev.mes === mes && Number(prev.tope) === tope && Array.isArray(prev.niveles)) ? prev.niveles : []

    let nivel = 0
    if (pct >= 100 && !niveles.includes(100)) nivel = 100
    else if (pct >= 80 && !niveles.includes(80)) nivel = 80
    if (!nivel) return res.status(200).json({ ok: true, enviado: false, pct, total })

    const detalle = `👤 Fabri: ${fmtP(fabri)}\n👤 Ariel: ${fmtP(ariel)}`
    const cuerpo = nivel === 100
      ? `🚨 *Tope de gastos de socios alcanzado*\n\nJefe, este mes ya se gastaron ${fmtP(total)} de los ${fmtP(tope)} del tope (${pct}%).\n\n${detalle}\n\nTodo gasto de socio que se cargue de acá en adelante queda por encima del tope. 🧐`
      : `⚠️ *Ojo con los gastos de socios*\n\nJefe, ya van ${fmtP(total)} gastados de los ${fmtP(tope)} del tope del mes (${pct}%). Queda ${fmtP(Math.max(tope - total, 0))} de margen.\n\n${detalle}`

    // phone_id del negocio (lo guarda el webhook en wa_config)
    let phoneId = PHONE_FALLBACK
    try {
      const cj = await (await fetch(`${SB_URL}/rest/v1/wa_config?clave=eq.phone_id&select=valor`, { headers: svc })).json()
      if (cj?.[0]?.valor) phoneId = cj[0].valor
    } catch {}

    const destino = String(AVISOS_TO).replace(/[^0-9]/g, '').replace(/^549(\d+)$/, '54$1') // sacar el 9 argentino
    const wr = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: destino, type: 'text', text: { body: cuerpo.slice(0, 4000) } }),
    })
    if (!wr.ok) {
      console.error('aviso-tope-gastos envío WA', wr.status, await wr.text().catch(() => ''))
      return res.status(200).json({ ok: false, enviado: false, pct, motivo: 'no se pudo enviar el WhatsApp' })
    }

    // Marcar el nivel como avisado ANTES de responder (una vez por mes)
    await fetch(`${SB_URL}/rest/v1/config_sistema?on_conflict=clave`, {
      method: 'POST',
      headers: { ...svc, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        clave: 'tope_gastos_socios_aviso',
        valor: { mes, tope, niveles: [...niveles, nivel] },
        descripcion: 'Dedupe del aviso de tope de gastos de socios: niveles ya avisados este mes',
        updated_at: new Date().toISOString(),
      }),
    })

    return res.status(200).json({ ok: true, enviado: true, nivel, pct, total })
  } catch (err) {
    console.error('aviso-tope-gastos error', err)
    return res.status(200).json({ ok: false, error: String(err?.message || err) })
  }
}
