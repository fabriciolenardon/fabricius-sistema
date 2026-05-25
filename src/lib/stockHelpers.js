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
  // por categoría, sino fallback al nombre crudo de la categoría
  const tipoStock = item.stock_origen || CATEGORIA_A_STOCK[cat] || cat
  return { tipoStock, cantidad: kg }
}
