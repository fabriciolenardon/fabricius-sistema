// ============================================================
// HELPERS DE CAJAS STOCK — tracking individual de cajas CB/PT
// ============================================================
// Encapsula las operaciones contra la tabla `cajas_stock`:
//   - listar cajas disponibles para vender
//   - reservar (marcar como vendida) cuando se cierra una venta
//   - revertir (volver a disponible) cuando se anula una venta
//   - sumar/restar el agregado en stock_actual para compatibilidad
// ============================================================
import { supabase } from './supabase'

// Mapeo categoria del producto → tipo_caja en la tabla cajas_stock
export const CATEGORIA_A_TIPO_CAJA = {
  bovino_caja_cb: 'CB',
  bovino_caja_pt: 'PT',
}

// stock_actual.tipo para cada tipo_caja (compatibilidad con displays viejos)
const TIPO_A_STOCK_ACTUAL = {
  CB: 'caja_cb',
  PT: 'caja_pt',
}

// Devuelve cajas con estado='disponible' del tipo pedido ('CB' | 'PT'),
// ordenadas por fecha_ingreso (más viejas primero = FIFO). Si se pasa
// productoId, filtra solo las cajas vinculadas a ese producto + las legacy
// sin producto asignado (para no esconder stock viejo).
export async function cargarCajasDisponibles(tipoCaja, productoId = null) {
  if (!tipoCaja) return []
  let query = supabase
    .from('cajas_stock')
    .select('*')
    .eq('tipo_caja', tipoCaja)
    .eq('estado', 'disponible')
  if (productoId) {
    // OR: producto_id matches OR producto_id is null (legacy sin asignar)
    query = query.or(`producto_id.eq.${productoId},producto_id.is.null`)
  }
  const { data } = await query
    .order('fecha_ingreso', { ascending: true })
    .order('id', { ascending: true })
  return data || []
}

// Suma kg al stock_actual.caja_cb / caja_pt para que el dashboard y las
// alertas viejas sigan funcionando. Crea la fila si no existe.
async function sumarStockActualCaja(tipoCaja, deltaKg) {
  const tipo = TIPO_A_STOCK_ACTUAL[tipoCaja]
  if (!tipo) return
  const { data } = await supabase.from('stock_actual').select('*').eq('tipo', tipo).maybeSingle()
  if (data) {
    await supabase.from('stock_actual')
      .update({ kg_disponible: (Number(data.kg_disponible) || 0) + deltaKg })
      .eq('tipo', tipo)
  } else {
    await supabase.from('stock_actual').insert({ tipo, kg_disponible: deltaKg })
  }
}

// Crea N cajas individuales con sus pesos. Devuelve las cajas creadas.
// pesos: array de números (uno por caja).
// meta: { tipoCaja, fecha, proveedor, descripcion, precioCostoKg, entradaId, productoId }
// productoId es el id del producto en `precios` (ej. el "Bola de Lomo Caja PT")
// — todas las cajas creadas con esta llamada quedan vinculadas a él.
export async function crearCajasIngreso(pesos, meta) {
  const { tipoCaja, fecha, proveedor, descripcion, precioCostoKg, entradaId, productoId } = meta
  if (!tipoCaja || !pesos?.length) return { data: [], error: 'Faltan datos' }
  const filas = pesos
    .map(kg => Number(kg))
    .filter(kg => kg > 0)
    .map(kg => ({
      tipo_caja: tipoCaja,
      kg,
      fecha_ingreso: fecha || null,
      proveedor_origen: proveedor || null,
      descripcion_origen: descripcion || null,
      precio_costo_kg: precioCostoKg || null,
      entrada_id: entradaId || null,
      producto_id: productoId || null,
      estado: 'disponible',
    }))
  if (filas.length === 0) return { data: [], error: 'Ninguna caja con peso válido' }
  const { data, error } = await supabase.from('cajas_stock').insert(filas).select()
  if (error) return { data: [], error: error.message }
  // Actualizar stock_actual.caja_cb / caja_pt (suma del total ingresado) para
  // que el dashboard siga reflejando la cantidad de kg en stock.
  const totalKg = filas.reduce((s, f) => s + f.kg, 0)
  await sumarStockActualCaja(tipoCaja, totalKg)
  return { data, error: null }
}

// Marca una caja como vendida. Decrementa el stock_actual para compatibilidad.
export async function venderCaja(cajaId, ventaInfo) {
  const { destino, clienteId, clienteNombre, precioVentaKg, totalVenta, fechaSalida, notas } = ventaInfo
  const { data: caja, error: errSel } = await supabase
    .from('cajas_stock').select('*').eq('id', cajaId).single()
  if (errSel || !caja) return { error: errSel?.message || 'Caja no encontrada' }
  if (caja.estado !== 'disponible') return { error: `La caja ya está ${caja.estado}` }
  const { error: errUpd } = await supabase.from('cajas_stock').update({
    estado: 'vendida',
    destino: destino || null,
    cliente_id: clienteId || null,
    cliente_nombre: clienteNombre || null,
    precio_venta_kg: precioVentaKg || null,
    total_venta: totalVenta || null,
    fecha_salida: fechaSalida || null,
    notas_salida: notas || null,
    updated_at: new Date().toISOString(),
  }).eq('id', cajaId)
  if (errUpd) return { error: errUpd.message }
  await sumarStockActualCaja(caja.tipo_caja, -Number(caja.kg))
  return { error: null, caja }
}

// Revierte una caja vendida a disponible. Devuelve kg al stock_actual.
export async function revertirVentaCaja(cajaId) {
  const { data: caja, error: errSel } = await supabase
    .from('cajas_stock').select('*').eq('id', cajaId).single()
  if (errSel || !caja) return { error: errSel?.message || 'Caja no encontrada' }
  if (caja.estado === 'disponible') return { error: 'La caja ya está disponible' }
  const { error: errUpd } = await supabase.from('cajas_stock').update({
    estado: 'disponible',
    destino: null, cliente_id: null, cliente_nombre: null,
    precio_venta_kg: null, total_venta: null, fecha_salida: null, notas_salida: null,
    updated_at: new Date().toISOString(),
  }).eq('id', cajaId)
  if (errUpd) return { error: errUpd.message }
  await sumarStockActualCaja(caja.tipo_caja, Number(caja.kg))
  return { error: null }
}
