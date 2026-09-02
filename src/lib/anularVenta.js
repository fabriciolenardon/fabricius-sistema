// ============================================================
// ANULAR VENTA — revertir stock + borrar de ventas_minoristas
// ============================================================
// Lógica compartida entre el Historial de Caja (pestaña) y el
// Historial del día (panel inline de la vista Vender). Revierte el
// stock de cada ítem según su tipo (caja individual CB/PT, pieza
// entera, cajón pollo/rebozado, o carne/almacén normal) y después
// borra la venta. Devuelve un resultado; el caller decide cómo
// recargar su vista.
// ============================================================
import { supabase } from './supabase'
import { kgPorUnidadDeProducto, redondearStock } from './stockHelpers'
import { revertirVentaCaja } from './cajasStock'
import { revertirVentaAnimalitoPorId } from './animalitos'
import { fmtPrecio } from './formatos'

const fmt$ = n => fmtPrecio(Math.abs(Number(n) || 0))

// Mapeo categoría → tipo en stock_actual. Recibe stock_origen opcional para
// revertir contra el cut específico si la venta lo guardó (ej. cerdo_bondiola).
export function mapearStockTipo(cat, stockOrigen) {
  if (!cat) return null
  if (stockOrigen) return stockOrigen
  if (cat === 'bovino_mr')        return 'bovino_mr'
  if (cat === 'bovino_corte')     return 'bovino_corte'
  // bovino_pieza: las ventas nuevas guardan stock_origen específico
  // (pieza_costillar, pieza_pierna… — resuelto por nombre en Caja) y entran
  // por el early-return de arriba, revirtiendo contra ese mismo bucket.
  // Este fallback cubre ventas viejas sin stock_origen, que debitaron el
  // genérico: se les devuelve al genérico para mantener la simetría.
  if (cat === 'bovino_pieza')     return 'bovino_pieza'
  // bovino_brosa: ídem — las ventas nuevas guardan stock_origen (brosa_*,
  // mig 89) y revierten contra ese bucket; el genérico cubre ventas viejas.
  if (cat === 'bovino_brosa')     return 'bovino_brosa'
  if (cat === 'cerdo')            return 'cerdo'        // capón
  if (cat === 'cerdo_corte')      return null           // sin origen → no revertir (cerdo_pieza eliminado)
  if (cat === 'cerdo_pieza')      return null
  if (cat === 'pollo')            return 'pollo'
  if (cat === 'pollo_cajon')      return 'pollo'      // se revierte kg×cajón
  if (cat === 'rebozado')         return 'rebozado'
  if (cat === 'rebozado_cajon')   return 'rebozado'   // se revierte kg×cajón
  if (cat === 'embutido')         return 'embutido'
  if (cat === 'almacen')          return 'almacen'
  if (cat === 'bebidas')          return 'bebidas'
  if (cat === 'bovino_caja_cb')   return 'caja_cb'
  if (cat === 'bovino_caja_pt')   return 'caja_pt'
  return null
}

// Anula una venta. Pide doble confirmación (confirm + tipear "ANULAR").
// Devuelve { ok, cancelled, error, errores } — el caller recarga si ok.
// yaConfirmado: cuando la UI ya confirmó con el modal de código de seguridad,
// se saltea el confirm/prompt nativo (el modal ES la confirmación).
export async function anularVenta(venta, { isAdmin = false, yaConfirmado = false } = {}) {
  if (!isAdmin) {
    alert('Solo los administradores pueden anular ventas.')
    return { ok: false, cancelled: true }
  }
  if (!yaConfirmado) {
    const total = Number(venta.total) || 0
    const cantItems = Array.isArray(venta.items) ? venta.items.length : 0
    if (!confirm(
      `⚠️ ANULAR VENTA — ACCIÓN IRREVERSIBLE\n\n` +
      `Venta #${venta.id} del ${venta.fecha}\n` +
      `Total: ${fmt$(total)}\n` +
      `Items: ${cantItems}\n\n` +
      `Se va a:\n` +
      `  1. Devolver al stock cada item vendido\n` +
      `  2. Borrar la venta del historial\n\n` +
      `¿Confirmar?`
    )) return { ok: false, cancelled: true }
    const conf2 = prompt('Para confirmar, escribí ANULAR en mayúsculas:')
    if (conf2 !== 'ANULAR') {
      alert('Cancelado. Texto incorrecto.')
      return { ok: false, cancelled: true }
    }
  }

  // 1) Reponer stock por cada item
  const items = Array.isArray(venta.items) ? venta.items : []
  const errores = []
  for (const item of items) {
    // Caja individual — revertir y saltar el flujo normal
    if (item.caja_id) {
      const { error } = await revertirVentaCaja(item.caja_id)
      if (error) errores.push(`Caja #${item.caja_id}: ${error}`)
      continue
    }
    // Animalito entero — vuelve a la cámara con su peso y su código. La
    // función ya repone el bucket, así que acá no se toca stock_actual.
    if (item.animalito_id) {
      const r = await revertirVentaAnimalitoPorId(item.animalito_id)
      if (r?.error) errores.push(`Animalito #${item.animalito_id}: ${r.error}`)
      continue
    }
    // Pieza entera — volver a 'disponible' en piezas_stock Y reponer su kg
    // en el agregado stock_actual del bucket propio (la venta lo descontó).
    if (item.pieza_id) {
      const { error } = await supabase.from('piezas_stock').update({
        estado: 'disponible',
        destino: null,
        cliente_id: null,
        cliente_nombre: null,
        precio_venta_kg: null,
        total_venta: null,
        fecha_salida: null,
        notas_salida: null,
      }).eq('id', item.pieza_id)
      if (error) errores.push(`Pieza #${item.pieza_id}: ${error.message}`)
      let bucketPz = item.stock_origen
      if (!bucketPz) {
        const { data: pz } = await supabase.from('piezas_stock').select('tipo_stock').eq('id', item.pieza_id).maybeSingle()
        bucketPz = pz?.tipo_stock || 'bovino_pieza'
      }
      const { data: stkPz } = await supabase.from('stock_actual').select('*').eq('tipo', bucketPz).maybeSingle()
      if (stkPz) {
        await supabase.from('stock_actual')
          .update({ kg_disponible: redondearStock((Number(stkPz.kg_disponible) || 0) + (Number(item.kg) || 0)) })
          .eq('tipo', bucketPz)
      }
      continue
    }
    const tipoStock = mapearStockTipo(item.categoria, item.stock_origen)
    if (!tipoStock) continue
    try {
      const esCajonAConvertir = item.categoria === 'pollo_cajon' || item.categoria === 'rebozado_cajon'
      const cantidad = esCajonAConvertir
        ? (Number(item.kg) || 0) * (kgPorUnidadDeProducto(item) || 1)
        : (Number(item.kg) || 0)
      const { data: stock } = await supabase.from('stock_actual').select('*').eq('tipo', tipoStock).maybeSingle()
      if (stock) {
        await supabase.from('stock_actual')
          .update({ kg_disponible: redondearStock((Number(stock.kg_disponible) || 0) + cantidad) })
          .eq('tipo', tipoStock)
      }
    } catch (e) {
      errores.push(`${item.descripcion}: ${e.message}`)
    }
  }

  // 2) Borrar la venta
  const { error } = await supabase.from('ventas_minoristas').delete().eq('id', venta.id)
  if (error) {
    alert(`❌ Stock revertido pero NO se pudo borrar la venta:\n${error.message}`)
    return { ok: false, error }
  }

  let msg = `✅ Venta #${venta.id} anulada — stock devuelto`
  if (errores.length > 0) msg += `\n\n⚠️ Algunos items tuvieron error al revertir stock:\n${errores.join('\n')}`
  alert(msg)
  return { ok: true, errores }
}
