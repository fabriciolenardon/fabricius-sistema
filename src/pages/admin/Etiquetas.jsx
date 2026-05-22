// ============================================================
// ETIQUETAS — Diseñador e impresor de etiquetas autoadhesivas
// ============================================================
// Imprime etiquetas con:
//  - Nombre del producto
//  - Descripción libre
//  - Código de barras EAN-13 (compatible con balanza)
//  - Fecha de elaboración / vencimiento
//  - Lote / información extra
// ============================================================
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { generarEAN13Balanza } from '../../lib/balanzaEAN'
import JsBarcode from 'jsbarcode'

const CATEGORIAS = {
  bovino_corte: '🥩 Bovino Cortes',
  bovino_pieza: '🍖 Piezas',
  bovino_brosa: '🫀 Brosa',
  cerdo: '🐷 Cerdo',
  pollo: '🍗 Pollo',
  embutido: '🌭 Embutidos',
}

function hoy() { return new Date().toISOString().split('T')[0] }
function sumarDias(fecha, dias) {
  const d = new Date(fecha + 'T12:00:00')
  d.setDate(d.getDate() + dias)
  return d.toISOString().split('T')[0]
}
function fmtFecha(f) {
  if (!f) return ''
  const d = new Date(f + 'T12:00:00')
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

// Componente que renderiza un código de barras
function Barcode({ value, height = 50, width = 1.6, displayValue = true }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && value) {
      try {
        JsBarcode(ref.current, value, {
          format: value.length === 13 ? 'EAN13' : 'CODE128',
          height,
          width,
          displayValue,
          fontSize: 12,
          margin: 4,
        })
      } catch (e) {
        console.error('Error generando barcode:', e)
      }
    }
  }, [value, height, width, displayValue])
  return <svg ref={ref} />
}

export default function Etiquetas() {
  const [precios, setPrecios] = useState([])
  const [configEAN, setConfigEAN] = useState({
    // Formato real Cuora Max Fabricius — pesos enteros. Ver migración 15.
    prefijo: '2', plu_digitos: 6, tipo: 'precio_pesos', campo_digitos: 5
  })
  const [productoSel, setProductoSel] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [datos, setDatos] = useState({
    descripcion: '',
    fecha_elaboracion: hoy(),
    fecha_vencimiento: '',
    lote: '',
    peso_kg: '',
    cantidad: 1,
  })
  const [config, setConfig] = useState({
    mostrar_codigo: true,
    mostrar_descripcion: true,
    mostrar_fecha_elab: true,
    mostrar_fecha_venc: true,
    mostrar_nombre: true,
    mostrar_lote: false,
    mostrar_peso: false,
    ancho_mm: 60,
    alto_mm: 40,
    tamano_nombre: 14,
    tamano_descripcion: 10,
  })
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    cargar()
  }, [])

  async function cargar() {
    const [{ data: pre }, { data: cfg }] = await Promise.all([
      supabase.from('precios').select('*').eq('activo', true).order('nombre'),
      supabase.from('config_sistema').select('*').eq('clave', 'ean13_formato').maybeSingle(),
    ])
    setPrecios(pre || [])
    if (cfg?.valor) setConfigEAN(cfg.valor)
  }

  function showMsg(texto, type = 'success') {
    setMsg({ texto, type }); setTimeout(() => setMsg(null), 2500)
  }

  function seleccionar(p) {
    setProductoSel(p)
    setDatos(d => ({
      ...d,
      descripcion: p.descripcion_etiqueta || p.nombre || '',
      fecha_elaboracion: hoy(),
      fecha_vencimiento: sumarDias(hoy(), p.dias_vencimiento || 3),
    }))
    setBusqueda('')
  }

  const productosFiltrados = busqueda.trim()
    ? precios.filter(p => p.nombre.toLowerCase().includes(busqueda.toLowerCase().trim())).slice(0, 15)
    : []

  // Generar código EAN-13 para preview
  let codigoEAN = ''
  if (productoSel?.codigo_balanza) {
    try {
      const peso = parseFloat(datos.peso_kg) || 0
      const precio = productoSel.precio_minorista || 0
      let valor
      if (configEAN.tipo === 'peso') {
        valor = Math.round(peso * 1000)              // gramos
      } else if (configEAN.tipo === 'precio_pesos') {
        valor = Math.round(peso * precio)            // pesos enteros (sin centavos)
      } else {
        valor = Math.round(peso * precio * 100)      // centavos
      }
      codigoEAN = generarEAN13Balanza(configEAN, productoSel.codigo_balanza, valor)
    } catch (e) {
      codigoEAN = ''
    }
  }

  // ----- Imprimir -----
  function imprimir() {
    if (!productoSel) { showMsg('Seleccioná un producto', 'error'); return }

    // Crear ventana de impresión
    const w = window.open('', '_blank', 'width=400,height=600')
    if (!w) { showMsg('Habilitá popups para imprimir', 'error'); return }

    const cantidad = parseInt(datos.cantidad) || 1
    let etiquetasHTML = ''

    for (let i = 0; i < cantidad; i++) {
      etiquetasHTML += `<div class="etiqueta">${renderEtiquetaHTML()}</div>`
    }

    w.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Etiquetas - ${productoSel.nombre}</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
        <style>
          @page { size: ${config.ancho_mm}mm ${config.alto_mm}mm; margin: 0; }
          * { box-sizing: border-box; }
          body { margin: 0; padding: 0; font-family: Arial, sans-serif; background: white; color: black; }
          .etiqueta {
            width: ${config.ancho_mm}mm;
            height: ${config.alto_mm}mm;
            padding: 2mm;
            page-break-after: always;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            overflow: hidden;
          }
          .nombre { font-weight: bold; font-size: ${config.tamano_nombre}px; text-align: center; line-height: 1.1; margin-bottom: 1mm; }
          .desc { font-size: ${config.tamano_descripcion}px; text-align: center; line-height: 1.1; margin-bottom: 1mm; }
          .fechas { font-size: 9px; display: flex; justify-content: space-between; margin-top: 1mm; }
          .fechas strong { font-weight: bold; }
          .lote { font-size: 9px; text-align: center; }
          .barcode-wrap { text-align: center; flex: 1; display: flex; align-items: center; justify-content: center; }
          .barcode-wrap svg { max-width: 100%; max-height: 100%; }
        </style>
      </head>
      <body>
        ${etiquetasHTML}
        <script>
          window.addEventListener('load', function() {
            document.querySelectorAll('svg[data-codigo]').forEach(function(svg) {
              try {
                JsBarcode(svg, svg.getAttribute('data-codigo'), {
                  format: svg.getAttribute('data-codigo').length === 13 ? 'EAN13' : 'CODE128',
                  height: 35, width: 1.4, displayValue: true, fontSize: 10, margin: 2
                });
              } catch (e) { console.error(e); }
            });
            setTimeout(function() { window.print(); }, 300);
          });
        <\/script>
      </body>
      </html>
    `)
    w.document.close()

    // Registrar en historial
    supabase.from('etiquetas_impresas').insert({
      producto_id: productoSel.id,
      codigo: codigoEAN,
      descripcion: datos.descripcion,
      fecha_elaboracion: datos.fecha_elaboracion,
      fecha_vencimiento: datos.fecha_vencimiento,
      lote: datos.lote,
      cantidad,
    }).then(() => showMsg(`✅ ${cantidad} etiqueta(s) enviada(s) a impresión`))
  }

  function renderEtiquetaHTML() {
    return `
      ${config.mostrar_nombre ? `<div class="nombre">${productoSel.nombre}</div>` : ''}
      ${config.mostrar_descripcion && datos.descripcion ? `<div class="desc">${datos.descripcion}</div>` : ''}
      ${config.mostrar_codigo && codigoEAN ? `<div class="barcode-wrap"><svg data-codigo="${codigoEAN}"></svg></div>` : ''}
      ${(config.mostrar_fecha_elab || config.mostrar_fecha_venc) ? `
        <div class="fechas">
          ${config.mostrar_fecha_elab ? `<span><strong>Elab:</strong> ${fmtFecha(datos.fecha_elaboracion)}</span>` : ''}
          ${config.mostrar_fecha_venc ? `<span><strong>Venc:</strong> ${fmtFecha(datos.fecha_vencimiento)}</span>` : ''}
        </div>
      ` : ''}
      ${config.mostrar_lote && datos.lote ? `<div class="lote">Lote: ${datos.lote}</div>` : ''}
    `
  }

  const inp = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    color: 'var(--text)', borderRadius: 8, padding: '8px 12px',
    fontFamily: "'DM Sans',sans-serif", fontSize: 13, width: '100%',
    boxSizing: 'border-box',
  }

  return (
    <div>
      <div className="page-title">🏷️ ETIQUETAS</div>
      <div className="page-sub">Diseño e impresión de etiquetas autoadhesivas con código de barras</div>

      {msg && (
        <div style={{
          background: msg.type === 'error' ? '#3a1a1a' : '#1a2a1a',
          border: `1px solid ${msg.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`,
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          color: msg.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600
        }}>{msg.texto}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
        {/* ============ COLUMNA IZQUIERDA: CONFIGURACIÓN ============ */}
        <div>
          {/* Selección de producto */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">📦 Producto</div>
            {productoSel ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, background: 'var(--surface2)', borderRadius: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{productoSel.nombre}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {CATEGORIAS[productoSel.categoria] || productoSel.categoria}
                    {productoSel.codigo_balanza ? ` · PLU ${productoSel.codigo_balanza}` : ' · ⚠️ Sin PLU asignado'}
                  </div>
                </div>
                <button onClick={() => setProductoSel(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>Cambiar</button>
              </div>
            ) : (
              <div>
                <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
                  placeholder="Buscar producto por nombre..." style={inp} />
                {productosFiltrados.length > 0 && (
                  <div style={{ marginTop: 8, maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    {productosFiltrados.map(p => (
                      <div key={p.id} onClick={() => seleccionar(p)}
                        style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                        onMouseOver={e => e.currentTarget.style.background = 'var(--surface2)'}
                        onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{p.nombre}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {CATEGORIAS[p.categoria]} {p.codigo_balanza ? `· PLU ${p.codigo_balanza}` : '· ⚠️ Sin PLU'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Datos editables */}
          {productoSel && (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-title">📝 Datos de la etiqueta</div>
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label>Descripción (editable)</label>
                  <input value={datos.descripcion} onChange={e => setDatos(d => ({ ...d, descripcion: e.target.value }))}
                    placeholder="Descripción del producto..." style={inp} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Fecha elaboración</label>
                    <input type="date" value={datos.fecha_elaboracion}
                      onChange={e => setDatos(d => ({ ...d, fecha_elaboracion: e.target.value }))} style={inp} />
                  </div>
                  <div className="form-group">
                    <label>Fecha vencimiento</label>
                    <input type="date" value={datos.fecha_vencimiento}
                      onChange={e => setDatos(d => ({ ...d, fecha_vencimiento: e.target.value }))} style={inp} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Lote (opcional)</label>
                    <input value={datos.lote} onChange={e => setDatos(d => ({ ...d, lote: e.target.value }))}
                      placeholder="L-001" style={inp} />
                  </div>
                  <div className="form-group">
                    <label>Peso/Kg (para barcode)</label>
                    <input type="number" step="0.001" value={datos.peso_kg}
                      onChange={e => setDatos(d => ({ ...d, peso_kg: e.target.value }))}
                      placeholder="0.000" style={inp} />
                  </div>
                </div>
                <div className="form-group" style={{ marginTop: 8 }}>
                  <label>Cantidad a imprimir</label>
                  <input type="number" min="1" value={datos.cantidad}
                    onChange={e => setDatos(d => ({ ...d, cantidad: e.target.value }))} style={inp} />
                </div>
              </div>

              {/* Configuración de campos */}
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-title">⚙️ ¿Qué mostrar en la etiqueta?</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    ['mostrar_nombre', 'Nombre producto'],
                    ['mostrar_descripcion', 'Descripción'],
                    ['mostrar_codigo', 'Código de barras'],
                    ['mostrar_fecha_elab', 'Fecha elaboración'],
                    ['mostrar_fecha_venc', 'Fecha vencimiento'],
                    ['mostrar_lote', 'Lote'],
                  ].map(([key, label]) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--surface2)', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                      <input type="checkbox" checked={config[key]}
                        onChange={e => setConfig(c => ({ ...c, [key]: e.target.checked }))} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <div className="form-row" style={{ marginTop: 12 }}>
                  <div className="form-group">
                    <label>Ancho (mm)</label>
                    <input type="number" value={config.ancho_mm}
                      onChange={e => setConfig(c => ({ ...c, ancho_mm: parseInt(e.target.value) || 60 }))} style={inp} />
                  </div>
                  <div className="form-group">
                    <label>Alto (mm)</label>
                    <input type="number" value={config.alto_mm}
                      onChange={e => setConfig(c => ({ ...c, alto_mm: parseInt(e.target.value) || 40 }))} style={inp} />
                  </div>
                </div>
              </div>

              <button onClick={imprimir} className="btn btn-gold" style={{ width: '100%', padding: '14px', fontSize: 16 }}>
                🖨️ IMPRIMIR {datos.cantidad} ETIQUETA{datos.cantidad > 1 ? 'S' : ''}
              </button>
            </>
          )}
        </div>

        {/* ============ COLUMNA DERECHA: PREVIEW ============ */}
        <div>
          <div className="card" style={{ position: 'sticky', top: 70 }}>
            <div className="card-title">👁️ Vista previa</div>
            {!productoSel ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>🏷️</div>
                <div>Seleccioná un producto para ver el preview</div>
              </div>
            ) : (
              <>
                {/* Etiqueta render */}
                <div style={{ display: 'flex', justifyContent: 'center', padding: 20, background: '#333', borderRadius: 8 }}>
                  <div style={{
                    width: `${config.ancho_mm * 3.5}px`,
                    height: `${config.alto_mm * 3.5}px`,
                    background: 'white',
                    color: 'black',
                    padding: '6px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    overflow: 'hidden',
                    fontFamily: 'Arial, sans-serif',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  }}>
                    {config.mostrar_nombre && (
                      <div style={{ fontWeight: 'bold', fontSize: config.tamano_nombre, textAlign: 'center', lineHeight: 1.1 }}>
                        {productoSel.nombre}
                      </div>
                    )}
                    {config.mostrar_descripcion && datos.descripcion && (
                      <div style={{ fontSize: config.tamano_descripcion, textAlign: 'center', lineHeight: 1.1 }}>
                        {datos.descripcion}
                      </div>
                    )}
                    {config.mostrar_codigo && codigoEAN && (
                      <div style={{ textAlign: 'center', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Barcode value={codigoEAN} height={40} width={1.4} />
                      </div>
                    )}
                    {(config.mostrar_fecha_elab || config.mostrar_fecha_venc) && (
                      <div style={{ fontSize: 9, display: 'flex', justifyContent: 'space-between' }}>
                        {config.mostrar_fecha_elab && <span><b>Elab:</b> {fmtFecha(datos.fecha_elaboracion)}</span>}
                        {config.mostrar_fecha_venc && <span><b>Venc:</b> {fmtFecha(datos.fecha_vencimiento)}</span>}
                      </div>
                    )}
                    {config.mostrar_lote && datos.lote && (
                      <div style={{ fontSize: 9, textAlign: 'center' }}>Lote: {datos.lote}</div>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, textAlign: 'center' }}>
                  Tamaño: {config.ancho_mm} × {config.alto_mm} mm
                </div>
                {!productoSel.codigo_balanza && (
                  <div style={{ marginTop: 10, padding: 10, background: '#3a2a1a', border: '1px solid #f59e0b', borderRadius: 8, fontSize: 12, color: '#f59e0b' }}>
                    ⚠️ Este producto no tiene PLU de balanza asignado. El código de barras no se podrá generar.
                    Asignalo en <strong>Precios</strong>.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
