// ============================================================
// PRECIOS POR SUCURSAL — superposición sobre el catálogo
// ============================================================
// El CATÁLOGO es uno solo y lo mantiene la central: qué productos existen,
// de qué bucket descuenta cada uno (`stock_origen`), con qué PLU se pesa,
// si va por kilo o por unidad. Eso vive en `precios` y no se toca.
//
// Los PRECIOS de venta son de cada sucursal: los carga a mano y respeta la
// lista por contrato. Viven en `precios_sucursal` (migración 92), una fila
// por producto y sucursal, con las DOS listas que usan: minorista y
// mayorista. La de carnicería no existe acá — esa es la de la central para
// venderles a ellos.
//
// POR QUÉ SEPARADO Y NO UNA COPIA DE `precios`
// Si cada sucursal tuviera su propia copia entera de la tabla, no estaría
// cargando precios: estaría recreando el maestro de productos. Un precio mal
// cargado se ve; un `stock_origen` mal cargado descuenta del bucket
// equivocado EN SILENCIO — así nacieron los 14 cortes de vaca que
// descontaban cerdo.
//
// POR QUÉ ACÁ Y NO UNA VISTA EN LA BASE
// La idea original era renombrar `precios` y dejar una vista en su lugar,
// para no tocar ninguna de las 51 lecturas del código. No se puede: `precios`
// está en la publicación de realtime y una VISTA no puede estar en una
// publicación, así que la Caja habría dejado de tomar los cambios de precio
// en vivo.
//
// CÓMO SE USA
//   const overlay = await overlayDeSucursal(sucursalId)
//   const productos = conPreciosDeSucursal(data, overlay)
//
// Para la central `overlayDeSucursal` devuelve null y `conPreciosDeSucursal`
// entrega la lista intacta: cero cambios de comportamiento en Río Primero.
// ============================================================
import { supabase } from './supabase'
import { SUCURSAL_CENTRAL } from './permisos'

// Trae los precios propios de una sucursal como mapa { precio_id: fila }.
// Devuelve null para la central (y para cualquier caso sin sucursal), que es
// la señal de "no hay nada que superponer".
export async function overlayDeSucursal(sucursalId) {
  if (!sucursalId || Number(sucursalId) === SUCURSAL_CENTRAL) return null
  const { data, error } = await supabase
    .from('precios_sucursal')
    .select('precio_id, precio_minorista, precio_mayorista')
    .eq('sucursal_id', sucursalId)
  if (error) {
    console.warn('No se pudieron leer los precios de la sucursal:', error.message)
    return null
  }
  const mapa = {}
  for (const fila of data || []) mapa[fila.precio_id] = fila
  return mapa
}

// Pisa los precios del catálogo con los de la sucursal.
//
// Un producto sin fila propia conserva el precio de la central: es el estado
// del primer día, cuando todavía no cargaron nada. Así el sistema arranca
// usable en vez de con toda la lista en cero — pero conviene avisarles de
// cargar los suyos, porque los de la central son los de OTRO negocio.
// `preciosPropiosFaltantes` cuenta exactamente eso.
export function conPreciosDeSucursal(productos, overlay) {
  if (!overlay || !Array.isArray(productos)) return productos
  return productos.map(p => {
    const propio = overlay[p.id]
    if (!propio) return p
    return {
      ...p,
      precio_minorista: propio.precio_minorista ?? p.precio_minorista,
      precio_mayorista: propio.precio_mayorista ?? p.precio_mayorista,
    }
  })
}

// Cuántos productos todavía no tienen precio propio cargado.
export function preciosPropiosFaltantes(productos, overlay) {
  if (!overlay || !Array.isArray(productos)) return 0
  return productos.filter(p => !overlay[p.id]).length
}

// Guarda el precio de un producto para una sucursal. La central NO pasa por
// acá: sigue escribiendo en `precios` como siempre.
export async function guardarPrecioDeSucursal(sucursalId, precioId, { precio_minorista, precio_mayorista }) {
  if (!sucursalId || Number(sucursalId) === SUCURSAL_CENTRAL) {
    return { error: new Error('La central guarda sus precios en el catálogo, no acá.') }
  }
  const { error } = await supabase.from('precios_sucursal').upsert({
    sucursal_id: sucursalId,
    precio_id: precioId,
    precio_minorista: precio_minorista ?? null,
    precio_mayorista: precio_mayorista ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'sucursal_id,precio_id' })
  return { error: error || null }
}
