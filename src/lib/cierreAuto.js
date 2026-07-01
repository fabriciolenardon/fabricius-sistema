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

// Fecha en que se imputa un concepto extra de sueldos (aguinaldo/vacaciones).
// Como no tienen fecha propia, se imputan a la fecha de CIERRE de su mes
// operativo (meses_operativos.fecha_cierre) → caen en la última semana del mes.
// Fallback si no hay mes operativo cargado: último día del mes calendario.
export function fechaImputacionConcepto(mes, mesesOp) {
  const m = (mesesOp || []).find(x => x.mes === mes)
  if (m && m.fecha_cierre) return m.fecha_cierre
  const [y, mm] = mes.split('-').map(Number)
  const d = new Date(y, mm, 0).getDate()   // día 0 del mes siguiente = último de este
  return `${mes}-${String(d).padStart(2, '0')}`
}

// Suma los conceptos extra de sueldos (aguinaldo / vacaciones) que caen en el
// rango [desde, hasta] según su fecha de imputación. Así el aguinaldo de un mes
// cae en la ÚLTIMA semana de ese mes y en el mensual, sin duplicarse en las
// semanas previas.
// `conceptos`: filas de conceptos_sueldos {mes, tipo, monto}.
// `mesesOp`:   filas de meses_operativos {mes, fecha_cierre}.
export function totalesConceptos(conceptos, mesesOp, desde, hasta) {
  const enRango = (conceptos || []).filter(c => {
    const f = fechaImputacionConcepto(c.mes, mesesOp)
    return f >= desde && f <= hasta
  })
  const aguinaldos = enRango.filter(c => c.tipo === 'aguinaldo').reduce((s, c) => s + (Number(c.monto) || 0), 0)
  const vacaciones = enRango.filter(c => c.tipo === 'vacaciones').reduce((s, c) => s + (Number(c.monto) || 0), 0)
  return { aguinaldos, vacaciones, total: aguinaldos + vacaciones }
}

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
    remitosR,
    movCtaCteR,
    entradasR,
    pagosProvR,
    movProvR,
    gastosR,
    sueldosR,
    clientesR,
    proveedoresR,
    conceptosR,
    mesesOpR,
  ] = await Promise.all([
    // Ventas minoristas (caja) — sólo origen='caja' (cliente cta cte ya cuenta como cobranza)
    supabase
      .from('ventas_minoristas')
      .select('id, fecha, total, efectivo, debito, transferencia, origen')
      .eq('origen', 'caja')
      .gte('fecha', desde)
      .lte('fecha', hasta),

    // Remitos emitidos en el período (mayorista). El cierre usa los REMITOS como
    // fuente de las ventas mayoristas: 1 remito = 1 venta a un cliente, con su
    // fecha de emisión (editable). Es lo que valida en qué semana cae la venta.
    // Excluye anulados y MITRE (casa central, no cliente).
    supabase
      .from('remitos')
      .select('id, numero, fecha, total, cobro, cliente_nombre, eliminado')
      .gte('fecha', desde)
      .lte('fecha', hasta),

    // Movimientos cta cte clientes — cobranzas (pago / cheque)
    supabase
      .from('movimientos_ctacte')
      .select('id, fecha, tipo, debe, haber, cliente_id, cliente_nombre')
      .gte('fecha', desde)
      .lte('fecha', hasta),

    // Entradas al depósito (compras)
    supabase
      .from('entradas_deposito')
      .select('id, fecha, tipo, descripcion, proveedor_nombre, kg, kg_real, precio_kg, importe, destino')
      .eq('eliminado', false)   // los ingresos anulados no cuentan como compra
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
      .select('id, fecha, tipo, categoria, monto, socio, descripcion, solo_balance')
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

    // Conceptos extra de sueldos (aguinaldo / vacaciones). No tienen fecha:
    // se imputan a la SEMANA DE CIERRE de su mes operativo (ver más abajo).
    supabase
      .from('conceptos_sueldos')
      .select('mes, tipo, monto'),

    // Meses operativos → para saber en qué fecha cierra cada mes y así ubicar
    // el aguinaldo/vacaciones en la semana correcta (la última del mes).
    supabase
      .from('meses_operativos')
      .select('mes, fecha_cierre'),
  ])

  const ventasCaja = ventasCajaR.data || []
  // Remitos del período = ventas mayoristas. Excluimos:
  //  - anulados (eliminado): no son ventas reales
  //  - cobro 'interno' (movimiento entre depósito y carnicería)
  //  - "MITRE": es nuestra propia casa central, NO un cliente.
  const remitos = (remitosR.data || []).filter(r =>
    !r.eliminado &&
    r.cobro !== 'interno' &&
    (r.cliente_nombre || '').toUpperCase().trim() !== 'MITRE'
  )
  const movCtaCte = movCtaCteR.data || []
  // Excluir movimientos INTERNOS de las compras (no son compra a proveedor):
  //   - 'desposte'    → piezas que salen de despostar una media res YA comprada
  //   - 'elaboracion' → embutidos elaborados con mercadería YA comprada
  // Tienen importe 0; el cierre antes las sumaba vía kg×precio e inflaba tanto las
  // compras totales como "comprado por proveedor" (ej. PRETTO sumaba sus propios
  // cortes de desposte como si se los hubiéramos vuelto a comprar).
  const entradas = (entradasR.data || []).filter(
    e => e.destino !== 'desposte' && e.destino !== 'elaboracion'
  )
  const pagosProv = pagosProvR.data || []
  const movProv = movProvR.data || []
  // Excluye "solo balance": facturas a nombre de la SAS que paga un tercero
  // (ej: luz Alvear la paga Roxana) — no son egreso nuestro.
  const gastos = (gastosR.data || []).filter(g => !g.solo_balance)
  const sueldos = sueldosR.data || []
  const clientes = clientesR.data || []

  // ====== VENTAS (facturado en el período) ======
  // Total = caja minorista + suma de remitos mayoristas. (Sin pedidos: lo que
  // se entregó ya está como remito; contar pedidos además duplicaría.)
  const ventasCajaTotal = sum(ventasCaja, 'total')
  const ventasMayoristaTotal = sum(remitos, 'total')
  const ventasTotal = ventasCajaTotal + ventasMayoristaTotal

  // ====== COBRADO (caja real en el período) ======
  const cobradoEfectivo = sum(ventasCaja, 'efectivo')
  const cobradoDebito = sum(ventasCaja, 'debito')
  const cobradoTransferencia = sum(ventasCaja, 'transferencia')
  // Cobranzas de cta cte: SOLO pagos reales (efectivo/transferencia). Los cheques
  // NO son cobro nuestro — se endosan a proveedores, no se cobran (no van al flujo).
  const cobranzasCta = movCtaCte
    .filter(m => m.tipo === 'pago')
    .reduce((s, m) => s + (Number(m.haber) || 0), 0)
  // Mayorista cobrada al despachar (remitos con cobro != 'cta_cte')
  const cobradoMayorista = remitos
    .filter(r => r.cobro && r.cobro !== 'cta_cte')
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
  // Los pagos a proveedores se registran en el libro mayor
  // (movimientos_proveedores, tipo='pago' → haber). La tabla vieja
  // `pagos_proveedores` quedó sin uso: si el cierre la leía, daba $0 aunque
  // se hubiera pagado todo. Tomamos los pagos del período desde el ledger.
  const pagosProvPeriodo = movProv.filter(m => m.tipo === 'pago')
  const pagadoProvTotal = pagosProvPeriodo.reduce((s, m) => s + (Number(m.haber) || 0), 0)

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

  // ====== AGUINALDO / VACACIONES ======
  // Los conceptos extra (aguinaldo/vacaciones) se imputan a la fecha de cierre
  // de su mes operativo — ver totalesConceptos(). Así caen en la última semana
  // del mes (y en el mensual) sin duplicarse en las semanas previas.
  const { aguinaldos: aguinaldosTotal, vacaciones: vacacionesTotal, total: conceptosTotal } =
    totalesConceptos(conceptosR?.data || [], mesesOpR?.data || [], desde, hasta)

  // ====== KG (referencia, no afecta cálculo de ganancia) ======
  const sumarKgPorTipo = tipos => entradas
    .filter(e => tipos.some(t => (e.tipo || '').startsWith(t)))
    .reduce((s, e) => s + (Number(e.kg_real || e.kg) || 0), 0)

  const kgCarne = sumarKgPorTipo(['bovino', 'mr_', 'media_res', 'pieza_'])
  const kgPollo = sumarKgPorTipo(['pollo', 'caja_pt'])
  const kgCerdo = sumarKgPorTipo(['cerdo', 'capon'])
  const kgEmbutidos = sumarKgPorTipo(['embutido', 'chorizo', 'morcilla'])

  // ====== VENTAS POR CLIENTE (en el período) ======
  // Suma de los remitos emitidos a cada cliente dentro de [desde, hasta]. La
  // suma coincide con ventas.mayorista. Es cuánto nos compró cada cliente esa
  // semana. (No es el saldo histórico — eso es porCobrar/al cierre.)
  const ventasClienteMap = new Map()
  for (const r of remitos) {
    const nombre = (r.cliente_nombre || '(sin nombre)').trim()
    ventasClienteMap.set(nombre, (ventasClienteMap.get(nombre) || 0) + (Number(r.total) || 0))
  }
  const ventasPorCliente = [...ventasClienteMap.entries()]
    .map(([nombre, total]) => ({ nombre, total }))
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total)

  // ====== COMPRAS POR PROVEEDOR (en el período) ======
  // Lo comprado a cada proveedor dentro del período (mismo criterio de importe
  // que comprasTotal). La suma coincide con compras.total.
  const comprasProvMap = new Map()
  for (const e of entradas) {
    const imp = Number(e.importe) > 0
      ? Number(e.importe)
      : (Number(e.kg_real || e.kg) || 0) * (Number(e.precio_kg) || 0)
    if (!imp) continue
    const nombre = e.proveedor_nombre || '(sin proveedor)'
    comprasProvMap.set(nombre, (comprasProvMap.get(nombre) || 0) + imp)
  }
  const comprasPorProveedor = [...comprasProvMap.entries()]
    .map(([nombre, total]) => ({ nombre, total }))
    .filter(p => p.total > 0)
    .sort((a, b) => b.total - a.total)

  // ====== GANANCIAS ======
  // Devengada: facturado - todos los costos del período (a precio de compra).
  // Aguinaldo/vacaciones se restan como un costo más del período.
  const gananciaDevengada = ventasTotal - comprasTotal - gastosTotal - sueldosTotal - conceptosTotal
  // Caja real: lo que efectivamente entró menos lo que efectivamente salió
  const cajaReal = cobradoTotal - pagadoProvTotal - gastosTotal - sueldosTotal - conceptosTotal

  return {
    periodo: { desde, hasta },
    ventas: {
      caja: ventasCajaTotal,
      mayorista: ventasMayoristaTotal,
      cantRemitos: remitos.length,
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
      cantPagos: pagosProvPeriodo.length,
    },
    porPagarProv: {
      total: totalPorPagar,
      proveedores: proveedoresConDeuda.slice(0, 10),
    },
    // Desgloses POR PERÍODO (no históricos): vendido a cada cliente y comprado
    // a cada proveedor dentro de [desde, hasta].
    ventasPorCliente,
    comprasPorProveedor,
    gastos: {
      fijos: gastosFijos,
      variables: gastosVariables,
      socios: gastosSocios,
      total: gastosTotal,
    },
    sueldos: {
      total: sueldosTotal,
      cantLiquidaciones: sueldos.length,
      aguinaldos: aguinaldosTotal,
      vacaciones: vacacionesTotal,
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
    // El aguinaldo/vacaciones del período se guardan dentro de "sueldos" para
    // que la fila reconcilie (ventas − compras − gastos − sueldos = ganancia).
    sueldos: cierre.sueldos.total + (cierre.sueldos.aguinaldos || 0) + (cierre.sueldos.vacaciones || 0),
    ganancia: cierre.ganancia.devengada,
    ingresos: {
      ventas_caja: cierre.ventas.caja,
      ventas_mayorista: cierre.ventas.mayorista,
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
      sueldos_liquidados: cierre.sueldos.total,
      aguinaldos: cierre.sueldos.aguinaldos || 0,
      vacaciones: cierre.sueldos.vacaciones || 0,
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
