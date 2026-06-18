// ============================================================
// BALANCE / CIERRE DE EJERCICIO — catálogo y cálculos
// ============================================================
// Define el "plan de cuentas reducido" del balance de la SAS y la
// lógica para calcular el Estado de Resultados y el Estado de
// Situación Patrimonial a partir de:
//   - los totales automáticos de `facturas` (ventas/compras netas), y
//   - las líneas manuales (`ejercicio_lineas`) + valores especiales
//     del ejercicio (existencia inicial/final, impuesto a las ganancias).
//
// Dos valores "enganchan" los dos estados (no se cargan dos veces):
//   - Existencia final  → resta en el CMV del ER y figura como
//     "Bienes de cambio" en el Activo Corriente.
//   - Resultado del ejercicio → sale del ER y figura en el Patrimonio Neto.
// ============================================================

// ─── Secciones del Estado de Resultados ───
export const SECCIONES_ER = {
  gastos:         'Gastos de comercialización y administración',
  otros_ingresos: 'Otros ingresos',
  otros_egresos:  'Resultados financieros y otros egresos',
}

// ─── Secciones del Estado de Situación Patrimonial ───
export const SECCIONES_ESP = {
  activo_corriente:     'Activo Corriente',
  activo_no_corriente:  'Activo No Corriente',
  pasivo_corriente:     'Pasivo Corriente',
  pasivo_no_corriente:  'Pasivo No Corriente',
  patrimonio_neto:      'Patrimonio Neto',
}

export const SECCIONES_ACTIVO = ['activo_corriente', 'activo_no_corriente']
export const SECCIONES_PASIVO = ['pasivo_corriente', 'pasivo_no_corriente']

// ─── Catálogo estándar de rubros (se siembra al crear un ejercicio) ───
// Cada uno arranca en $0; el usuario completa montos y puede agregar/borrar.
export const RUBROS_DEFAULT = [
  // ===== Estado de Resultados — gastos =====
  { estado: 'resultados', seccion: 'gastos', rubro: 'Sueldos y cargas sociales' },
  { estado: 'resultados', seccion: 'gastos', rubro: 'Honorarios' },
  { estado: 'resultados', seccion: 'gastos', rubro: 'Alquileres' },
  { estado: 'resultados', seccion: 'gastos', rubro: 'Servicios (luz, gas, agua, teléfono, internet)' },
  { estado: 'resultados', seccion: 'gastos', rubro: 'Fletes y movilidad' },
  { estado: 'resultados', seccion: 'gastos', rubro: 'Mantenimiento y reparaciones' },
  { estado: 'resultados', seccion: 'gastos', rubro: 'Impuestos y tasas (IIBB, municipal)' },
  { estado: 'resultados', seccion: 'gastos', rubro: 'Gastos bancarios y comisiones' },
  { estado: 'resultados', seccion: 'gastos', rubro: 'Amortización de bienes de uso' },
  { estado: 'resultados', seccion: 'gastos', rubro: 'Otros gastos' },

  // ===== Estado de Situación Patrimonial — Activo Corriente =====
  { estado: 'patrimonial', seccion: 'activo_corriente', rubro: 'Caja y bancos' },
  { estado: 'patrimonial', seccion: 'activo_corriente', rubro: 'Créditos por ventas (deudores)' },
  { estado: 'patrimonial', seccion: 'activo_corriente', rubro: 'Otros créditos (IVA saldo a favor, anticipos)' },
  // "Bienes de cambio" NO es línea manual: se engancha con la existencia final.

  // ===== Activo No Corriente =====
  { estado: 'patrimonial', seccion: 'activo_no_corriente', rubro: 'Bienes de uso (neto de amortizaciones)' },
  { estado: 'patrimonial', seccion: 'activo_no_corriente', rubro: 'Otros activos no corrientes' },

  // ===== Pasivo Corriente =====
  { estado: 'patrimonial', seccion: 'pasivo_corriente', rubro: 'Deudas comerciales (proveedores)' },
  { estado: 'patrimonial', seccion: 'pasivo_corriente', rubro: 'Deudas fiscales (IVA, Ganancias, IIBB)' },
  { estado: 'patrimonial', seccion: 'pasivo_corriente', rubro: 'Deudas sociales (sueldos y cargas a pagar)' },
  { estado: 'patrimonial', seccion: 'pasivo_corriente', rubro: 'Deudas bancarias y financieras' },
  { estado: 'patrimonial', seccion: 'pasivo_corriente', rubro: 'Otras deudas' },

  // ===== Pasivo No Corriente =====
  { estado: 'patrimonial', seccion: 'pasivo_no_corriente', rubro: 'Deudas a largo plazo' },

  // ===== Patrimonio Neto =====
  { estado: 'patrimonial', seccion: 'patrimonio_neto', rubro: 'Capital social' },
  { estado: 'patrimonial', seccion: 'patrimonio_neto', rubro: 'Reservas' },
  { estado: 'patrimonial', seccion: 'patrimonio_neto', rubro: 'Resultados no asignados (ejercicios anteriores)' },
  // "Resultado del ejercicio" NO es línea manual: se engancha con el ER.
]

// Devuelve el catálogo default con orden incremental, listo para insertar.
export function rubrosDefaultParaEjercicio(ejercicioId) {
  return RUBROS_DEFAULT.map((r, i) => ({
    ejercicio_id: ejercicioId,
    estado: r.estado,
    seccion: r.seccion,
    rubro: r.rubro,
    monto: 0,
    orden: i,
  }))
}

const n = v => Number(v) || 0
const sumLineas = (lineas, estado, seccion) =>
  (lineas || [])
    .filter(l => l.estado === estado && l.seccion === seccion)
    .reduce((a, l) => a + n(l.monto), 0)

// ============================================================
// computeBalance — calcula todos los subtotales y totales.
//   ej    : fila de `ejercicios` (usa existencia_inicial/final, impuesto_ganancias)
//   lineas: array de `ejercicio_lineas`
//   auto  : objeto del RPC ejercicio_resultados_auto (ventas_netas, compras_netas, ...)
// Devuelve un objeto plano con todo lo necesario para render, snapshot y PDF.
// ============================================================
export function computeBalance(ej, lineas, auto) {
  const a = auto || {}
  const existIni = n(ej?.existencia_inicial)
  const existFin = n(ej?.existencia_final)
  const impGan   = n(ej?.impuesto_ganancias)

  // ---- Estado de Resultados ----
  const ventasNetas  = n(a.ventas_netas)
  const comprasNetas = n(a.compras_netas)
  const cmv          = existIni + comprasNetas - existFin       // costo de mercadería vendida
  const resultadoBruto = ventasNetas - cmv

  const gastos        = sumLineas(lineas, 'resultados', 'gastos')
  const otrosIngresos = sumLineas(lineas, 'resultados', 'otros_ingresos')
  const otrosEgresos  = sumLineas(lineas, 'resultados', 'otros_egresos')

  const resultadoOperativo = resultadoBruto - gastos
  const resultadoAntesImp  = resultadoOperativo + otrosIngresos - otrosEgresos
  const resultadoEjercicio = resultadoAntesImp - impGan

  // ---- Estado de Situación Patrimonial ----
  const bienesCambio   = existFin                               // enganchado con existencia final
  const activoCteManual = sumLineas(lineas, 'patrimonial', 'activo_corriente')
  const activoCorriente = activoCteManual + bienesCambio
  const activoNoCorriente = sumLineas(lineas, 'patrimonial', 'activo_no_corriente')
  const totalActivo = activoCorriente + activoNoCorriente

  const pasivoCorriente   = sumLineas(lineas, 'patrimonial', 'pasivo_corriente')
  const pasivoNoCorriente = sumLineas(lineas, 'patrimonial', 'pasivo_no_corriente')
  const totalPasivo = pasivoCorriente + pasivoNoCorriente

  const pnManual = sumLineas(lineas, 'patrimonial', 'patrimonio_neto')   // capital, reservas, resultados no asignados
  const totalPN  = pnManual + resultadoEjercicio                          // + resultado del ejercicio (enganchado)

  const diferencia = totalActivo - (totalPasivo + totalPN)                // debe ser 0 para cuadrar
  const cuadra = Math.abs(diferencia) < 1                                 // tolerancia 1 peso por redondeo

  return {
    // ER
    ventasNetas, comprasNetas, existIni, existFin, cmv, resultadoBruto,
    gastos, otrosIngresos, otrosEgresos,
    resultadoOperativo, resultadoAntesImp, impGan, resultadoEjercicio,
    // ESP
    bienesCambio, activoCteManual, activoCorriente, activoNoCorriente, totalActivo,
    pasivoCorriente, pasivoNoCorriente, totalPasivo,
    pnManual, totalPN,
    diferencia, cuadra,
    // crudos
    auto: a,
  }
}
