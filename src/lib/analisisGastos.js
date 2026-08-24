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

// ============================================================
// El depósito y el catálogo le dicen distinto a lo mismo: las piezas
// bovinas se despachan como `pieza_entera` (o al bucket específico
// `pieza_costillar`, `pieza_cortito`, …) pero en la lista de precios
// viven bajo `bovino_pieza`. Sin unificar, la misma mercadería sale en
// dos filas: una con precios y sin kilos, otra con kilos y sin precios.
export function categoriaCanonica(c) {
  const k = String(c || '')
  if (k === 'pieza_entera' || k.startsWith('pieza_')) return 'bovino_pieza'
  return k
}

// Junta las filas de vendido que caen en la misma categoría canónica,
// sumando kilos, plata y el desglose por lista.
function unificarVendido(vendido) {
  const m = new Map()
  for (const v of vendido || []) {
    const k = categoriaCanonica(v.categoria)
    const a = m.get(k) || { categoria: k, may: 0, min: 0, total: 0, impMay: 0, impMin: 0, importe: 0, listas: {} }
    a.may += n(v.may); a.min += n(v.min); a.total += n(v.total)
    a.impMay += n(v.impMay); a.impMin += n(v.impMin); a.importe += n(v.importe)
    for (const [lista, x] of Object.entries(v.listas || {})) {
      const l = a.listas[lista] || { kg: 0, imp: 0 }
      l.kg += n(x.kg); l.imp += n(x.imp)
      a.listas[lista] = l
    }
    m.set(k, a)
  }
  return [...m.values()].map(a => ({
    ...a,
    realPorKg: a.total > 0.01 ? a.importe / a.total : null,
  }))
}

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

  // Kg vendidos por categoría (mayorista y minorista por separado). Sirven
  // para dos cosas: el $/kg de cada gasto y el precio promedio REAL por kilo
  // de cada canal (facturación ÷ kg), que es el que se compara contra el
  // promedio de la lista.
  const vendidoPorCategoria = unificarVendido(control?.vendido)
  const kgVendidos = vendidoPorCategoria.reduce((s, v) => s + n(v.total), 0)
  const kgMay = vendidoPorCategoria.reduce((s, v) => s + n(v.may), 0)
  const kgMin = vendidoPorCategoria.reduce((s, v) => s + n(v.min), 0)

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

  // La misma categoría puede estar cargada como fijo Y como variable (ej.
  // Insumos), así que la fila lleva el tipo al lado — si no, en la tabla se
  // ven dos "Insumos" y parece un duplicado.
  const SUFIJO_TIPO = { fijo: 'fijo', variable: 'variable', socio: 'socio' }
  const lineas = [...catMap.values()]
    .map(c => conLecturas(`${labelCategoria(c.categoria)} · ${SUFIJO_TIPO[c.tipo] || c.tipo}`, c.total, {
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
    kgVendidos, kgMay, kgMin, vendidoPorCategoria,
    ventas: { minorista: n(cierre.ventas.caja), mayorista: n(cierre.ventas.mayorista) },
    // Precio promedio REAL por kilo: lo que efectivamente entró dividido los
    // kilos que salieron. Es el número honesto — ya trae adentro el mix de
    // productos, las ofertas y los descuentos.
    realPorKg: {
      minorista: kgMin > 0 ? n(cierre.ventas.caja) / kgMin : null,
      mayorista: kgMay > 0 ? n(cierre.ventas.mayorista) / kgMay : null,
      global: kgVendidos > 0 ? facturacion / kgVendidos : null,
    },
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

// ============================================================
// PRECIO PROMEDIO POR KILO DE CADA LISTA
// ============================================================
// Se venden por UNIDAD, no por kilo: promediar su precio con el de la
// carne no significa nada (una gaseosa "vale" menos que un kilo de lomo
// sin que eso diga nada del precio del kilo).
const CAT_SIN_KG = new Set(['almacen', 'bebidas', 'insumos'])

// Precio POR KILO de un producto en una lista.
//
// El que manda es `kg_por_unidad`: si está cargado, el precio es de un
// BULTO (cajón de 20 kg, caja de menudos de 15) y hay que dividirlo, o el
// cajón de pechuga de $92.000 entra al promedio como si fuera un kilo.
// `pesable` NO sirve para decidir: hay cajones con pesable=true (CAJA MDM,
// CAJON DE MENUDOS) y cortes que se venden por kilo con pesable=false
// (los Novara PT). Con kg_por_unidad vacío, el precio ya es por kilo.
function precioPorKg(p, campo) {
  const precio = n(p[campo])
  if (precio <= 0) return null
  if (CAT_SIN_KG.has(p.categoria)) return null
  const kpu = n(p.kg_por_unidad)
  return kpu > 0 ? precio / kpu : precio
}

/**
 * Promedio del kilo de cada lista de precios, de dos maneras:
 *
 *   - SIMPLE: sumar el precio de todos los productos y dividir por la
 *     cantidad. Es "cómo está parada la lista": trata igual al hueso que
 *     al lomo, así que NO es lo que cobrás en promedio.
 *   - PONDERADO: el mismo promedio pero pesado por los KILOS que se
 *     vendieron de cada categoría en el período. Ése sí se parece a la
 *     realidad, porque los productos que más movés pesan más.
 *
 * @param {Array} precios              filas de `precios`
 * @param {Array} vendidoPorCategoria  [{categoria, may, min, total}] del período
 */
export function promediosDeListas(precios, vendidoPorCategoria) {
  // `claves` son los valores de salidas_deposito.lista (y 'caja' para el
  // mostrador) que corresponden a cada lista. Cada lista se pesa con los
  // kilos que salieron POR ESA LISTA, no con el total del negocio: la media
  // res sale siempre a precio carnicería (franquicias y carnicerías), y al
  // cliente mayorista común no le vendés medias. Pesarla en la lista
  // mayorista daría un promedio que nadie paga.
  const LISTAS = [
    { codigo: 'min', label: '🟢 Minorista', campo: 'precio_minorista', claves: ['caja', 'precio_minorista'] },
    { codigo: 'may', label: '🟡 Mayorista', campo: 'precio_mayorista', claves: ['precio_mayorista'] },
    { codigo: 'carn', label: '🔴 Carnicería', campo: 'precio_carniceria', claves: ['precio_carniceria'] },
  ]

  return LISTAS.map(l => {
    // Kilos y plata que salieron por esta lista, por categoría
    const movido = new Map()
    for (const v of vendidoPorCategoria || []) {
      let kg = 0, imp = 0
      for (const k of l.claves) {
        const x = v.listas?.[k]
        if (x) { kg += n(x.kg); imp += n(x.imp) }
      }
      if (kg > 0.01) movido.set(v.categoria, { kg, imp })
    }

    // Promedio de la lista por categoría (y el simple, sobre todo el catálogo)
    const porCat = new Map()
    let suma = 0, cant = 0
    for (const p of precios || []) {
      const pk = precioPorKg(p, l.campo)
      if (pk == null) continue
      suma += pk; cant++
      const cat = categoriaCanonica(p.categoria)
      const c = porCat.get(cat) || { suma: 0, cant: 0 }
      c.suma += pk; c.cant++
      porCat.set(cat, c)
    }

    // Ponderado y precio real, ambos sobre lo que salió por esta lista
    let pesoTotal = 0, acum = 0, kgReal = 0, impReal = 0
    const categorias = []
    for (const [categoria, c] of porCat) {
      const prom = c.suma / c.cant
      const m = movido.get(categoria)
      const kg = m ? m.kg : 0
      categorias.push({
        categoria, promedio: prom, productos: c.cant, kg,
        real: m && m.kg > 0.01 ? m.imp / m.kg : null,
      })
      if (kg > 0) { acum += prom * kg; pesoTotal += kg }
    }
    // El real toma TODO lo que salió por la lista, tenga o no precio cargado
    for (const [, m] of movido) { kgReal += m.kg; impReal += m.imp }

    return {
      ...l,
      productos: cant,
      simple: cant > 0 ? suma / cant : null,
      ponderado: pesoTotal > 0 ? acum / pesoTotal : null,
      real: kgReal > 0.01 ? impReal / kgReal : null,
      kgVendidos: kgReal,
      categorias: categorias.sort((a, b) => b.kg - a.kg),
    }
  })
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
