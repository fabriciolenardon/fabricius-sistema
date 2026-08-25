// ============================================================
// CATÁLOGO DE CATEGORÍAS DE PRECIOS — editable desde la UI
// ============================================================
// Las categorías dejaron de ser un objeto hardcodeado en Precios.jsx:
// ahora viven en config_sistema (clave 'categorias_precios') y se
// administran desde Precios → 🗂️ Categorías (agregar, renombrar,
// reordenar, ocultar, eliminar).
//
// Dos clases de categoría:
//   - SISTEMA: las claves históricas (bovino_corte, cerdo_pieza, etc.)
//     que tienen lógica asociada en el código (mapeo a stock, cajones,
//     piezas enteras, portales). Se pueden renombrar, reordenar y
//     ocultar, pero NO eliminar.
//   - PERSONALIZADAS: clave 'cat_<slug>'. Se venden por kg y no
//     descuentan stock salvo que el producto tenga stock_origen.
//
// El orden visible es el orden del array guardado. Si el código suma
// una categoría de sistema nueva (deploy), aparece al final hasta que
// se reordene. Si la config no existe todavía, se usa el set de
// sistema tal cual (no hace falta migración).
// ============================================================
import { supabase } from './supabase'

export const CATEGORIAS_SISTEMA = [
  { clave: 'bovino_mr',      label: '🐄 Media Reses' },
  { clave: 'bovino_corte',   label: '🥩 Bovino Cortes' },
  { clave: 'bovino_pieza',   label: '🍖 Piezas Bovinas' },
  { clave: 'bovino_brosa',   label: '🫀 Brosas' },
  { clave: 'bovino_caja_pt', label: '📦 Bovino Caja PT' },
  { clave: 'cerdo_corte',    label: '🐷 Cerdo Cortes' },
  { clave: 'cerdo_pieza',    label: '🐷 Cerdo Piezas' },
  { clave: 'embutido',       label: '🌭 Embutidos' },
  { clave: 'pollo',          label: '🍗 Pollo X Kilo' },
  { clave: 'pollo_cajon',    label: '🍗 Pollo Cajón' },
  { clave: 'rebozado',       label: '🧊 Rebozado X Kilo' },
  { clave: 'rebozado_cajon', label: '🧊 Rebozado Cajón' },
  { clave: 'almacen',        label: '🛒 Almacén' },
  { clave: 'bebidas',        label: '🥤 Bebidas' },
  { clave: 'insumos',        label: '🧰 Insumos' },
]
const CLAVES_SISTEMA = new Set(CATEGORIAS_SISTEMA.map(c => c.clave))
export const esCategoriaSistema = clave => CLAVES_SISTEMA.has(clave)

// Lista default (sin config guardada): todas las de sistema, visibles.
export const categoriasDefault = () =>
  CATEGORIAS_SISTEMA.map(c => ({ ...c, activa: true, sistema: true }))

// Carga el catálogo: lo guardado (con su orden) + cualquier categoría de
// sistema nueva que todavía no esté en la config (queda al final).
export async function cargarCategoriasPrecios() {
  const { data } = await supabase.from('config_sistema').select('valor')
    .eq('clave', 'categorias_precios').maybeSingle()
  const guardadas = Array.isArray(data?.valor) ? data.valor : []
  if (!guardadas.length) return categoriasDefault()
  const vistas = new Set()
  const lista = []
  for (const g of guardadas) {
    if (!g?.clave || vistas.has(g.clave)) continue
    vistas.add(g.clave)
    lista.push({
      clave: g.clave,
      label: g.label || g.clave,
      activa: g.activa !== false,
      sistema: CLAVES_SISTEMA.has(g.clave),
    })
  }
  for (const s of CATEGORIAS_SISTEMA) {
    if (!vistas.has(s.clave)) lista.push({ ...s, activa: true, sistema: true })
  }
  return lista
}

export async function guardarCategoriasPrecios(lista) {
  const valor = lista.map(c => ({ clave: c.clave, label: c.label, activa: c.activa !== false }))
  return supabase.from('config_sistema').upsert({
    clave: 'categorias_precios',
    valor,
    descripcion: 'Catálogo de categorías de la lista de precios (orden, nombres, visibles y personalizadas). Se administra desde Precios → Categorías.',
  }, { onConflict: 'clave' })
}

// ============================================================
// CATEGORÍAS QUE SOLO VENDE LA CENTRAL
// ============================================================
// Los INSUMOS (bolsas, bandejas, etiquetas) son un producto que la central le
// vende a sus carnicerías y a las franquicias. Una sucursal NO los revende:
// se los compra a la central igual que la carne. Que le aparezcan en su lista
// de precios, en un remito o en un presupuesto solo confunde.
//
// Si mañana hay otra categoría con la misma forma, se agrega acá y queda
// aplicada en todos lados.
export const CATEGORIAS_SOLO_CENTRAL = new Set(['insumos'])

// ============================================================
// Almacén y bebidas NO son del catálogo compartido: la mercadería la compra
// y la vende cada boca por su cuenta, así que cada una arma y mantiene su
// propia lista (decisión de Fabricio, 25/08/2026 — mig 113).
//
// En la base esto es `precios.sucursal_id`: NULL = compartido, un número =
// propio de esa boca. La RLS ya impide que una sucursal toque nada fuera de
// estas dos categorías; lo de acá es para que la pantalla no le ofrezca algo
// que le va a rebotar.
export const CATEGORIAS_PROPIAS_DE_BOCA = new Set(['almacen', 'bebidas'])

// ¿Este usuario puede dar de alta/baja el PRODUCTO (no sólo su precio)?
// La central siempre; una sucursal, sólo en sus dos categorías.
export function puedeAdministrarProducto(esSucursal, categoria) {
  return !esSucursal || CATEGORIAS_PROPIAS_DE_BOCA.has(categoria)
}

// Filtra el catálogo de categorías: saca las ocultas y, si es una sucursal,
// también las que solo vende la central.
export function categoriasParaVender(lista, esSucursal) {
  const visibles = (lista || []).filter(c => c.activa !== false)
  return esSucursal ? visibles.filter(c => !CATEGORIAS_SOLO_CENTRAL.has(c.clave)) : visibles
}

// Ídem para una lista de PRODUCTOS: así no aparecen en el buscador de un
// remito ni en el de un presupuesto.
export function productosQueVende(productos, esSucursal) {
  if (!esSucursal) return productos
  return (productos || [])
    .filter(p => !CATEGORIAS_SOLO_CENTRAL.has(p.categoria))
    // `precio_carniceria` es la lista con la que la CENTRAL le vende a las
    // carnicerías — o sea, el precio al que la franquicia COMPRA. Que le
    // aparezca en su lista de venta es mostrarle a un tercero el margen del
    // negocio, y en la media res es directo el precio con el que se la
    // compran a Fabricio.
    //
    // Se corta acá y no en cada pantalla a propósito: por esta función pasa
    // TODO lo que ve una sucursal (Precios, Caja, Depósito, Presupuestos),
    // así que ninguna futura se puede olvidar de ocultarlo.
    .map(p => (p.precio_carniceria == null ? p : { ...p, precio_carniceria: null }))
}

// { clave: label } de TODA la lista (ocultas incluidas — sirve para mostrar
// la etiqueta de un producto aunque su categoría esté oculta).
export const labelsDeCategorias = lista =>
  Object.fromEntries((lista || []).map(c => [c.clave, c.label]))

// Clave para una categoría nueva a partir del nombre visible.
// Ej: "🐟 Pescados y Mariscos" → "cat_pescados_y_mariscos"
export function claveDesdeNombre(nombre) {
  const slug = String(nombre || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // sin acentos
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return slug ? `cat_${slug}` : ''
}
