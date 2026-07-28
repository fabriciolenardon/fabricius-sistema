// ============================================================
// BLOQUEO DE CUENTA CORRIENTE — manual, con sugerencia a 15 días
// ============================================================
// El bloqueo lo decide FABRICIO, no el sistema: es el flag
// clientes.bloqueo_ctacte (mig 90) que él marca/desmarca desde la
// pantalla de Clientes. El sistema solo SUGIERE bloquear cuando
// detecta saldo VENCIDO (deuda con más de 15 días) — anuncio con
// confirmación en Clientes — y sugiere desbloquear cuando el
// bloqueado regularizó. El despacho (Depósito) y el portal de
// pedidos obedecen únicamente el flag.
//
// Cálculo del vencido — FIFO implícito (mismo criterio que la
// "mora" de Clientes.jsx): los pagos cancelan primero lo más viejo,
// así que  vencido = max(0, saldo − Σ debe de los últimos 15 días).
// La semana comercial es lun→dom: el mayorista compra la semana y
// la paga la siguiente; 15 días = esa tolerancia + margen.
//
// movimientos_ctacte se usa SOLO LECTURA (regla de oro N°5). El
// flag de bloqueo vive en clientes, no en el ledger.
// ============================================================
import { supabase, fetchAllRows } from './supabase'
import { fechaRelativaARG } from './fechas'
import { logAuditoria } from './auditoria'

// Días de tolerancia antes de SUGERIR el bloqueo.
export const DIAS_BLOQUEO = 15

// Deuda vencida menor a esto no genera sugerencia. En el ledger quedan
// residuos de redondeo de pagos ($18, $27…) que no son mora real.
const TOLERANCIA_PESOS = 1000

export const fechaCorteBloqueo = (dias = DIAS_BLOQUEO) => fechaRelativaARG(-dias)

// Estado de UN cliente (para el despacho y el portal).
// bloqueado = el flag manual de la ficha; vencido = el cálculo a 15 días
// (informativo: se muestra en el cartel para explicar el porqué).
export async function estadoBloqueoCliente(clienteId, dias = DIAS_BLOQUEO) {
  if (!clienteId) return { saldo: 0, vencido: 0, bloqueado: false, motivo: null, dias }
  const corte = fechaCorteBloqueo(dias)
  const [{ data: cli }, { data: movs }] = await Promise.all([
    supabase.from('clientes').select('saldo, bloqueo_ctacte, bloqueo_motivo').eq('id', clienteId).maybeSingle(),
    fetchAllRows(() => supabase.from('movimientos_ctacte')
      .select('debe').eq('cliente_id', clienteId).gte('fecha', corte).gt('debe', 0)),
  ])
  const saldo = Number(cli?.saldo) || 0
  const debeReciente = (movs || []).reduce((s, m) => s + (Number(m.debe) || 0), 0)
  const vencidoBruto = saldo > 0 ? Math.max(0, saldo - debeReciente) : 0
  return {
    saldo,
    vencido: vencidoBruto > TOLERANCIA_PESOS ? vencidoBruto : 0,
    bloqueado: !!cli?.bloqueo_ctacte,
    motivo: cli?.bloqueo_motivo || null,
    dias,
  }
}

// Vencido de TODOS los clientes en una sola consulta (para la lista y
// las sugerencias de Clientes). Recibe el array de clientes (con .id y
// .saldo ya cargados) y devuelve un map cliente_id → $ vencido.
export async function vencidoPorCliente(clientes, dias = DIAS_BLOQUEO) {
  const corte = fechaCorteBloqueo(dias)
  const { data: movs } = await fetchAllRows(() => supabase.from('movimientos_ctacte')
    .select('cliente_id, debe').gte('fecha', corte).gt('debe', 0))
  const reciente = {}
  for (const m of (movs || [])) {
    reciente[m.cliente_id] = (reciente[m.cliente_id] || 0) + (Number(m.debe) || 0)
  }
  const out = {}
  for (const c of (clientes || [])) {
    const saldo = Number(c.saldo) || 0
    const vencido = saldo > 0 ? Math.max(0, saldo - (reciente[c.id] || 0)) : 0
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
