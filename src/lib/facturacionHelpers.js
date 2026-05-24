// ============================================================
// HELPERS DE FACTURACIÓN
// ============================================================
// Cálculos de proyección, distribución y vencimientos para el
// módulo de facturación multi-cuenta.
// ============================================================
import { TOPE_MAX_ABSOLUTO, topeAnual, proximaRecategorizacion } from './monotributo2026'
import { fechaHoyARG } from './fechas'

// ─────────────────────────────────────────────────────────────
// PROYECCIÓN: estima cuánto va a facturar la cuenta en los
// próximos 12 meses según el ritmo de los últimos 3 meses.
// ─────────────────────────────────────────────────────────────
export function proyectarFacturacionAnual(facturasEmitidas) {
  if (!facturasEmitidas || facturasEmitidas.length === 0) return 0
  // Tomar últimos 90 días (3 meses) como referencia. fechaHoyARG (no UTC)
  // evita corrimientos cerca de la medianoche.
  const hace90 = new Date(); hace90.setDate(hace90.getDate() - 90)
  const hace90ISO = fechaHoyARG(hace90)
  const recientes = facturasEmitidas.filter(f => f.fecha >= hace90ISO)
  if (recientes.length === 0) {
    // Si no hubo nada en 3 meses, proyectar con últimos 12 meses
    const hace365 = new Date(); hace365.setDate(hace365.getDate() - 365)
    const hace365ISO = fechaHoyARG(hace365)
    const ultimoAno = facturasEmitidas.filter(f => f.fecha >= hace365ISO)
    return ultimoAno.reduce((s, f) => s + (Number(f.monto_total) || 0), 0)
  }
  const total90 = recientes.reduce((s, f) => s + (Number(f.monto_total) || 0), 0)
  // Promedio mensual × 12 meses
  return (total90 / 3) * 12
}

// ─────────────────────────────────────────────────────────────
// DISTRIBUCIÓN: dado un monto a facturar, devuelve cuánto
// asignar a cada cuenta para que TODAS queden al mismo % del
// tope K (la idea es equilibrarlas, no llenar una sola).
// ─────────────────────────────────────────────────────────────
export function distribuirEntreCuentas(monto, cuentasConFacturacion) {
  // cuentasConFacturacion = [{ id, nombre, facturado12m, tope }]
  // Solo distribuir entre monotributistas (las RI/SAS no tienen tope)
  const monos = cuentasConFacturacion.filter(c => c.tope > 0)
  if (monos.length === 0 || monto <= 0) return []

  // El "espacio libre" de cada cuenta = tope - facturado
  const espacios = monos.map(c => ({ ...c, libre: Math.max(0, c.tope - c.facturado12m) }))
  const espacioTotal = espacios.reduce((s, c) => s + c.libre, 0)

  if (monto > espacioTotal) {
    // No alcanza ni llenando todo el monotributo
    return espacios.map(c => ({
      ...c,
      asignar: c.libre,
      pctFinal: 100,
      alerta: 'No alcanza el espacio total — exceso $' + Math.round(monto - espacioTotal).toLocaleString('es-AR'),
    }))
  }

  // Algoritmo: queremos que TODAS queden al mismo % final del tope.
  // Si cuenta i queda en pct% final: facturadoFinal_i = pct * tope_i
  // Suma de incrementos = monto:  Σ (pct * tope_i - facturado_i) = monto
  // pct = (Σ facturado_i + monto) / Σ tope_i
  const sumaFact = espacios.reduce((s, c) => s + c.facturado12m, 0)
  const sumaTopes = espacios.reduce((s, c) => s + c.tope, 0)
  const pctFinal = (sumaFact + monto) / sumaTopes

  return espacios.map(c => {
    const facturadoFinal = pctFinal * c.tope
    let asignar = facturadoFinal - c.facturado12m
    // Si una cuenta ya estaba arriba del pctFinal, asignamos 0 (no podemos quitarle)
    if (asignar < 0) asignar = 0
    return {
      ...c,
      asignar: Math.round(asignar),
      pctFinal: ((c.facturado12m + asignar) / c.tope) * 100,
    }
  })
}

// ─────────────────────────────────────────────────────────────
// VENCIMIENTOS Y AVISOS — devuelve array de alertas para mostrar
// ─────────────────────────────────────────────────────────────
export function calcularAvisos(cuentas, impuestosPagados, hoy = new Date()) {
  const avisos = []
  const yyyy = hoy.getFullYear()
  const mmActual = hoy.getMonth() + 1
  const dia = hoy.getDate()

  // 1) Cuota mensual de monotributo — vence ~día 20 de cada mes
  cuentas.forEach(c => {
    if (c.tipo !== 'monotributo') return
    if (!c.activa) return
    const yaPago = impuestosPagados.some(p =>
      p.cuenta_id === c.id &&
      p.concepto === 'monotributo' &&
      p.periodo_anio === yyyy &&
      p.periodo_mes === mmActual
    )
    if (!yaPago) {
      if (dia <= 20) {
        // Pendiente, todavía en término
        const diasRest = 20 - dia
        avisos.push({
          tipo: diasRest <= 5 ? 'warning' : 'info',
          cuenta: c.nombre,
          titulo: `Cuota Monotributo ${c.nombre}`,
          sub: diasRest === 0 ? '🚨 Vence HOY' : diasRest < 0 ? '🚨 VENCIDA' : `Vence en ${diasRest} día${diasRest === 1 ? '' : 's'}`,
          icono: '📘',
        })
      } else {
        // Pasado el día 20 sin pago
        avisos.push({
          tipo: 'danger',
          cuenta: c.nombre,
          titulo: `Cuota Monotributo VENCIDA — ${c.nombre}`,
          sub: `Período ${String(mmActual).padStart(2, '0')}/${yyyy} sin registrar pago`,
          icono: '🚨',
        })
      }
    }
  })

  // 2) Recategorización (enero/julio)
  const prox = proximaRecategorizacion(hoy)
  const diasARec = Math.ceil((prox - hoy) / (1000 * 60 * 60 * 24))
  if (diasARec <= 30 && diasARec >= 0) {
    avisos.push({
      tipo: diasARec <= 7 ? 'warning' : 'info',
      titulo: `Recategorización ARCA en ${diasARec} día${diasARec === 1 ? '' : 's'}`,
      sub: `Fecha estimada: ${prox.toLocaleDateString('es-AR')} — revisá categoría de cada monotributista`,
      icono: '📅',
    })
  }

  return avisos
}
