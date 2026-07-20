// Precios — gestión completa de listas, PLUs e importadores
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { fechaHoyARG } from '../../lib/fechas'
import Paginador, { usePaginacion } from '../../components/Paginador'
import LimpiezaDuplicados from './LimpiezaDuplicados'
import ImportarPLUQendra from './ImportarPLUQendra'
import CombosEditor from './CombosEditor'
import { abrirVentanaImprimible } from '../../lib/pdfPrintable'
import { compartirListaPrecios } from '../../lib/listasPreciosPdf'
// Las categorías ya no son un objeto hardcodeado: viven en config_sistema
// ('categorias_precios') y se administran desde la solapa 🗂️ Categorías.
// Ver src/lib/categoriasPrecios.js (las de sistema no se pueden eliminar).
import {
  cargarCategoriasPrecios, guardarCategoriasPrecios, categoriasDefault,
  labelsDeCategorias, claveDesdeNombre,
} from '../../lib/categoriasPrecios'

// Subgrupos dentro de Insumos (como en el PDF original)
const INSUMO_SUBCAT = { descartables: '📦 Descartables', limpieza: '🧽 Limpieza', carniceria: '🔪 Insumos Carnicería' }
const INSUMO_SUBCAT_ORDEN = { descartables: 0, limpieza: 1, carniceria: 2 }
const INSUMO_SUBCAT_OPCIONES = [['descartables', '📦 Descartables'], ['limpieza', '🧽 Limpieza'], ['carniceria', '🔪 Insumos Carnicería']]
const VACIO = { categoria: 'bovino_corte', subcategoria: 'descartables', nombre: '', precio_carniceria: '', precio_mayorista: '', precio_minorista: '', codigo_balanza: '', dias_vencimiento: '3', descripcion_etiqueta: '', pesable: true, kg_por_unidad: '', vende_por_pieza: false, stock_origen: '', stock_no_aplica: false }

// Categorías cuyos productos descuentan de un bucket de stock específico
// (cerdo por pieza, embutidos de elaboración propia). Sin stock_origen quedan
// "huérfanos": se venden pero NO descuentan stock. Los bovinos NO van acá: se
// trackean por categoría/pieza, su stock_origen debe ser NULL.
const CATEGORIAS_CON_STOCK_ORIGEN = new Set(['cerdo_corte', 'cerdo_pieza', 'embutido'])
// Las categorías personalizadas (cat_*) también pueden enlazar stock_origen:
// sin enlace no descuentan stock (igual que un embutido comprado).
const permiteStockOrigen = cat => CATEGORIAS_CON_STOCK_ORIGEN.has(cat) || String(cat || '').startsWith('cat_')
const prettyBucket = b => String(b || '')
  .replace(/^cerdo_/, '🐷 ')
  .replace(/^emb_/, '🌭 ')
  .replace(/_/g, ' ')

// Categorías que se venden por cajón (unidad con peso fijo) y por lo tanto
// necesitan el campo kg_por_unidad cargado para descontar stock correctamente.
const CATEGORIAS_CON_KG_POR_UNIDAD = new Set(['pollo_cajon', 'rebozado_cajon'])

// Categorías donde tiene sentido el flag "se vende por pieza entera".
// Las piezas bovinas son las únicas donde se vende un objeto físico único
// (cada pierna, cuarto pistola, costillar, etc. con su peso propio).
const CATEGORIAS_CON_PIEZA_ENTERA = new Set(['bovino_pieza'])
import { fmtPrecio } from '../../lib/formatos'
// Precio en formato AR (35.600,50 con decimales si tiene)
const fmt = n => n != null ? fmtPrecio(Number(n) || 0) : '—'
const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%', boxSizing: 'border-box' }

export default function Precios() {
  const [tab, setTab] = useState('ver')
  const [precios, setPrecios] = useState([])
  const [stockBuckets, setStockBuckets] = useState([])  // tipos de stock_actual (cerdo_*, emb_*) para enlazar
  const [filtro, setFiltro] = useState('bovino_corte')
  // Catálogo de categorías (config_sistema). CATEGORIAS mantiene la forma
  // { clave: label } que usaba el viejo objeto hardcodeado — incluye las
  // ocultas para poder etiquetar productos de una categoría escondida.
  const [categorias, setCategorias] = useState(categoriasDefault())
  const CATEGORIAS = useMemo(() => labelsDeCategorias(categorias), [categorias])
  const categoriasVisibles = useMemo(() => categorias.filter(c => c.activa !== false), [categorias])
  // Editor de categorías (solapa 🗂️): copia local + form de alta
  const [catEdit, setCatEdit] = useState(null)         // null = sin cambios sin guardar
  const [catNueva, setCatNueva] = useState('')
  const [catGuardando, setCatGuardando] = useState(false)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(VACIO)
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
  const [ofertaForm, setOfertaForm] = useState({ precio_id: '', tipo: 'fijo', precio_oferta: '', descuento_pct: '', fecha_inicio: fechaHoyARG(), fecha_fin: '', notas: '', aplica_carniceria: true, aplica_mayorista: true, aplica_minorista: true })
  const [ofertaLoading, setOfertaLoading] = useState(false)
  const [busquedaOferta, setBusquedaOferta] = useState('')
  const [mostrarDropdown, setMostrarDropdown] = useState(false)
  const [productoSeleccionado, setProductoSeleccionado] = useState(null)

  // Promo Mundial: -X% en la Caja para compras 100% efectivo/transferencia.
  // Vive en config_sistema (clave 'promo_mundial') y la Caja la lee por
  // realtime. Mientras está activa, la Caja PAUSA las ofertas (no se acumulan).
  const [promoMundial, setPromoMundial] = useState({ activa: false, descuento_pct: 10 })
  const [promoPctInput, setPromoPctInput] = useState('10')
  const [promoLoading, setPromoLoading] = useState(false)

  useEffect(() => { cargar(); cargarOfertas(); cargarPromoMundial(); cargarCategoriasPrecios().then(setCategorias) }, [])

  async function cargarPromoMundial() {
    const { data } = await supabase.from('config_sistema').select('*').eq('clave', 'promo_mundial').maybeSingle()
    if (data?.valor) {
      setPromoMundial(data.valor)
      setPromoPctInput(String(data.valor.descuento_pct ?? 10))
    }
  }

  async function togglePromoMundial() {
    const pct = parseFloat(promoPctInput)
    if (!promoMundial.activa && (!pct || pct <= 0 || pct >= 100)) {
      mostrarMsg('❌ El % de la promo debe estar entre 1 y 99')
      return
    }
    setPromoLoading(true)
    const nuevo = { activa: !promoMundial.activa, descuento_pct: promoMundial.activa ? (promoMundial.descuento_pct ?? 10) : pct }
    const { error } = await supabase.from('config_sistema').upsert({
      clave: 'promo_mundial',
      valor: nuevo,
      descripcion: 'Promo Mundial: % de descuento en Caja para pagos 100% efectivo/transferencia. Pausa las ofertas mientras está activa.',
      updated_at: new Date().toISOString(),
    })
    setPromoLoading(false)
    if (error) {
      mostrarMsg('❌ Error al guardar la promo: ' + error.message)
      return
    }
    setPromoMundial(nuevo)
    mostrarMsg(nuevo.activa
      ? `⚽ Promo Mundial ACTIVADA: −${nuevo.descuento_pct}% efectivo/transferencia (ofertas pausadas en Caja)`
      : '✅ Promo Mundial desactivada — las ofertas vuelven a aplicar')
  }

  async function cargar() {
    setLoading(true)
    const [{ data }, { data: stk }] = await Promise.all([
      supabase.from('precios').select('*').order('nombre'),
      supabase.from('stock_actual').select('tipo'),
    ])
    setPrecios(data || [])
    // Buckets enlazables: cerdo_* (piezas) y emb_* (embutidos). Excluye el 'cerdo'
    // genérico (capón entero), que no es a donde van los cortes.
    setStockBuckets((stk || []).map(s => s.tipo).filter(t => /^cerdo_|^emb_/.test(t)).sort())
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
      const kpu = Number(form.kg_por_unidad) || 0
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
      precio_carniceria: form.precio_carniceria === '' ? null : Number(form.precio_carniceria),
      precio_mayorista: form.precio_mayorista === '' ? null : Number(form.precio_mayorista),
      precio_minorista: form.precio_minorista === '' ? null : Number(form.precio_minorista),
      codigo_balanza: nuevoPlu,
      dias_vencimiento: form.dias_vencimiento === '' ? 3 : Number(form.dias_vencimiento),
      descripcion_etiqueta: form.descripcion_etiqueta || null,
      pesable: form.pesable !== false,
      // kg por unidad — solo relevante para categorías por cajón (pollo_cajon,
      // rebozado_cajon). Determina cuántos kg se descuentan del stock base al
      // vender una unidad. NULL si no aplica (el sistema cae al parseo del nombre).
      kg_por_unidad: form.kg_por_unidad === '' || form.kg_por_unidad == null
        ? null
        : Number(form.kg_por_unidad),
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
    if (nuevoPlu != null) {
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
    if (editando) {
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
    setForm(VACIO); setEditando(null)
    await cargar(); setLoading(false)
  }

  async function eliminar(id) {
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
    const pct = parseFloat(masivoPct)
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
    setOfertaLoading(true)
    const { error } = await supabase.from('ofertas').insert({
      precio_id: ofertaForm.precio_id,
      producto_nombre: productoSeleccionado?.nombre,
      precio_original_carniceria: productoSeleccionado?.precio_carniceria,
      precio_original_mayorista: productoSeleccionado?.precio_mayorista,
      precio_original_minorista: productoSeleccionado?.precio_minorista,
      precio_oferta: ofertaForm.tipo === 'fijo' ? parseFloat(ofertaForm.precio_oferta) : null,
      descuento_pct: ofertaForm.tipo === 'porcentaje' ? parseFloat(ofertaForm.descuento_pct) : null,
      fecha_inicio: ofertaForm.fecha_inicio,
      fecha_fin: ofertaForm.fecha_fin,
      activa: true,
      notas: ofertaForm.notas,
      aplica_carniceria: ofertaForm.aplica_carniceria,
      aplica_mayorista: ofertaForm.aplica_mayorista,
      aplica_minorista: ofertaForm.aplica_minorista,
    })
    setOfertaLoading(false)
    if (error) {
      mostrarMsg('❌ Error al guardar la oferta: ' + error.message)
      console.error('Insert oferta error:', error)
      return
    }
    mostrarMsg('✅ Oferta registrada correctamente')
    setOfertaForm({ precio_id: '', tipo: 'fijo', precio_oferta: '', descuento_pct: '', fecha_inicio: fechaHoyARG(), fecha_fin: '', notas: '', aplica_carniceria: true, aplica_mayorista: true, aplica_minorista: true })
    setBusquedaOferta(''); setProductoSeleccionado(null)
    await cargarOfertas()
  }

  async function desactivarOferta(id) {
    await supabase.from('ofertas').update({ activa: false }).eq('id', id)
    mostrarMsg('✅ Oferta desactivada')
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
  // Usa preciosConOfertas: la lista que sale refleja las ofertas vigentes.
  async function pdfLista(tipo) {
    try {
      const res = await compartirListaPrecios({ tipo, precios: preciosConOfertas, categorias: categoriasVisibles })
      if (res === 'descargado') mostrarMsg('✅ PDF descargado — arrastralo al chat de WhatsApp')
      if (res === 'compartido') mostrarMsg('✅ Lista compartida')
    } catch (e) {
      mostrarMsg('❌ ' + e.message)
    }
  }

  const ofertasVigentes = ofertas.filter(o => o.activa && o.fecha_inicio <= hoy && o.fecha_fin >= hoy)
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
      <div className="page-sub">Consultá, administrá y usá la IA para gestionar tus precios</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabBtn('ver', '📋 Ver Precios')}
        {tabBtn('admin', '✏️ Administrar')}
        {tabBtn('masivo', '🚀 Actualización masiva')}
        {tabBtn('ofertas', `🏷️ Ofertas${ofertasVigentes.length > 0 ? ` (${ofertasVigentes.length})` : ''}`)}
        {tabBtn('combos', '🍱 Combos')}
        {tabBtn('categorias', '🗂️ Categorías')}
        {tabBtn('chat', '🤖 Asistente IA')}
{tabBtn('plu', '🏷️ PLU / Balanza')}
{tabBtn('limpieza', '🧹 Limpieza duplicados')}
{tabBtn('importar_plu', '📥 Importar PLUs CSV')}
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
          <button onClick={() => pdfLista('carniceria')}
            style={{ padding: '8px 14px', background: '#25D366', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            📄 PDF Carnicerías → WhatsApp
          </button>
          <button onClick={() => pdfLista('franquicia')} title="Lista de carnicerías + insumos (la central les vende insumos solo a las franquicias)"
            style={{ padding: '8px 14px', background: '#25D366', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            🏪 PDF Franquicias (c/insumos) → WhatsApp
          </button>
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
                    <th style={{ color: 'var(--red-light)' }}>🔴 Carnicería</th>
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
                            <td style={{ color: p.enOferta ? '#7dff7d' : 'var(--red-light)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_carniceria)}</td>
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
          {(() => {
            const orfanos = precios.filter(p => CATEGORIAS_CON_STOCK_ORIGEN.has(p.categoria) && !p.stock_origen && !p.stock_no_aplica)
            if (orfanos.length === 0) return null
            return (
              <div className="card" style={{ marginBottom: 16, borderColor: 'var(--amber)', background: '#2a1f0a' }}>
                <div className="card-title" style={{ color: 'var(--amber)' }}>📦 {orfanos.length} producto{orfanos.length === 1 ? '' : 's'} sin stock asignado — enlazalos</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                  Estos productos de cerdo/embutido se venden pero NO descuentan stock. Tocá cada uno para asignarle el bucket del que sale (o marcalo "no descuenta" si es comprado para reventa).
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
                  <input type="number" value={form.precio_carniceria}
                    onChange={e => setForm({ ...form, precio_carniceria: e.target.value, precio_mayorista: e.target.value, precio_minorista: e.target.value })}
                    placeholder="Ej: 5500" style={inp} />
                </div>
              ) : (
                [['precio_carniceria', '🔴 Precio Carnicería'], ['precio_mayorista', '🟡 Precio Mayorista'], ['precio_minorista', '🟢 Precio Minorista']].map(([campo, label]) => (
                  <div key={campo}>
                    <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{label}</label>
                    <input type="number" value={form[campo]} onChange={e => setForm({ ...form, [campo]: e.target.value })} placeholder="Vacío = —" style={inp} />
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
                    type="number" step="0.1" min="0"
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
                      .filter(b => form.categoria === 'embutido' ? b.startsWith('emb_') : b.startsWith('cerdo_'))
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
                <button onClick={() => { setEditando(null); setForm(VACIO) }}
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
                <th style={{ color: 'var(--red-light)' }}>🔴 Carn.</th>
                <th style={{ color: 'var(--amber)' }}>🟡 May.</th>
                <th style={{ color: 'var(--green)' }}>🟢 Min.</th>
                <th>Acciones</th>
              </tr></thead>
              <tbody>
                {productosFiltrados.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.nombre}</td>
                    <td>{p.codigo_balanza ? <span style={{ background: 'var(--gold)', color: '#000', padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>{p.codigo_balanza}</span> : <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>}</td>
                    <td style={{ color: 'var(--red-light)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_carniceria)}</td>
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
                  <option value="carniceria">🔴 Solo Carnicería</option>
                  <option value="mayorista">🟡 Solo Mayorista</option>
                  <option value="minorista">🟢 Solo Minorista</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Porcentaje (+ aumento / - reducción)</label>
                <input type="number" step="0.5" placeholder="Ej: 10 para +10%" value={masivoPct} onChange={e => { setMasivoPct(e.target.value); setMasivoPreview([]) }} style={{ ...inp, borderColor: masivoPct ? 'var(--gold)' : 'var(--border)' }} />
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
                  {(masivoLista === 'todas' || masivoLista === 'carniceria') && <th style={{ color: 'var(--red-light)' }}>🔴 Carn. → nuevo</th>}
                  {(masivoLista === 'todas' || masivoLista === 'mayorista') && <th style={{ color: 'var(--amber)' }}>🟡 May. → nuevo</th>}
                  {(masivoLista === 'todas' || masivoLista === 'minorista') && <th style={{ color: 'var(--green)' }}>🟢 Min. → nuevo</th>}
                </tr></thead>
                <tbody>
                  {masivoPreview.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>{p.nombre}</td>
                      <td style={{ fontSize: 11, color: 'var(--muted)' }}>{CATEGORIAS[p.categoria]}</td>
                      {(masivoLista === 'todas' || masivoLista === 'carniceria') && <td>{fmt(p.precio_carniceria)} → <strong style={{ color: 'var(--gold)' }}>{fmt(p.nuevo_carniceria)}</strong></td>}
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
          {/* PROMO MUNDIAL */}
          <div className="card" style={{ marginBottom: 20, borderColor: promoMundial.activa ? '#3a6ea5' : 'var(--border)', background: promoMundial.activa ? '#16243a' : undefined }}>
            <div className="card-title" style={{ color: '#7ec8ff' }}>⚽ Promo Mundial — día de partido de Argentina</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
              Activala el día que juega la Selección: la Caja aplica el descuento al total de toda compra pagada
              <strong> 100% en efectivo y/o transferencia</strong> (con débito no aplica).
              Mientras esté activa, <strong style={{ color: '#ffb86b' }}>las ofertas quedan pausadas en la Caja</strong> para
              no hacer doble descuento. Al desactivarla, las ofertas vuelven a aplicar solas.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {!promoMundial.activa && (
                <div>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>% de descuento</label>
                  <input type="number" value={promoPctInput} onChange={e => setPromoPctInput(e.target.value)}
                    style={{ ...inp, width: 90, textAlign: 'right' }} placeholder="10" />
                </div>
              )}
              <button onClick={togglePromoMundial} disabled={promoLoading}
                style={{
                  padding: '12px 28px', borderRadius: 10, border: 'none', cursor: promoLoading ? 'wait' : 'pointer',
                  background: promoMundial.activa ? '#a53a3a' : '#3a6ea5', color: '#fff',
                  fontWeight: 800, fontSize: 14, fontFamily: "'DM Sans',sans-serif", letterSpacing: 0.5,
                  alignSelf: 'flex-end',
                }}>
                {promoLoading ? '⏳ Guardando…'
                  : promoMundial.activa ? `🛑 DESACTIVAR PROMO (−${promoMundial.descuento_pct}%)`
                  : '⚽ ACTIVAR PROMO MUNDIAL'}
              </button>
              {promoMundial.activa && (
                <div style={{ fontSize: 13, color: '#7ec8ff', fontWeight: 700 }}>
                  ✅ Activa ahora: −{promoMundial.descuento_pct}% en efectivo/transferencia · ofertas pausadas en Caja
                </div>
              )}
            </div>
          </div>

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
                  <input type="number" value={ofertaForm.precio_oferta} onChange={e => setOfertaForm(f => ({ ...f, precio_oferta: e.target.value }))} placeholder="Ej: 16000" style={{ ...inp, borderColor: 'var(--green)' }} />
                </div>
              ) : (
                <div>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>📉 % de descuento</label>
                  <input type="number" min="1" max="99" step="1" value={ofertaForm.descuento_pct} onChange={e => setOfertaForm(f => ({ ...f, descuento_pct: e.target.value }))} placeholder="Ej: 20" style={{ ...inp, borderColor: 'var(--gold)' }} />
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
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>📋 Aplicar esta oferta a las listas:</label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { key: 'aplica_carniceria', label: '🔴 Carnicería', color: '#ff6b6b' },
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
                { key: 'aplica_carniceria', label: '🔴 Carnicería', base: productoSeleccionado.precio_carniceria },
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

          {/* OFERTAS VIGENTES */}
          {ofertasVigentes.length > 0 && (
            <div className="card" style={{ marginBottom: 16, borderColor: '#4a8a2a' }}>
              <div className="card-title">✅ Ofertas vigentes ahora</div>
              {promoMundial.activa && (
                <div style={{ background: '#3a2a1a', border: '1px solid #ffb86b', borderRadius: 8, padding: '8px 14px', marginBottom: 10, fontSize: 12, color: '#ffb86b', fontWeight: 700 }}>
                  ⏸️ Estas ofertas están PAUSADAS en la Caja mientras dure la Promo Mundial (siguen vigentes en Depósito/listas mayoristas).
                </div>
              )}
              <table>
                <thead><tr><th>Producto</th><th>Aplica a</th><th>Tipo</th><th>Descuento</th><th>Resulta en</th><th>Vigencia</th><th>Acciones</th></tr></thead>
                <tbody>
                  {ofertasVigentes.map(o => {
                    const listas = []
                    if (o.aplica_carniceria !== false) listas.push({ l: '🔴 Carn', c: '#ff6b6b' })
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
                    <tr key={o.id}>
                      <td style={{ fontWeight: 600 }}>{o.producto_nombre}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {listas.map((x, i) => (
                            <span key={i} style={{ background: x.c + '22', color: x.c, borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 700 }}>{x.l}</span>
                          ))}
                        </div>
                      </td>
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
                        <button onClick={() => desactivarOferta(o.id)}
                          style={{ padding: '4px 10px', background: '#3a1a1a', color: '#ff6b6b', border: '1px solid #5a2a2a', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                          ✕ Desactivar
                        </button>
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

      {tab === 'chat' && (
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
  <PLUTab precios={precios} ofertas={ofertas} onRecargar={cargar} categoriasOrden={categoriasVisibles} />
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
    </div>
  )
}

// Orden de las listas para renumerar PLUs: mismo orden de categorías que el
// catálogo impreso, correlativo desde 1; las cajas PT van en bloque aparte
// desde 120 para no mezclarse con las listas del mostrador.
const ORDEN_RENUM_PLU = ['bovino_corte', 'bovino_pieza', 'bovino_brosa', 'cerdo_corte', 'cerdo_pieza', 'embutido', 'pollo', 'rebozado']
const CAT_CAJAS_PLU = 'bovino_caja_pt'
const PLU_INICIO_CAJAS = 120

function PLUTab({ precios, ofertas = [], onRecargar, categoriasOrden = [] }) {
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
    }))
    .sort((a, b) => a.codigoNum - b.codigoNum)

  // Precio minorista vigente de un PLU, respetando ofertas activas
  // (tanto por precio fijo como por % de descuento — mismo criterio que
  // aplicarOferta del componente principal).
  function precioMinoristaVigente(p) {
    const hoy = fechaHoyARG()
    const base = Number(p.precio) || 0
    const oferta = ofertas?.find(o =>
      o.precio_id === p.precio_id &&
      o.activa &&
      o.fecha_inicio <= hoy &&
      o.fecha_fin >= hoy &&
      o.aplica_minorista !== false
    )
    if (!oferta || base <= 0) return base
    if (oferta.descuento_pct != null && Number(oferta.descuento_pct) > 0) {
      return Math.round(base * (1 - Number(oferta.descuento_pct) / 100))
    }
    if (oferta.precio_oferta != null && Number(oferta.precio_oferta) > 0) {
      return Number(oferta.precio_oferta)
    }
    return base
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
      `${p.codigo},"${p.nombre}",${Math.round(precioMinoristaVigente(p))}`
    ).join('\n')
    descargar(header + rows, 'PLU_Fabricius_simple.csv')
  }

  // CSV para el Asistente de importación de Qendra (Archivo → Importar).
  // Mismas columnas que muestra la grilla de Productos de Qendra, así el
  // "Mapeo de campos" del asistente es directo. Separador ";" y primera
  // fila como títulos (tildar "Utilizar la primer fila como títulos").
  function exportarQendra() {
    const pct = Number(lista2Pct) || 0
    const header = '"Numero de seccion";"Nombre de seccion";"Codigo de PLU";"Descripcion";"Numero de PLU";"Precio lista 1";"Precio lista 2"\n'
    const rows = plus.map(p => {
      const precio1 = Math.round(precioMinoristaVigente(p))
      // Lista 2 redondeada a $10 (mismo redondeo que usa la lista cargada en Qendra)
      const precio2 = pct > 0 ? Math.round(precio1 * (1 - pct / 100) / 10) * 10 : precio1
      return `1;"CARNICERIA";${p.codigoNum};"${nombreParaQendra(p.nombre)}";${p.codigoNum};${precio1};${precio2}`
    }).join('\n')
    descargar(header + rows, `PLU_Qendra_${fechaHoyARG()}.csv`)
  }

  function descargar(contenido, nombre) {
    // BOM para que Excel/Qendra abran con acentos correctamente
    const bom = '\uFEFF'
    const blob = new Blob([bom + contenido], { type: 'text/csv;charset=utf-8' })
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
    plus.forEach(p => { (porCat[p.categoria] = porCat[p.categoria] || []).push(p) })
    const clavesOrdenadas = [
      ...categoriasOrden.map(c => c.clave).filter(c => porCat[c]),
      ...Object.keys(porCat).filter(c => !categoriasOrden.some(k => k.clave === c)),
    ]
    const labelDe = clave => categoriasOrden.find(c => c.clave === clave)?.label || clave
    const fechaTxt = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' })
    // Layout a DOS COLUMNAS compacto (CSS multicol): entra el doble por hoja.
    // Filas chicas tipo listado, sin tabla \u2014 las tablas no fragmentan bien
    // entre columnas al imprimir. Cada fila evita cortarse al medio.
    let html = `<style>
      .plu-cols { column-count: 2; column-gap: 18px; column-rule: 1px solid #ddd; }
      .plu-cat { break-inside: avoid; background: #1a1408; color: #c9a84c; font-size: 11px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; padding: 3px 8px; border-radius: 3px; margin: 8px 0 3px; }
      .plu-cols > .plu-cat:first-child { margin-top: 0; }
      .plu-fila { break-inside: avoid; display: flex; align-items: baseline; gap: 7px; padding: 1.5px 2px; border-bottom: 1px solid #eee; font-size: 10.5px; }
      .plu-cod { font-family: monospace; font-weight: 800; font-size: 11.5px; background: #f0e6c8; border-radius: 3px; padding: 0 5px; min-width: 34px; text-align: center; }
      .plu-nom { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      .plu-pre { font-weight: 700; white-space: nowrap; font-size: 10px; color: #444; }
    </style>`
    html += `<div class="badge">CARNICER\u00CDAS FABRICIUS</div>`
    html += `<h1 class="h1" style="font-size:20px">\uD83C\uDFF7\uFE0F PLUs de la Balanza</h1>`
    html += `<div class="sub" style="margin-bottom:8px">Qu\u00E9 c\u00F3digo tiene cada producto \u00B7 Vigente al ${fechaTxt}</div>`
    html += '<div class="plu-cols">'
    clavesOrdenadas.forEach(clave => {
      const items = [...porCat[clave]].sort((a, b) => a.codigoNum - b.codigoNum)
      html += `<div class="plu-cat">${labelDe(clave)}</div>`
      items.forEach(p => {
        html += `<div class="plu-fila"><span class="plu-cod">${p.codigo}</span><span class="plu-nom">${p.nombre}</span><span class="plu-pre">${fmt(precioMinoristaVigente(p))}</span></div>`
      })
    })
    html += '</div>'
    html += `<div class="footer" style="margin-top:14px">Generado desde el sistema de Carnicer\u00EDas Fabricius \u00B7 ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</div>`
    abrirVentanaImprimible({ titulo: `PLUs Balanza Fabricius ${fechaHoyARG()}`, contenidoHtml: html })
  }
  return (
    <div>
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
          <button onClick={() => { setConfirmandoRenum(c => !c); setRenumMsg(null) }} className="btn btn-ghost" disabled={renumerando}
            style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
            🔁 Renumerar PLUs (alfabético)
          </button>
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            Lista 2: −
            <input type="number" min="0" max="50" step="0.5" value={lista2Pct}
              onChange={e => setLista2Pct(e.target.value)}
              style={{ width: 55, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '4px 8px', fontSize: 12 }} />
            % (0 = igual a Lista 1)
          </label>
        </div>
        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text)' }}>Cómo actualizar los precios de la balanza:</strong> descargá el CSV para Qendra
          y en Qendra andá a <strong>Archivo → Importar → Asistente de importación</strong> →
          Productos, formato <strong>Archivo delimitado (*.csv)</strong>, tildá <strong>"Utilizar la primer fila como títulos"</strong>,
          delimitador <strong>punto y coma (;)</strong>. En el <strong>Mapeo de campos</strong> asigná cada columna a su campo
          (los nombres coinciden). Si solo querés actualizar precios, mapeá <strong>Código de PLU</strong> +
          <strong> Precio lista 1</strong> (y Lista 2 si la usás) y dejá el resto sin asignar.
          Después mandá los datos a la balanza como siempre (Comunicación).
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
              {plus.map((p) => (
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
