// Gastos.jsx
import { useEffect, useRef, useState } from 'react'
import { supabase, fetchAllRows } from '../../lib/supabase'
import { fechaHoyARG } from '../../lib/fechas'
import { parseNumero } from '../../lib/formatos'
import Paginador, { usePaginacion } from '../../components/Paginador'
import { useEsMovil } from '../../lib/useEsMovil'

// Display de precio con formato AR (incluye centavos si tiene)
import { fmtPrecio } from '../../lib/formatos'
function fmt(n) { return fmtPrecio(Math.abs(Number(n) || 0)) }

// Fecha DD/MM/YYYY (las fechas vienen como 'YYYY-MM-DD')
function fmtFecha(f) {
  if (!f) return '—'
  const [y, m, d] = String(f).substring(0, 10).split('-')
  return `${d}/${m}/${y}`
}
function nombreMes(mesKey) {
  return new Date(mesKey + '-15T12:00').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
}

const CATEGORIAS = [
  { value: 'vehiculo', label: '🚗 Vehículo' },
  { value: 'peaje', label: '🛣️ Peaje' },
  { value: 'insumos', label: '📦 Insumos' },
  { value: 'limpieza', label: '🧹 Limpieza' },
  { value: 'tripas', label: '🔗 Tripas' },
  { value: 'art', label: '🏥 ART' },
  { value: 'impuestos', label: '📋 Impuestos / ARCA' },
  { value: 'luz', label: '💡 Luz' },
  { value: 'alquiler', label: '🏠 Alquiler' },
  { value: 'redes', label: '📱 Diseño / Redes' },
  { value: 'otro', label: '📝 Otro' },
]

const TIPOS = [
  { id: 'variable', label: '💸 Variable', color: 'var(--red-light)' },
  { id: 'fijo', label: '📌 Fijo', color: 'var(--blue)' },
  { id: 'socio', label: '👤 Socio', color: 'var(--gold)' },
  { id: 'ingreso', label: '💰 Ingreso', color: 'var(--green)' },
]

// Alícuotas de IVA disponibles
const ALICUOTAS = [
  { value: '21', label: '21%' },
  { value: '10.5', label: '10,5%' },
  { value: '27', label: '27%' },
  { value: '0', label: 'Exento / Sin IVA' },
]

// Discrimina neto e IVA a partir del TOTAL y la alícuota.
// total = neto + iva  →  neto = total / (1 + pct/100)
function discriminarIva(total, pct) {
  const t = Number(total) || 0
  const p = Number(pct) || 0
  const neto = p > 0 ? t / (1 + p / 100) : t
  const iva = t - neto
  return { neto: Math.round(neto * 100) / 100, iva: Math.round(iva * 100) / 100 }
}

const FORM_VACIO = {
  fecha: fechaHoyARG(),
  categoria: '', descripcion: '', monto: '',
  forma: 'efectivo', socio: 'fabricio', origenIngreso: '', notas: '',
  // Factura
  tieneFactura: false, fechaEmision: '', ivaPct: '21', proveedor: '', comprobante: '',
  facturaPath: '', facturaNombre: '', facturaMime: '',
  // Factura a nombre de la SAS pero pagada por un tercero (ej: luz Alvear la
  // paga Roxana). Se guarda para el balance pero NO suma a nuestros gastos.
  soloBalance: false,
}

// Carga pdf-lib desde CDN una sola vez (mismo patrón que JsBarcode en Etiquetas)
function cargarPdfLib() {
  return new Promise((resolve, reject) => {
    if (window.PDFLib) return resolve(window.PDFLib)
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'
    s.onload = () => resolve(window.PDFLib)
    s.onerror = () => reject(new Error('No se pudo cargar pdf-lib (revisá tu conexión)'))
    document.head.appendChild(s)
  })
}

export default function Gastos() {
  const esMovil = useEsMovil()
  const [gastos, setGastos] = useState([])
  const [tipo, setTipo] = useState('variable')
  const [form, setForm] = useState(FORM_VACIO)
  const [facturaFile, setFacturaFile] = useState(null)
  const [alert, setAlert] = useState(null)
  const [editandoId, setEditandoId] = useState(null)
  const [filtroMes, setFiltroMes] = useState(fechaHoyARG().substring(0, 7))
  const [filtroPeriodo, setFiltroPeriodo] = useState('mes')
  const [vista, setVista] = useState('todos') // 'todos' | 'facturas'
  const [guardando, setGuardando] = useState(false)
  const [exportando, setExportando] = useState('')
  const guardandoRef = useRef(false)

  useEffect(() => { fetchGastos() }, [])

  async function fetchGastos() {
    // Sin .limit — paginamos en cliente para mostrar TODOS los gastos
    const { data } = await fetchAllRows(() => supabase.from('gastos').select('*').order('fecha', { ascending: false }))
    setGastos(data || [])
  }

  function showAlert(msg, type = 'success') {
    setAlert({ msg, type })
    setTimeout(() => setAlert(null), 4000)
  }

  async function guardar() {
    if (guardandoRef.current) return // anti doble-click (ref es sincrónico)
    if (!form.descripcion || !form.monto) { showAlert('Completá descripción y monto', 'error'); return }

    guardandoRef.current = true
    setGuardando(true)
    try {
      const montoNum = parseNumero(form.monto)
      const conFactura = form.tieneFactura && tipo !== 'ingreso'

      // Subir archivo de factura si hay uno nuevo seleccionado
      let facturaPath = form.facturaPath || null
      let facturaNombre = form.facturaNombre || null
      let facturaMime = form.facturaMime || null
      if (conFactura && facturaFile) {
        const safe = facturaFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const ruta = `gastos/${Date.now()}_${safe}`
        const { data: up, error: upErr } = await supabase.storage.from('facturas').upload(ruta, facturaFile)
        if (upErr) { showAlert('❌ Error subiendo la factura: ' + upErr.message, 'error'); return }
        facturaPath = up.path
        facturaNombre = facturaFile.name
        facturaMime = facturaFile.type || (safe.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
      }

      const { neto, iva } = conFactura ? discriminarIva(montoNum, form.ivaPct) : { neto: null, iva: null }

      const datos = {
        fecha: form.fecha, tipo,
        categoria: tipo === 'socio' || tipo === 'ingreso' ? '' : form.categoria,
        descripcion: form.descripcion, monto: montoNum,
        forma: form.forma,
        socio: tipo === 'socio' ? form.socio : null,
        origen_ingreso: tipo === 'ingreso' ? form.origenIngreso : null,
        notas: form.notas,
        // Factura
        tiene_factura: conFactura,
        factura_path: conFactura ? facturaPath : null,
        factura_nombre: conFactura ? facturaNombre : null,
        factura_mime: conFactura ? facturaMime : null,
        fecha_emision: conFactura ? (form.fechaEmision || form.fecha) : null,
        neto, iva,
        iva_pct: conFactura ? (parseFloat(form.ivaPct) || 0) : null,
        proveedor: conFactura ? (form.proveedor || null) : null,
        comprobante: conFactura ? (form.comprobante || null) : null,
        solo_balance: conFactura && !!form.soloBalance,
      }

      if (editandoId) {
        const { error } = await supabase.from('gastos').update(datos).eq('id', editandoId)
        if (error) { showAlert(error.message, 'error'); return }
        showAlert('✅ Gasto actualizado')
        setEditandoId(null)
      } else {
        const { error } = await supabase.from('gastos').insert(datos)
        if (error) { showAlert(error.message, 'error'); return }
        showAlert(conFactura ? '✅ Gasto con factura registrado' : '✅ Registrado correctamente')
      }
      setForm(FORM_VACIO)
      setFacturaFile(null)
      fetchGastos()
    } finally {
      guardandoRef.current = false
      setGuardando(false)
    }
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar este registro?')) return
    const g = gastos.find(x => x.id === id)
    // Borrar también el archivo de factura del storage (si tenía)
    if (g?.factura_path) {
      await supabase.storage.from('facturas').remove([g.factura_path]).catch(() => {})
    }
    await supabase.from('gastos').delete().eq('id', id)
    showAlert('🗑️ Eliminado')
    if (editandoId === id) { setEditandoId(null); setForm(FORM_VACIO); setFacturaFile(null) }
    fetchGastos()
  }

  function editar(g) {
    setEditandoId(g.id)
    setTipo(g.tipo)
    setFacturaFile(null)
    setForm({
      fecha: g.fecha,
      categoria: g.categoria || '',
      descripcion: g.descripcion || '',
      monto: g.monto?.toString() || '',
      forma: g.forma || 'efectivo',
      socio: g.socio || 'fabricio',
      origenIngreso: g.origen_ingreso || '',
      notas: g.notas || '',
      tieneFactura: !!g.tiene_factura,
      fechaEmision: g.fecha_emision || '',
      ivaPct: g.iva_pct != null ? String(g.iva_pct) : '21',
      proveedor: g.proveedor || '',
      comprobante: g.comprobante || '',
      facturaPath: g.factura_path || '',
      facturaNombre: g.factura_nombre || '',
      facturaMime: g.factura_mime || '',
      soloBalance: !!g.solo_balance,
    })
    setVista('todos')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Abre la factura en una pestaña nueva (URL firmada temporal, bucket privado)
  async function verFactura(path) {
    if (!path) return
    const { data, error } = await supabase.storage.from('facturas').createSignedUrl(path, 3600)
    if (error || !data?.signedUrl) { showAlert('No se pudo abrir la factura', 'error'); return }
    window.open(data.signedUrl, '_blank')
  }

  // Exporta UN mes a un solo PDF: cada factura (imagen o PDF) por fecha de
  // emisión + hoja de resumen al final. Usa pdf-lib (CDN).
  async function exportarMes(mesKey, lista) {
    if (exportando) return
    setExportando(mesKey)
    try {
      const PDFLib = await cargarPdfLib()
      const { PDFDocument, StandardFonts, rgb } = PDFLib
      const doc = await PDFDocument.create()
      const font = await doc.embedFont(StandardFonts.Helvetica)
      const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
      const A4 = [595.28, 841.89]

      const ordenadas = [...lista].sort((a, b) =>
        String(a.fecha_emision || a.fecha).localeCompare(String(b.fecha_emision || b.fecha)))

      let incluidas = 0, fallidas = 0
      for (const g of ordenadas) {
        if (!g.factura_path) { fallidas++; continue }
        let blob
        try {
          const r = await supabase.storage.from('facturas').download(g.factura_path)
          if (r.error || !r.data) throw new Error('download')
          blob = r.data
        } catch { fallidas++; continue }
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const esPdf = (g.factura_mime || '').includes('pdf') || g.factura_path.toLowerCase().endsWith('.pdf')

        try {
          if (esPdf) {
            const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
            const pages = await doc.copyPages(src, src.getPageIndices())
            pages.forEach(p => doc.addPage(p))
          } else {
            let img
            const esPng = (g.factura_mime || '').includes('png') || g.factura_path.toLowerCase().endsWith('.png')
            try { img = esPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes) }
            catch { img = await doc.embedPng(bytes).catch(() => null) }
            if (!img) { fallidas++; continue }
            const page = doc.addPage(A4)
            const cap1 = `${fmtFecha(g.fecha_emision || g.fecha)}  -  ${(g.proveedor || g.descripcion || '').substring(0, 70)}`
            const cap2 = `Neto $${fmt(g.neto ?? g.monto)}   IVA $${fmt(g.iva || 0)}   Total $${fmt(g.monto)}`
            page.drawText(cap1, { x: 40, y: 805, size: 11, font: fontBold, color: rgb(0, 0, 0) })
            page.drawText(cap2, { x: 40, y: 790, size: 10, font, color: rgb(0.25, 0.25, 0.25) })
            const maxW = 515, maxH = 720
            const scale = Math.min(maxW / img.width, maxH / img.height, 1)
            const w = img.width * scale, h = img.height * scale
            page.drawImage(img, { x: 40, y: 770 - h, width: w, height: h })
          }
          incluidas++
        } catch { fallidas++ }
      }

      // Hoja de resumen al final
      const tot = resumenMes(lista)
      const page = doc.addPage(A4)
      let y = 800
      const line = (txt, opts = {}) => { page.drawText(txt, { x: opts.x ?? 40, y, size: opts.size ?? 11, font: opts.bold ? fontBold : font, color: opts.color || rgb(0, 0, 0) }); y -= (opts.gap ?? 18) }
      line('CARNICERIAS FABRICIUS SAS', { bold: true, size: 14, gap: 22 })
      line(`Resumen de gastos con factura - ${nombreMes(mesKey)}`, { bold: true, size: 12, gap: 26 })
      line(`Comprobantes incluidos: ${incluidas}${fallidas ? `  (no adjuntados: ${fallidas})` : ''}`, { gap: 24 })
      line('IVA discriminado por alicuota:', { bold: true, gap: 20 })
      for (const a of tot.porAlicuota) {
        line(`   ${a.label}:   Neto $${fmt(a.neto)}    IVA $${fmt(a.iva)}    Total $${fmt(a.total)}`, { gap: 18 })
      }
      y -= 8
      line(`NETO TOTAL:   $${fmt(tot.neto)}`, { bold: true, size: 12, gap: 20 })
      line(`IVA TOTAL:    $${fmt(tot.iva)}`, { bold: true, size: 12, gap: 20 })
      line(`TOTAL FACTURADO:  $${fmt(tot.total)}`, { bold: true, size: 13, color: rgb(0.6, 0.45, 0), gap: 20 })

      const out = await doc.save()
      const blobOut = new Blob([out], { type: 'application/pdf' })
      const url = URL.createObjectURL(blobOut)
      const a = document.createElement('a')
      a.href = url
      a.download = `Gastos-con-factura-${mesKey}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      if (fallidas) showAlert(`PDF generado. ${fallidas} archivo(s) no se pudieron adjuntar (formato no soportado).`, 'error')
      else showAlert('✅ PDF generado')
    } catch (e) {
      showAlert('❌ ' + (e.message || 'Error generando el PDF'), 'error')
    } finally {
      setExportando('')
    }
  }

  // Filtrar por período (vista "Todos")
  const hoy = new Date()
  const gastosFiltrados = gastos.filter(g => {
    if (filtroPeriodo === 'mes') return g.fecha?.startsWith(filtroMes)
    if (filtroPeriodo === 'semana') {
      const d = new Date(g.fecha + 'T12:00')
      const diffDays = Math.floor((hoy - d) / (1000 * 60 * 60 * 24))
      return diffDays >= 0 && diffDays <= 7
    }
    return true // todos
  })

  // Totales del período filtrado. Los "solo balance" (facturas a nombre de la
  // SAS que paga un tercero) NO suman: son solo documentación para el balance.
  const gastosQueSuman = gastosFiltrados.filter(g => !g.solo_balance)
  const totVar = gastosQueSuman.filter(g => g.tipo === 'variable').reduce((s, g) => s + (g.monto || 0), 0)
  const totFijo = gastosQueSuman.filter(g => g.tipo === 'fijo').reduce((s, g) => s + (g.monto || 0), 0)
  const totSocio = gastosQueSuman.filter(g => g.tipo === 'socio').reduce((s, g) => s + (g.monto || 0), 0)
  const totIngreso = gastosQueSuman.filter(g => g.tipo === 'ingreso').reduce((s, g) => s + (g.monto || 0), 0)
  const totalEgresos = totVar + totFijo + totSocio
  const balance = totIngreso - totalEgresos

  // Totales del MES en curso (del día 01 hasta hoy), sin importar el filtro de
  // período de la lista. Socio separado por Fabri / Ariel. Panel bajo el formulario.
  const mesIniGastos = fechaHoyARG().slice(0, 8) + '01'
  const hoyGastos = fechaHoyARG()
  const acum = (gastos || []).filter(g => !g.solo_balance && g.fecha >= mesIniGastos && g.fecha <= hoyGastos)
  const acumVar   = acum.filter(g => g.tipo === 'variable').reduce((s, g) => s + (Number(g.monto) || 0), 0)
  const acumFijo  = acum.filter(g => g.tipo === 'fijo').reduce((s, g) => s + (Number(g.monto) || 0), 0)
  const acumFabri = acum.filter(g => g.tipo === 'socio' && g.socio === 'fabricio').reduce((s, g) => s + (Number(g.monto) || 0), 0)
  const acumAriel = acum.filter(g => g.tipo === 'socio' && g.socio === 'ariel').reduce((s, g) => s + (Number(g.monto) || 0), 0)

  // Meses disponibles
  const mesesDisp = [...new Set(gastos.map(g => g.fecha?.substring(0, 7)))].filter(Boolean).sort().reverse()

  // Paginación del listado filtrado
  const pag = usePaginacion(gastosFiltrados, 25)

  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%', boxSizing: 'border-box' }

  // ---- Datos para la vista "Con factura" ----
  const conFactura = gastos.filter(g => g.tiene_factura)
  // Agrupar por mes de emisión (fallback a fecha de pago)
  const mesesFactura = {}
  for (const g of conFactura) {
    const k = String(g.fecha_emision || g.fecha || '').substring(0, 7)
    if (!k) continue
    if (!mesesFactura[k]) mesesFactura[k] = []
    mesesFactura[k].push(g)
  }
  const mesesFacturaOrden = Object.keys(mesesFactura).sort().reverse()

  // Vista previa en vivo del IVA en el formulario
  const previewIva = form.tieneFactura ? discriminarIva(parseNumero(form.monto), form.ivaPct) : null

  return (
    <div>
      <div className="page-title">GASTOS</div>
      <div className="page-sub">Variables, fijos, socios e ingresos extra</div>

      {alert && (
        <div style={{ background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>
          {alert.msg}
        </div>
      )}

      {/* TABS Todos / Con factura */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {[
          { id: 'todos', label: '📋 Todos los gastos' },
          { id: 'facturas', label: `🧾 Con factura (${conFactura.length})` },
        ].map(t => (
          <button key={t.id} onClick={() => setVista(t.id)}
            style={{ padding: '9px 18px', borderRadius: 8, border: `2px solid ${vista === t.id ? 'var(--gold)' : 'var(--border)'}`, background: vista === t.id ? 'var(--gold)' : 'transparent', color: vista === t.id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 13 }}>
            {t.label}
          </button>
        ))}
      </div>

      {vista === 'facturas'
        ? <VistaFacturas
            meses={mesesFacturaOrden} mapa={mesesFactura}
            onVer={verFactura} onEditar={editar} onEliminar={eliminar}
            onExport={exportarMes} exportando={exportando} />
        : (
        <>
      {/* FILTROS */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { id: 'semana', label: '📅 Esta semana' },
          { id: 'mes', label: '📆 Este mes' },
          { id: 'todos', label: '📋 Todos' },
        ].map(p => (
          <button key={p.id} onClick={() => setFiltroPeriodo(p.id)}
            style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${filtroPeriodo === p.id ? 'var(--gold)' : 'var(--border)'}`, background: filtroPeriodo === p.id ? 'var(--gold)' : 'transparent', color: filtroPeriodo === p.id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
            {p.label}
          </button>
        ))}
        {filtroPeriodo === 'mes' && (
          <select value={filtroMes} onChange={e => setFiltroMes(e.target.value)}
            style={{ ...inp, width: 'auto', fontSize: 13 }}>
            {mesesDisp.map(m => (
              <option key={m} value={m}>{nombreMes(m)}</option>
            ))}
          </select>
        )}
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>{gastosFiltrados.length} registros</span>
      </div>

      {/* STATS */}
      <div className="grid4" style={{ marginBottom: 20 }}>
        {[
          { label: 'Variables', val: totVar, color: 'var(--red-light)', icon: '💸' },
          { label: 'Fijos', val: totFijo, color: 'var(--blue)', icon: '📌' },
          { label: 'Socios', val: totSocio, color: 'var(--gold)', icon: '👤' },
          { label: 'Ingresos extra', val: totIngreso, color: 'var(--green)', icon: '💰' },
        ].map(s => (
          <div key={s.label} className="stat">
            <div style={{ fontSize: 18, marginBottom: 4 }}>{s.icon}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color: s.color }}>{fmt(s.val)}</div>
          </div>
        ))}
      </div>

      {/* BALANCE */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div className="stat" style={{ flex: 1 }}>
          <div className="stat-label">Total egresos del período</div>
          <div className="stat-value" style={{ color: 'var(--red-light)' }}>{fmt(totalEgresos)}</div>
        </div>
        <div className="stat" style={{ flex: 1, borderColor: balance >= 0 ? 'var(--green)' : 'var(--red-light)' }}>
          <div className="stat-label">Balance (ingresos − egresos)</div>
          <div className="stat-value" style={{ color: balance >= 0 ? 'var(--green)' : 'var(--red-light)' }}>
            {balance >= 0 ? '+' : ''}{fmt(balance)}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : '1fr 1.5fr', gap: 16 }}>
        {/* FORMULARIO */}
        <div className="card">
          <div className="card-title">{editandoId ? '✏️ Editando registro' : 'Cargar registro'}</div>

          {editandoId && (
            <div style={{ background: '#2a1a0a', border: '1px solid var(--amber)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 600 }}>✏️ Editando</span>
              <button className="btn btn-ghost btn-sm" onClick={() => { setEditandoId(null); setForm(FORM_VACIO); setFacturaFile(null) }}>Cancelar</button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {TIPOS.map(t => (
              <button key={t.id} onClick={() => setTipo(t.id)}
                style={{ padding: '7px 12px', borderRadius: 8, border: `2px solid ${tipo === t.id ? t.color : 'var(--border)'}`, background: tipo === t.id ? t.color + '22' : 'transparent', color: tipo === t.id ? t.color : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 12 }}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="form-row">
            <div className="form-group"><label>Fecha</label>
              <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} style={inp} />
            </div>
            {tipo === 'socio' && (
              <div className="form-group"><label>Socio</label>
                <select value={form.socio} onChange={e => setForm(f => ({ ...f, socio: e.target.value }))} style={inp}>
                  <option value="fabricio">Fabricio Lenardon</option>
                  <option value="ariel">Ariel Garrone</option>
                </select>
              </div>
            )}
            {tipo !== 'socio' && tipo !== 'ingreso' && (
              <div className="form-group"><label>Categoría</label>
                <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))} style={inp}>
                  <option value="">— Seleccioná —</option>
                  {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            )}
            {tipo === 'ingreso' && (
              <div className="form-group"><label>Origen</label>
                <select value={form.origenIngreso} onChange={e => setForm(f => ({ ...f, origenIngreso: e.target.value }))} style={inp}>
                  <option value="alquiler_sucursal">🏠 Alquiler Sucursal</option>
                  <option value="alquiler_maquinas">⚙️ Alquiler máquinas</option>
                  <option value="contrato">📋 Pago contrato</option>
                  <option value="otro">💰 Otro ingreso</option>
                </select>
              </div>
            )}
          </div>

          <div className="form-group"><label>Descripción</label>
            <input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
              placeholder="Ej: Mecánico Kangoo, ART Roxana..." style={inp} />
          </div>

          <div className="form-row">
            <div className="form-group"><label>{form.tieneFactura ? 'Total c/ IVA ($)' : 'Monto ($)'}</label>
              <input type="number" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                style={{ ...inp, borderColor: form.monto ? 'var(--gold)' : 'var(--border)' }} />
            </div>
            <div className="form-group"><label>Forma de pago</label>
              <select value={form.forma} onChange={e => setForm(f => ({ ...f, forma: e.target.value }))} style={inp}>
                <option value="efectivo">💵 Efectivo</option>
                <option value="transferencia">📲 Transferencia</option>
                <option value="debito">💳 Débito</option>
                <option value="cheque">📄 Cheque</option>
              </select>
            </div>
          </div>

          <div className="form-group"><label>Notas (opcional)</label>
            <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
              placeholder="Observaciones..." style={inp} />
          </div>

          {/* SECCIÓN FACTURA (no aplica a ingresos) */}
          {tipo !== 'ingreso' && (
            <div style={{ border: `1px solid ${form.tieneFactura ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 10, padding: 12, marginBottom: 14, background: form.tieneFactura ? '#221c08' : 'transparent' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                <input type="checkbox" checked={form.tieneFactura}
                  onChange={e => setForm(f => ({ ...f, tieneFactura: e.target.checked, fechaEmision: f.fechaEmision || f.fecha }))}
                  style={{ width: 16, height: 16, accentColor: 'var(--gold)' }} />
                🧾 Tiene factura (para balance SAS)
              </label>

              {form.tieneFactura && (
                <div style={{ marginTop: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12, marginBottom: 12, padding: '8px 10px', borderRadius: 8, border: `1px solid ${form.soloBalance ? 'var(--blue)' : 'var(--border)'}`, background: form.soloBalance ? '#0e1a2a' : 'transparent', color: form.soloBalance ? 'var(--blue)' : 'var(--muted)' }}>
                    <input type="checkbox" checked={form.soloBalance}
                      onChange={e => setForm(f => ({ ...f, soloBalance: e.target.checked }))}
                      style={{ width: 15, height: 15, accentColor: 'var(--blue)' }} />
                    📑 Solo para balance — la paga un tercero (NO suma a nuestros gastos)
                  </label>

                  <div className="form-group"><label>Archivo (imagen o PDF)</label>
                    <input type="file" accept="image/*,application/pdf,.pdf"
                      onChange={e => setFacturaFile(e.target.files?.[0] || null)} style={{ ...inp, padding: 7 }} />
                    {form.facturaPath && !facturaFile && (
                      <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>
                        ✓ Ya tiene archivo: {form.facturaNombre || 'factura'} <span style={{ color: 'var(--muted)' }}>(subí otro solo si querés reemplazarlo)</span>
                      </div>
                    )}
                    {facturaFile && <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 4 }}>📎 {facturaFile.name}</div>}
                  </div>

                  <div className="form-row">
                    <div className="form-group"><label>Fecha de emisión</label>
                      <input type="date" value={form.fechaEmision} onChange={e => setForm(f => ({ ...f, fechaEmision: e.target.value }))} style={inp} />
                    </div>
                    <div className="form-group"><label>Alícuota IVA</label>
                      <select value={form.ivaPct} onChange={e => setForm(f => ({ ...f, ivaPct: e.target.value }))} style={inp}>
                        {ALICUOTAS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group"><label>Proveedor (opcional)</label>
                      <input value={form.proveedor} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))}
                        placeholder="Razón social" style={inp} />
                    </div>
                    <div className="form-group"><label>Nº comprobante (opcional)</label>
                      <input value={form.comprobante} onChange={e => setForm(f => ({ ...f, comprobante: e.target.value }))}
                        placeholder="Ej: A 0001-00012345" style={inp} />
                    </div>
                  </div>

                  {previewIva && parseNumero(form.monto) > 0 && (
                    <div style={{ display: 'flex', gap: 10, fontSize: 12, marginTop: 4, flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--muted)' }}>Neto: <b style={{ color: 'var(--text)' }}>${fmt(previewIva.neto)}</b></span>
                      <span style={{ color: 'var(--muted)' }}>IVA: <b style={{ color: 'var(--gold)' }}>${fmt(previewIva.iva)}</b></span>
                      <span style={{ color: 'var(--muted)' }}>Total: <b style={{ color: 'var(--text)' }}>${fmt(parseNumero(form.monto))}</b></span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            {editandoId && <button className="btn btn-ghost" onClick={() => { setEditandoId(null); setForm(FORM_VACIO); setFacturaFile(null) }}>Cancelar</button>}
            <button className="btn btn-gold" onClick={guardar} disabled={guardando} style={{ flex: 1, opacity: guardando ? 0.6 : 1 }}>
              {guardando ? '⏳ Guardando…' : editandoId ? '💾 Guardar cambios' : '✅ Registrar'}
            </button>
          </div>

          {/* ── Totales por categoría hasta la fecha ── */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, color: 'var(--muted)', fontWeight: 700, marginBottom: 12 }}>
              📊 GASTOS DEL MES (01 → HOY)
            </div>
            {[
              { l: '💸 Gastos variables',     v: acumVar,   c: 'var(--red-light)' },
              { l: '📌 Gastos fijos',         v: acumFijo,  c: 'var(--blue)' },
              { l: '👤 Gasto socio Fabri',    v: acumFabri, c: 'var(--gold)' },
              { l: '👤 Gasto socio Ariel',    v: acumAriel, c: 'var(--gold)' },
            ].map(x => (
              <div key={x.l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: 13, color: 'var(--text2)' }}>{x.l}</span>
                <span style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 19, color: x.c }}>{fmt(x.v)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 11, marginTop: 4, borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12, letterSpacing: 1, color: 'var(--muted)', fontWeight: 700 }}>TOTAL EGRESOS</span>
              <span style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 23, color: 'var(--red-light)' }}>{fmt(acumVar + acumFijo + acumFabri + acumAriel)}</span>
            </div>
          </div>
        </div>

        {/* LISTADO */}
        <div className="card">
          <div className="card-title">
            {filtroPeriodo === 'semana' ? 'Gastos de la semana' : filtroPeriodo === 'mes' ? `Gastos de ${nombreMes(filtroMes)}` : 'Todos los gastos'}
          </div>

          {gastosFiltrados.length === 0
            ? <div className="empty">Sin registros para este período</div>
            : pag.items.map(g => {
                const t = TIPOS.find(x => x.id === g.tipo) || TIPOS[0]
                return (
                  <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 6px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ background: t.color + '22', color: t.color, borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{t.label}</span>
                        {g.tiene_factura && <span title="Tiene factura adjunta" style={{ fontSize: 12 }}>🧾</span>}
                        {g.solo_balance && <span title="Solo para balance: la paga un tercero, no suma a los gastos" style={{ background: '#0e1a2a', color: 'var(--blue)', border: '1px solid var(--blue)', borderRadius: 4, padding: '1px 6px', fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap' }}>📑 SOLO BALANCE</span>}
                        <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.descripcion}</div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {g.fecha} · {g.forma}
                        {g.socio ? ` · ${g.socio}` : ''}
                        {g.categoria ? ` · ${CATEGORIAS.find(c => c.value === g.categoria)?.label || g.categoria}` : ''}
                      </div>
                      {g.notas && <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>{g.notas}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, color: g.solo_balance ? 'var(--muted)' : g.tipo === 'ingreso' ? 'var(--green)' : t.color, fontSize: 13 }}>
                        {g.solo_balance ? '' : g.tipo === 'ingreso' ? '+' : '−'}{fmt(g.monto)}
                      </span>
                      {g.factura_path && (
                        <button onClick={() => verFactura(g.factura_path)} title="Ver factura"
                          style={{ background: '#1a2a1a', border: '1px solid #2d5a2d', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: 11 }}>👁️</button>
                      )}
                      <button onClick={() => editar(g)}
                        style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#000' }}>✏️</button>
                      <button onClick={() => eliminar(g.id)}
                        style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'var(--red-light)' }}>🗑️</button>
                    </div>
                  </div>
                )
              })}
          <Paginador {...pag.controles} label="registros" />
        </div>
      </div>
        </>
        )}
    </div>
  )
}

// Calcula el resumen de un mes: neto, iva, total y desglose por alícuota
function resumenMes(lista) {
  let neto = 0, iva = 0, total = 0
  const porPct = {}
  for (const g of lista) {
    const n = Number(g.neto ?? g.monto) || 0
    const i = Number(g.iva) || 0
    const t = Number(g.monto) || 0
    neto += n; iva += i; total += t
    const pct = g.iva_pct != null ? String(g.iva_pct) : 's/d'
    if (!porPct[pct]) porPct[pct] = { neto: 0, iva: 0, total: 0 }
    porPct[pct].neto += n; porPct[pct].iva += i; porPct[pct].total += t
  }
  const labelPct = p => p === '0' ? 'Exento' : p === 's/d' ? 'Sin alicuota' : `${p}%`.replace('.', ',')
  const porAlicuota = Object.keys(porPct).sort().map(p => ({ label: labelPct(p), ...porPct[p] }))
  return { neto, iva, total, porAlicuota }
}

// ---- Vista "Con factura": gastos con factura agrupados por mes de emisión ----
function VistaFacturas({ meses, mapa, onVer, onEditar, onEliminar, onExport, exportando }) {
  if (meses.length === 0) {
    return <div className="empty" style={{ padding: 40 }}>
      Todavía no cargaste gastos con factura.<br />
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Cargá un gasto en la pestaña "Todos los gastos" y tildá <b>🧾 Tiene factura</b>.</span>
    </div>
  }
  return (
    <div>
      {meses.map(mesKey => {
        const lista = [...mapa[mesKey]].sort((a, b) =>
          String(b.fecha_emision || b.fecha).localeCompare(String(a.fecha_emision || a.fecha)))
        const r = resumenMes(lista)
        return (
          <div className="card" key={mesKey} style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
              <div className="card-title" style={{ marginBottom: 0, textTransform: 'capitalize' }}>📆 {nombreMes(mesKey)} · {lista.length} factura{lista.length !== 1 ? 's' : ''}</div>
              <button className="btn btn-gold btn-sm" onClick={() => onExport(mesKey, lista)} disabled={!!exportando}
                style={{ opacity: exportando === mesKey ? 0.6 : 1 }}>
                {exportando === mesKey ? '⏳ Generando…' : '📄 Descargar PDF del mes'}
              </button>
            </div>

            {/* Resumen mensual */}
            <div className="grid4" style={{ marginBottom: 12 }}>
              <div className="stat"><div className="stat-label">Neto</div><div className="stat-value" style={{ fontSize: 18 }}>{fmt(r.neto)}</div></div>
              <div className="stat"><div className="stat-label">IVA</div><div className="stat-value" style={{ fontSize: 18, color: 'var(--gold)' }}>{fmt(r.iva)}</div></div>
              <div className="stat"><div className="stat-label">Total facturado</div><div className="stat-value" style={{ fontSize: 18, color: 'var(--green)' }}>{fmt(r.total)}</div></div>
              <div className="stat" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div className="stat-label" style={{ marginBottom: 4 }}>IVA por alícuota</div>
                {r.porAlicuota.map(a => (
                  <div key={a.label} style={{ fontSize: 11, color: 'var(--muted)' }}>{a.label}: <b style={{ color: 'var(--text)' }}>${fmt(a.iva)}</b></div>
                ))}
              </div>
            </div>

            {/* Detalle de facturas del mes */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}>Emisión</th>
                    <th style={{ padding: '6px 8px' }}>Proveedor / Detalle</th>
                    <th style={{ padding: '6px 8px' }}>Comprob.</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Neto</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>IVA</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Total</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map(g => (
                    <tr key={g.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>{fmtFecha(g.fecha_emision || g.fecha)}</td>
                      <td style={{ padding: '7px 8px' }}>
                        <div style={{ fontWeight: 600 }}>
                          {g.proveedor || g.descripcion}
                          {g.solo_balance && <span title="Solo para balance: la paga un tercero, no suma a los gastos" style={{ background: '#0e1a2a', color: 'var(--blue)', border: '1px solid var(--blue)', borderRadius: 4, padding: '1px 6px', fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', marginLeft: 6 }}>📑 SOLO BALANCE</span>}
                        </div>
                        {g.proveedor && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{g.descripcion}</div>}
                      </td>
                      <td style={{ padding: '7px 8px', color: 'var(--muted)' }}>{g.comprobante || '—'}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(g.neto ?? g.monto)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--gold)' }}>{fmt(g.iva || 0)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700 }}>{fmt(g.monto)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {g.factura_path && (
                          <button onClick={() => onVer(g.factura_path)} title="Ver factura"
                            style={{ background: '#1a2a1a', border: '1px solid #2d5a2d', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: 11, marginRight: 4 }}>👁️</button>
                        )}
                        <button onClick={() => onEditar(g)} title="Editar"
                          style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#000', marginRight: 4 }}>✏️</button>
                        <button onClick={() => onEliminar(g.id)} title="Eliminar"
                          style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'var(--red-light)' }}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
