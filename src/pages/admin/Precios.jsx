// Precios — gestión completa de listas, PLUs e importadores
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { fechaHoyARG } from '../../lib/fechas'
import Paginador, { usePaginacion } from '../../components/Paginador'
import LimpiezaDuplicados from './LimpiezaDuplicados'
import ImportarPLUQendra from './ImportarPLUQendra'
import SucursalesPrecios from './SucursalesPrecios'
import CombosEditor from './CombosEditor'
import { abrirVentanaImprimible } from '../../lib/pdfPrintable'
import { compartirListaPrecios } from '../../lib/listasPreciosPdf'
import { overlayDeSucursal, conPreciosDeSucursal, preciosPropiosFaltantes, guardarPrecioDeSucursal } from '../../lib/preciosSucursal'
import { useAuth } from '../../context/AuthContext'
import { SUCURSAL_CENTRAL } from '../../lib/permisos'
import { decodificarEANBalanza } from '../../lib/balanzaEAN'
import {
  resolverFormatoEAN, conModoDeSucursal, patronLegible, MODOS_BALANZA, FORMATO_DEFAULT,
} from '../../lib/balanzaFormato'
// Las categorías ya no son un objeto hardcodeado: viven en config_sistema
// ('categorias_precios') y se administran desde la solapa 🗂️ Categorías.
// Ver src/lib/categoriasPrecios.js (las de sistema no se pueden eliminar).
import {
  cargarCategoriasPrecios, guardarCategoriasPrecios, categoriasDefault,
  labelsDeCategorias, claveDesdeNombre, categoriasParaVender, productosQueVende,
  puedeAdministrarProducto,
} from '../../lib/categoriasPrecios'

// Subgrupos dentro de Insumos (como en el PDF original)
const INSUMO_SUBCAT = { descartables: '📦 Descartables', limpieza: '🧽 Limpieza', carniceria: '🔪 Insumos Carnicería' }
const INSUMO_SUBCAT_ORDEN = { descartables: 0, limpieza: 1, carniceria: 2 }
const INSUMO_SUBCAT_OPCIONES = [['descartables', '📦 Descartables'], ['limpieza', '🧽 Limpieza'], ['carniceria', '🔪 Insumos Carnicería']]
const VACIO = { categoria: 'bovino_corte', subcategoria: 'descartables', nombre: '', precio_carniceria: '', precio_mayorista: '', precio_minorista: '', codigo_balanza: '', dias_vencimiento: '3', descripcion_etiqueta: '', pesable: true, kg_por_unidad: '', vende_por_pieza: false, stock_origen: '', stock_no_aplica: false }

// Categorías cuyos productos descuentan de un bucket de stock específico
// (cerdo por pieza, embutidos de elaboración propia, brosas por producto —
// mig 89). Sin stock_origen quedan "huérfanos": se venden pero NO descuentan
// stock. Los bovinos de carne NO van acá: se trackean por categoría/pieza,
// su stock_origen debe ser NULL.
const CATEGORIAS_CON_STOCK_ORIGEN = new Set(['cerdo_corte', 'cerdo_pieza', 'embutido', 'bovino_brosa'])
// Las categorías personalizadas (cat_*) también pueden enlazar stock_origen:
// sin enlace no descuentan stock (igual que un embutido comprado).
const permiteStockOrigen = cat => CATEGORIAS_CON_STOCK_ORIGEN.has(cat) || String(cat || '').startsWith('cat_')
const prettyBucket = b => String(b || '')
  .replace(/^cerdo_/, '🐷 ')
  .replace(/^emb_/, '🌭 ')
  .replace(/^brosa_/, '🫀 ')
  .replace(/^bovino_/, '🐄 ')
  .replace(/_/g, ' ')

// Categorías que se venden por cajón (unidad con peso fijo) y por lo tanto
// necesitan el campo kg_por_unidad cargado para descontar stock correctamente.
const CATEGORIAS_CON_KG_POR_UNIDAD = new Set(['pollo_cajon', 'rebozado_cajon'])

// Categorías donde tiene sentido el flag "se vende por pieza entera".
// Las piezas bovinas son las únicas donde se vende un objeto físico único
// (cada pierna, cuarto pistola, costillar, etc. con su peso propio).
const CATEGORIAS_CON_PIEZA_ENTERA = new Set(['bovino_pieza'])
import { fmtPrecio, parseNumero } from '../../lib/formatos'
// Precio en formato AR (35.600,50 con decimales si tiene)
const fmt = n => n != null ? fmtPrecio(Number(n) || 0) : '—'
const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%', boxSizing: 'border-box' }

export default function Precios() {
  const [tab, setTab] = useState('ver')
  const { sucursalId, isSucursal: esSucursal } = useAuth()
  const [overlay, setOverlay] = useState(null)
  // Las bocas donde puede correr una oferta. Solo las carga la central: es
  // quien las elige. `sucursales` se puede leer desde la mig 94.
  const [sucursalesLista, setSucursalesLista] = useState([])
  const nombreSucursal = id => sucursalesLista.find(s => s.id === id)?.nombre || `Sucursal ${id}`
  const [precios, setPrecios] = useState([])
  const [stockBuckets, setStockBuckets] = useState([])  // tipos de stock_actual (cerdo_*, emb_*) para enlazar
  const [filtro, setFiltro] = useState('bovino_corte')
  // Catálogo de categorías (config_sistema). CATEGORIAS mantiene la forma
  // { clave: label } que usaba el viejo objeto hardcodeado — incluye las
  // ocultas para poder etiquetar productos de una categoría escondida.
  const [categorias, setCategorias] = useState(categoriasDefault())
  const CATEGORIAS = useMemo(() => labelsDeCategorias(categorias), [categorias])
  // Saca las ocultas y, para una sucursal, las que solo vende la central
  // (hoy: Insumos — se los compra a la central, no los revende).
  const categoriasVisibles = useMemo(() => categoriasParaVender(categorias, esSucursal), [categorias, esSucursal])
  // Editor de categorías (solapa 🗂️): copia local + form de alta
  const [catEdit, setCatEdit] = useState(null)         // null = sin cambios sin guardar
  const [catNueva, setCatNueva] = useState('')
  const [catGuardando, setCatGuardando] = useState(false)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(VACIO)
  // El form en blanco arranca donde el usuario PUEDE crear: una sucursal sólo
  // da de alta almacén y bebidas, así que ofrecerle 'bovino_corte' por defecto
  // es mandarla derecho al mensaje de error.
  const formEnBlanco = () => (esSucursal ? { ...VACIO, categoria: 'almacen', pesable: false } : VACIO)
  const [editando, setEditando] = useState(null)
  const [msg, setMsg] = useState('')
  const [chatMsgs, setChatMsgs] = useState([{ rol: 'ia', texto: '¡Hola! 🥩 Soy el asistente de Carnicerías Fabricius. Consultame precios, productos o lo que necesites.' }])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  // Actualización masiva
  const [masivoCat, setMasivoCat] = useState('todas')
  const [masivoLista, setMasivoLista] = useState('todas')
  const [masivoPct, setMasivoPct] = useState('')
  const [masivoLoading, setMasivoLoading] = useState(false)
  const [masivoPreview, setMasivoPreview] = useState([])

  // Ofertas
  const [ofertas, setOfertas] = useState([])
  const [ofertaForm, setOfertaForm] = useState({ precio_id: '', tipo: 'fijo', precio_oferta: '', descuento_pct: '', fecha_inicio: fechaHoyARG(), fecha_fin: '', notas: '', aplica_carniceria: !esSucursal, aplica_mayorista: true, aplica_minorista: true, sucursales: [SUCURSAL_CENTRAL] })
  const [ofertaLoading, setOfertaLoading] = useState(false)
  const [busquedaOferta, setBusquedaOferta] = useState('')
  const [mostrarDropdown, setMostrarDropdown] = useState(false)
  const [productoSeleccionado, setProductoSeleccionado] = useState(null)

  // sucursalId en las dependencias: el perfil llega un instante después del
  // primer render y sin esto la sucursal vería la lista de la central.
  useEffect(() => { cargar(); cargarOfertas(); cargarCategoriasPrecios().then(setCategorias) }, [sucursalId])

  // Bocas disponibles para dirigir una oferta (solo le sirve a la central).
  useEffect(() => {
    if (esSucursal) return
    supabase.from('sucursales').select('id, nombre').order('id')
      .then(({ data }) => setSucursalesLista(data || []))
  }, [esSucursal])

  async function cargar() {
    setLoading(true)
    const [{ data }, { data: stk }] = await Promise.all([
      supabase.from('precios').select('*').order('nombre'),
      supabase.from('stock_actual').select('tipo'),
    ])
    // La sucursal ve el catálogo de la central con SUS precios encima. Los
    // productos que todavía no cargó muestran el precio de la central: sirve
    // para arrancar, pero son de otro negocio (ver lib/preciosSucursal.js).
    const ov = await overlayDeSucursal(sucursalId)
    setOverlay(ov)
    // Los insumos se los vende la central: no van en la lista de la sucursal.
    setPrecios(productosQueVende(conPreciosDeSucursal(data || [], ov), esSucursal))
    // Buckets enlazables: cerdo_* (piezas), emb_* (embutidos) y brosa_*
    // (brosas por producto, mig 89). Excluye el 'cerdo' genérico (capón
    // entero), que no es a donde van los cortes. 'bovino_corte' entra para
    // brosas SIN stock propio (ej. entraña de costillar): salen del desposte
    // que acredita a Bovino Cortes, así que la venta debita de ahí.
    setStockBuckets((stk || []).map(s => s.tipo).filter(t => t === 'bovino_corte' || /^cerdo_|^emb_|^brosa_/.test(t)).sort())
    setLoading(false)
  }

  async function cargarOfertas() {
    const { data } = await supabase.from('ofertas').select('*').order('fecha_inicio', { ascending: false })
    setOfertas(data || [])
  }

  function mostrarMsg(texto) { setMsg(texto); setTimeout(() => setMsg(''), 3000) }

  async function guardar() {
    if (!form.nombre.trim()) return mostrarMsg('❌ El nombre es obligatorio')

    // Validación dura: productos de categoría cajón (pollo_cajon, rebozado_cajon)
    // DEBEN tener kg_por_unidad cargado, sino el sistema no sabe cuántos kg
    // descontar del stock base al venderse → bugs silenciosos de stock negativo.
    if (CATEGORIAS_CON_KG_POR_UNIDAD.has(form.categoria)) {
      const kpu = parseNumero(form.kg_por_unidad)
      if (kpu <= 0) {
        return mostrarMsg('❌ Cargá los "Kg por cajón / unidad" — es obligatorio para esta categoría')
      }
    }

    // Detectar nombres que claramente son embutidos pero están en otra categoría.
    // Excluye "bife de chorizo" (corte bovino, no embutido).
    const nombreLower = form.nombre.toLowerCase()
    const pareceEmbutido = (
      nombreLower.startsWith('chorizo')
      || nombreLower.includes('morcilla')
      || nombreLower.includes('salchicha')
      || nombreLower.includes('salame')
      || nombreLower.includes('longaniza')
    ) && !nombreLower.includes('bife')
    if (pareceEmbutido && form.categoria !== 'embutido') {
      const ok = window.confirm(
        `⚠️ "${form.nombre}" parece ser un embutido pero está en categoría "${form.categoria}".\n\n` +
        `Si lo guardás así, al venderse descontará del stock de "${form.categoria}" en vez de "embutido".\n\n` +
        `¿Estás seguro? Si querés que descuente de embutidos, cambiá la categoría a "🌭 Embutidos" antes de guardar.`
      )
      if (!ok) return
    }
    setLoading(true)
    const nuevoPlu = form.codigo_balanza === '' ? null : Number(form.codigo_balanza)
    const datos = {
      categoria: form.categoria, nombre: form.nombre,
      subcategoria: form.categoria === 'insumos' ? (form.subcategoria || 'descartables') : null,
      precio_carniceria: form.precio_carniceria === '' ? null : parseNumero(form.precio_carniceria),
      precio_mayorista: form.precio_mayorista === '' ? null : parseNumero(form.precio_mayorista),
      precio_minorista: form.precio_minorista === '' ? null : parseNumero(form.precio_minorista),
      codigo_balanza: nuevoPlu,
      dias_vencimiento: form.dias_vencimiento === '' ? 3 : Number(form.dias_vencimiento),
      descripcion_etiqueta: form.descripcion_etiqueta || null,
      pesable: form.pesable !== false,
      // kg por unidad — solo relevante para categorías por cajón (pollo_cajon,
      // rebozado_cajon). Determina cuántos kg se descuentan del stock base al
      // vender una unidad. NULL si no aplica (el sistema cae al parseo del nombre).
      kg_por_unidad: form.kg_por_unidad === '' || form.kg_por_unidad == null
        ? null
        : parseNumero(form.kg_por_unidad),
      // Marca productos que se venden como pieza entera individual (no por kg).
      // Cuando el cajero los elige en Caja Rápida (o Mayorista), aparece el
      // selector de piezas_stock para elegir cuál pieza específica vender.
      vende_por_pieza: !!form.vende_por_pieza,
      // Bucket de stock del que descuenta al venderse. Solo aplica a cerdo/
      // embutido; el resto (bovino, pollo, etc.) SIEMPRE va NULL para no
      // reintroducir mapeos malos (bug 09/06: cortes de vaca descontando cerdo).
      // stock_no_aplica = comprado/reventa: no descuenta y no se marca huérfano.
      stock_origen: permiteStockOrigen(form.categoria) && !form.stock_no_aplica
        ? (form.stock_origen || null)
        : null,
      stock_no_aplica: permiteStockOrigen(form.categoria) ? !!form.stock_no_aplica : false,
    }

    // Si está asignando un PLU, verificar si ya está ocupado por OTRO producto
    // El PLU vive en el catálogo compartido: reasignarlo es de la central.
    // Una sucursal que edita su precio no pasa por acá (si no, liberaría el
    // PLU de un producto de la central — y la mig 100 se lo rechaza).
    if (nuevoPlu != null && !esSucursal) {
      const { data: conflicto } = await supabase
        .from('precios')
        .select('id, nombre')
        .eq('codigo_balanza', nuevoPlu)
        .neq('id', editando || '00000000-0000-0000-0000-000000000000')
        .maybeSingle()
      if (conflicto) {
        const ok = confirm(
          `⚠️ El PLU ${nuevoPlu} ya está asignado a "${conflicto.nombre}".\n\n` +
          `Si confirmás, ese PLU se LIBERA del otro producto y se asigna acá.\n\n` +
          `¿Continuar?`
        )
        if (!ok) { setLoading(false); return }
        // Liberar PLU del producto que lo tenía
        const { error: eLib } = await supabase.from('precios').update({ codigo_balanza: null }).eq('id', conflicto.id)
        if (eLib) { mostrarMsg('❌ Error liberando PLU: ' + eLib.message); setLoading(false); return }
      }
    }

    let error
    if (esSucursal) {
      // Dos caminos bien distintos para una sucursal:
      //
      // · Almacén y bebidas son SUYOS (mig 113): la mercadería la compra ella,
      //   así que da de alta, edita y borra el producto de verdad, marcado con
      //   su `sucursal_id`. El PLU va en null: el código de balanza vive en el
      //   catálogo compartido y no queremos que choque con uno de la central.
      // · Todo lo demás es de la central: sólo puede cargar SU precio, que va
      //   a `precios_sucursal` y no toca el catálogo.
      const original = editando ? precios.find(p => p.id === editando) : null
      const esPropio = original ? original.sucursal_id === sucursalId : puedeAdministrarProducto(true, datos.categoria)

      if (esPropio) {
        const fila = { ...datos, sucursal_id: sucursalId, codigo_balanza: null }
        const r = editando
          ? await supabase.from('precios').update(fila).eq('id', editando)
          : await supabase.from('precios').insert(fila)
        error = r.error
      } else {
        // Ni el producto ni su precio: la lista la manda la central (mig 114).
        // Lo único suyo es almacén y bebidas, que entra por la rama de arriba.
        mostrarMsg('❌ La lista la maneja la central. Vos administrás almacén y bebidas.')
        setLoading(false); return
      }
    } else if (editando) {
      const r = await supabase.from('precios').update(datos).eq('id', editando)
      error = r.error
    } else {
      const r = await supabase.from('precios').insert(datos)
      error = r.error
    }
    if (error) {
      mostrarMsg('❌ Error al guardar: ' + error.message)
      setLoading(false)
      return
    }
    mostrarMsg(editando ? '✅ Precio actualizado' : '✅ Producto agregado')
    setForm(formEnBlanco()); setEditando(null)
    await cargar(); setLoading(false)
  }

  async function eliminar(id) {
    // El catálogo es de la central, salvo almacén y bebidas: esos son de cada
    // boca y los da de baja quien los cargó (mig 113).
    if (esSucursal && precios.find(p => p.id === id)?.sucursal_id !== sucursalId) {
      mostrarMsg('❌ Ese producto lo administra la central. Vos das de baja los de almacén y bebidas.')
      return
    }
    if (!confirm('¿Seguro que querés eliminar este producto? También se borrarán sus ofertas.')) return
    // Antes el error se tragaba: si el borrado fallaba (p. ej. el producto estaba
    // en una oferta) parecía que "no pasaba nada". Ahora se muestra el motivo.
    const { error } = await supabase.from('precios').delete().eq('id', id)
    if (error) { mostrarMsg('❌ No se pudo eliminar: ' + error.message); return }
    mostrarMsg('🗑️ Eliminado'); await cargar()
  }

  function editar(p) {
    setEditando(p.id)
    setForm({
      categoria: p.categoria, nombre: p.nombre,
      subcategoria: p.subcategoria || 'descartables',
      precio_carniceria: p.precio_carniceria ?? '',
      precio_mayorista: p.precio_mayorista ?? '',
      precio_minorista: p.precio_minorista ?? '',
      codigo_balanza: p.codigo_balanza ?? '',
      dias_vencimiento: p.dias_vencimiento ?? 3,
      descripcion_etiqueta: p.descripcion_etiqueta ?? '',
      pesable: p.pesable !== false,
      kg_por_unidad: p.kg_por_unidad ?? '',
      vende_por_pieza: !!p.vende_por_pieza,
      stock_origen: p.stock_origen ?? '',
      stock_no_aplica: !!p.stock_no_aplica,
    })
    setFiltro(p.categoria)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Masivo
  function calcularPreview() {
    const pct = parseNumero(masivoPct)
    if (!pct) return setMasivoPreview([])
    const filtrados = masivoCat === 'todas' ? precios : precios.filter(p => p.categoria === masivoCat)
    setMasivoPreview(filtrados.map(p => ({
      ...p,
      nuevo_carniceria: masivoLista === 'todas' || masivoLista === 'carniceria' ? Math.round((p.precio_carniceria || 0) * (1 + pct / 100)) : p.precio_carniceria,
      nuevo_mayorista: masivoLista === 'todas' || masivoLista === 'mayorista' ? Math.round((p.precio_mayorista || 0) * (1 + pct / 100)) : p.precio_mayorista,
      nuevo_minorista: masivoLista === 'todas' || masivoLista === 'minorista' ? Math.round((p.precio_minorista || 0) * (1 + pct / 100)) : p.precio_minorista,
    })))
  }

  async function aplicarMasivo() {
    if (!masivoPct || masivoPreview.length === 0) return
    if (!confirm(`¿Confirmar actualización de ${masivoPreview.length} productos con ${masivoPct}%?`)) return
    setMasivoLoading(true)
    for (const p of masivoPreview) {
      if (esSucursal) {
        // La sucursal actualiza SU lista, no el catálogo de la central.
        // Sin esto, un aumento masivo desde Monte Cristo reescribía los
        // precios de Río Primero para todos los productos de una.
        const r = await guardarPrecioDeSucursal(sucursalId, p.id, {
          precio_minorista: masivoLista === 'todas' || masivoLista === 'minorista' ? p.nuevo_minorista : p.precio_minorista,
          precio_mayorista: masivoLista === 'todas' || masivoLista === 'mayorista' ? p.nuevo_mayorista : p.precio_mayorista,
        })
        if (r.error) { mostrarMsg('❌ ' + r.error.message); break }
        continue
      }
      const update = {}
      if (masivoLista === 'todas' || masivoLista === 'carniceria') update.precio_carniceria = p.nuevo_carniceria
      if (masivoLista === 'todas' || masivoLista === 'mayorista') update.precio_mayorista = p.nuevo_mayorista
      if (masivoLista === 'todas' || masivoLista === 'minorista') update.precio_minorista = p.nuevo_minorista
      await supabase.from('precios').update(update).eq('id', p.id)
    }
    setMasivoLoading(false)
    setMasivoPct(''); setMasivoPreview([])
    mostrarMsg(`✅ ${masivoPreview.length} productos actualizados con ${masivoPct}%`)
    await cargar()
  }

  // Ofertas
  function seleccionarProductoOferta(p) {
    setProductoSeleccionado(p)
    setBusquedaOferta(p.nombre)
    setOfertaForm(f => ({ ...f, precio_id: p.id }))
    setMostrarDropdown(false)
  }

  async function guardarOferta() {
    if (!ofertaForm.precio_id || !ofertaForm.fecha_inicio || !ofertaForm.fecha_fin) {
      mostrarMsg('❌ Completá producto y fechas'); return
    }
    if (ofertaForm.tipo === 'fijo' && !ofertaForm.precio_oferta) {
      mostrarMsg('❌ Ingresá el precio de oferta'); return
    }
    if (ofertaForm.tipo === 'porcentaje' && !ofertaForm.descuento_pct) {
      mostrarMsg('❌ Ingresá el % de descuento'); return
    }
    if (ofertaForm.tipo === 'porcentaje') {
      const pct = parseFloat(ofertaForm.descuento_pct)
      if (isNaN(pct) || pct <= 0 || pct >= 100) {
        mostrarMsg('❌ El % debe estar entre 1 y 99'); return
      }
    }
    if (new Date(ofertaForm.fecha_fin) < new Date(ofertaForm.fecha_inicio)) {
      mostrarMsg('❌ La fecha de fin debe ser posterior al inicio'); return
    }
    if (!ofertaForm.aplica_carniceria && !ofertaForm.aplica_mayorista && !ofertaForm.aplica_minorista) {
      mostrarMsg('❌ Tildá al menos una lista (carnicería, mayorista o minorista)'); return
    }
    // ── EN QUÉ BOCAS CORRE ──────────────────────────────────────────
    // Una fila por sucursal, todas con el mismo `grupo_id` (mig 103). Así la
    // Caja y el remito siguen leyendo `ofertas` filtrado por RLS igual que
    // siempre — no cambia nada de CÓMO se aplica una oferta —, y desde acá se
    // manejan como una sola.
    // Una sucursal no elige: su oferta es para su propia boca y el trigger de
    // la base la marca como propia.
    const destinos = esSucursal ? [sucursalId] : (ofertaForm.sucursales?.length ? ofertaForm.sucursales : [SUCURSAL_CENTRAL])
    if (!esSucursal && destinos.length === 0) {
      mostrarMsg('❌ Elegí al menos una sucursal donde aplicar la oferta'); return
    }
    setOfertaLoading(true)
    const grupoId = crypto.randomUUID()
    const base = {
      precio_id: ofertaForm.precio_id,
      producto_nombre: productoSeleccionado?.nombre,
      precio_original_carniceria: productoSeleccionado?.precio_carniceria,
      precio_original_mayorista: productoSeleccionado?.precio_mayorista,
      precio_original_minorista: productoSeleccionado?.precio_minorista,
      precio_oferta: ofertaForm.tipo === 'fijo' ? parseNumero(ofertaForm.precio_oferta) : null,
      descuento_pct: ofertaForm.tipo === 'porcentaje' ? parseNumero(ofertaForm.descuento_pct) : null,
      fecha_inicio: ofertaForm.fecha_inicio,
      fecha_fin: ofertaForm.fecha_fin,
      activa: true,
      notas: ofertaForm.notas,
      aplica_carniceria: ofertaForm.aplica_carniceria,
      aplica_mayorista: ofertaForm.aplica_mayorista,
      aplica_minorista: ofertaForm.aplica_minorista,
      grupo_id: grupoId,
    }
    const { error } = await supabase.from('ofertas').insert(
      // Carnicería sólo en la central: en una sucursal esa lista no existe
      // (la base también lo fuerza, mig 116).
      destinos.map(sid => ({
        ...base, sucursal_id: sid,
        aplica_carniceria: sid === SUCURSAL_CENTRAL ? base.aplica_carniceria : false,
      }))
    )
    setOfertaLoading(false)
    if (error) {
      mostrarMsg('❌ Error al guardar la oferta: ' + error.message)
      console.error('Insert oferta error:', error)
      return
    }
    mostrarMsg('✅ Oferta registrada correctamente')
    setOfertaForm({ precio_id: '', tipo: 'fijo', precio_oferta: '', descuento_pct: '', fecha_inicio: fechaHoyARG(), fecha_fin: '', notas: '', aplica_carniceria: !esSucursal, aplica_mayorista: true, aplica_minorista: true, sucursales: destinos })
    setBusquedaOferta(''); setProductoSeleccionado(null)
    await cargarOfertas()
  }

  // Se apaga el GRUPO, no la fila: una oferta que corre en tres bocas son tres
  // filas y tienen que caerse juntas. Las viejas (previas a la mig 103) tienen
  // grupo_id = su propio id, así que el mismo camino les sirve.
  async function desactivarOferta(o) {
    const { error } = await supabase.from('ofertas').update({ activa: false })
      .eq('grupo_id', o.grupo_id || o.id)
    if (error) { mostrarMsg('❌ No se pudo desactivar: ' + error.message); return }
    mostrarMsg('✅ Oferta desactivada')
    await cargarOfertas()
  }

  // ── Prender o apagar una oferta YA CARGADA en otra boca ──────────────
  // Al crear una oferta se eligen las bocas, pero después no había forma de
  // sumarle una: para que Monte Cristo tuviera una promo que ya corría en la
  // central había que cargarla de nuevo a mano. Acá se agrega o se saca la
  // fila de esa boca, manteniendo el `grupo_id` para que sigan siendo LA
  // MISMA oferta (se apagan juntas, se muestran en una sola línea).
  const [tocandoBoca, setTocandoBoca] = useState(null)   // `${grupo}|${sid}` en curso
  async function alternarBoca(o, sid) {
    if (esSucursal) return
    const grupo = o.grupo_id || o.id
    const yaEsta = new Set(o.bocas).has(sid)
    setTocandoBoca(`${grupo}|${sid}`)
    let error
    if (yaEsta) {
      // La última boca no se saca: una oferta sin bocas no existe en ningún
      // lado y quedaría de fantasma en la tabla. Para eso está Desactivar.
      if (new Set(o.bocas).size <= 1) {
        setTocandoBoca(null)
        mostrarMsg('❌ Es la única boca donde corre. Si no la querés más, usá Desactivar.')
        return
      }
      const r = await supabase.from('ofertas').delete().eq('grupo_id', grupo).eq('sucursal_id', sid)
      error = r.error
    } else {
      // Copia de la oferta para la boca nueva. `id`, `created_at` y
      // `sucursal_id` los pone la base; el resto se clona tal cual para que
      // las dos bocas tengan exactamente la misma promo.
      const { id, created_at, sucursal_id, origen, bocas, ...campos } = o
      const r = await supabase.from('ofertas').insert({
        ...campos, grupo_id: grupo, sucursal_id: sid,
        // Una sucursal no tiene lista Carnicería: esa es con la que la central
        // le vende a las carnicerías. La base también lo fuerza (mig 116).
        aplica_carniceria: sid === SUCURSAL_CENTRAL ? campos.aplica_carniceria : false,
      })
      error = r.error
    }
    setTocandoBoca(null)
    if (error) { mostrarMsg('❌ No se pudo: ' + error.message); return }
    mostrarMsg(yaEsta
      ? `✅ Sacada de ${nombreSucursal(sid)}`
      : `✅ ${nombreSucursal(sid)} ya tiene esta oferta`)
    await cargarOfertas()
  }

  const hoy = fechaHoyARG()
  function catalogoPDF() {
    const precsActivos = preciosConOfertas.filter(p => (p.precio_minorista || p.precio_carniceria || 0) > 0)
    const porCat = {}
    precsActivos.forEach(p => {
      const cat = p.categoria || 'otros'
      if (!porCat[cat]) porCat[cat] = []
      porCat[cat].push(p)
    })
    const fechaTxt = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
    let html = `<div class="badge">CARNICERÍAS FABRICIUS</div>`
    html += `<h1 class="h1">🥩 Catálogo de Precios</h1>`
    html += `<div class="sub">Río Primero, Córdoba · Vigente al ${fechaTxt}</div>`
    Object.entries(porCat).forEach(([catKey, items]) => {
      const catLabel = CATEGORIAS[catKey] || catKey
      html += `<h2 class="h2">${catLabel}</h2>`
      html += '<table><thead><tr><th>Producto</th><th class="right">Minorista</th><th class="right">Mayorista</th><th class="center">PLU</th></tr></thead><tbody>'
      items.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '')).forEach(p => {
        const tieneOferta = p.enOferta
        html += '<tr>'
        html += `<td class="bold">${p.nombre}${tieneOferta ? '<span class="oferta-badge">OFERTA</span>' : ''}</td>`
        html += `<td class="right ${tieneOferta ? 'precio-new' : ''}">${fmt(p.precio_minorista) || '—'}</td>`
        html += `<td class="right">${fmt(p.precio_mayorista) || '—'}</td>`
        html += `<td class="center" style="color:#999;font-size:11px">${p.codigo_balanza || '—'}</td>`
        html += '</tr>'
      })
      html += '</tbody></table>'
    })
    html += `<div class="footer">Generado desde el sistema de Carnicerías Fabricius · ${new Date().toLocaleString('es-AR')}</div>`
    abrirVentanaImprimible({ titulo: `Catálogo Fabricius ${fechaTxt}`, contenidoHtml: html })
  }

  // PDFs de listas de precios (archivo real, compartible por WhatsApp).
  // Va con los precios de lista NORMALES, sin aplicar ofertas: la oferta es
  // del mostrador, no de la lista que se le manda a un cliente (pedido de
  // Fabricio 20/07 — la falda especial salía a precio de oferta y parecía
  // que ese era el precio de lista). Si algún día se quiere mandar la lista
  // promocional, pasar preciosConOfertas acá: el PDF ya sabe marcar OFERTA.
  async function pdfLista(tipo) {
    try {
      const res = await compartirListaPrecios({ tipo, precios, categorias: categoriasVisibles })
      if (res === 'descargado') mostrarMsg('✅ PDF descargado — arrastralo al chat de WhatsApp')
      if (res === 'compartido') mostrarMsg('✅ Lista compartida')
    } catch (e) {
      mostrarMsg('❌ ' + e.message)
    }
  }

  // Vigentes de TODAS las bocas: SOLO para la tabla de administración. La RLS
  // deja que la central VEA las filas de todas las bocas a propósito (las
  // gobierna ella, mig 103) — por eso acá llegan también las de Monte Cristo.
  const ofertasVigentesTodas = ofertas.filter(o => o.activa && o.fecha_inicio <= hoy && o.fecha_fin >= hoy)
  // Vigentes DE ESTA BOCA: lo que usa el resto de la pantalla para marcar un
  // producto en oferta. Sin este filtro, una oferta cargada solo para una
  // sucursal aparecía "en oferta" también en la central (bug 28/08: Fabricio
  // cargó ofertas para Monte Cristo y se le aplicaban en su caja).
  const miBoca = Number(sucursalId ?? SUCURSAL_CENTRAL)
  const ofertasVigentes = ofertasVigentesTodas.filter(o => Number(o.sucursal_id ?? SUCURSAL_CENTRAL) === miBoca)
  // Para la TABLA: una fila por oferta, no por boca. Una oferta que corre en
  // la central y en Monte Cristo son dos filas en la base con el mismo
  // `grupo_id`; acá se juntan y se muestran las bocas como chips.
  const ofertasAgrupadas = useMemo(() => {
    const m = new Map()
    for (const o of ofertasVigentesTodas) {
      const k = o.grupo_id || o.id
      if (!m.has(k)) m.set(k, { ...o, bocas: [] })
      m.get(k).bocas.push(o.sucursal_id)
    }
    return [...m.values()]
  }, [ofertasVigentesTodas])
  const ofertasVencidas = ofertas.filter(o => !o.activa || o.fecha_fin < hoy)
  const productosFiltrados = precios.filter(p => p.categoria === filtro)
  const productosBusqueda = precios.filter(p => p.nombre.toLowerCase().includes(busquedaOferta.toLowerCase()))

  // Precios vigentes aplicando ofertas (selectivamente según las listas marcadas).
  // Soporta dos modos: precio fijo (precio_oferta) o porcentaje (descuento_pct).
  function aplicarOferta(precioBase, oferta) {
    if (!precioBase || precioBase <= 0) return precioBase
    if (oferta.descuento_pct != null && Number(oferta.descuento_pct) > 0) {
      return Math.round(precioBase * (1 - Number(oferta.descuento_pct) / 100))
    }
    if (oferta.precio_oferta != null && Number(oferta.precio_oferta) > 0) {
      return Number(oferta.precio_oferta)
    }
    return precioBase
  }
  const preciosConOfertas = precios.map(p => {
    const oferta = ofertasVigentes.find(o => o.precio_id === p.id)
    if (oferta) {
      // Las viejas ofertas sin flags se tratan como aplicables a todas (default DB es TRUE)
      const aC = oferta.aplica_carniceria !== false
      const aMa = oferta.aplica_mayorista !== false
      const aMi = oferta.aplica_minorista !== false
      return {
        ...p,
        precio_carniceria: aC ? aplicarOferta(p.precio_carniceria, oferta) : p.precio_carniceria,
        precio_mayorista:  aMa ? aplicarOferta(p.precio_mayorista,  oferta) : p.precio_mayorista,
        precio_minorista:  aMi ? aplicarOferta(p.precio_minorista,  oferta) : p.precio_minorista,
        enOferta: true,
        oferta,
      }
    }
    return p
  })
  const productosFiltradosConOfertas = preciosConOfertas.filter(p => p.categoria === filtro)

  async function enviarChat() {
    if (!chatInput.trim() || chatLoading) return
    const pregunta = chatInput.trim()
    setChatInput('')
    setChatMsgs(m => [...m, { rol: 'user', texto: pregunta }])
    setChatLoading(true)
    const listaTexto = precios.map(p =>
      `- ${p.nombre} (${CATEGORIAS[p.categoria]}): Carn $${p.precio_carniceria ?? '—'} / May $${p.precio_mayorista ?? '—'} / Min $${p.precio_minorista ?? '—'}`
    ).join('\n')
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openrouter/auto',
          messages: [
            { role: 'system', content: `Sos el asistente de Carnicerías Fabricius. Respondé en español argentino, directo y sin markdown.\n\nLISTA DE PRECIOS:\n${listaTexto}` },
            ...chatMsgs.filter((_, i) => i > 0).map(m => ({ role: m.rol === 'user' ? 'user' : 'assistant', content: m.texto })),
            { role: 'user', content: pregunta }
          ]
        })
      })
      const data = await res.json()
      const respuesta = (data.choices?.[0]?.message?.content || '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/#/g, '').trim()
      setChatMsgs(m => [...m, { rol: 'ia', texto: respuesta }])
    } catch (err) {
      setChatMsgs(m => [...m, { rol: 'ia', texto: '❌ Error: ' + err.message }])
    }
    setChatLoading(false)
  }

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: tab === id ? 'var(--gold)' : 'var(--surface)', color: tab === id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 13 }}>
      {label}
    </button>
  )

  return (
    <div>
      <div className="page-title">PRECIOS</div>
      <div className="page-sub">
        {esSucursal
          ? 'La lista te la manda la central. Almacén y bebidas los cargás vos.'
          : 'Consultá, administrá y usá la IA para gestionar tus precios'}
      </div>
      {/* Antes acá iba un aviso de "te faltan cargar N precios", de cuando la
          sucursal cargaba su propia lista. Ya no corresponde: los precios de la
          lista los manda la central (mig 114) y no hay nada que ella pueda
          cargar — el aviso sólo la mandaría a buscar un botón que no existe. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabBtn('ver', '📋 Ver Precios')}
        {tabBtn('admin', '✏️ Administrar')}
        {/* El aumento masivo corre sobre la lista, que ahora es de la central
            (mig 114). Para una sucursal la base lo rechaza, así que mejor que
            ni aparezca a que apriete y no pase nada. */}
        {!esSucursal && tabBtn('masivo', '🚀 Actualización masiva')}
        {tabBtn('ofertas', `🏷️ Ofertas${ofertasAgrupadas.length > 0 ? ` (${ofertasAgrupadas.length})` : ''}`)}
        {tabBtn('combos', '🍱 Combos')}
        {/* Categorías, Limpieza e Importar PLUs escriben el CATÁLOGO COMPARTIDO
            (`precios` y `config_sistema`): las tres son de la central. Para una
            sucursal la base ya las rechaza (mig 100) — mejor que ni aparezcan
            a que tiren un error. */}
        {!esSucursal && tabBtn('categorias', '🗂️ Categorías')}
        {/* El Asistente IA es de la central. Las franquicias no lo tienen:
            Alvear entra por FranquiciaPrecios, que nunca lo tuvo, y Monte
            Cristo cae en ESTA pantalla — era el único lugar donde le aparecía.
            Aparte de que no le corresponde, la consulta le manda la lista de
            precios entera al modelo. */}
        {!esSucursal && tabBtn('chat', '🤖 Asistente IA')}
{tabBtn('plu', '🏷️ PLU / Balanza')}
{!esSucursal && tabBtn('limpieza', '🧹 Limpieza duplicados')}
{!esSucursal && tabBtn('importar_plu', '📥 Importar PLUs CSV')}
{/* Comparativo contra las sucursales: solo lo ve la central, que es quien
    define la lista. Una sucursal ya ve sus propios precios en "Ver Precios". */}
{!esSucursal && tabBtn('sucursales', '🏪 Sucursales')}
      </div>
      {msg && <div style={{ background: msg.includes('❌') ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${msg.includes('❌') ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: msg.includes('❌') ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>{msg}</div>}

      {tab === 'ver' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <button onClick={catalogoPDF}
            style={{ padding: '8px 14px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            📄 Catálogo PDF (imprimible)
          </button>
          <button onClick={() => pdfLista('mayorista')}
            style={{ padding: '8px 14px', background: '#25D366', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            📄 PDF May/Min → WhatsApp
          </button>
          {/* Las listas de Carnicerías y Franquicias son las que usa la CENTRAL
              para venderles a sus clientes mayoristas y a las propias
              franquicias. Una sucursal no le vende a ninguno de los dos: ella
              ES la franquicia. */}
          {!esSucursal && (<>
            <button onClick={() => pdfLista('carniceria')}
              style={{ padding: '8px 14px', background: '#25D366', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
              📄 PDF Carnicerías → WhatsApp
            </button>
            <button onClick={() => pdfLista('franquicia')} title="Lista de carnicerías + insumos (la central les vende insumos solo a las franquicias)"
              style={{ padding: '8px 14px', background: '#25D366', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
              🏪 PDF Franquicias (c/insumos) → WhatsApp
            </button>
          </>)}
        </div>
      )}
      {tab === 'ver' && (
        <div>
          {ofertasVigentes.length > 0 && (
            <div style={{ background: '#1a2a0a', border: '1px solid #4a8a2a', borderRadius: 10, padding: '10px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#7dff7d', marginBottom: 6 }}>🏷️ Ofertas vigentes esta semana</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {ofertasVigentes.map(o => (
                  <div key={o.id} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '6px 12px', fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>{o.producto_nombre}</span>
                    <span style={{ color: 'var(--gold)', fontWeight: 700, marginLeft: 8 }}>${Math.round(o.precio_oferta).toLocaleString('es-AR')}</span>
                    <span style={{ color: 'var(--muted)', marginLeft: 6 }}>hasta {o.fecha_fin}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {categoriasVisibles.map(({ clave: id, label }) => (
              <button key={id} onClick={() => setFiltro(id)}
                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: filtro === id ? 'var(--gold)' : 'transparent', color: filtro === id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
                {label}
              </button>
            ))}
          </div>
          <div className="card">
            <div className="card-title">{CATEGORIAS[filtro]}</div>
            {loading ? <p style={{ color: 'var(--muted)' }}>Cargando...</p> : (
              <table>
                <thead><tr>
                  <th style={{ width: filtro === 'insumos' ? '65%' : '45%' }}>Producto</th>
                  {filtro === 'insumos' ? (
                    <th style={{ color: 'var(--gold)' }}>🧰 Precio Franquicia</th>
                  ) : (<>
                    {/* La columna Carnicería es el precio con el que la CENTRAL
                        le vende a la sucursal, no uno con el que ella venda. */}
                    {!esSucursal && <th style={{ color: 'var(--red-light)' }}>🔴 Carnicería</th>}
                    <th style={{ color: 'var(--amber)' }}>🟡 Mayorista</th>
                    <th style={{ color: 'var(--green)' }}>🟢 Minorista</th>
                  </>)}
                </tr></thead>
                <tbody>
                  {(() => {
                    const lista = filtro === 'insumos'
                      ? [...productosFiltradosConOfertas].sort((a, b) => (INSUMO_SUBCAT_ORDEN[a.subcategoria] ?? 9) - (INSUMO_SUBCAT_ORDEN[b.subcategoria] ?? 9) || a.nombre.localeCompare(b.nombre))
                      : productosFiltradosConOfertas
                    const rows = []
                    let lastSub = null
                    lista.forEach(p => {
                      if (filtro === 'insumos' && p.subcategoria !== lastSub) {
                        lastSub = p.subcategoria
                        rows.push(
                          <tr key={'sub-' + (p.subcategoria || 'x')}>
                            <td colSpan={2} style={{ background: 'var(--surface2)', color: 'var(--gold)', fontWeight: 700, fontSize: 12, padding: '6px 10px', letterSpacing: 0.5 }}>{INSUMO_SUBCAT[p.subcategoria] || p.subcategoria}</td>
                          </tr>
                        )
                      }
                      rows.push(
                        <tr key={p.id} style={{ background: p.enOferta ? 'rgba(125,255,125,0.04)' : 'transparent' }}>
                          <td style={{ fontWeight: 500 }}>
                            {p.nombre}
                            {p.enOferta && <span style={{ marginLeft: 8, background: '#4a8a2a', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>🏷️ OFERTA</span>}
                          </td>
                          {filtro === 'insumos' ? (
                            <td style={{ color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_carniceria)}</td>
                          ) : (<>
                            {!esSucursal && <td style={{ color: p.enOferta ? '#7dff7d' : 'var(--red-light)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_carniceria)}</td>}
                            <td style={{ color: p.enOferta ? '#7dff7d' : 'var(--amber)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_mayorista)}</td>
                            <td style={{ color: p.enOferta ? '#7dff7d' : 'var(--green)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_minorista)}</td>
                          </>)}
                        </tr>
                      )
                    })
                    return rows
                  })()}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'admin' && (
        <div>
          {/* Para una sucursal la solapa hace DOS cosas distintas según el
              producto, y sin decirlo parece que la mitad de los botones fallan. */}
          {esSucursal && (
            <div className="card" style={{ marginBottom: 16, borderColor: 'var(--gold)' }}>
              <div className="card-title" style={{ color: 'var(--gold)' }}>🛒 Almacén y bebidas son tuyos</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
                Esa mercadería la comprás y la vendés vos, así que armás tu propia lista:
                <strong style={{ color: 'var(--text)' }}> agregás, editás y borrás</strong> los productos que quieras.
                La central no los ve ni te los toca.
                <div style={{ marginTop: 8 }}>
                  Del <strong style={{ color: 'var(--text)' }}>resto del catálogo</strong> —carne, embutidos, pollo— acá
                  cargás <strong style={{ color: 'var(--text)' }}>solo el precio</strong>: los productos los da de alta la central.
                </div>
              </div>
            </div>
          )}
          {(() => {
            const orfanos = precios.filter(p => CATEGORIAS_CON_STOCK_ORIGEN.has(p.categoria) && !p.stock_origen && !p.stock_no_aplica)
            if (orfanos.length === 0) return null
            return (
              <div className="card" style={{ marginBottom: 16, borderColor: 'var(--amber)', background: '#2a1f0a' }}>
                <div className="card-title" style={{ color: 'var(--amber)' }}>📦 {orfanos.length} producto{orfanos.length === 1 ? '' : 's'} sin stock asignado — enlazalos</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                  Estos productos de cerdo/embutido/brosa se venden pero NO descuentan stock. Tocá cada uno para asignarle el bucket del que sale (o marcalo "no descuenta" si es comprado para reventa).
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {orfanos.map(p => (
                    <button key={p.id} onClick={() => editar(p)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface2)', border: '1px solid var(--amber)', color: 'var(--text)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                      ✏️ {(p.nombre || '').trim()} <span style={{ color: 'var(--muted)', fontSize: 11 }}>({CATEGORIAS[p.categoria] || p.categoria})</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-title">{editando ? '✏️ Editando producto' : '➕ Agregar producto'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Categoría</label>
                <select value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} style={inp}>
                  {categoriasVisibles.map(({ clave: id, label }) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
              {form.categoria === 'insumos' && (
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Grupo de insumo</label>
                  <select value={form.subcategoria} onChange={e => setForm({ ...form, subcategoria: e.target.value })} style={inp}>
                    {INSUMO_SUBCAT_OPCIONES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </div>
              )}
              <div style={{ gridColumn: '1/-1' }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nombre del producto</label>
                <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: Asado x kg" style={inp} />
              </div>
              {form.categoria === 'insumos' ? (
                // Insumos: un solo precio (Precio Franquicia). Se guarda en las 3
                // columnas para que el despacho lo tome con cualquier lista.
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🧰 Precio Franquicia (final, ya con el 10%)</label>
                  <input type="text" inputMode="decimal" value={form.precio_carniceria}
                    onChange={e => setForm({ ...form, precio_carniceria: e.target.value, precio_mayorista: e.target.value, precio_minorista: e.target.value })}
                    placeholder="Ej: 5500" style={inp} />
                </div>
              ) : (
                // Una sucursal solo carga sus dos listas de venta: la de
                // Carnicería es con la que la central le vende a ella.
                (esSucursal
                  ? [['precio_mayorista', '🟡 Precio Mayorista'], ['precio_minorista', '🟢 Precio Minorista']]
                  : [['precio_carniceria', '🔴 Precio Carnicería'], ['precio_mayorista', '🟡 Precio Mayorista'], ['precio_minorista', '🟢 Precio Minorista']]
                ).map(([campo, label]) => (
                  <div key={campo}>
                    <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{label}</label>
                    <input type="text" inputMode="decimal" value={form[campo]} onChange={e => setForm({ ...form, [campo]: e.target.value })} placeholder="Vacío = —" style={inp} />
                  </div>
                ))
              )}
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>⚖️ PLU Balanza (1-9999)</label>
                <input type="number" min="1" max="9999" value={form.codigo_balanza} onChange={e => setForm({ ...form, codigo_balanza: e.target.value })} placeholder="Ej: 1" style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>📅 Días vencimiento</label>
                <input type="number" min="0" value={form.dias_vencimiento} onChange={e => setForm({ ...form, dias_vencimiento: e.target.value })} placeholder="3" style={inp} />
              </div>
              {CATEGORIAS_CON_KG_POR_UNIDAD.has(form.categoria) && (
                <div style={{ gridColumn: '1/-1', background: '#1a2a3a', border: '1px solid #2d3a5a', borderRadius: 8, padding: 12 }}>
                  <label style={{ fontSize: 12, color: '#7db5ff', display: 'block', marginBottom: 4, fontWeight: 600 }}>
                    📦 Kg por cajón / unidad
                  </label>
                  <input
                    type="text" inputMode="decimal"
                    value={form.kg_por_unidad}
                    onChange={e => setForm({ ...form, kg_por_unidad: e.target.value })}
                    placeholder="Ej: 20"
                    style={{ ...inp, borderColor: '#7db5ff' }}
                  />
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    Cuántos kg pesa cada cajón/unidad. Al vender 1 cajón se descuentan estos kg del stock base ({form.categoria === 'pollo_cajon' ? 'pollo' : 'rebozado'}). Si lo dejás vacío, el sistema intenta parsearlo del nombre (ej. "X20KG").
                  </div>
                </div>
              )}
              {CATEGORIAS_CON_PIEZA_ENTERA.has(form.categoria) && (
                <div style={{ gridColumn: '1/-1', background: '#2a1f1a', border: '1px solid #5a3d2d', borderRadius: 8, padding: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--gold)' }}>
                    <input type="checkbox"
                      checked={!!form.vende_por_pieza}
                      onChange={e => setForm({ ...form, vende_por_pieza: e.target.checked })}
                      style={{ width: 18, height: 18, cursor: 'pointer' }} />
                    🥩 Se vende por pieza entera (selección del stock)
                  </label>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                    Al activarlo: cuando se elija este producto en Caja Rápida o Mayorista, aparece un selector con las piezas disponibles del stock (cada una con su kg propio). El cajero elige una pieza específica para vender — no se ingresa kg manualmente.
                    <br />Dejalo desactivado si el producto se vende por kg (Ej: "Pierna por kg" — el cajero pesa lo que el cliente lleva).
                  </div>
                </div>
              )}
              {permiteStockOrigen(form.categoria) && (
                <div style={{ gridColumn: '1/-1', background: '#10231a', border: `1px solid ${(form.stock_origen || form.stock_no_aplica) ? '#2d5a2d' : 'var(--amber)'}`, borderRadius: 8, padding: 12 }}>
                  <label style={{ fontSize: 12, color: '#7dff7d', display: 'block', marginBottom: 4, fontWeight: 600 }}>
                    📦 Stock que descuenta (de qué bucket sale al vender)
                  </label>
                  <select
                    value={form.stock_no_aplica ? '__no__' : (form.stock_origen || '')}
                    onChange={e => {
                      const v = e.target.value
                      if (v === '__no__') setForm({ ...form, stock_no_aplica: true, stock_origen: '' })
                      else setForm({ ...form, stock_no_aplica: false, stock_origen: v })
                    }}
                    style={{ ...inp, borderColor: (form.stock_origen || form.stock_no_aplica) ? '#2d5a2d' : 'var(--amber)' }}
                  >
                    <option value="">— Sin asignar (huérfano: se vende pero NO descuenta) —</option>
                    {stockBuckets
                      .filter(b => form.categoria === 'embutido' ? b.startsWith('emb_')
                        : form.categoria === 'bovino_brosa' ? (b.startsWith('brosa_') || b === 'bovino_corte')
                        : b.startsWith('cerdo_'))
                      .map(b => <option key={b} value={b}>{prettyBucket(b)}</option>)}
                    <option value="__no__">🚫 No descuenta (comprado / reventa)</option>
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    Al venderse, descuenta de este bucket. Si lo dejás "Sin asignar", el producto se vende pero NO baja stock (queda huérfano y te avisa la alerta). Marcá "No descuenta" solo si es comprado para reventa (no sale de tu producción).
                  </div>
                </div>
              )}
              <div style={{ gridColumn: '1/-1' }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🏷️ Descripción para etiqueta (opcional)</label>
                <input value={form.descripcion_etiqueta} onChange={e => setForm({ ...form, descripcion_etiqueta: e.target.value })} placeholder="Ej: Asado de tira premium" style={inp} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={guardar} disabled={loading}
                style={{ flex: 1, padding: '10px 0', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                {loading ? 'Guardando...' : editando ? '💾 Guardar cambios' : '➕ Agregar'}
              </button>
              {editando && (
                <button onClick={() => { setEditando(null); setForm(formEnBlanco()) }}
                  style={{ padding: '10px 20px', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                  Cancelar
                </button>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {categoriasVisibles.map(({ clave: id, label }) => (
              <button key={id} onClick={() => setFiltro(id)}
                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: filtro === id ? 'var(--gold)' : 'transparent', color: filtro === id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
                {label}
              </button>
            ))}
          </div>
          <div className="card">
            <div className="card-title">{CATEGORIAS[filtro]} — {productosFiltrados.length} productos</div>
            <table>
              <thead><tr>
                <th>Producto</th>
                <th style={{ width: 70 }}>⚖️ PLU</th>
                {/* Carnicería es el precio con el que la central le vende a las
                    carnicerías: para una sucursal es su precio de COMPRA, no
                    de venta. Era la única tabla que todavía lo mostraba. */}
                {!esSucursal && <th style={{ color: 'var(--red-light)' }}>🔴 Carn.</th>}
                <th style={{ color: 'var(--amber)' }}>🟡 May.</th>
                <th style={{ color: 'var(--green)' }}>🟢 Min.</th>
                <th>Acciones</th>
              </tr></thead>
              <tbody>
                {productosFiltrados.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.nombre}</td>
                    <td>{p.codigo_balanza ? <span style={{ background: 'var(--gold)', color: '#000', padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>{p.codigo_balanza}</span> : <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>}</td>
                    {!esSucursal && <td style={{ color: 'var(--red-light)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_carniceria)}</td>}
                    <td style={{ color: 'var(--amber)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_mayorista)}</td>
                    <td style={{ color: 'var(--green)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_minorista)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => editar(p)} style={{ padding: '4px 10px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>✏️</button>
                        <button onClick={() => eliminar(p.id)} style={{ padding: '4px 10px', background: '#3a1a1a', color: '#ff6b6b', border: '1px solid #5a2a2a', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'masivo' && (
        <div>
          <div className="card" style={{ marginBottom: 20, borderColor: 'var(--gold)' }}>
            <div className="card-title">🚀 Actualización masiva de precios</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Actualizá todos los precios de una categoría con un porcentaje de aumento o reducción.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Categoría</label>
                <select value={masivoCat} onChange={e => { setMasivoCat(e.target.value); setMasivoPreview([]) }} style={inp}>
                  <option value="todas">📦 Todas las categorías</option>
                  {categoriasVisibles.map(({ clave: id, label }) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Lista de precios</label>
                <select value={masivoLista} onChange={e => { setMasivoLista(e.target.value); setMasivoPreview([]) }} style={inp}>
                  <option value="todas">💰 Todas las listas</option>
                  {!esSucursal && <option value="carniceria">🔴 Solo Carnicería</option>}
                  <option value="mayorista">🟡 Solo Mayorista</option>
                  <option value="minorista">🟢 Solo Minorista</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Porcentaje (+ aumento / - reducción)</label>
                <input type="text" inputMode="decimal" placeholder="Ej: 10 para +10%" value={masivoPct} onChange={e => { setMasivoPct(e.target.value); setMasivoPreview([]) }} style={{ ...inp, borderColor: masivoPct ? 'var(--gold)' : 'var(--border)' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={calcularPreview} disabled={!masivoPct}
                style={{ padding: '10px 20px', background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--gold)', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}>
                👁️ Ver preview
              </button>
              <button onClick={aplicarMasivo} disabled={masivoLoading || masivoPreview.length === 0}
                style={{ padding: '10px 20px', background: masivoPreview.length > 0 ? 'var(--gold)' : 'var(--surface2)', color: masivoPreview.length > 0 ? '#000' : 'var(--muted)', border: 'none', borderRadius: 8, fontWeight: 700, cursor: masivoPreview.length > 0 ? 'pointer' : 'not-allowed', fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}>
                {masivoLoading ? '⏳ Aplicando...' : `✅ Aplicar a ${masivoPreview.length} productos`}
              </button>
            </div>
          </div>
          {masivoPreview.length > 0 && (
            <div className="card">
              <div className="card-title">👁️ Preview — {masivoPreview.length} productos afectados</div>
              <table>
                <thead><tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  {!esSucursal && (masivoLista === 'todas' || masivoLista === 'carniceria') && <th style={{ color: 'var(--red-light)' }}>🔴 Carn. → nuevo</th>}
                  {(masivoLista === 'todas' || masivoLista === 'mayorista') && <th style={{ color: 'var(--amber)' }}>🟡 May. → nuevo</th>}
                  {(masivoLista === 'todas' || masivoLista === 'minorista') && <th style={{ color: 'var(--green)' }}>🟢 Min. → nuevo</th>}
                </tr></thead>
                <tbody>
                  {masivoPreview.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>{p.nombre}</td>
                      <td style={{ fontSize: 11, color: 'var(--muted)' }}>{CATEGORIAS[p.categoria]}</td>
                      {!esSucursal && (masivoLista === 'todas' || masivoLista === 'carniceria') && <td>{fmt(p.precio_carniceria)} → <strong style={{ color: 'var(--gold)' }}>{fmt(p.nuevo_carniceria)}</strong></td>}
                      {(masivoLista === 'todas' || masivoLista === 'mayorista') && <td>{fmt(p.precio_mayorista)} → <strong style={{ color: 'var(--gold)' }}>{fmt(p.nuevo_mayorista)}</strong></td>}
                      {(masivoLista === 'todas' || masivoLista === 'minorista') && <td>{fmt(p.precio_minorista)} → <strong style={{ color: 'var(--gold)' }}>{fmt(p.nuevo_minorista)}</strong></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'ofertas' && (
        <div>
          {/* NUEVA OFERTA */}
          <div className="card" style={{ marginBottom: 20, borderColor: '#4a8a2a' }}>
            <div className="card-title">🏷️ Nueva oferta semanal</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Podés cargar la oferta como precio fijo nuevo (ej: $16.000) o como % de descuento (ej: -20%). El descuento se aplica solo a las listas tildadas más abajo.
            </div>

            <div style={{ position: 'relative', marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Buscar producto</label>
              <input
                value={busquedaOferta}
                onChange={e => { setBusquedaOferta(e.target.value); setMostrarDropdown(true); setProductoSeleccionado(null); setOfertaForm(f => ({ ...f, precio_id: '' })) }}
                onFocus={() => setMostrarDropdown(true)}
                placeholder="Escribí el nombre del producto..."
                style={{ ...inp, borderColor: productoSeleccionado ? '#4a8a2a' : 'var(--border)' }}
              />
              {mostrarDropdown && busquedaOferta && productosBusqueda.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 100, maxHeight: 200, overflowY: 'auto' }}>
                  {productosBusqueda.map(p => (
                    <div key={p.id} onClick={() => seleccionarProductoOferta(p)}
                      style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}
                      onMouseOver={e => e.currentTarget.style.background = 'var(--surface2)'}
                      onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                      <span style={{ fontWeight: 600 }}>{p.nombre}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{CATEGORIAS[p.categoria]}</span>
                    </div>
                  ))}
                </div>
              )}
              {productoSeleccionado && (
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
                  Precios actuales — 🔴 Carn: {fmt(productoSeleccionado.precio_carniceria)} / 🟡 May: {fmt(productoSeleccionado.precio_mayorista)} / 🟢 Min: {fmt(productoSeleccionado.precio_minorista)}
                </div>
              )}
            </div>

            {/* Selector tipo de oferta */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Tipo de oferta</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button"
                  onClick={() => setOfertaForm(f => ({ ...f, tipo: 'fijo', descuento_pct: '' }))}
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: 8,
                    border: `2px solid ${ofertaForm.tipo === 'fijo' ? 'var(--green)' : 'var(--border)'}`,
                    background: ofertaForm.tipo === 'fijo' ? 'var(--green)22' : 'var(--surface2)',
                    color: ofertaForm.tipo === 'fijo' ? 'var(--green)' : 'var(--muted)',
                    cursor: 'pointer', fontWeight: 700, fontSize: 13,
                  }}>
                  💰 Precio fijo nuevo
                </button>
                <button type="button"
                  onClick={() => setOfertaForm(f => ({ ...f, tipo: 'porcentaje', precio_oferta: '' }))}
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: 8,
                    border: `2px solid ${ofertaForm.tipo === 'porcentaje' ? 'var(--gold)' : 'var(--border)'}`,
                    background: ofertaForm.tipo === 'porcentaje' ? 'var(--gold)22' : 'var(--surface2)',
                    color: ofertaForm.tipo === 'porcentaje' ? 'var(--gold)' : 'var(--muted)',
                    cursor: 'pointer', fontWeight: 700, fontSize: 13,
                  }}>
                  📉 % de descuento
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              {ofertaForm.tipo === 'fijo' ? (
                <div>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>💥 Precio de oferta ($)</label>
                  <input type="text" inputMode="decimal" value={ofertaForm.precio_oferta} onChange={e => setOfertaForm(f => ({ ...f, precio_oferta: e.target.value }))} placeholder="Ej: 16000" style={{ ...inp, borderColor: 'var(--green)' }} />
                </div>
              ) : (
                <div>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>📉 % de descuento</label>
                  <input type="text" inputMode="decimal" max="99" value={ofertaForm.descuento_pct} onChange={e => setOfertaForm(f => ({ ...f, descuento_pct: e.target.value }))} placeholder="Ej: 20" style={{ ...inp, borderColor: 'var(--gold)' }} />
                </div>
              )}
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>📅 Fecha inicio</label>
                <input type="date" value={ofertaForm.fecha_inicio} onChange={e => setOfertaForm(f => ({ ...f, fecha_inicio: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>📅 Fecha fin</label>
                <input type="date" value={ofertaForm.fecha_fin} onChange={e => setOfertaForm(f => ({ ...f, fecha_fin: e.target.value }))} style={inp} />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Notas</label>
              <input value={ofertaForm.notas} onChange={e => setOfertaForm(f => ({ ...f, notas: e.target.value }))} placeholder="Ej: Oferta de semana santa, liquidación..." style={inp} />
            </div>

            {/* Selector de listas a las que aplica la oferta */}
            <div style={{ marginBottom: 16 }}>
              {/* ── DÓNDE CORRE (solo la central elige) ──
                  Las ofertas las define la central y decide en qué bocas se
                  aplican. Una sucursal que arma una oferta propia no elige:
                  va a la suya. */}
              {!esSucursal && sucursalesLista.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>🏪 ¿En qué sucursales corre esta oferta?</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {sucursalesLista.map(s => {
                      const elegida = (ofertaForm.sucursales || []).includes(s.id)
                      return (
                        <button key={s.id} type="button"
                          onClick={() => setOfertaForm(f => ({
                            ...f,
                            sucursales: elegida
                              ? f.sucursales.filter(x => x !== s.id)
                              : [...(f.sucursales || []), s.id],
                          }))}
                          style={{
                            padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                            fontSize: 12, fontWeight: 700, fontFamily: "'DM Sans',sans-serif",
                            border: `1px solid ${elegida ? 'var(--gold)' : 'var(--border)'}`,
                            background: elegida ? 'var(--gold)' : 'transparent',
                            color: elegida ? '#000' : 'var(--muted)',
                          }}>
                          {elegida ? '✓ ' : ''}🏪 {s.nombre}
                        </button>
                      )
                    })}
                  </div>
                  {(ofertaForm.sucursales || []).length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 6 }}>
                      ⚠️ Elegí al menos una: si no, la oferta no corre en ningún lado.
                    </div>
                  )}
                </div>
              )}

              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>📋 Aplicar esta oferta a las listas:</label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  // Carnicería es la lista con la que la central le vende a las
                  // carnicerías: no es de la sucursal. Mayorista y minorista sí:
                  // cada boca elige a cuál aplica su oferta, o a las dos.
                  ...(esSucursal ? [] : [{ key: 'aplica_carniceria', label: '🔴 Carnicería', color: '#ff6b6b' }]),
                  { key: 'aplica_mayorista',  label: '🟡 Mayorista',  color: 'var(--amber)' },
                  { key: 'aplica_minorista',  label: '🟢 Minorista',  color: 'var(--green)' },
                ].map(opt => {
                  const checked = !!ofertaForm[opt.key]
                  return (
                    <label key={opt.key}
                      onClick={() => setOfertaForm(f => ({ ...f, [opt.key]: !f[opt.key] }))}
                      style={{ flex: '1 1 150px', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, cursor: 'pointer', border: `2px solid ${checked ? opt.color : 'var(--border)'}`, background: checked ? opt.color + '22' : 'var(--surface2)', color: checked ? opt.color : 'var(--muted)', fontWeight: 600, fontSize: 13 }}>
                      <input type="checkbox" checked={checked} readOnly style={{ accentColor: opt.color }} />
                      {opt.label}
                    </label>
                  )
                })}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                ℹ️ El precio de oferta solo se aplica a las listas tildadas. Las no tildadas mantienen su precio original.
              </div>
            </div>

            {productoSeleccionado && (ofertaForm.precio_oferta || ofertaForm.descuento_pct) && (() => {
              const calcular = (base) => {
                if (!base || base <= 0) return null
                if (ofertaForm.tipo === 'porcentaje' && ofertaForm.descuento_pct) {
                  const pct = parseFloat(ofertaForm.descuento_pct)
                  if (isNaN(pct) || pct <= 0) return null
                  return { precio: Math.round(base * (1 - pct / 100)), pct }
                }
                if (ofertaForm.tipo === 'fijo' && ofertaForm.precio_oferta) {
                  const nuevo = parseFloat(ofertaForm.precio_oferta)
                  return { precio: nuevo, pct: Math.round((1 - nuevo / base) * 100) }
                }
                return null
              }
              const filas = [
                ...(esSucursal ? [] : [{ key: 'aplica_carniceria', label: '🔴 Carnicería', base: productoSeleccionado.precio_carniceria }]),
                { key: 'aplica_mayorista',  label: '🟡 Mayorista',  base: productoSeleccionado.precio_mayorista },
                { key: 'aplica_minorista',  label: '🟢 Minorista',  base: productoSeleccionado.precio_minorista },
              ].filter(f => ofertaForm[f.key])
              return (
                <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, letterSpacing: 1 }}>VISTA PREVIA</div>
                  {filas.map(f => {
                    const r = calcular(f.base)
                    return (
                      <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ minWidth: 110 }}>{f.label}</span>
                        <span style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>{fmt(f.base || 0)}</span>
                        <span style={{ color: 'var(--muted)' }}>→</span>
                        <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 15 }}>{r ? fmt(r.precio) : '—'}</span>
                        {r && r.pct > 0 && (
                          <span style={{ background: '#4a8a2a', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>
                            -{r.pct}%
                          </span>
                        )}
                      </div>
                    )
                  })}
                  {filas.length === 0 && (
                    <div style={{ color: '#ff6b6b' }}>⚠️ No hay listas tildadas: la oferta no se aplica a ningún precio.</div>
                  )}
                </div>
              )
            })()}

            <button onClick={guardarOferta} disabled={ofertaLoading}
              style={{ padding: '10px 24px', background: '#4a8a2a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
              {ofertaLoading ? '⏳ Guardando...' : '✅ Registrar oferta'}
            </button>
          </div>

          {/* OFERTAS VIGENTES (de todas las bocas: esta tabla es administración) */}
          {ofertasVigentesTodas.length > 0 && (
            <div className="card" style={{ marginBottom: 16, borderColor: '#4a8a2a' }}>
              <div className="card-title">✅ Ofertas vigentes ahora</div>
              <table>
                <thead><tr><th>Producto</th><th>Aplica a</th>{!esSucursal && <th>Dónde corre</th>}<th>Tipo</th><th>Descuento</th><th>Resulta en</th><th>Vigencia</th><th>Acciones</th></tr></thead>
                <tbody>
                  {ofertasAgrupadas.map(o => {
                    const listas = []
                    // Carnicería es la lista con la que la CENTRAL le vende a las
                    // carnicerías: una sucursal no la tiene. Mostrarle el chip era
                    // ofrecerle una lista inexistente (la base ya lo fuerza, mig 116).
                    if (!esSucursal && o.aplica_carniceria !== false) listas.push({ l: '🔴 Carn', c: '#ff6b6b' })
                    if (o.aplica_mayorista  !== false) listas.push({ l: '🟡 May',  c: 'var(--amber)' })
                    if (o.aplica_minorista  !== false) listas.push({ l: '🟢 Min',  c: 'var(--green)' })
                    const esPct = o.descuento_pct != null && Number(o.descuento_pct) > 0
                    const baseRef = o.precio_original_minorista || o.precio_original_carniceria || o.precio_original_mayorista || 0
                    const resultante = esPct
                      ? Math.round(baseRef * (1 - Number(o.descuento_pct) / 100))
                      : Number(o.precio_oferta || 0)
                    const pctMostrado = esPct
                      ? Number(o.descuento_pct)
                      : (baseRef > 0 ? Math.round((1 - resultante / baseRef) * 100) : null)
                    return (
                    <tr key={o.grupo_id || o.id}>
                      <td style={{ fontWeight: 600 }}>
                        {o.producto_nombre}
                        {/* A la sucursal se le avisa cuál bajó de la central:
                            esa no la puede tocar. */}
                        {esSucursal && o.origen === 'central' && (
                          <span title="Oferta de la central — no se puede desactivar desde acá"
                            style={{ marginLeft: 6, background: 'var(--gold)22', color: 'var(--gold)', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
                            🔒 de la central
                          </span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {listas.map((x, i) => (
                            <span key={i} style={{ background: x.c + '22', color: x.c, borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 700 }}>{x.l}</span>
                          ))}
                        </div>
                      </td>
                      {!esSucursal && (
                        <td>
                          {/* Todas las bocas, no sólo donde ya corre: se tocan para
                              sumarla o sacarla. Antes esto era una etiqueta muerta y
                              para darle una promo a Monte Cristo había que volver a
                              cargarla desde cero. */}
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {sucursalesLista.map(s => {
                              const corre = new Set(o.bocas).has(s.id)
                              const cargando = tocandoBoca === `${o.grupo_id || o.id}|${s.id}`
                              return (
                                <button key={s.id} onClick={() => alternarBoca(o, s.id)} disabled={cargando}
                                  title={corre ? `Sacar de ${s.nombre}` : `Darle esta oferta a ${s.nombre}`}
                                  style={{
                                    background: corre ? 'var(--green)22' : 'transparent',
                                    color: corre ? 'var(--green)' : 'var(--muted)',
                                    border: `1px solid ${corre ? 'var(--green)' : 'var(--border)'}`,
                                    borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 700,
                                    whiteSpace: 'nowrap', cursor: cargando ? 'wait' : 'pointer',
                                    opacity: cargando ? 0.5 : 1, fontFamily: "'DM Sans',sans-serif",
                                  }}>
                                  {corre ? '✓' : '+'} {s.nombre}
                                </button>
                              )
                            })}
                          </div>
                        </td>
                      )}
                      <td>
                        <span style={{ background: esPct ? 'var(--gold)22' : 'var(--green)22', color: esPct ? 'var(--gold)' : 'var(--green)', borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>
                          {esPct ? '📉 %' : '💰 FIJO'}
                        </span>
                      </td>
                      <td>
                        {pctMostrado != null && (
                          <span style={{ background: '#4a8a2a', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                            -{pctMostrado}%
                          </span>
                        )}
                      </td>
                      <td>
                        <div style={{ color: 'var(--muted)', textDecoration: 'line-through', fontSize: 11 }}>{fmt(baseRef)}</div>
                        <div style={{ color: 'var(--green)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(resultante)}</div>
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--muted)' }}>{o.fecha_inicio} → {o.fecha_fin}</td>
                      <td>
                        {/* La sucursal no puede apagar una oferta de la
                            central. Además del botón, lo impide la base
                            (policy `oferta_central_intocable`, mig 103). */}
                        {esSucursal && o.origen === 'central' ? (
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>La define la central</span>
                        ) : (
                          <button onClick={() => desactivarOferta(o)}
                            style={{ padding: '4px 10px', background: '#3a1a1a', color: '#ff6b6b', border: '1px solid #5a2a2a', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                            ✕ Desactivar{!esSucursal && new Set(o.bocas).size > 1 ? ` (${new Set(o.bocas).size} bocas)` : ''}
                          </button>
                        )}
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          )}

          {/* HISTORIAL */}
          {ofertasVencidas.length > 0 && (
            <div className="card">
              <div className="card-title">📁 Historial de ofertas</div>
              <TablaOfertasVencidasPag ofertasVencidas={ofertasVencidas} />
            </div>
          )}
        </div>
      )}

      {/* `&& !esSucursal` además de esconder la pestaña: la pestaña que no
          existe no se puede apretar, pero la vista sí se puede pedir si `tab`
          queda en 'chat' por cualquier vía. */}
      {tab === 'chat' && !esSucursal && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 520 }}>
          <div className="card-title">🤖 Asistente IA — Carnicerías Fabricius</div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16, paddingRight: 4 }}>
            {chatMsgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.rol === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '80%', padding: '10px 14px', borderRadius: 12, background: m.rol === 'user' ? 'var(--gold)' : 'var(--surface)', color: m.rol === 'user' ? '#000' : 'var(--text)', fontSize: 14, lineHeight: 1.5, fontFamily: "'DM Sans',sans-serif", border: m.rol === 'ia' ? '1px solid var(--border)' : 'none', whiteSpace: 'pre-wrap' }}>
                  {m.texto}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: 14 }}>Pensando... ⏳</div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && enviarChat()} placeholder="Preguntame sobre precios, productos..." style={{ ...inp, flex: 1 }} />
            <button onClick={enviarChat} disabled={chatLoading} style={{ padding: '8px 18px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Enviar</button>
          </div>
        </div>
      )}

     {tab === 'plu' && (
  <PLUTab precios={precios} ofertas={ofertas} onRecargar={cargar} categoriasOrden={categoriasVisibles} esSucursal={esSucursal} />
)}
      {tab === 'categorias' && (() => {
        // Copia editable: se trabaja sobre catEdit y recién al Guardar se
        // persiste en config_sistema. Las de sistema no se pueden eliminar
        // (tienen lógica de stock/cajones asociada); eliminar exige 0 productos.
        const lista = catEdit || categorias
        const productosPorCat = precios.reduce((acc, p) => { acc[p.categoria] = (acc[p.categoria] || 0) + 1; return acc }, {})
        const mover = (i, dir) => {
          const j = i + dir
          if (j < 0 || j >= lista.length) return
          const copia = [...lista]
          ;[copia[i], copia[j]] = [copia[j], copia[i]]
          setCatEdit(copia)
        }
        const setLabel = (i, label) => {
          const copia = [...lista]
          copia[i] = { ...copia[i], label }
          setCatEdit(copia)
        }
        const toggleActiva = i => {
          const copia = [...lista]
          copia[i] = { ...copia[i], activa: copia[i].activa === false }
          setCatEdit(copia)
        }
        const eliminar = i => {
          const c = lista[i]
          if (c.sistema || (productosPorCat[c.clave] || 0) > 0) return
          setCatEdit(lista.filter((_, k) => k !== i))
        }
        const agregar = () => {
          const nombre = catNueva.trim()
          if (!nombre) return
          const clave = claveDesdeNombre(nombre)
          if (!clave) { mostrarMsg('❌ El nombre no genera una clave válida'); return }
          if (lista.some(c => c.clave === clave)) { mostrarMsg('❌ Ya existe una categoría con esa clave (' + clave + ')'); return }
          setCatEdit([...lista, { clave, label: nombre, activa: true, sistema: false }])
          setCatNueva('')
        }
        const guardar = async () => {
          setCatGuardando(true)
          const { error } = await guardarCategoriasPrecios(lista)
          if (error) mostrarMsg('❌ No se pudo guardar: ' + error.message)
          else {
            setCategorias(lista)
            setCatEdit(null)
            mostrarMsg('✅ Categorías guardadas')
          }
          setCatGuardando(false)
        }
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'start' }}>
            <div className="card">
              <div className="card-title">🗂️ Categorías de la lista de precios</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                Ordená con ⬆️⬇️, renombrá tocando el nombre, ocultá con 👁 y eliminá con 🗑 (solo categorías propias y vacías).
                Las categorías 🔒 son del sistema: tienen lógica de stock asociada, se pueden ocultar o renombrar pero no eliminar.
              </div>
              {lista.map((c, i) => {
                const cant = productosPorCat[c.clave] || 0
                const oculta = c.activa === false
                return (
                  <div key={c.clave} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border)', opacity: oculta ? 0.5 : 1 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <button onClick={() => mover(i, -1)} disabled={i === 0} style={{ background: 'none', border: 'none', color: i === 0 ? 'var(--border)' : 'var(--muted)', cursor: i === 0 ? 'default' : 'pointer', fontSize: 11, padding: 0, lineHeight: 1 }}>▲</button>
                      <button onClick={() => mover(i, 1)} disabled={i === lista.length - 1} style={{ background: 'none', border: 'none', color: i === lista.length - 1 ? 'var(--border)' : 'var(--muted)', cursor: i === lista.length - 1 ? 'default' : 'pointer', fontSize: 11, padding: 0, lineHeight: 1 }}>▼</button>
                    </div>
                    <input value={c.label} onChange={e => setLabel(i, e.target.value)}
                      style={{ ...inp, flex: 1, padding: '6px 10px', fontSize: 13, textDecoration: oculta ? 'line-through' : 'none' }} />
                    <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 74, textAlign: 'right' }}>
                      {cant} producto{cant === 1 ? '' : 's'}
                    </span>
                    <span title={c.sistema ? 'Categoría del sistema — no se puede eliminar' : 'Categoría propia'} style={{ fontSize: 13, width: 20, textAlign: 'center' }}>
                      {c.sistema ? '🔒' : '✨'}
                    </span>
                    <button onClick={() => toggleActiva(i)} title={oculta ? 'Mostrar' : 'Ocultar (no aparece en solapas, buscadores ni PDF)'}
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 13, color: oculta ? 'var(--muted)' : 'var(--text)' }}>
                      {oculta ? '🚫' : '👁'}
                    </button>
                    <button onClick={() => eliminar(i)} disabled={c.sistema || cant > 0}
                      title={c.sistema ? 'Del sistema: solo se puede ocultar' : cant > 0 ? 'Tiene productos: movelos o borralos primero' : 'Eliminar categoría'}
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: (c.sistema || cant > 0) ? 'not-allowed' : 'pointer', fontSize: 13, opacity: (c.sistema || cant > 0) ? 0.35 : 1 }}>
                      🗑
                    </button>
                  </div>
                )
              })}
              <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
                <button className="btn btn-gold" onClick={guardar} disabled={catGuardando || !catEdit}>
                  {catGuardando ? '⏳ Guardando…' : '💾 Guardar cambios'}
                </button>
                {catEdit && (
                  <button className="btn" onClick={() => setCatEdit(null)}>Descartar</button>
                )}
                {!catEdit && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Sin cambios pendientes</span>}
              </div>
            </div>
            <div className="card">
              <div className="card-title">➕ Nueva categoría</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                Nombre visible (podés incluir un emoji). Ej: <em>🐟 Pescados</em>. Después cargale productos desde ✏️ Administrar.
              </div>
              <input value={catNueva} onChange={e => setCatNueva(e.target.value)} placeholder="🐟 Pescados y Mariscos"
                onKeyDown={e => { if (e.key === 'Enter') agregar() }} style={{ ...inp, marginBottom: 10 }} />
              {catNueva.trim() && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>Clave interna: <code>{claveDesdeNombre(catNueva)}</code></div>
              )}
              <button className="btn btn-gold" onClick={agregar} disabled={!catNueva.trim()} style={{ width: '100%' }}>➕ Agregar a la lista</button>
              <div style={{ background: '#1a1a2a', border: '1px solid #2a2a5a', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#7db5ff', marginTop: 14 }}>
                ℹ️ Los productos de una categoría nueva se venden por kg y <strong>no descuentan stock</strong>, salvo que en ✏️ Administrar los enlaces a un bucket de stock. Los portales de clientes/franquicias no muestran categorías nuevas automáticamente.
              </div>
            </div>
          </div>
        )
      })()}
      {tab === 'combos' && <CombosEditor precios={precios} />}
      {tab === 'limpieza' && <LimpiezaDuplicados />}
      {tab === 'importar_plu' && <ImportarPLUQendra />}
      {tab === 'sucursales' && !esSucursal && <SucursalesPrecios productos={precios} />}
    </div>
  )
}

// Orden de las listas para renumerar PLUs: mismo orden de categorías que el
// catálogo impreso, correlativo desde 1; las cajas PT van en bloque aparte
// desde 120 para no mezclarse con las listas del mostrador.
const ORDEN_RENUM_PLU = ['bovino_corte', 'bovino_pieza', 'bovino_brosa', 'cerdo_corte', 'cerdo_pieza', 'embutido', 'pollo', 'rebozado']
const CAT_CAJAS_PLU = 'bovino_caja_pt'
const PLU_INICIO_CAJAS = 120

// ============================================================
// FORMATO DEL CÓDIGO DE BARRAS — cambiar el modo de la balanza
// ============================================================
// Sirve para pasar la balanza de "importe" a "peso" (ver lib/balanzaFormato.js)
// SIN depender de nadie: se elige el modo, se prueba con una etiqueta real y
// recién ahí se guarda. El probador decodifica con el modo ELEGIDO (todavía sin
// guardar), así se verifica que la balanza escriba los gramos donde el sistema
// los espera antes de tocar nada en producción.
// El cambio es por SUCURSAL: cada boca tiene su balanza y se reconfiguran en
// momentos distintos, así que la central puede quedar en importe mientras
// Monte Cristo ya está en peso.
function FormatoBalanzaCard({ precios }) {
  const { isCEO, sucursalId } = useAuth()
  const [valor, setValor] = useState(null)        // config_sistema.valor crudo
  const [sucursales, setSucursales] = useState([])
  const [sucSel, setSucSel] = useState(sucursalId || 1)
  const [modoSel, setModoSel] = useState(null)    // modo elegido, aún sin guardar
  const [test, setTest] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    (async () => {
      const [{ data: cfg }, { data: sucs }] = await Promise.all([
        supabase.from('config_sistema').select('valor').eq('clave', 'ean13_formato').maybeSingle(),
        supabase.from('sucursales').select('id, nombre').order('id'),
      ])
      setValor(cfg?.valor || FORMATO_DEFAULT)
      setSucursales(sucs || [])
    })()
  }, [])

  useEffect(() => { setModoSel(null); setTest('') }, [sucSel])

  if (!valor) return null

  const guardado = resolverFormatoEAN(valor, sucSel)
  const modo = modoSel || guardado.tipo
  const formatoPreview = { ...guardado, tipo: modo }
  const hayCambio = modo !== guardado.tipo

  // Decodificación de prueba con el modo ELEGIDO (no el guardado)
  const clean = String(test).replace(/\D/g, '')
  const decoded = clean.length === 13 ? decodificarEANBalanza(clean, formatoPreview) : null
  const prodTest = decoded && !decoded.error ? (precios || []).find(p => p.codigo_balanza === decoded.plu) : null

  async function guardar() {
    setGuardando(true)
    const nuevo = conModoDeSucursal(valor, sucSel, modo)
    // `.select()` no es decorativo: `config_sistema` sólo la escribe la
    // central (mig 100). Para una sucursal el UPDATE no falla — actualiza
    // CERO filas y vuelve sin error, así que sin mirar lo que volvió la
    // pantalla decía "✅ Formato guardado" y no había guardado nada. Con la
    // balanza ya cambiada eso es una mañana perdida buscando el fantasma.
    const { data, error } = await supabase.from('config_sistema')
      .update({ valor: nuevo }).eq('clave', 'ean13_formato').select('clave')
    setGuardando(false)
    if (error) { setMsg({ tipo: 'error', texto: '❌ No se pudo guardar: ' + error.message }); return }
    if (!data || data.length === 0) {
      setMsg({ tipo: 'error', texto: '❌ No se guardó: el formato de la balanza lo cambia la central. Pedíselo a Fabricio — él lo hace desde su usuario eligiendo esta boca.' })
      return
    }
    setValor(nuevo)
    setModoSel(null)
    setMsg({ tipo: 'ok', texto: '✅ Formato guardado. La Caja de esa boca ya lee con el modo nuevo.' })
    setTimeout(() => setMsg(null), 6000)
  }

  const nombreSuc = s => (sucursales.find(x => x.id === s)?.nombre) || `Sucursal ${s}`

  return (
    <div className="card" style={{ marginBottom: 16, borderColor: hayCambio ? 'var(--amber)' : 'var(--border)' }}>
      <div className="card-title">⚖️ Formato del código de barras</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.6 }}>
        Define qué lee la Caja de la etiqueta de la balanza. Cambiarlo acá <b>y en la balanza</b> tiene
        que hacerse junto: mientras uno diga una cosa y el otro otra, todos los escaneos salen mal.
        Probá con una etiqueta real antes de guardar.
      </div>

      {sucursales.length > 1 && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>BOCA</label>
          <select value={sucSel} onChange={e => setSucSel(Number(e.target.value))}
            disabled={!isCEO}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}>
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {Object.entries(MODOS_BALANZA).map(([clave, info]) => (
          <label key={clave} style={{
            display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 8,
            cursor: isCEO ? 'pointer' : 'not-allowed', opacity: isCEO ? 1 : 0.6,
            background: modo === clave ? 'rgba(255,209,122,0.07)' : 'var(--surface2)',
            border: `1px solid ${modo === clave ? 'var(--gold)' : 'var(--border)'}`,
          }}>
            <input type="radio" name="modo-balanza" checked={modo === clave} disabled={!isCEO}
              onChange={() => setModoSel(clave)} style={{ marginTop: 3, accentColor: 'var(--gold)' }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {info.label}
                {guardado.tipo === clave && <span style={{ fontSize: 10, color: 'var(--green)', marginLeft: 8 }}>● en uso</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>{info.resumen}</div>
              <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 3 }}>
                En Qendra → Códigos de barras, campo <b>{info.campoQendra}</b>
              </div>
            </div>
          </label>
        ))}
      </div>

      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
        Patrón esperado: <code style={{ color: 'var(--gold)' }}>{patronLegible(formatoPreview)}</code>
      </div>

      {/* PROBADOR — escanear una etiqueta de prueba antes de guardar */}
      <div style={{ padding: 12, background: 'var(--surface2)', borderRadius: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>🔍 Probar una etiqueta</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.5 }}>
          Pesá algo que conozcas (por ejemplo 1 kg), imprimí la etiqueta y escaneala acá.
          Se decodifica con el modo elegido arriba, <b>sin guardar nada</b>.
        </div>
        <input value={test} onChange={e => setTest(e.target.value)} placeholder="Escaneá o pegá el código de 13 dígitos"
          style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '9px 12px', fontSize: 14, fontFamily: 'monospace' }} />
        {clean.length > 0 && clean.length !== 13 && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{clean.length} de 13 dígitos…</div>
        )}
        {decoded?.error && (
          <div style={{ fontSize: 12, color: '#ff8b8b', marginTop: 8 }}>❌ {decoded.error === 'prefijo_invalido' ? 'El código no arranca con el prefijo esperado' : 'El verificador del código no cierra'}</div>
        )}
        {decoded && !decoded.error && (
          <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.7 }}>
            <div>PLU <b>{decoded.plu}</b> → {prodTest ? <b>{prodTest.nombre}</b> : <span style={{ color: '#ff8b8b' }}>sin producto con ese PLU</span>}</div>
            {modo === 'peso'
              ? <div>Peso leído: <b style={{ color: 'var(--gold)', fontSize: 16 }}>{decoded.peso_kg?.toFixed(3)} kg</b></div>
              : <div>Importe leído: <b style={{ color: 'var(--gold)', fontSize: 16 }}>${decoded.precio?.toLocaleString('es-AR')}</b></div>}
            {modo === 'peso' && prodTest && (
              <div style={{ color: 'var(--muted)' }}>
                Cobraría: {decoded.peso_kg?.toFixed(3)} kg × ${Number(prodTest.precio_minorista || 0).toLocaleString('es-AR')} =
                <b style={{ color: 'var(--text)' }}> ${Math.round((decoded.peso_kg || 0) * Number(prodTest.precio_minorista || 0)).toLocaleString('es-AR')}</b>
              </div>
            )}
            {modo === 'peso' && (
              <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>
                ⚠️ Si pesaste 1 kg y acá no dice <b>1,000 kg</b>, la balanza no está escribiendo gramos: no guardes y avisá.
              </div>
            )}
          </div>
        )}
      </div>

      {msg && (
        <div style={{ fontSize: 12, marginBottom: 10, color: msg.tipo === 'error' ? '#ff8b8b' : 'var(--green)' }}>{msg.texto}</div>
      )}

      {!isCEO && <div style={{ fontSize: 11, color: 'var(--muted)' }}>🔒 Solo el dueño puede cambiar el formato.</div>}

      {isCEO && hayCambio && (
        <div style={{ padding: 12, background: 'rgba(255,209,122,0.06)', border: '1px solid var(--gold)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, marginBottom: 10, lineHeight: 1.6 }}>
            Vas a pasar <b>{nombreSuc(sucSel)}</b> a <b>{MODOS_BALANZA[modo]?.label}</b>.
            Antes de guardar, la balanza de esa boca ya tiene que estar emitiendo con este formato.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={guardar} disabled={guardando} className="btn btn-gold">
              {guardando ? 'Guardando…' : '✅ Guardar formato'}
            </button>
            <button onClick={() => setModoSel(null)} className="btn btn-ghost">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}

// esSucursal: la sucursal usa esta pestaña para EXPORTAR el CSV de su balanza
// (los PLU son los mismos en las dos bocas, viven en el catálogo compartido),
// pero no renumera: eso reescribe `precios` de la central.
function PLUTab({ precios, ofertas = [], onRecargar, categoriasOrden = [], esSucursal = false }) {
  const [msg, setMsg] = useState('')
  const [confirmandoRenum, setConfirmandoRenum] = useState(false)
  const [renumerando, setRenumerando] = useState(false)
  const [renumMsg, setRenumMsg] = useState(null) // { tipo, texto }

  // Renumera TODOS los PLUs: alfabético dentro de cada categoría (mismo sort
  // que el catálogo impreso), bloques correlativos por categoría. Dos fases
  // porque codigo_balanza tiene índice UNIQUE: primero se liberan todos y
  // después se asignan los nuevos. Si falla a mitad, volver a ejecutar lo
  // deja consistente (recalcula todo desde cero).
  async function renumerarPLUs() {
    setRenumerando(true)
    setRenumMsg(null)
    const activos = (precios || []).filter(p => !p.nombre?.startsWith('ZZ_'))
    const asignacion = []
    let n = 1
    for (const cat of ORDEN_RENUM_PLU) {
      activos.filter(p => p.categoria === cat)
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'))
        .forEach(p => asignacion.push({ id: p.id, plu: n++ }))
    }
    let nc = PLU_INICIO_CAJAS
    activos.filter(p => p.categoria === CAT_CAJAS_PLU)
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'))
      .forEach(p => asignacion.push({ id: p.id, plu: nc++ }))

    // Fase 1: liberar todos los PLUs de las categorías con lista
    const { error: eLib } = await supabase.from('precios')
      .update({ codigo_balanza: null })
      .in('categoria', [...ORDEN_RENUM_PLU, CAT_CAJAS_PLU])
    if (eLib) {
      setRenumMsg({ tipo: 'error', texto: '❌ Error liberando PLUs: ' + eLib.message })
      setRenumerando(false)
      return
    }
    // Fase 2: asignar los nuevos, en tandas para no saturar
    for (let i = 0; i < asignacion.length; i += 25) {
      const tanda = asignacion.slice(i, i + 25)
      const resultados = await Promise.all(
        tanda.map(a => supabase.from('precios').update({ codigo_balanza: a.plu }).eq('id', a.id))
      )
      const conError = resultados.find(r => r.error)
      if (conError) {
        setRenumMsg({ tipo: 'error', texto: `❌ Error asignando PLUs: ${conError.error.message}. Volvé a apretar Renumerar para completar.` })
        setRenumerando(false)
        if (onRecargar) await onRecargar()
        return
      }
    }
    setRenumMsg({
      tipo: 'ok',
      texto: `✅ ${asignacion.length} PLUs renumerados en orden alfabético. ⚠️ AHORA: exportá el CSV para Qendra (botón de arriba) y cargalo en la balanza — hasta que no la actualices, las etiquetas que imprima decodifican al producto equivocado. Tirá también las etiquetas ya impresas con PLUs viejos.`,
    })
    setConfirmandoRenum(false)
    setRenumerando(false)
    if (onRecargar) await onRecargar()
  }

  // % de descuento para Precio Lista 2 de la balanza (en Qendra la Lista 2
  // está cargada ~10% abajo de la Lista 1). 0 = Lista 2 igual a Lista 1.
  const [lista2Pct, setLista2Pct] = useState('10')

  // PLUs REALES: productos en `precios` que tienen codigo_balanza asignado.
  // El código viene de la asignación que hizo Fabri (vía Importar PLUs CSV
  // o editando manualmente desde Administrar). Ordenados por PLU.
  const plus = (precios || [])
    .filter(p => p.codigo_balanza != null && !p.nombre?.startsWith('ZZ_'))
    .map(p => ({
      codigo: String(p.codigo_balanza).padStart(4, '0'),
      codigoNum: p.codigo_balanza,
      nombre: p.nombre,
      precio: p.precio_minorista || 0,
      categoria: p.categoria,
      precio_id: p.id,
      pesable: p.pesable !== false, // false → se vende por Unidad en la balanza
    }))
  // La tabla de abajo va paginada: son 128+ PLUs y la lista entera hacía la
  // pestaña interminable. OJO: los exports (CSV simple, Qendra, PDF) siguen
  // usando `plus` COMPLETO — la paginación es solo de pantalla, jamás del
  // archivo que va a la balanza.
  const pagPlus = usePaginacion(plus, 25)
    .sort((a, b) => a.codigoNum - b.codigoNum)

  // Precio para la BALANZA: SIEMPRE el precio de lista normal, SIN ofertas.
  // Regla de Fabricio (20/07/2026): la oferta la aplica la CAJA cuando
  // escanea el producto — si la balanza llevara el precio promocional, la
  // etiqueta saldría con el importe ya rebajado y la Caja descontaría DE
  // NUEVO (doble descuento), además de derivar mal el peso (importe ÷
  // precio normal). Antes acá se aplicaban las ofertas vigentes y la
  // balanza quedó cargada con la falda especial a precio de oferta.
  function precioBalanza(p) {
    return Number(p.precio) || 0
  }

  // Qendra trunca descripciones largas y la balanza no imprime bien
  // caracteres fuera de ASCII: mayúsculas, sin acentos, máx. 18 caracteres.
  function nombreParaQendra(nombre) {
    return (nombre || '')
      .toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Z0-9 \-\/.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 18)
  }

  function exportarCSV() {
    // Formato simple (compatible con muchos importadores)
    const header = 'Codigo,Nombre,Precio\n'
    const rows = plus.map(p =>
      `${p.codigo},"${p.nombre}",${Math.round(precioBalanza(p))}`
    ).join('\n')
    descargar(header + rows, 'PLU_Fabricius_simple.csv')
  }

  // CSV para el Asistente de importación de Qendra, en el FORMATO NATIVO
  // que exporta el propio Qendra (calcado de productos_fabricius.csv, el
  // export original de la balanza): SIN fila de títulos, 48 columnas,
  // precios con coma decimal ("20800,00") y tipo de venta como texto
  // rellenado a 11 caracteres ("Peso       "/"Unidad     "). El asistente
  // viejo rechazaba en silencio nuestro formato propio de 7 columnas con
  // cabecera — "0 registros a importar" sin explicación (odisea 20/07).
  // En el asistente: DESTILDAR "primer fila como títulos"; mapear por
  // posición (col 1 sección, 2 nro PLU, 3 descripción, 4 código, 5 lista 1,
  // 6 lista 2, 7 tipo de venta), resto sin asignar; sección por NOMBRE.
  function exportarQendra() {
    const pct = parseNumero(lista2Pct)
    const f = fechaHoyARG()
    const fechaQendra = `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)} 12:00:00`
    const conComa = n => `${n},00`
    const rows = plus.map(p => {
      const precio1 = Math.round(precioBalanza(p))
      // Lista 2 redondeada a $10 (mismo redondeo que usa la lista cargada en Qendra)
      const precio2 = pct > 0 ? Math.round(precio1 * (1 - pct / 100) / 10) * 10 : precio1
      const tipoVenta = (p.pesable ? 'Peso' : 'Unidad').padEnd(11, ' ')
      return [
        'CARNICERIA', p.codigoNum, nombreParaQendra(p.nombre), p.codigoNum,
        conComa(precio1), conComa(precio2), tipoVenta,
        '0', '""', '0', '0', '""', '""', '""', 'N', '100', '1', '100', '""',
        '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', 'G', '""',
        fechaQendra, 'ADMIN', String(precio1),
        '0', '0', '0', '0', '0', '0', '0', '0', '0',
        '""', '""', '""', '""', '""',
      ].join(';')
    }).join('\n')
    // SIN BOM: el asistente viejo de Qendra se atraganta con la marca UTF-8
    // al inicio del archivo. El contenido es ASCII puro (nombreParaQendra
    // ya filtr\u00F3 acentos), as\u00ED que no se pierde nada.
    descargar(rows, `PLU_Qendra_${fechaHoyARG()}.csv`, { conBom: false })
  }

  function descargar(contenido, nombre, { conBom = true } = {}) {
    // BOM para que Excel abra con acentos correctamente (el CSV de Qendra
    // va SIN BOM \u2014 ver exportarQendra)
    const bom = conBom ? '\uFEFF' : ''
    // Saltos de l\u00EDnea de WINDOWS (CRLF): el asistente de importaci\u00F3n de
    // Qendra no reconoce los LF de Unix y lee todo el archivo como un solo
    // registro ("0 registros a importar, 1 con errores" \u2014 caso 20/07).
    // + salto de línea FINAL: sin él, el asistente no cierra el último
    // registro y el último producto del CSV rebota con errores absurdos
    // (sección vacía) — le pasó al PLU 131, última línea del archivo.
    const win = contenido.replace(/\r?\n/g, '\r\n').replace(/\r\n$/, '') + '\r\n'
    const blob = new Blob([bom + win], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nombre
    a.click()
    URL.revokeObjectURL(url)
  }

  // PDF imprimible con todos los PLUs agrupados por categor\u00EDa \u2014 para pegar
  // en el mostrador / balanza y que los empleados sepan qu\u00E9 PLU es cada
  // producto. Mismo patr\u00F3n de ventana imprimible que el cat\u00E1logo.
  function pdfPlusEmpleados() {
    // Agrupar por categor\u00EDa respetando el orden del cat\u00E1logo (\uD83D\uDDC2\uFE0F Categor\u00EDas);
    // categor\u00EDas que no est\u00E9n en el cat\u00E1logo (ocultas/viejas) van al final.
    const porCat = {}
    // Las cajas PT no van en la hoja del mostrador (no se pesan en la
    // balanza); sí siguen saliendo en los CSV para Qendra.
    plus.filter(p => p.categoria !== 'bovino_caja_pt')
      .forEach(p => { (porCat[p.categoria] = porCat[p.categoria] || []).push(p) })
    const clavesOrdenadas = [
      ...categoriasOrden.map(c => c.clave).filter(c => porCat[c]),
      ...Object.keys(porCat).filter(c => !categoriasOrden.some(k => k.clave === c)),
    ]
    const labelDe = clave => categoriasOrden.find(c => c.clave === clave)?.label || clave
    const fechaTxt = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' })
    // Layout a TRES COLUMNAS compacto (CSS multicol). Sin precios: el precio
    // se consulta en la balanza apretando el PLU \u2014 ac\u00e1 solo importa c\u00f3digo y
    // producto, as\u00ed entra todo en la menor cantidad de hojas posible.
    // Filas chicas tipo listado, sin tabla \u2014 las tablas no fragmentan bien
    // entre columnas al imprimir. Cada fila evita cortarse al medio.
    let html = `<style>
      .plu-cols { column-count: 3; column-gap: 14px; column-rule: 1px solid #ddd; }
      .plu-cat { break-inside: avoid; background: #1a1408; color: #c9a84c; font-size: 11px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; padding: 3px 8px; border-radius: 3px; margin: 8px 0 3px; }
      .plu-cols > .plu-cat:first-child { margin-top: 0; }
      .plu-fila { break-inside: avoid; display: flex; align-items: baseline; gap: 7px; padding: 1.5px 2px; border-bottom: 1px solid #eee; font-size: 10.5px; }
      .plu-cod { font-family: monospace; font-weight: 800; font-size: 11.5px; background: #f0e6c8; border-radius: 3px; padding: 0 5px; min-width: 34px; text-align: center; }
      .plu-nom { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    </style>`
    html += `<div class="badge">CARNICER\u00CDAS FABRICIUS</div>`
    html += `<h1 class="h1" style="font-size:20px">\uD83C\uDFF7\uFE0F PLUs de la Balanza</h1>`
    html += `<div class="sub" style="margin-bottom:8px">Qu\u00E9 c\u00F3digo tiene cada producto (el precio se consulta en la balanza con el PLU) \u00B7 Vigente al ${fechaTxt}</div>`
    html += '<div class="plu-cols">'
    clavesOrdenadas.forEach(clave => {
      const items = [...porCat[clave]].sort((a, b) => a.codigoNum - b.codigoNum)
      html += `<div class="plu-cat">${labelDe(clave)}</div>`
      items.forEach(p => {
        html += `<div class="plu-fila"><span class="plu-cod">${p.codigo}</span><span class="plu-nom">${p.nombre}</span></div>`
      })
    })
    html += '</div>'
    html += `<div class="footer" style="margin-top:14px">Generado desde el sistema de Carnicer\u00EDas Fabricius \u00B7 ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</div>`
    abrirVentanaImprimible({ titulo: `PLUs Balanza Fabricius ${fechaHoyARG()}`, contenidoHtml: html })
  }
  return (
    <div>
      <FormatoBalanzaCard precios={precios} />
      <div className="card" style={{ marginBottom: 16, borderColor: 'var(--gold)' }}>
        <div className="card-title">🏷️ PLU para Balanza Cuora Max</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
          Estos son los productos que tienen PLU asignado en el sistema (de la balanza Cuora Max). Para cambiar nombre o precio, editá el producto desde la pestaña <strong>✏️ Administrar</strong>. Para asignar más PLUs, usá <strong>📥 Importar PLUs CSV</strong>.
        </div>
        {plus.length === 0 && (
          <div style={{ background: '#3a2a1a', border: '1px solid #6a5a2a', color: '#ffd17a', padding: '12px 16px', borderRadius: 8, marginBottom: 12 }}>
            ⚠️ Todavía no hay productos con PLU asignado. Andá a <strong>📥 Importar PLUs CSV</strong> para asignar.
          </div>
        )}
        {plus.length > 0 && (
          <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12 }}>
            <strong>{plus.length}</strong> productos con PLU asignado.
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={exportarCSV} className="btn btn-ghost" disabled={plus.length === 0}>📥 Exportar CSV simple</button>
          <button onClick={exportarQendra} className="btn btn-ghost" style={{ background: 'var(--gold)', color: '#000', fontWeight: 700 }} disabled={plus.length === 0}>⚖️ Exportar CSV para Qendra</button>
          <button onClick={pdfPlusEmpleados} className="btn btn-ghost" title="Lista imprimible con el PLU de cada producto, agrupada por categoría — para el mostrador" disabled={plus.length === 0}>🖨️ PDF PLUs para empleados</button>
          {!esSucursal && (
            <button onClick={() => { setConfirmandoRenum(c => !c); setRenumMsg(null) }} className="btn btn-ghost" disabled={renumerando}
              style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
              🔁 Renumerar PLUs (alfabético)
            </button>
          )}
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            Lista 2: −
            <input type="text" inputMode="decimal" max="50" value={lista2Pct}
              onChange={e => setLista2Pct(e.target.value)}
              style={{ width: 55, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '4px 8px', fontSize: 12 }} />
            % (0 = igual a Lista 1)
          </label>
        </div>
        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text)' }}>Cómo actualizar los precios de la balanza</strong> (probado 20/07/2026):
          el CSV va SIEMPRE con los <strong>precios de lista normales, sin ofertas</strong> (la oferta la aplica la Caja al escanear —
          con el precio promocional en la balanza se descontaría dos veces).
          ⚠️ Si Qendra YA tiene productos cargados, <strong>primero borralos todos</strong> (Productos → seleccionar todo → Borrar):
          la importación NO pisa los existentes — los saltea en silencio y quedan los precios viejos.
          Descargá el CSV para Qendra (formato NATIVO, sin fila de títulos) y en Qendra:
          <strong> Archivo → Importar → Asistente de importación</strong> → Productos,
          formato <strong>Archivo delimitado (*.csv)</strong>, delimitador <strong>punto y coma (;)</strong>,
          <strong> "Utilizar la primer fila como títulos" DESTILDADO</strong>.
          ⚠️ <strong>Elegí el archivo A MANO con el botón "..."</strong> — el asistente recuerda la ruta anterior y si no
          la cambiás importa el archivo viejo. En el <strong>Mapeo de campos</strong> (las columnas se cuentan <strong>desde CERO</strong>):
          Nombre de sección = <strong>Columna 0</strong> · Número de PLU = <strong>Columna 1</strong> · Descripción = <strong>Columna 2</strong> ·
          Código de PLU = <strong>Columna 3</strong> · Precio lista 1 = <strong>Columna 4</strong> · Precio lista 2 = <strong>Columna 5</strong> ·
          Tipo de venta = <strong>Columna 6</strong> — el resto sin asignar.
          Sección: opción "contiene el <strong>nombre</strong> de la sección" (CARNICERIA → CARNICERIA); tipo de venta Peso→Peso, Unidad→Unidad.
          Controles: la vista previa arranca con AGUJA ECONOMICA y la pantalla final dice <strong>"128 registros a importar"</strong> (si dice
          "0 registros", el archivo o el mapeo están mal — NO inicies). Verificá en Productos/Secciones que la cantidad sea la esperada y
          recién ahí mandá los datos a la balanza (Comunicación). Si Chrome baja un archivo con formato viejo, exportá desde una
          ventana de incógnito (Ctrl+Shift+N).
        </div>

        {confirmandoRenum && (
          <div style={{ background: '#3a2a1a', border: '1px solid var(--amber)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', marginBottom: 6 }}>
              🔁 ¿Renumerar TODOS los PLUs?
            </div>
            <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 10 }}>
              Se eliminan todos los PLUs actuales y se reasignan en <strong>orden alfabético dentro de cada lista</strong>, correlativos por categoría
              (cortes bovinos desde 1, después piezas, brosas, cerdo, embutidos, pollo, rebozados; cajas PT desde {PLU_INICIO_CAJAS}).
              Los productos nuevos sin PLU quedan integrados en su lugar.
              <br /><strong style={{ color: 'var(--amber)' }}>⚠️ Después hay que exportar el CSV para Qendra y recargar la balanza Cuora Max</strong> — con la balanza desactualizada, las etiquetas cobran el producto equivocado. Las etiquetas ya impresas quedan inválidas.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={renumerarPLUs} disabled={renumerando} className="btn btn-gold">
                {renumerando ? '⏳ Renumerando…' : '✅ Sí, renumerar todo'}
              </button>
              <button onClick={() => setConfirmandoRenum(false)} disabled={renumerando} className="btn btn-ghost">Cancelar</button>
            </div>
          </div>
        )}

        {renumMsg && (
          <div style={{
            background: renumMsg.tipo === 'error' ? '#3a1a1a' : '#1a2a1a',
            border: `1px solid ${renumMsg.tipo === 'error' ? '#ff6b6b' : '#3f6d2f'}`,
            color: renumMsg.tipo === 'error' ? '#ff8b8b' : '#7dff7d',
            borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, fontWeight: 600,
          }}>{renumMsg.texto}</div>
        )}
        {plus.length > 0 && (
          <table>
            <thead>
              <tr>
                <th style={{ width: 80 }}>Código PLU</th>
                <th>Nombre</th>
                <th style={{ width: 140 }}>Precio minorista</th>
                <th>Categoría</th>
              </tr>
            </thead>
            <tbody>
              {pagPlus.items.map((p) => (
                <tr key={p.precio_id}>
                  <td>
                    <span style={{ background: 'var(--gold)', color: '#000', padding: '3px 10px', borderRadius: 4, fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>
                      {p.codigo}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500 }}>{p.nombre}</td>
                  <td style={{ color: 'var(--green)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>
                    ${Number(p.precio || 0).toLocaleString('es-AR')}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--muted)' }}>{p.categoria}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {plus.length > 0 && <Paginador {...pagPlus.controles} label="PLUs" />}
      </div>
    </div>
  )
}

// Sub-componente: paginación para historial de ofertas vencidas.
function TablaOfertasVencidasPag({ ofertasVencidas }) {
  const pag = usePaginacion(ofertasVencidas, 20)
  const fmt = n => n != null ? '$' + Math.round(n).toLocaleString('es-AR') : '—'
  return (
    <>
      <table>
        <thead><tr><th>Producto</th><th>Descuento</th><th>Vigencia</th><th>Estado</th></tr></thead>
        <tbody>
          {pag.items.map(o => {
            const esPct = o.descuento_pct != null && Number(o.descuento_pct) > 0
            return (
              <tr key={o.id} style={{ opacity: 0.6 }}>
                <td>{o.producto_nombre}</td>
                <td style={{ color: 'var(--muted)' }}>
                  {esPct ? `📉 -${o.descuento_pct}%` : `💰 ${fmt(o.precio_oferta)}`}
                </td>
                <td style={{ fontSize: 11, color: 'var(--muted)' }}>{o.fecha_inicio} → {o.fecha_fin}</td>
                <td><span style={{ background: '#3a1a1a', color: '#ff6b6b', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>Vencida</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <Paginador {...pag.controles} label="ofertas vencidas" />
    </>
  )
}
