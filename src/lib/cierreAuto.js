// ============================================================
// cierreAuto.js — calcula automáticamente el cierre semanal
// (o de cualquier rango fecha-desde / fecha-hasta).
//
// El cierre es un "paréntesis" del flujo continuo:
//   - VENTAS  → todo lo facturado en el período (cobrado o no)
//   - COBRADO → caja real ingresada en el período (puede incluir
//                cobranzas de cta cte de períodos anteriores)
//   - POR COBRAR → saldo total de clientes con deuda al cierre
//   - COMPRAS → entradas al depósito en el período (a precio costo)
//   - PAGADO PROV → lo que efectivamente pagamos a proveedores
//   - POR PAGAR  → saldo pendiente con proveedores al cierre
//   - GASTOS  → fijos + variables + retiros socios
//   - SUELDOS → liquidaciones cuya semana cae en el período
//
// Dos métricas de ganancia:
//   - DEVENGADA  = facturado − costos − gastos − sueldos
//   - CAJA REAL  = cobrado − pagado prov − gastos − sueldos
// ============================================================

import { supabase } from './supabase'
import { fechaHoyARG } from './fechas'

// Devuelve el lunes de la semana que contiene `base` (en ARG), formato YYYY-MM-DD.
// dia 0 = domingo, 1 = lunes, ...
export function lunesDeLaSemana(base = new Date()) {
  const d = new Date(base)
  const dia = d.getDay()
  // Si es domingo (0) restamos 6, sino restamos (dia - 1)
  d.setDate(d.getDate() - (dia === 0 ? 6 : dia - 1))
  return fechaHoyARG(d)
}

// Devuelve el domingo de la semana que contiene `base` (en ARG), formato YYYY-MM-DD.
export function domingoDeLaSemana(base = new Date()) {
  const d = new Date(base)
  const dia = d.getDay()
  d.setDate(d.getDate() + (dia === 0 ? 0 : 7 - dia))
  return fechaHoyARG(d)
}

// Helper: sumar columna numérica de un array de filas
const sum = (arr, k) => (arr || []).reduce((s, r) => s + (Number(r?.[k]) || 0), 0)

/**
 * Calcula todos los valores del cierre para el rango [desde, hasta] inclusive.
 * Ambas fechas en formato YYYY-MM-DD (zona ARG).
 *
 * Devuelve un objeto con la siguiente estructura:
 * {
 *   periodo: { desde, hasta, dias },
 *   ventas: { caja, mayorista, pedidos, total },
 *   cobrado: { efectivo, debito, transferencia, cobranzasCta, total },
 *   porCobrar: { totalSaldoClientes },
 *   compras: { entradas, total },
 *   pagadoProv: { pagos, total },
 *   porPagarProv: { totalSaldoProveedores },
 *   gastos: { fijos, variables, socios, total },
 *   sueldos: { total },
 *   kg: { carne, pollo, cerdo, embutidos },
 *   ganancia: { devengada, cajaReal },
 *   detalles: { ... }  // datos de soporte (top deudores, etc)
 * }
 */
export async function calcularCierreAuto(desde, hasta) {
  // Lanzamos todas las queries en paralelo
  const [
    ventasCajaR,
    salidasR,
    pedidosR,
    movCtaCteR,
    entradasR,
    pagosProvR,
    movProvR,
    gastosR,
    sueldosR,
    clientesR,
    proveedoresR,
  ] = await Promise.all([
    // Ventas minoristas (caja) — sólo origen='caja' (cliente cta cte ya cuenta como cobranza)
    supabase
      .from('ventas_minoristas')
      .select('id, fecha, total, efectivo, debito, transferencia, origen')
      .eq('origen', 'caja')
      .gte('fecha', desde)
      .lte('fecha', hasta),

    // Salidas / despachos depósito (mayorista) — excluye 'interno' (movimiento entre depósito y carnicería)
    supabase
      .from('salidas_deposito')
      .select('id, fecha, total, cobro, cliente_nombre')
      .gte('fecha', desde)
      .lte('fecha', hasta),

    // Pedidos confirmados con entrega en el período
    supabase
      .from('pedidos')
      .select('id, dia_entrega, total_estimado, estado, cliente_nombre')
      .eq('estado', 'confirmado')
      .gte('dia_entrega', desde)
      .lte('dia_entrega', hasta),

    // Movimientos cta cte clientes — cobranzas (pago / cheque)
    supabase
      .from('movimientos_ctacte')
      .select('id, fecha, tipo, debe, haber, cliente_id, cliente_nombre')
      .gte('fecha', desde)
      .lte('fecha', hasta),

    // Entradas al depósito (compras)
    supabase
      .from('entradas_deposito')
      .select('id, fecha, tipo, descripcion, proveedor_nombre, kg, kg_real, precio_kg, importe')
      .gte('fecha', desde)
      .lte('fecha', hasta),

    // Pagos a proveedores
    supabase
      .from('pagos_proveedores')
      .select('id, fecha, proveedor_nombre, importe, percepcion, tipo, medio')
      .gte('fecha', desde)
      .lte('fecha', hasta),

    // Movimientos cuenta corriente proveedores (extracto ledger)
    supabase
      .from('movimientos_proveedores')
      .select('id, fecha, proveedor_id, proveedor_nombre, tipo, debe, haber')
      .gte('fecha', desde)
      .lte('fecha', hasta),

    // Gastos del período
    supabase
      .from('gastos')
      .select('id, fecha, tipo, categoria, monto, socio, descripcion')
      .gte('fecha', desde)
      .lte('fecha', hasta),

    // Sueldos liquidados con semana cerrada dentro del período
    supabase
      .from('liquidaciones_sueldos')
      .select('id, semana_inicio, semana_fin, neto, empleado_nombre')
      .gte('semana_fin', desde)
      .lte('semana_fin', hasta),

    // Clientes con saldo (snapshot al momento — no es histórico al cierre)
    supabase
      .from('clientes')
      .select('id, nombre, saldo, tipo'),

    // Proveedores — pero saldo se computa desde movimientos_proveedores
    supabase
      .from('proveedores')
      .select('id, nombre'),
  ])

  const ventasCaja = ventasCajaR.data || []
  const salidas = (salidasR.data || []).filter(s => s.cobro !== 'interno')
  const pedidos = pedidosR.data || []
  const movCtaCte = movCtaCteR.data || []
  const entradas = entradasR.data || []
  const pagosProv = pagosProvR.data || []
  const movProv = movProvR.data || []
  const gastos = gastosR.data || []
  const sueldos = sueldosR.data || []
  const clientes = clientesR.data || []

  // ====== VENTAS (facturado en el período) ======
  const ventasCajaTotal = sum(ventasCaja, 'total')
  const ventasMayoristaTotal = sum(salidas, 'total')
  const ventasPedidosTotal = sum(pedidos, 'total_estimado')
  const ventasTotal = ventasCajaTotal + ventasMayoristaTotal + ventasPedidosTotal

  // ====== COBRADO (caja real en el período) ======
  const cobradoEfectivo = sum(ventasCaja, 'efectivo')
  const cobradoDebito = sum(ventasCaja, 'debito')
  const cobradoTransferencia = sum(ventasCaja, 'transferencia')
  // Cobranzas de cta cte: pago y cheque tienen haber > 0
  const cobranzasCta = movCtaCte
    .filter(m => m.tipo === 'pago' || m.tipo === 'cheque')
    .reduce((s, m) => s + (Number(m.haber) || 0), 0)
  // Mayorista cobrada al despachar (cobro != 'cta_cte' y != 'interno')
  const cobradoMayorista = salidas
    .filter(s => s.cobro && s.cobro !== 'cta_cte')
    .reduce((s, r) => s + (Number(r.total) || 0), 0)
  const cobradoTotal = cobradoEfectivo + cobradoDebito + cobradoTransferencia + cobranzasCta + cobradoMayorista

  // ====== POR COBRAR AL CIERRE (saldo clientes deudores) ======
  const clientesConDeuda = clientes
    .filter(c => Number(c.saldo) > 0)
    .sort((a, b) => (Number(b.saldo) || 0) - (Number(a.saldo) || 0))
  const totalPorCobrar = clientesConDeuda.reduce((s, c) => s + (Number(c.saldo) || 0), 0)

  // ====== COMPRAS (entradas al depósito) ======
  // Usar importe si está, si no, kg * precio_kg
  const comprasTotal = entradas.reduce((s, e) => {
    if (Number(e.importe) > 0) return s + Number(e.importe)
    const kg = Number(e.kg_real || e.kg) || 0
    const pkg = Number(e.precio_kg) || 0
    return s + (kg * pkg)
  }, 0)

  // ====== PAGADO A PROVEEDORES ======
  const pagadoProvTotal = pagosProv.reduce((s, p) =>
    s + (Number(p.importe) || 0) + (Number(p.percepcion) || 0), 0)

  // ====== POR PAGAR PROVEEDORES (saldo ledger al cierre) ======
  // Saldo se calcula leyendo TODOS los movimientos hasta `hasta`, no sólo los del período.
  const { data: todosMovProv } = await supabase
    .from('movimientos_proveedores')
    .select('proveedor_id, proveedor_nombre, debe, haber, fecha')
    .lte('fecha', hasta)

  const saldosProvMap = new Map()
  for (const m of (todosMovProv || [])) {
    const key = m.proveedor_id || m.proveedor_nombre || 'desconocido'
    const cur = saldosProvMap.get(key) || { nombre: m.proveedor_nombre, saldo: 0 }
    cur.saldo += (Number(m.debe) || 0) - (Number(m.haber) || 0)
    cur.nombre = m.proveedor_nombre || cur.nombre
    saldosProvMap.set(key, cur)
  }
  const proveedoresConDeuda = Array.from(saldosProvMap.values())
    .filter(p => p.saldo > 0.01)
    .sort((a, b) => b.saldo - a.saldo)
  const totalPorPagar = proveedoresConDeuda.reduce((s, p) => s + p.saldo, 0)

  // ====== GASTOS ======
  const gastosFijos = gastos.filter(g => g.tipo === 'fijo').reduce((s, g) => s + (Number(g.monto) || 0), 0)
  const gastosVariables = gastos.filter(g => g.tipo === 'variable').reduce((s, g) => s + (Number(g.monto) || 0), 0)
  const gastosSocios = gastos.filter(g => g.tipo === 'socio').reduce((s, g) => s + (Number(g.monto) || 0), 0)
  const gastosTotal = gastosFijos + gastosVariables + gastosSocios

  // ====== SUELDOS ======
  const sueldosTotal = sum(sueldos, 'neto')

  // ====== KG (referencia, no afecta cálculo de ganancia) ======
  const sumarKgPorTipo = tipos => entradas
    .filter(e => tipos.some(t => (e.tipo || '').startsWith(t)))
    .reduce((s, e) => s + (Number(e.kg_real || e.kg) || 0), 0)

  const kgCarne = sumarKgPorTipo(['bovino', 'mr_', 'media_res', 'pieza_'])
  const kgPollo = sumarKgPorTipo(['pollo', 'caja_pt'])
  const kgCerdo = sumarKgPorTipo(['cerdo', 'capon'])
  const kgEmbutidos = sumarKgPorTipo(['embutido', 'chorizo', 'morcilla'])

  // ====== GANANCIAS ======
  // Devengada: facturado - todos los costos del período (a precio de compra)
  const gananciaDevengada = ventasTotal - comprasTotal - gastosTotal - sueldosTotal
  // Caja real: lo que efectivamente entró menos lo que efectivamente salió
  const cajaReal = cobradoTotal - pagadoProvTotal - gastosTotal - sueldosTotal

  return {
    periodo: { desde, hasta },
    ventas: {
      caja: ventasCajaTotal,
      mayorista: ventasMayoristaTotal,
      pedidos: ventasPedidosTotal,
      total: ventasTotal,
    },
    cobrado: {
      efectivo: cobradoEfectivo,
      debito: cobradoDebito,
      transferencia: cobradoTransferencia,
      mayorista: cobradoMayorista,
      cobranzasCta,
      total: cobradoTotal,
    },
    porCobrar: {
      total: totalPorCobrar,
      clientes: clientesConDeuda.slice(0, 10),
    },
    compras: {
      total: comprasTotal,
      cantEntradas: entradas.length,
    },
    pagadoProv: {
      total: pagadoProvTotal,
      cantPagos: pagosProv.length,
    },
    porPagarProv: {
      total: totalPorPagar,
      proveedores: proveedoresConDeuda.slice(0, 10),
    },
    gastos: {
      fijos: gastosFijos,
      variables: gastosVariables,
      socios: gastosSocios,
      total: gastosTotal,
    },
    sueldos: {
      total: sueldosTotal,
      cantLiquidaciones: sueldos.length,
    },
    kg: {
      carne: kgCarne,
      pollo: kgPollo,
      cerdo: kgCerdo,
      embutidos: kgEmbutidos,
    },
    ganancia: {
      devengada: gananciaDevengada,
      cajaReal,
    },
  }
}

// Convierte el resultado de calcularCierreAuto al formato de la tabla
// `cierres_semanales` para poder guardar el snapshot.
export function cierreAutoAFila(cierre, mes) {
  return {
    semana_inicio: cierre.periodo.desde,
    semana_fin: cierre.periodo.hasta,
    mes: mes || cierre.periodo.desde.substring(0, 7),
    ventas: cierre.ventas.total,
    compras: cierre.compras.total,
    gastos: cierre.gastos.total,
    sueldos: cierre.sueldos.total,
    ganancia: cierre.ganancia.devengada,
    ingresos: {
      ventas_caja: cierre.ventas.caja,
      ventas_mayorista: cierre.ventas.mayorista,
      ventas_pedidos: cierre.ventas.pedidos,
      cobrado_efectivo: cierre.cobrado.efectivo,
      cobrado_debito: cierre.cobrado.debito,
      cobrado_transferencia: cierre.cobrado.transferencia,
      cobrado_mayorista: cierre.cobrado.mayorista,
      cobranzas_cta: cierre.cobrado.cobranzasCta,
      cobrado_total: cierre.cobrado.total,
      por_cobrar: cierre.porCobrar.total,
      pagado_prov: cierre.pagadoProv.total,
      por_pagar_prov: cierre.porPagarProv.total,
      gastos_fijos: cierre.gastos.fijos,
      gastos_variables: cierre.gastos.variables,
      gastos_socios: cierre.gastos.socios,
      ganancia_devengada: cierre.ganancia.devengada,
      caja_real: cierre.ganancia.cajaReal,
    },
    kg_carne: cierre.kg.carne,
    kg_pollo: cierre.kg.pollo,
    kg_cerdo: cierre.kg.cerdo,
    kg_merma: 0,
    ventas_ctacte: cierre.ventas.total - cierre.cobrado.total > 0
      ? cierre.ventas.total - cierre.cobrado.total
      : 0,
  }
}
