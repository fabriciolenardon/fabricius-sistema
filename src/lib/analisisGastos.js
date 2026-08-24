// ============================================================
// analisisGastos.js — estructura de costos del negocio y cuánto
// de esa estructura tiene que soportar CADA PRODUCTO.
// ============================================================
// La pregunta que responde: "¿qué % de mi facturación (y de mi
// ganancia) se lleva cada gasto, y cuánto tengo que cargarle a un
// producto para que el precio pague la estructura y encima deje
// rentabilidad?".
//
// El armado del período es el MISMO que usa el Cierre
// (calcularCierreAuto) para que los números coincidan con el
// Cierre y el Dashboard Ejecutivo — no se recalcula nada aparte:
//
//   FACTURACIÓN  = minorista (caja) + mayorista (remitos)
//   − MERCADERÍA = compras a proveedores del período
//   = MARGEN BRUTO
//   − SUELDOS    = liquidaciones + aguinaldo/vacaciones imputados
//   − FIJOS      = alquiler, luz, internet, ART, impuestos…
//   − VARIABLES  = combustible, peajes, insumos, limpieza…
//   = RESULTADO OPERATIVO
//   − SOCIOS     = retiros de los dueños (NO es costo del producto)
//   = GANANCIA (la misma "devengada" del Cierre)
//
// REGLA IMPORTANTE (la que se equivoca siempre a mano):
// para cargarle la estructura a un producto NO se SUMA el % —
// se DIVIDE. Si la estructura se lleva el 25% de cada peso
// vendido y querés 15% de rentabilidad, el precio no es
// costo × 1,40: es costo / (1 − 0,25 − 0,15) = costo / 0,60.
// Sumando quedás siempre corto (ver precioSugerido()).
// ============================================================
import { calcularCierreAuto } from './cierreAuto'
import { calcularControlSemanal } from './controlSemanal'

const n = v => Number(v) || 0
const pct = (parte, total) => (total > 0 ? (n(parte) / total) * 100 : null)

// Etiquetas de las categorías de gastos (espejo de CATEGORIAS en Gastos.jsx)
export const LABEL_CATEGORIA = {
  vehiculo: '🚗 Vehículo', peaje: '🛣️ Peaje', insumos: '📦 Insumos',
  limpieza: '🧹 Limpieza', tripas: '🔗 Tripas', art: '🏥 ART',
  impuestos: '📋 Impuestos / ARCA', luz: '💡 Luz', alquiler: '🏠 Alquiler',
  redes: '📱 Diseño / Redes', otro: '📝 Otro',
}
export const labelCategoria = c => LABEL_CATEGORIA[c] || '📝 Otro'

// Normaliza la descripción para agrupar el mismo gasto mes a mes
// ("Luz Alvear", "LUZ ALVEAR " y "luz  alvear" son el mismo concepto).
export function claveConcepto(desc) {
  return String(desc || '(sin detalle)')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim()
}

/**
 * Estructura de costos del período [desde, hasta].
 *
 * @param {string} desde  YYYY-MM-DD (ARG)
 * @param {string} hasta  YYYY-MM-DD (ARG)
 * @param {Array}  gastos filas de `gastos` YA cargadas en la pantalla
 *                        (se filtran por fecha acá; se excluye solo_balance
 *                        igual que en el Cierre).
 */
export async function calcularEstructura(desde, hasta, gastos) {
  const [cierre, control] = await Promise.all([
    calcularCierreAuto(desde, hasta),
    calcularControlSemanal(desde, hasta).catch(() => null), // los kg son opcionales
  ])

  const facturacion = n(cierre.ventas.total)
  const mercaderia = n(cierre.compras.total)
  const sueldos = n(cierre.sueldos.total) + n(cierre.sueldos.aguinaldos) + n(cierre.sueldos.vacaciones)
  const fijos = n(cierre.gastos.fijos)
  const variables = n(cierre.gastos.variables)
  const socios = n(cierre.gastos.socios)

  const margenBruto = facturacion - mercaderia
  const estructura = sueldos + fijos + variables          // lo que carga el producto
  const resultadoOperativo = margenBruto - estructura
  const ganancia = n(cierre.ganancia.devengada)           // ya descuenta socios

  const dias = Math.max(1, Math.round(
    (new Date(hasta + 'T12:00') - new Date(desde + 'T12:00')) / 86400000) + 1)

  const kgVendidos = (control?.vendido || []).reduce((s, v) => s + n(v.total), 0)

  // ── Detalle línea por línea (mismo filtro que el Cierre) ──
  const delPeriodo = (gastos || []).filter(g =>
    !g.solo_balance && g.fecha >= desde && g.fecha <= hasta && g.tipo !== 'ingreso')

  // categoría → { total, conceptos: Map(clave → {label, monto, veces}) }
  const catMap = new Map()
  for (const g of delPeriodo) {
    const key = `${g.tipo}|${g.categoria || 'otro'}`
    const c = catMap.get(key) || { tipo: g.tipo, categoria: g.categoria || 'otro', total: 0, conceptos: new Map() }
    c.total += n(g.monto)
    const ck = claveConcepto(g.descripcion)
    const con = c.conceptos.get(ck) || { label: (g.descripcion || '(sin detalle)').trim(), monto: 0, veces: 0 }
    con.monto += n(g.monto); con.veces++
    c.conceptos.set(ck, con)
    catMap.set(key, c)
  }

  // Cada línea con sus tres lecturas: sobre facturación, sobre ganancia y
  // sobre la estructura. `pctGanancia` es "cuánto de tu ganancia se llevó"
  // → null si el período no dio ganancia (dividir por ≤0 no significa nada).
  const conLecturas = (label, monto, extra = {}) => ({
    label, monto,
    pctFacturacion: pct(monto, facturacion),
    pctGanancia: ganancia > 0 ? pct(monto, ganancia) : null,
    pctEstructura: pct(monto, estructura),
    porDia: monto / dias,
    porKg: kgVendidos > 0 ? monto / kgVendidos : null,
    ...extra,
  })

  const lineas = [...catMap.values()]
    .map(c => conLecturas(labelCategoria(c.categoria), c.total, {
      tipo: c.tipo,
      categoria: c.categoria,
      conceptos: [...c.conceptos.values()]
        .map(x => conLecturas(x.label, x.monto, { veces: x.veces }))
        .sort((a, b) => b.monto - a.monto),
    }))
    .sort((a, b) => b.monto - a.monto)

  // Bloques grandes, para el ranking "quién se lleva la plata"
  const bloques = [
    conLecturas('🥩 Mercadería (compras)', mercaderia, { clave: 'mercaderia' }),
    conLecturas('👷 Sueldos', sueldos, { clave: 'sueldos' }),
    conLecturas('📌 Gastos fijos', fijos, { clave: 'fijos' }),
    conLecturas('💸 Gastos variables', variables, { clave: 'variables' }),
    conLecturas('👤 Retiros de socios', socios, { clave: 'socios' }),
  ].filter(b => b.monto > 0)

  // ── Coeficientes para el costeo de productos ──
  // cargaPct: de cada $100 vendidos, cuántos se van en estructura.
  const cargaPct = pct(estructura, facturacion) ?? 0
  const mercaderiaPct = pct(mercaderia, facturacion) ?? 0
  const margenBrutoPct = pct(margenBruto, facturacion) ?? 0
  const gananciaPct = pct(ganancia, facturacion) ?? 0
  // Punto de equilibrio: cuánto hay que facturar para cubrir la estructura
  // con el margen bruto que dejan los productos hoy.
  const puntoEquilibrio = margenBrutoPct > 0 ? estructura / (margenBrutoPct / 100) : null

  return {
    periodo: { desde, hasta, dias },
    facturacion, mercaderia, margenBruto, sueldos, fijos, variables, socios,
    estructura, resultadoOperativo, ganancia,
    kgVendidos,
    ventas: { minorista: n(cierre.ventas.caja), mayorista: n(cierre.ventas.mayorista) },
    lineas, bloques,
    coef: {
      cargaPct, mercaderiaPct, margenBrutoPct, gananciaPct,
      estructuraPorDia: estructura / dias,
      estructuraPorKg: kgVendidos > 0 ? estructura / kgVendidos : null,
      puntoEquilibrio,
      puntoEquilibrioDia: puntoEquilibrio != null ? puntoEquilibrio / dias : null,
    },
  }
}

/**
 * Precio de venta que deja la rentabilidad buscada DESPUÉS de pagar la
 * estructura, las comisiones y la merma.
 *
 * Se divide, no se suma: los porcentajes son sobre el PRECIO FINAL, no
 * sobre el costo. Devuelve precio null si los porcentajes se comen el 100%.
 */
export function precioSugerido({ costoKg, mermaPct = 0, cargaPct = 0, comisionesPct = 0, rentabilidadPct = 0 }) {
  const costo = n(costoKg)
  const merma = Math.min(n(mermaPct), 99.9)
  // La merma encarece el kilo vendible: de 1 kg comprado vendés (1 − merma).
  const costoReal = costo / (1 - merma / 100)
  const cargas = (n(cargaPct) + n(comisionesPct) + n(rentabilidadPct)) / 100
  if (cargas >= 1) return { costoReal, precio: null, error: 'Los porcentajes suman 100% o más — no hay precio posible.' }
  const precio = costoReal / (1 - cargas)
  return {
    costoReal,
    precio,
    // Cómo se reparte cada peso del precio final
    reparto: {
      mercaderia: costoReal,
      estructura: precio * (n(cargaPct) / 100),
      comisiones: precio * (n(comisionesPct) / 100),
      ganancia: precio * (n(rentabilidadPct) / 100),
    },
    // El multiplicador sobre el costo de compra (lo que se usa a ojo)
    multiplicador: costo > 0 ? precio / costo : null,
  }
}

/** Lo que deja REALMENTE un precio que ya estás cobrando. */
export function rentabilidadDe({ precio, costoKg, mermaPct = 0, cargaPct = 0, comisionesPct = 0 }) {
  const p = n(precio)
  if (p <= 0) return null
  const costoReal = n(costoKg) / (1 - Math.min(n(mermaPct), 99.9) / 100)
  const estructura = p * (n(cargaPct) / 100)
  const comisiones = p * (n(comisionesPct) / 100)
  const ganancia = p - costoReal - estructura - comisiones
  return { costoReal, estructura, comisiones, ganancia, gananciaPct: (ganancia / p) * 100 }
}
