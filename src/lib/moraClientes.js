// ============================================================
// BLOQUEO DE CUENTA CORRIENTE POR SALDO VENCIDO (> 15 días)
// ============================================================
// Regla comercial de Fabricio: el mayorista compra la semana (lun→dom)
// y la paga la siguiente. Se le tolera deuda de hasta 15 días; lo que
// el saldo excede a las compras de los últimos 15 días es deuda VENCIDA
// y el cliente queda BLOQUEADO para nuevas ventas a cuenta corriente
// (despacho en Depósito y pedidos del portal). Puede seguir comprando
// de contado (efectivo/transferencia) — eso no genera deuda.
//
// FIFO implícito (mismo criterio que la "mora" de Clientes.jsx): los
// pagos cancelan primero lo más viejo, así que
//   vencido = max(0, saldo − Σ debe de los últimos 15 días)
//
// SOLO LECTURA de movimientos_ctacte — acá no se modifica nada del
// ledger (regla de oro N°5).
// ============================================================
import { supabase, fetchAllRows } from './supabase'
import { fechaRelativaARG } from './fechas'

// Días de tolerancia antes de bloquear (pedido por Fabricio: 15 días,
// con semanas comerciales de lunes a domingo).
export const DIAS_BLOQUEO = 15

// Deuda vencida menor a esto NO bloquea. En el ledger quedan residuos de
// redondeo de pagos ($18, $27…) que no son mora real — bloquear un cliente
// por eso sería un papelón. $1.000 no compra ni un chorizo: cualquier deuda
// real supera esto por lejos.
const TOLERANCIA_PESOS = 1000

export const fechaCorteBloqueo = (dias = DIAS_BLOQUEO) => fechaRelativaARG(-dias)

// Estado de bloqueo de UN cliente (para el despacho y el portal).
// Devuelve { saldo, vencido, bloqueado, dias }.
export async function estadoBloqueoCliente(clienteId, dias = DIAS_BLOQUEO) {
  if (!clienteId) return { saldo: 0, vencido: 0, bloqueado: false, dias }
  const corte = fechaCorteBloqueo(dias)
  const [{ data: cli }, { data: movs }] = await Promise.all([
    supabase.from('clientes').select('saldo').eq('id', clienteId).maybeSingle(),
    // fetchAllRows por consistencia: 15 días de compras de un cliente no
    // deberían superar 1000 filas, pero mejor no subdeclarar el "debe
    // reciente" (subdeclararlo INFLA el vencido y bloquea de más).
    fetchAllRows(() => supabase.from('movimientos_ctacte')
      .select('debe').eq('cliente_id', clienteId).gte('fecha', corte).gt('debe', 0)),
  ])
  const saldo = Number(cli?.saldo) || 0
  const debeReciente = (movs || []).reduce((s, m) => s + (Number(m.debe) || 0), 0)
  const vencido = saldo > 0 ? Math.max(0, saldo - debeReciente) : 0
  return { saldo, vencido, bloqueado: vencido > TOLERANCIA_PESOS, dias }
}

// Vencido de TODOS los clientes en una sola consulta (para la lista de
// Clientes). Recibe el array de clientes (con .id y .saldo ya cargados)
// y devuelve un map cliente_id → $ vencido.
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
