// Presupuestos — cotizaciones de carne para clientes (nombre libre + lista de
// precios). NO toca stock ni cuenta corriente: arma un documento, lo guarda en
// el historial y genera un PDF imprimible. Reusa la tabla `precios`, el helper
// de listas y abrirVentanaImprimible.
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { fechaHoyARG } from '../../lib/fechas'
import { fmtPrecio, fmtKg, fmtUnidades } from '../../lib/formatos'
import { LISTAS, getLista, getCampoPrecio } from '../../lib/listasPrecios'
import { abrirVentanaImprimible } from '../../lib/pdfPrintable'
import { useEsMovil } from '../../lib/useEsMovil'

// Etiquetas de categoría (mismo set que Precios.jsx) — solo para mostrar de
// qué categoría es cada producto en el buscador.
const CATEGORIAS = {
  bovino_mr: '🐄 Media Reses',
  bovino_corte: '🥩 Bovino Cortes',
  bovino_pieza: '🍖 Piezas Bovinas',
  bovino_brosa: '🫀 Brosas',
  bovino_caja_cb: '📦 Bovino Caja CB',
  bovino_caja_pt: '📦 Bovino Caja PT',
  cerdo_corte: '🐷 Cerdo Cortes',
  cerdo_pieza: '🐷 Cerdo Piezas',
  embutido: '🌭 Embutidos',
  pollo: '🍗 Pollo X Kilo',
  pollo_cajon: '🍗 Pollo Cajón',
  rebozado: '🧊 Rebozado X Kilo',
  rebozado_cajon: '🧊 Rebozado Cajón',
  almacen: '🛒 Almacén',
  bebidas: '🥤 Bebidas',
  insumos: '🧰 Insumos',
}

// Categorías que se venden por cajón/unidad → el ítem arranca en "unidad".
const CATEGORIAS_POR_UNIDAD = new Set(['pollo_cajon', 'rebozado_cajon', 'bebidas'])

const ESTADOS = {
  borrador: { label: '📝 Borrador', color: 'var(--muted)' },
  enviado:  { label: '📤 Enviado',  color: '#7ec8ff' },
  aceptado: { label: '✅ Aceptado', color: 'var(--green)' },
  rechazado:{ label: '❌ Rechazado', color: 'var(--red-light)' },
}

const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%', boxSizing: 'border-box' }
const fmt = n => fmtPrecio(Number(n) || 0)

function validoPorDefecto() {
  const d = new Date(fechaHoyARG() + 'T12:00'); d.setDate(d.getDate() + 7)
  return fechaHoyARG(d)
}
const FORM_VACIO = () => ({ editandoId: null, clienteNombre: '', lista: 'may', items: [], notas: '', validoHasta: validoPorDefecto() })

export default function Presupuestos() {
  const esMovil = useEsMovil()
  const [tab, setTab] = useState('nuevo')
  const [precios, setPrecios] = useState([])
  const [presupuestos, setPresupuestos] = useState([])
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState('')

  const [form, setForm] = useState(FORM_VACIO)

  // Adder de ítems
  const [busqueda, setBusqueda] = useState('')
  const [productoSel, setProductoSel] = useState(null)
  const [mostrarDropdown, setMostrarDropdown] = useState(false)
  const [cantidad, setCantidad] = useState('')
  const [unidad, setUnidad] = useState('kg')
  const [precioInput, setPrecioInput] = useState('')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const [{ data: precs }, { data: presu }] = await Promise.all([
      supabase.from('precios').select('id, nombre, categoria, precio_carniceria, precio_mayorista, precio_minorista').order('nombre'),
      supabase.from('presupuestos').select('*').order('created_at', { ascending: false }),
    ])
    setPrecios(precs || [])
    setPresupuestos(presu || [])
    setLoading(false)
  }

  function mostrarMsg(texto) { setMsg(texto); setTimeout(() => setMsg(''), 3500) }

  // Precio sugerido de un producto según la lista elegida en el form
  function precioSugerido(prod, listaCodigo) {
    if (!prod) return 0
    return Number(prod[getCampoPrecio(listaCodigo)]) || 0
  }

  function seleccionarProducto(p) {
    setProductoSel(p)
    setBusqueda(p.nombre)
    setMostrarDropdown(false)
    setUnidad(CATEGORIAS_POR_UNIDAD.has(p.categoria) ? 'unidad' : 'kg')
    setPrecioInput(String(precioSugerido(p, form.lista) || ''))
  }

  function agregarItem() {
    if (!productoSel) return mostrarMsg('❌ Elegí un producto del listado')
    const cant = Number(cantidad)
    const precio = Number(precioInput)
    if (!cant || cant <= 0) return mostrarMsg('❌ Cargá la cantidad')
    if (!precio || precio <= 0) return mostrarMsg('❌ Cargá el precio unitario')
    const item = {
      nombre: productoSel.nombre,
      categoria: productoSel.categoria,
      cantidad: cant,
      unidad,
      precio_unitario: precio,
      subtotal: Math.round(cant * precio * 100) / 100,
    }
    setForm(f => ({ ...f, items: [...f.items, item] }))
    // Reset del adder para cargar el siguiente
    setProductoSel(null); setBusqueda(''); setCantidad(''); setUnidad('kg'); setPrecioInput('')
  }

  function quitarItem(idx) {
    setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))
  }

  const totalForm = form.items.reduce((s, it) => s + (Number(it.subtotal) || 0), 0)

  async function guardar() {
    if (!form.clienteNombre.trim()) return mostrarMsg('❌ Poné el nombre del cliente')
    if (form.items.length === 0) return mostrarMsg('❌ Agregá al menos un producto')
    setGuardando(true)
    const datos = {
      cliente_nombre: form.clienteNombre.trim(),
      lista_precios: form.lista,
      items: form.items,
      total: totalForm,
      notas: form.notas || null,
      valido_hasta: form.validoHasta || null,
      updated_at: new Date().toISOString(),
    }
    let error
    if (form.editandoId) {
      const r = await supabase.from('presupuestos').update(datos).eq('id', form.editandoId)
      error = r.error
    } else {
      const r = await supabase.from('presupuestos').insert(datos)
      error = r.error
    }
    setGuardando(false)
    if (error) return mostrarMsg('❌ Error al guardar: ' + error.message)
    mostrarMsg(form.editandoId ? '✅ Presupuesto actualizado' : '✅ Presupuesto guardado')
    setForm(FORM_VACIO())
    await cargar()
    setTab('historial')
  }

  function editar(p) {
    setForm({
      editandoId: p.id,
      clienteNombre: p.cliente_nombre || '',
      lista: p.lista_precios || 'may',
      items: Array.isArray(p.items) ? p.items : [],
      notas: p.notas || '',
      validoHasta: p.valido_hasta || '',
    })
    setProductoSel(null); setBusqueda(''); setCantidad(''); setPrecioInput('')
    setTab('nuevo')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function eliminar(id) {
    if (!confirm('¿Seguro que querés eliminar este presupuesto?')) return
    const { error } = await supabase.from('presupuestos').delete().eq('id', id)
    if (error) return mostrarMsg('❌ No se pudo eliminar: ' + error.message)
    mostrarMsg('🗑️ Presupuesto eliminado')
    await cargar()
  }

  async function cambiarEstado(id, estado) {
    const { error } = await supabase.from('presupuestos').update({ estado, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return mostrarMsg('❌ No se pudo cambiar el estado: ' + error.message)
    setPresupuestos(ps => ps.map(p => p.id === id ? { ...p, estado } : p))
  }

  // Genera el PDF imprimible de un presupuesto (guardado o el del form actual)
  function generarPDF(p) {
    const items = Array.isArray(p.items) ? p.items : []
    if (items.length === 0) return mostrarMsg('❌ El presupuesto no tiene productos')
    const total = items.reduce((s, it) => s + (Number(it.subtotal) || 0), 0)
    const lista = getLista(p.lista_precios)
    const fechaTxt = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
    const validoTxt = p.valido_hasta
      ? new Date(p.valido_hasta + 'T12:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
      : null
    const cant = (it) => it.unidad === 'kg' ? fmtKg(it.cantidad) : fmtUnidades(it.cantidad)

    let html = `<div class="badge">CARNICERÍAS FABRICIUS</div>`
    html += `<h1 class="h1">📋 Presupuesto</h1>`
    html += `<div class="sub">Río Primero, Córdoba · Emitido el ${fechaTxt}${validoTxt ? ` · Válido hasta el ${validoTxt}` : ''}</div>`
    html += `<table style="margin-bottom:18px"><tbody>`
    html += `<tr><td class="bold" style="width:140px">Cliente</td><td>${(p.cliente_nombre || '—')}</td></tr>`
    html += `<tr><td class="bold">Lista de precios</td><td>${lista.label}</td></tr>`
    html += `</tbody></table>`
    html += '<table><thead><tr><th>Producto</th><th class="right">Cantidad</th><th class="right">Precio unit.</th><th class="right">Subtotal</th></tr></thead><tbody>'
    items.forEach(it => {
      html += '<tr>'
      html += `<td class="bold">${it.nombre}</td>`
      html += `<td class="right">${cant(it)}</td>`
      html += `<td class="right">${fmt(it.precio_unitario)}</td>`
      html += `<td class="right">${fmt(it.subtotal)}</td>`
      html += '</tr>'
    })
    html += '</tbody></table>'
    html += `<h2 class="h2 right" style="border:none;margin-top:16px">TOTAL: <span class="gold">${fmt(total)}</span></h2>`
    if (p.notas) html += `<div style="margin-top:14px;font-size:12px"><strong>Notas:</strong> ${p.notas}</div>`
    html += `<div class="footer">Presupuesto sin valor fiscal · Precios sujetos a confirmación · Carnicerías Fabricius · ${new Date().toLocaleString('es-AR')}</div>`
    abrirVentanaImprimible({ titulo: `Presupuesto ${p.cliente_nombre || ''} ${fechaTxt}`, contenidoHtml: html })
  }

  const productosBusqueda = busqueda.trim()
    ? precios.filter(p => p.nombre.toLowerCase().includes(busqueda.toLowerCase())).slice(0, 40)
    : []

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: tab === id ? 'var(--gold)' : 'var(--surface)', color: tab === id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 13 }}>
      {label}
    </button>
  )

  return (
    <div>
      <div className="page-title">PRESUPUESTOS</div>
      <div className="page-sub">Cotizá mercadería para un cliente y generá el PDF. No toca stock ni cuenta corriente.</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabBtn('nuevo', form.editandoId ? '✏️ Editando' : '➕ Nuevo presupuesto')}
        {tabBtn('historial', `📋 Historial${presupuestos.length ? ` (${presupuestos.length})` : ''}`)}
      </div>

      {msg && <div style={{ background: msg.includes('❌') ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${msg.includes('❌') ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: msg.includes('❌') ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>{msg}</div>}

      {tab === 'nuevo' && (
        <div>
          {/* Datos del cliente */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title">👤 Datos del presupuesto</div>
            <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : '2fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nombre del cliente</label>
                <input value={form.clienteNombre} onChange={e => setForm(f => ({ ...f, clienteNombre: e.target.value }))} placeholder="Ej: Rotisería La Esquina" style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Lista de precios</label>
                <select value={form.lista} onChange={e => setForm(f => ({ ...f, lista: e.target.value }))} style={inp}>
                  {Object.values(LISTAS).map(l => <option key={l.codigo} value={l.codigo}>{l.labelEmoji}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Válido hasta</label>
                <input type="date" value={form.validoHasta} onChange={e => setForm(f => ({ ...f, validoHasta: e.target.value }))} style={inp} />
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
              El precio de cada producto se autocompleta de la lista <strong>{getLista(form.lista).label}</strong>, pero lo podés editar para hacer un precio especial o descuento.
            </div>
          </div>

          {/* Adder de productos */}
          <div className="card" style={{ marginBottom: 20, borderColor: 'var(--gold)' }}>
            <div className="card-title">➕ Agregar producto</div>
            <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : '2.4fr 1fr 1fr 1.2fr auto', gap: 10, alignItems: 'end' }}>
              <div style={{ position: 'relative' }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Producto</label>
                <input
                  value={busqueda}
                  onChange={e => { setBusqueda(e.target.value); setMostrarDropdown(true); setProductoSel(null) }}
                  onFocus={() => setMostrarDropdown(true)}
                  placeholder="Buscar producto..."
                  style={{ ...inp, borderColor: productoSel ? 'var(--gold)' : 'var(--border)' }}
                />
                {mostrarDropdown && productosBusqueda.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 100, maxHeight: 240, overflowY: 'auto', marginTop: 2 }}>
                    {productosBusqueda.map(p => (
                      <div key={p.id} onClick={() => seleccionarProducto(p)}
                        style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 8 }}
                        onMouseOver={e => e.currentTarget.style.background = 'var(--surface2)'}
                        onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                        <span style={{ fontWeight: 600 }}>{p.nombre}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                          {CATEGORIAS[p.categoria] || p.categoria} · {fmt(precioSugerido(p, form.lista))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Cantidad</label>
                <input type="number" step="0.01" min="0" value={cantidad} onChange={e => setCantidad(e.target.value)} placeholder="0" style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Unidad</label>
                <select value={unidad} onChange={e => setUnidad(e.target.value)} style={inp}>
                  <option value="kg">kg</option>
                  <option value="unidad">unidad</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Precio unit.</label>
                <input type="number" step="0.01" min="0" value={precioInput} onChange={e => setPrecioInput(e.target.value)} placeholder="0" style={inp} />
              </div>
              <button onClick={agregarItem}
                style={{ padding: '10px 18px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap' }}>
                ➕ Agregar
              </button>
            </div>
          </div>

          {/* Detalle del presupuesto */}
          <div className="card">
            <div className="card-title">🧾 Detalle del presupuesto</div>
            {form.items.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>Todavía no agregaste productos. Buscá uno arriba, poné la cantidad y dale "Agregar".</p>
            ) : (
              <table>
                <thead><tr>
                  <th>Producto</th>
                  <th style={{ textAlign: 'right' }}>Cantidad</th>
                  <th style={{ textAlign: 'right' }}>Precio unit.</th>
                  <th style={{ textAlign: 'right' }}>Subtotal</th>
                  <th style={{ width: 60 }}></th>
                </tr></thead>
                <tbody>
                  {form.items.map((it, idx) => (
                    <tr key={idx}>
                      <td style={{ fontWeight: 500 }}>{it.nombre}</td>
                      <td style={{ textAlign: 'right' }}>{it.unidad === 'kg' ? fmtKg(it.cantidad) : fmtUnidades(it.cantidad)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--amber)' }}>{fmt(it.precio_unitario)}</td>
                      <td style={{ textAlign: 'right', fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: 'var(--gold)' }}>{fmt(it.subtotal)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button onClick={() => quitarItem(idx)} style={{ padding: '4px 10px', background: '#3a1a1a', color: '#ff6b6b', border: '1px solid #5a2a2a', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 700, marginRight: 14, alignSelf: 'center' }}>TOTAL</div>
              <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 34, color: 'var(--gold)', lineHeight: 1 }}>{fmt(totalForm)}</div>
            </div>

            <div style={{ marginTop: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Notas (opcional)</label>
              <textarea value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Ej: Entrega a coordinar · Precios sin IVA · etc." rows={2} style={{ ...inp, resize: 'vertical' }} />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button onClick={guardar} disabled={guardando}
                style={{ flex: 1, minWidth: 180, padding: '12px 0', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                {guardando ? 'Guardando...' : form.editandoId ? '💾 Guardar cambios' : '💾 Guardar presupuesto'}
              </button>
              <button onClick={() => generarPDF({ ...form, cliente_nombre: form.clienteNombre, lista_precios: form.lista, valido_hasta: form.validoHasta })}
                disabled={form.items.length === 0}
                style={{ padding: '12px 20px', background: form.items.length ? 'var(--surface2)' : 'var(--surface)', color: form.items.length ? 'var(--text)' : 'var(--muted)', border: '1px solid var(--gold)', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: form.items.length ? 'pointer' : 'not-allowed', fontFamily: "'DM Sans',sans-serif" }}>
                📄 Generar PDF
              </button>
              {(form.editandoId || form.items.length > 0 || form.clienteNombre) && (
                <button onClick={() => { setForm(FORM_VACIO()); setProductoSel(null); setBusqueda(''); setCantidad(''); setPrecioInput('') }}
                  style={{ padding: '12px 20px', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                  Limpiar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'historial' && (
        <div className="card">
          <div className="card-title">📋 Presupuestos guardados</div>
          {loading ? <p style={{ color: 'var(--muted)' }}>Cargando...</p> : presupuestos.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Todavía no guardaste ningún presupuesto.</p>
          ) : (
            <table>
              <thead><tr>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Lista</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr></thead>
              <tbody>
                {presupuestos.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {p.created_at ? new Date(p.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'}
                    </td>
                    <td style={{ fontWeight: 600 }}>{p.cliente_nombre}</td>
                    <td style={{ fontSize: 12 }}>{getLista(p.lista_precios).labelEmoji}</td>
                    <td style={{ textAlign: 'right', fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: 'var(--gold)' }}>{fmt(p.total)}</td>
                    <td>
                      <select value={p.estado} onChange={e => cambiarEstado(p.id, e.target.value)}
                        style={{ ...inp, width: 'auto', padding: '5px 8px', fontSize: 12, color: (ESTADOS[p.estado] || {}).color }}>
                        {Object.entries(ESTADOS).map(([id, e]) => <option key={id} value={id}>{e.label}</option>)}
                      </select>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button onClick={() => generarPDF(p)} title="Generar PDF" style={{ padding: '4px 10px', background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--gold)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>📄 PDF</button>
                        <button onClick={() => editar(p)} title="Editar" style={{ padding: '4px 10px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>✏️</button>
                        <button onClick={() => eliminar(p.id)} title="Eliminar" style={{ padding: '4px 10px', background: '#3a1a1a', color: '#ff6b6b', border: '1px solid #5a2a2a', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
