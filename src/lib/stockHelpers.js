// ============================================================
// HELPERS DE STOCK — conversiones y mapeos compartidos
// ============================================================
// Centraliza la lógica de cómo se descuenta cada categoría de venta
// del `stock_actual`. Hay 3 casos a distinguir:
//
//   1. Por kg (carnes): item.kg representa kg → se descuenta tal cual
//      del stock kg del tipo correspondiente.
//      Ej: bovino_corte → stock_actual.tipo='bovino_corte', −item.kg
//
//   2. Por unidad con stock propio (almacen, bebidas, cajas CB/PT):
//      item.kg representa cantidad de unidades. El stock_actual ya
//      lleva la cuenta en unidades (campo se llama kg_disponible por
//      compatibilidad histórica). Se descuenta tal cual.
//      Ej: almacen → stock_actual.tipo='almacen', −item.kg unidades
//
//   3. Por unidad pero stock kg del padre (cajones de pollo/rebozado):
//      item.kg representa cantidad de cajones. El stock se lleva en
//      kg del producto base ('pollo' o 'rebozado'). Hay que multiplicar
//      las unidades por los kg que pesa cada cajón antes de descontar.
//      Ej: 3 cajones de "Suprema B X20KG" → 3 × 20 = 60 kg de pollo
// ============================================================

// ───────────────────────────────────────────────────────────
// TOLERANCIA DE REDONDEO — un 0 es 0, no un negativo
// ───────────────────────────────────────────────────────────
// El stock se calcula sumando y restando floats (venta por venta, desposte
// por desposte), así que un bucket que llegó a cero REAL queda con residuo:
// pieza_costillar y pieza_costeletal terminaron en -0,0000000000000036 kg y
// pieza_pierna en -0,000000000000021.
//
// En pantalla eso se muestra como "0" (todo se formatea con 2 decimales),
// pero para el código `valor < 0` daba true: el 0 se pintaba en rojo, entraba
// al filtro 🚨 Negativos y disparaba la alerta "Stock NEGATIVO" del dashboard
// como si se hubiera vendido mercadería sin ingresar.
//
// Criterio: si en pantalla dice 0, es 0 — stock neutro, ni negativo ni
// positivo. Como todo se muestra con 2 decimales, cualquier |valor| menor a
// 0,005 redondea a cero. Son 5 gramos: por debajo de eso no hay faltante real
// que avisar.
export const EPSILON_STOCK = 0.005

// ¿El bucket está REALMENTE en negativo? Usar siempre esto en vez de
// `valor < 0` para alertas, filtros y colores de stock.
export function esStockNegativo(valor) {
  return (Number(valor) || 0) < -EPSILON_STOCK
}

// Colapsa el residuo a cero: -0,0000000000000036 → 0. Para mostrar y para
// calcular diferencias contra el conteo físico (si no, "0 → 0" daba un ajuste
// fantasma de +0).
export function stockNormalizado(valor) {
  const n = Number(valor) || 0
  return Math.abs(n) < EPSILON_STOCK ? 0 : n
}

// ───────────────────────────────────────────────────────────
// PRECISIÓN AL GUARDAR — 5 enteros + 3 decimales
// ───────────────────────────────────────────────────────────
// El stock se guarda con precisión de 1 GRAMO y tope de 99.999,999 kg
// (345,340 = 345 kg con 340 gramos). Así el residuo de float no se acumula
// escritura tras escritura en vez de tener que limpiarlo después.
//
// La garantía de verdad está en la base: `stock_actual.kg_disponible` es
// numeric(8,3) (migración 91), así que Postgres redondea igual venga de donde
// venga la escritura. redondearStock() es la primera línea de defensa: deja
// el número lindo antes de mandarlo y hace que la UI muestre lo mismo que
// quedó guardado.
export const DECIMALES_STOCK = 3      // gramos
export const TOPE_STOCK = 99999.999   // 5 dígitos para el entero

export function redondearStock(valor) {
  const n = Number(valor)
  if (!Number.isFinite(n)) return 0
  const r = Math.round(n * 1000) / 1000
  // Sin el clamp, un valor de 100.000+ lo rechaza la base con "numeric field
  // overflow" y se pierde el movimiento entero.
  if (r > TOPE_STOCK) return TOPE_STOCK
  if (r < -TOPE_STOCK) return -TOPE_STOCK
  return r
}

// ¿Este valor se pasa del tope? Para avisar ANTES de intentar guardarlo
// (el clamp de redondearStock es la red, no el mensaje al usuario).
export function excedeTopeStock(valor) {
  const n = Number(valor)
  return Number.isFinite(n) && Math.abs(n) > TOPE_STOCK
}

// Extrae el peso en kg de un cajón leyéndolo del nombre del producto.
// Reconoce patrones tipo "X20KG", "X 14 KG", "cajón 20kg", etc.
// Si no encuentra nada, devuelve 0 (no se aplica conversión).
// Es el FALLBACK histórico — preferir kgPorUnidadDeProducto() que usa
// el campo explícito precios.kg_por_unidad si está cargado.
export function kgPorUnidadDeNombre(nombre) {
  if (!nombre) return 0
  const txt = String(nombre).toUpperCase()
  // Prioridad 1: patrón "X20KG" / "X 20 KG" / "X 20.5 KG" (con o sin espacios)
  let m = txt.match(/X\s*(\d+(?:[.,]\d+)?)\s*KG/)
  if (m) return parseFloat(m[1].replace(',', '.'))
  // Prioridad 2: patrón genérico "20 KG" o "20KG" — último recurso
  m = txt.match(/(\d+(?:[.,]\d+)?)\s*KG/)
  if (m) return parseFloat(m[1].replace(',', '.'))
  return 0
}

// Devuelve cuántos kg pesa cada unidad de un producto vendido por cajón.
// Usa el campo explícito `kg_por_unidad` del producto si está cargado;
// si no, cae al parseo del nombre por compatibilidad. Devuelve 0 si no
// se puede determinar (el caller debe fallback a 1 para no romper).
//
// `producto` puede ser:
//   - Un objeto producto de la tabla `precios` con .kg_por_unidad y .nombre
//   - Un objeto item del carrito que ya tenga kg_por_unidad copiado
//   - Solo el nombre como string (legacy — para items viejos)
export function kgPorUnidadDeProducto(producto) {
  if (!producto) return 0
  // String: legacy — solo tenemos el nombre
  if (typeof producto === 'string') return kgPorUnidadDeNombre(producto)
  // Objeto: preferir kg_por_unidad (campo explícito), fallback al nombre
  const kpu = Number(producto.kg_por_unidad)
  if (kpu > 0) return kpu
  return kgPorUnidadDeNombre(producto.nombre || producto.descripcion || '')
}

// Mapea el NOMBRE de un producto de categoría bovino_pieza al bucket de
// stock específico de esa pieza (pieza_costillar, pieza_pierna, etc.).
// Mismo criterio que NOMBRE_A_TIPO / PIEZA_A_STOCK en Deposito.jsx — el
// desposte acredita a estos buckets, así que la venta por kg tiene que
// debitar del mismo lado (el bucket genérico 'bovino_pieza' ya no recibe
// créditos y cualquier débito lo deja negativo).
// Matchea por keyword sobre el nombre normalizado (mayúsculas, sin acentos)
// porque los nombres en `precios` se editan a mano (ej. "PIERNA BOVINA -
// MOCHO ( PIEZA )", "PALETA/COGOTE ( PIEZA )").
// Devuelve null si no reconoce la pieza (ej. "MEDIA RES DESPOSTADA EN
// PIEZAS", que no corresponde a ningún bucket individual) — el caller
// decide el fallback.
export function bucketPiezaBovina(nombre) {
  if (!nombre) return null
  const txt = String(nombre)
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
  // Las medias res no son una pieza individual — sin bucket específico
  if (txt.includes('MEDIA RES')) return null
  if (txt.includes('CUARTO PISTOLA')) return 'pieza_cuarto_pistola'
  if (txt.includes('COSTELETAL'))     return 'pieza_costeletal'
  if (txt.includes('COSTILLAR'))      return 'pieza_costillar'   // completo / con vacío / solo
  if (txt.includes('CORTITO'))        return 'pieza_cortito'
  if (txt.includes('PIERNA'))         return 'pieza_pierna'
  if (txt.includes('PALETA') || txt.includes('COGOTE')) return 'pieza_paleta'
  if (txt.includes('PARRILLERO'))     return 'pieza_parrillero'
  return null
}

// Devuelve [tipoStock, kgADescontar] para un item del carrito.
// item: { tipo, kg, descripcion, stock_origen?, kg_por_unidad? }
// CATEGORIA_A_STOCK: mapeo categoria_producto → tipo en stock_actual
//
// Si la categoría es de "cajón" (pollo_cajon, rebozado_cajon), descuenta
// del stock kg del producto base multiplicando unidades × kg_por_cajón.
// Prefiere item.kg_por_unidad (cargado desde precios.kg_por_unidad);
// si no, parsea del nombre como fallback. Si no encuentra, asume 1.
//
// Retorna { tipoStock, cantidad } donde cantidad es la magnitud a descontar
// (kg o unidades, depende del tipo de stock).
export function resolverDescuentoStock(item, CATEGORIA_A_STOCK = {}) {
  const cat = item.tipo
  const kg = Number(item.kg) || 0

  // Caso especial: cajones cuyo stock está en kg del producto base
  if (cat === 'pollo_cajon') {
    const kgPorCajon = kgPorUnidadDeProducto(item) || 1
    return { tipoStock: 'pollo', cantidad: kg * kgPorCajon }
  }
  if (cat === 'rebozado_cajon') {
    const kgPorCajon = kgPorUnidadDeProducto(item) || 1
    return { tipoStock: 'rebozado', cantidad: kg * kgPorCajon }
  }

  // Caso normal: usar stock_origen del producto si existe, sino mapear
  // por categoría, sino fallback al nombre crudo de la categoría.
  // Un mapeo EXPLÍCITO en null (ej. embutido) significa "esta categoría
  // no descuenta stock sin stock_origen" — el caller debe saltear
  // tipoStock null en vez de caer al nombre crudo.
  const tipoStock = item.stock_origen || (cat in CATEGORIA_A_STOCK ? CATEGORIA_A_STOCK[cat] : cat)
  return { tipoStock, cantidad: kg }
}
