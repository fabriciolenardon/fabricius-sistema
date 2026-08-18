// ───────────────────────────────────────────────────────────
// AVISO TOPE GASTOS SOCIOS — Iris avisa por WhatsApp cuando los
// gastos de socios del mes llegan al tope configurado
// ───────────────────────────────────────────────────────────
// Lo dispara el panel de Gastos después de registrar/editar un gasto
// de socio. Todo el cálculo es server-side (service role): lee la config
// de config_sistema (clave 'tope_gastos_socios': tope total y/o tope
// individual por socio), suma los gastos tipo='socio' del mes calendario
// ARG y, por cada tope que cruce el 80% o el 100%, manda UN aviso por
// nivel por mes (varios cruces en el mismo gasto salen en un solo
// mensaje). El dedupe vive en config_sistema (clave
// 'tope_gastos_socios_aviso'); si cambia el mes o algún tope se rearma.
// No bloquea nada: Iris avisa, Fabricio decide.
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

    // ── Topes configurados ──
    // El tope TOTAL vive en la fila de la sucursal y el de cada dueño en su
    // ficha de `socios` (migración 98). Antes estaban en config_sistema con
    // los nombres fabricio/ariel escritos a mano acá adentro.
    //
    // Este aviso es SOLO de la central (sucursal 1): es el WhatsApp de
    // Fabricio el que recibe. Una sucursal ve sus topes en pantalla pero no
    // tiene WhatsApp propio configurado — el módulo es de la central.
    const SUC = 1
    const suc = await (await fetch(`${SB_URL}/rest/v1/sucursales?id=eq.${SUC}&select=tope_gastos_total,tope_gastos_activo`, { headers: svc })).json()
    const topeTotal = Number(suc?.[0]?.tope_gastos_total) || 0
    const activo = !!suc?.[0]?.tope_gastos_activo

    const socios = await (await fetch(
      `${SB_URL}/rest/v1/socios?sucursal_id=eq.${SUC}&activo=eq.true&select=clave,nombre,apodo,tope_mensual&order=orden`,
      { headers: svc },
    )).json().catch(() => [])
    const listaSocios = (Array.isArray(socios) ? socios : []).map(s => ({
      clave: s.clave,
      label: s.apodo || String(s.nombre || '').split(' ')[0],
      tope: Number(s.tope_mensual) || 0,
    }))

    if (!activo || (topeTotal <= 0 && !listaSocios.some(s => s.tope > 0))) {
      return res.status(200).json({ ok: true, enviado: false, motivo: 'tope inactivo' })
    }

    // ── Rango del MES OPERATIVO (Cierre → Por Mes): si hoy cae dentro de
    //    un mes operativo, el tope se mide desde su fecha_inicio (mismo
    //    criterio que el "Mensual en vivo" del Dashboard Ejecutivo).
    //    Fallback al mes calendario si no hay mes operativo configurado. ──
    const hoy = fechaARG(new Date())
    const mesesOp = await (await fetch(
      `${SB_URL}/rest/v1/meses_operativos?select=etiqueta,fecha_inicio,fecha_cierre&order=fecha_inicio.desc`,
      { headers: svc },
    )).json().catch(() => [])
    const mesOp = (Array.isArray(mesesOp) ? mesesOp : []).find(m => hoy >= m.fecha_inicio && hoy <= m.fecha_cierre) || null
    const mesIni = mesOp ? mesOp.fecha_inicio : hoy.slice(0, 8) + '01'
    // Identificador del período para el dedupe (único por mes operativo)
    const mes = mesOp ? `op:${mesOp.fecha_inicio}` : hoy.slice(0, 7)
    const nombrePeriodo = mesOp ? `el mes operativo${mesOp.etiqueta ? ` ${mesOp.etiqueta}` : ''}` : 'este mes'
    const gastos = await (await fetch(
      `${SB_URL}/rest/v1/gastos?select=monto,socio,solo_balance&tipo=eq.socio&fecha=gte.${mesIni}&fecha=lte.${hoy}`,
      { headers: svc },
    )).json()
    const lista = (Array.isArray(gastos) ? gastos : []).filter(g => !g.solo_balance)
    const total = lista.reduce((s, g) => s + (Number(g.monto) || 0), 0)
    const gastadoPor = Object.fromEntries(listaSocios.map(s =>
      [s.clave, lista.filter(g => g.socio === s.clave).reduce((t, g) => t + (Number(g.monto) || 0), 0)]
    ))

    const scopes = [
      { key: 'total', label: 'Total socios', gastado: total, tope: topeTotal },
      ...listaSocios.map(s => ({ key: s.clave, label: s.label, gastado: gastadoPor[s.clave] || 0, tope: s.tope })),
    ].filter(s => s.tope > 0)

    // ── Dedupe: un aviso por nivel por tope por mes; si cambia algún
    //    tope (firma) o el mes, se rearma todo ──
    const firma = [topeTotal, ...listaSocios.map(s => `${s.clave}:${s.tope}`)].join('|')
    const cfgAviso = await (await fetch(`${SB_URL}/rest/v1/config_sistema?clave=eq.tope_gastos_socios_aviso&select=valor`, { headers: svc })).json()
    const prev = cfgAviso?.[0]?.valor || {}
    const niveles = (prev.mes === mes && prev.firma === firma && prev.niveles && !Array.isArray(prev.niveles)) ? prev.niveles : {}

    const avisos = []
    const nuevos = {}
    for (const s of scopes) {
      const pct = Math.round((s.gastado / s.tope) * 100)
      const ya = Array.isArray(niveles[s.key]) ? niveles[s.key] : []
      let nivel = 0
      if (pct >= 100 && !ya.includes(100)) nivel = 100
      else if (pct >= 80 && !ya.includes(80)) nivel = 80
      nuevos[s.key] = nivel ? [...ya, nivel] : ya
      if (nivel === 100) avisos.push(`🚨 *${s.label}*: tope alcanzado — ${fmtP(s.gastado)} de ${fmtP(s.tope)} (${pct}%)`)
      else if (nivel === 80) avisos.push(`⚠️ *${s.label}*: al ${pct}% del tope — ${fmtP(s.gastado)} de ${fmtP(s.tope)}, queda ${fmtP(Math.max(s.tope - s.gastado, 0))}`)
    }
    if (!avisos.length) return res.status(200).json({ ok: true, enviado: false, total })

    const grave = avisos.some(l => l.startsWith('🚨'))
    // El detalle se arma con los dueños que tenga cargados el negocio, no con
    // dos nombres fijos: si mañana entra un socio nuevo, aparece solo.
    const detalleSocios = listaSocios.map(s => `👤 ${s.label}: ${fmtP(gastadoPor[s.clave] || 0)}`).join(' · ')
    const cuerpo = `${grave ? '🚨' : '⚠️'} *Gastos de socios — aviso de tope*\n\nJefe, en ${nombrePeriodo} se cruzó un límite:\n\n${avisos.join('\n')}\n\n${detalleSocios}${detalleSocios ? ' · ' : ''}Total: ${fmtP(total)}${grave ? '\n\nTodo gasto que se cargue de acá en adelante queda por encima del tope. 🧐' : ''}`

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
      return res.status(200).json({ ok: false, enviado: false, motivo: 'no se pudo enviar el WhatsApp' })
    }

    // Marcar los niveles como avisados (una vez por tope por mes)
    await fetch(`${SB_URL}/rest/v1/config_sistema?on_conflict=clave`, {
      method: 'POST',
      headers: { ...svc, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        clave: 'tope_gastos_socios_aviso',
        valor: { mes, firma, niveles: nuevos },
        descripcion: 'Dedupe del aviso de tope de gastos de socios: niveles ya avisados este mes por tope (total/fabricio/ariel)',
        updated_at: new Date().toISOString(),
      }),
    })

    return res.status(200).json({ ok: true, enviado: true, grave, avisos: avisos.length, total })
  } catch (err) {
    console.error('aviso-tope-gastos error', err)
    return res.status(200).json({ ok: false, error: String(err?.message || err) })
  }
}
