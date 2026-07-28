// ============================================================
// BLOQUEO DE CUENTA CORRIENTE — manual, con sugerencia por plazo
// ============================================================
// El bloqueo lo decide FABRICIO, no el sistema: es el flag
// clientes.bloqueo_ctacte (mig 90) que él marca/desmarca desde la
// pantalla de Clientes. El sistema solo SUGIERE bloquear cuando
// detecta saldo VENCIDO — anuncio con confirmación en Clientes — y
// sugiere desbloquear cuando el bloqueado regularizó. El despacho
// (Depósito) y el portal de pedidos obedecen únicamente el flag.
//
// Crédito configurable por cliente (mig 90, editable en la ficha):
//   ctacte_libre      → cuenta libre: sin control de vencimiento,
//                       jamás se sugiere bloquearla.
//   ctacte_dias_plazo → plazo propio en días (NULL = estándar 15).
//
// Cálculo del vencido — FIFO implícito (mismo criterio que la
// "mora" de Clientes.jsx): los pagos cancelan primero lo más viejo,
// así que  vencido = max(0, saldo − Σ debe de los últimos <plazo> días).
// La semana comercial es lun→dom: el mayorista compra la semana y
// la paga la siguiente; 15 días = esa tolerancia + margen.
//
// movimientos_ctacte se usa SOLO LECTURA (regla de oro N°5). El
// flag de bloqueo y la config de crédito viven en clientes.
// ============================================================
import { supabase, fetchAllRows } from './supabase'
import { fechaRelativaARG } from './fechas'
import { logAuditoria } from './auditoria'

// Plazo estándar (días) antes de SUGERIR el bloqueo.
export const DIAS_BLOQUEO = 15

// Deuda vencida menor a esto no genera sugerencia. En el ledger quedan
// residuos de redondeo de pagos ($18, $27…) que no son mora real.
const TOLERANCIA_PESOS = 1000

// Plazo efectivo de un cliente: el propio si tiene, sino el estándar.
export const plazoCliente = c =>
  Number(c?.ctacte_dias_plazo) > 0 ? Number(c.ctacte_dias_plazo) : DIAS_BLOQUEO

// Estado de UN cliente (para el despacho y el portal).
// bloqueado = el flag manual de la ficha; vencido = el cálculo según SU
// plazo (informativo: se muestra en el cartel para explicar el porqué).
export async function estadoBloqueoCliente(clienteId) {
  if (!clienteId) return { saldo: 0, vencido: 0, bloqueado: false, motivo: null, dias: DIAS_BLOQUEO, libre: false }
  const { data: cli } = await supabase.from('clientes')
    .select('saldo, bloqueo_ctacte, bloqueo_motivo, ctacte_libre, ctacte_dias_plazo')
    .eq('id', clienteId).maybeSingle()
  const dias = plazoCliente(cli)
  const saldo = Number(cli?.saldo) || 0
  let vencido = 0
  if (!cli?.ctacte_libre && saldo > 0) {
    const corte = fechaRelativaARG(-dias)
    const { data: movs } = await fetchAllRows(() => supabase.from('movimientos_ctacte')
      .select('debe').eq('cliente_id', clienteId).gte('fecha', corte).gt('debe', 0))
    const debeReciente = (movs || []).reduce((s, m) => s + (Number(m.debe) || 0), 0)
    const bruto = Math.max(0, saldo - debeReciente)
    vencido = bruto > TOLERANCIA_PESOS ? bruto : 0
  }
  return {
    saldo,
    vencido,
    bloqueado: !!cli?.bloqueo_ctacte,
    motivo: cli?.bloqueo_motivo || null,
    dias,
    libre: !!cli?.ctacte_libre,
  }
}

// Vencido de TODOS los clientes en una sola consulta (para la lista y
// las sugerencias de Clientes). Respeta el plazo propio de cada uno y
// saltea las cuentas libres. Recibe el array de clientes ya cargado
// (con saldo, ctacte_libre y ctacte_dias_plazo) y devuelve un map
// cliente_id → $ vencido.
export async function vencidoPorCliente(clientes) {
  const conDeuda = (clientes || []).filter(c => Number(c.saldo) > 0 && !c.ctacte_libre)
  const out = {}
  for (const c of (clientes || [])) out[c.id] = 0
  if (conDeuda.length === 0) return out
  // Una sola consulta hasta el corte más lejano; después cada cliente
  // filtra por SU corte (fecha es 'YYYY-MM-DD' → comparación de strings).
  const maxDias = Math.max(...conDeuda.map(plazoCliente))
  const corteMax = fechaRelativaARG(-maxDias)
  const cortes = {}
  for (const c of conDeuda) cortes[c.id] = fechaRelativaARG(-plazoCliente(c))
  const { data: movs } = await fetchAllRows(() => supabase.from('movimientos_ctacte')
    .select('cliente_id, debe, fecha').gte('fecha', corteMax).gt('debe', 0))
  const reciente = {}
  for (const m of (movs || [])) {
    const corte = cortes[m.cliente_id]
    if (!corte || m.fecha < corte) continue
    reciente[m.cliente_id] = (reciente[m.cliente_id] || 0) + (Number(m.debe) || 0)
  }
  for (const c of conDeuda) {
    const vencido = Math.max(0, (Number(c.saldo) || 0) - (reciente[c.id] || 0))
    out[c.id] = vencido > TOLERANCIA_PESOS ? vencido : 0
  }
  return out
}

// Marcar / desmarcar el bloqueo de un cliente. Siempre con decisión
// humana detrás (confirmación en la UI de Clientes) — nunca automático.
// Queda registrado en auditoría con el motivo.
export async function setBloqueoCliente(cliente, bloquear, motivo) {
  const upd = bloquear
    ? { bloqueo_ctacte: true, bloqueo_motivo: motivo || 'Bloqueo manual', bloqueo_fecha: new Date().toISOString() }
    : { bloqueo_ctacte: false, bloqueo_motivo: null, bloqueo_fecha: null }
  const { error } = await supabase.from('clientes').update(upd).eq('id', cliente.id)
  if (error) return { error: error.message }
  await logAuditoria({
    accion: 'update',
    modulo: 'clientes',
    entidad: 'clientes',
    entidad_id: cliente.id,
    descripcion: bloquear
      ? `🚫 BLOQUEO de cta cte a "${cliente.nombre}". Motivo: ${motivo || 'Bloqueo manual'}.`
      : `✅ DESBLOQUEO de cta cte a "${cliente.nombre}".`,
    valoresAntes: { bloqueo_ctacte: !!cliente.bloqueo_ctacte, bloqueo_motivo: cliente.bloqueo_motivo || null },
    valoresDespues: { bloqueo_ctacte: bloquear, bloqueo_motivo: upd.bloqueo_motivo },
  })
  return { error: null }
}

// Config de crédito de un cliente: cuenta libre y/o plazo propio.
// { libre: boolean } y/o { dias: number|null } (null = plazo estándar).
export async function setConfigCtaCte(cliente, { libre, dias }) {
  const upd = {}
  if (libre !== undefined) upd.ctacte_libre = !!libre
  if (dias !== undefined) upd.ctacte_dias_plazo = dias
  if (Object.keys(upd).length === 0) return { error: null }
  const { error } = await supabase.from('clientes').update(upd).eq('id', cliente.id)
  if (error) return { error: error.message }
  const partes = []
  if (libre !== undefined) partes.push(libre ? 'cuenta LIBRE (sin control de vencimiento)' : 'cuenta con control de vencimiento')
  if (dias !== undefined) partes.push(dias ? `plazo propio ${dias} días` : `plazo estándar (${DIAS_BLOQUEO} días)`)
  await logAuditoria({
    accion: 'update',
    modulo: 'clientes',
    entidad: 'clientes',
    entidad_id: cliente.id,
    descripcion: `⚙️ Config de cta cte de "${cliente.nombre}": ${partes.join(' · ')}.`,
    valoresAntes: { ctacte_libre: !!cliente.ctacte_libre, ctacte_dias_plazo: cliente.ctacte_dias_plazo ?? null },
    valoresDespues: { ctacte_libre: upd.ctacte_libre ?? !!cliente.ctacte_libre, ctacte_dias_plazo: upd.ctacte_dias_plazo !== undefined ? upd.ctacte_dias_plazo : (cliente.ctacte_dias_plazo ?? null) },
  })
  return { error: null }
}
