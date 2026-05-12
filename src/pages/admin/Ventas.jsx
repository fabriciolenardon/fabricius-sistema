import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const fmt = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR')
const CATEGORIAS = {
  bovino_corte: '🥩 Bovino Cortes',
  bovino_pieza: '🍖 Piezas',
  bovino_brosa: '🫀 Brosa',
  cerdo: '🐷 Cerdo',
  pollo: '🍗 Pollo',
  embutido: '🌭 Embutidos',
}

export default function Ventas() {
  const [tab, setTab] = useState('nueva')
  const [ventas, setVentas] = useState([])
  const [ventasHoy, setVentasHoy] = useState([])
  const [precios, setPrecios] = useState([])
  const [form, setForm] = useState({
    fecha: new Date().toISOString().split('T')[0],
    turno: 'mañana',
    efectivo: '',
    debito: '',
    transferencia: '',
    notas: ''
  })
  const [items, setItems] = useState([])
  const [categoria, setCategoria] = useState('')
  const [productoId, setProductoId] = useState('')
  const [kg, setKg] = useState('')
  const [precio, setPrecio] = useState('')
  const [msg, setMsg] = useState(null)
  const hoy = new Date().toISOString().split('T')[0]

  useEffect(() => {
    cargarVentas()
    supabase.from('precios').select('*').order('nombre').then(({ data }) => setPrecios(data || []))
  }, [])

  async function cargarVentas() {
    const { data } = await supabase.from('ventas_minoristas').select('*').order('fecha', { ascending: false }).limit(50)
    setVentas(data || [])
    setVentasHoy((data || []).filter(v => v.fecha === hoy))
  }

  function showMsg(texto, type = 'success') { setMsg({ texto, type }); setTimeout(() => setMsg(null), 3000) }

  const productosFiltrados = precios.filter(p => p.categoria === categoria)

  function onProductoChange(id) {
    const prod = precios.find(p => p.id === id)
    setProductoId(id)
    setPrecio(prod?.precio_minorista || prod?.precio_carniceria || '')
  }

  function agregarItem() {
    if (!productoId || !kg) { showMsg('Seleccioná producto y kg', 'error'); return }
    const prod = precios.find(p => p.id === productoId)
    setItems(prev => [...prev, {
      descripcion: prod?.nombre || '',
      categoria,
      kg: parseFloat(kg),
      precio: parseFloat(precio),
      importe: parseFloat(kg) * parseFloat(precio)
    }])
    setKg(''); setProductoId(''); setPrecio(''); setCategoria('')
  }

  function quitarItem(idx) { setItems(prev => prev.filter((_, i) => i !== idx)) }

  const totalItems = items.reduce((s, i) => s + i.importe, 0)
  const totalCobrado = (parseFloat(form.efectivo) || 0) + (parseFloat(form.debito) || 0) + (parseFloat(form.transferencia) || 0)

  async function guardarVenta() {
    if (items.length === 0) { showMsg('Agregá al menos un producto', 'error'); return }
    const total = totalItems
    await supabase.from('ventas_minoristas').insert({
      fecha: form.fecha, turno: form.turno, items, total,
      efectivo: parseFloat(form.efectivo) || 0,
      debito: parseFloat(form.debito) || 0,
      transferencia: parseFloat(form.transferencia) || 0,
      notas: form.notas
    })
    for (const item of items) {
      const tipoStock = item.categoria === 'bovino_pieza' ? 'bovino_pieza' :
                        item.categoria === 'bovino_brosa' ? 'bovino_brosa' :
                        item.categoria === 'cerdo' ? 'cerdo' :
                        item.categoria === 'pollo' ? 'pollo' :
                        item.categoria === 'embutido' ? 'embutido' : 'bovino_corte'
      const { data: stock } = await supabase.from('stock_actual').select('*').eq('tipo', tipoStock).maybeSingle()
      if (stock) await supabase.from('stock_actual').update({ kg_disponible: (stock.kg_disponible || 0) - item.kg }).eq('tipo', tipoStock)
    }
    showMsg('✅ Venta registrada')
    setItems([])
    setForm({ fecha: new Date().toISOString().split('T')[0], turno: 'mañana', efectivo: '', debito: '', transferencia: '', notas: '' })
    cargarVentas()
  }

  async function eliminarVenta(v) {
    if (!confirm(`¿Eliminar venta de ${fmt(v.total)} del ${v.fecha}?`)) return
    await supabase.from('ventas_minoristas').delete().eq('id', v.id)
    for (const item of (v.items || [])) {
      const tipoStock = item.categoria === 'bovino_pieza' ? 'bovino_pieza' :
                        item.categoria === 'bovino_brosa' ? 'bovino_brosa' :
                        item.categoria === 'cerdo' ? 'cerdo' :
                        item.categoria === 'pollo' ? 'pollo' :
                        item.categoria === 'embutido' ? 'embutido' : 'bovino_corte'
      const { data: stock } = await supabase.from('stock_actual').select('*').eq('tipo', tipoStock).maybeSingle()
      if (stock) await supabase.from('stock_actual').update({ kg_disponible: (stock.kg_disponible || 0) + item.kg }).eq('tipo', tipoStock)
    }
    showMsg('🗑️ Venta eliminada y stock revertido')
    cargarVentas()
  }

  // Resumen del día
  const totalHoy = ventasHoy.reduce((s, v) => s + (v.total || 0), 0)
  const efectivoHoy = ventasHoy.reduce((s, v) => s + (v.efectivo || 0), 0)
  const debitoHoy = ventasHoy.reduce((s, v) => s + (v.debito || 0), 0)
  const transferenciaHoy = ventasHoy.reduce((s, v) => s + (v.transferencia || 0), 0)

  // Productos más vendidos hoy
  const productosHoy = {}
  ventasHoy.forEach(v => (v.items || []).forEach(item => {
    if (!productosHoy[item.descripcion]) productosHoy[item.descripcion] = { kg: 0, importe: 0 }
    productosHoy[item.descripcion].kg += item.kg
    productosHoy[item.descripcion].importe += item.importe
  }))
  const rankingHoy = Object.entries(productosHoy).sort((a, b) => b[1].importe - a[1].importe)

  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, width: '100%', boxSizing: 'border-box' }

  return (
    <div>
      <div className="page-title">VENTAS</div>
      <div className="page-sub">Registro de ventas minoristas diarias</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { id: 'resumen', label: '📊 Resumen del día' },
          { id: 'nueva', label: '➕ Nueva venta' },
          { id: 'historial', label: '📋 Historial' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${tab === t.id ? 'var(--amber)' : 'var(--border)'}`, background: tab === t.id ? 'var(--amber)' : 'transparent', color: tab === t.id ? '#fff' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
            {t.label}
          </button>
        ))}
      </div>

      {msg && <div style={{ background: msg.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${msg.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: msg.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>{msg.texto}</div>}

      {tab === 'resumen' && (
        <div>
          <div style={{ background: 'linear-gradient(135deg,#1a1408,#0a0a08)', border: '1px solid var(--gold)', borderRadius: 16, padding: 24, marginBottom: 20 }}>
            <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 28, color: 'var(--gold)', marginBottom: 4 }}>📊 RESUMEN DE HOY — {hoy}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginTop: 16 }}>
              <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>TOTAL VENDIDO</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 32, color: 'var(--gold)' }}>{fmt(totalHoy)}</div>
              </div>
              <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>💵 EFECTIVO</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 32, color: 'var(--green)' }}>{fmt(efectivoHoy)}</div>
              </div>
              <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>💳 DÉBITO</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 32, color: 'var(--amber)' }}>{fmt(debitoHoy)}</div>
              </div>
              <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>📲 TRANSFERENCIA</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 32, color: 'var(--amber)' }}>{fmt(transferenciaHoy)}</div>
              </div>
            </div>
          </div>

          {rankingHoy.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">🥩 Productos más vendidos hoy</div>
              <table>
                <thead><tr><th>Producto</th><th>Kg vendidos</th><th>Importe</th></tr></thead>
                <tbody>
                  {rankingHoy.map(([nombre, data]) => (
                    <tr key={nombre}>
                      <td style={{ fontWeight: 600 }}>{nombre}</td>
                      <td style={{ color: 'var(--amber)' }}>{data.kg.toFixed(1)} kg</td>
                      <td style={{ color: 'var(--gold)', fontWeight: 600 }}>{fmt(data.importe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {ventasHoy.length === 0 && (
            <div className="card">
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Sin ventas registradas hoy</div>
            </div>
          )}
        </div>
      )}

      {tab === 'nueva' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">📅 Datos de la venta</div>
            <div className="form-row">
              <div className="form-group"><label>Fecha</label>
                <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} style={inp} />
              </div>
              <div className="form-group"><label>Turno</label>
                <select value={form.turno} onChange={e => setForm(f => ({ ...f, turno: e.target.value }))} style={inp}>
                  <option value="mañana">🌅 Mañana</option>
                  <option value="tarde">🌆 Tarde</option>
                  <option value="completo">🌟 Día completo</option>
                </select>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">🥩 Agregar productos</div>
            <div className="form-row">
              <div className="form-group"><label>Categoría</label>
                <select value={categoria} onChange={e => { setCategoria(e.target.value); setProductoId(''); setPrecio('') }} style={inp}>
                  <option value="">— Seleccioná —</option>
                  {Object.entries(CATEGORIAS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
              <div className="form-group"><label>Producto</label>
                <select value={productoId} onChange={e => onProductoChange(e.target.value)} disabled={!categoria} style={inp}>
                  <option value="">— Seleccioná —</option>
                  {productosFiltrados.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Kg</label>
                <input type="number" step="0.1" placeholder="0" value={kg} onChange={e => setKg(e.target.value)} style={inp} />
              </div>
              <div className="form-group"><label>Precio/kg</label>
                <input type="number" value={precio} onChange={e => setPrecio(e.target.value)} style={{ ...inp, borderColor: 'var(--gold)' }} />
              </div>
            </div>
            <button className="btn btn-ghost" onClick={agregarItem}>➕ Agregar producto</button>

            {items.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <table>
                  <thead><tr><th>Producto</th><th>Kg</th><th>Precio/kg</th><th>Importe</th><th></th></tr></thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={i}>
                        <td>{item.descripcion}</td>
                        <td>{item.kg} kg</td>
                        <td>{fmt(item.precio)}</td>
                        <td style={{ color: 'var(--gold)', fontWeight: 600 }}>{fmt(item.importe)}</td>
                        <td><button onClick={() => quitarItem(i)} style={{ background: 'none', border: 'none', color: 'var(--red-light)', cursor: 'pointer' }}>🗑️</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ textAlign: 'right', fontFamily: "'Bebas Neue',cursive", fontSize: 28, color: 'var(--gold)', marginTop: 8 }}>
                  TOTAL: {fmt(totalItems)}
                </div>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">💵 Formas de cobro</div>
            <div className="form-row">
              <div className="form-group"><label>💵 Efectivo ($)</label>
                <input type="number" placeholder="0" value={form.efectivo} onChange={e => setForm(f => ({ ...f, efectivo: e.target.value }))} style={inp} />
              </div>
              <div className="form-group"><label>💳 Débito ($)</label>
                <input type="number" placeholder="0" value={form.debito} onChange={e => setForm(f => ({ ...f, debito: e.target.value }))} style={inp} />
              </div>
              <div className="form-group"><label>📲 Transferencia ($)</label>
                <input type="number" placeholder="0" value={form.transferencia} onChange={e => setForm(f => ({ ...f, transferencia: e.target.value }))} style={inp} />
              </div>
            </div>
            {totalCobrado > 0 && (
              <div style={{ display: 'flex', gap: 20, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 13 }}><span style={{ color: 'var(--muted)' }}>Total productos: </span><strong style={{ color: 'var(--gold)' }}>{fmt(totalItems)}</strong></div>
                <div style={{ fontSize: 13 }}><span style={{ color: 'var(--muted)' }}>Total cobrado: </span><strong style={{ color: totalCobrado >= totalItems ? 'var(--green)' : 'var(--red-light)' }}>{fmt(totalCobrado)}</strong></div>
                {totalCobrado > totalItems && <div style={{ fontSize: 13 }}><span style={{ color: 'var(--muted)' }}>Vuelto: </span><strong style={{ color: 'var(--amber)' }}>{fmt(totalCobrado - totalItems)}</strong></div>}
              </div>
            )}
            <div className="form-group" style={{ marginBottom: 12 }}><label>Notas</label>
              <input placeholder="Observaciones..." value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} style={inp} />
            </div>
            <button className="btn btn-gold" onClick={guardarVenta}>✅ Registrar venta</button>
          </div>
        </div>
      )}

      {tab === 'historial' && (
        <div className="card">
          <div className="card-title">📋 Historial de ventas</div>
          <table>
            <thead><tr><th>Fecha</th><th>Turno</th><th>Total</th><th>Efectivo</th><th>Débito</th><th>Transf.</th><th>Productos</th><th></th></tr></thead>
            <tbody>
              {ventas.map(v => (
                <tr key={v.id}>
                  <td>{v.fecha}</td>
                  <td><span style={{ background: 'var(--surface2)', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>{v.turno}</span></td>
                  <td style={{ color: 'var(--gold)', fontWeight: 700, fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(v.total)}</td>
                  <td style={{ color: 'var(--green)' }}>{v.efectivo > 0 ? fmt(v.efectivo) : '—'}</td>
                  <td style={{ color: 'var(--amber)' }}>{v.debito > 0 ? fmt(v.debito) : '—'}</td>
                  <td style={{ color: 'var(--amber)' }}>{v.transferencia > 0 ? fmt(v.transferencia) : '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--muted)' }}>{(v.items || []).map(i => `${i.descripcion} ${i.kg}kg`).join(' · ')}</td>
                  <td><button onClick={() => eliminarVenta(v)} style={{ background: 'none', border: 'none', color: 'var(--red-light)', cursor: 'pointer', fontSize: 16 }}>🗑️</button></td>
                </tr>
              ))}
              {ventas.length === 0 && <tr><td colSpan={8} className="empty">Sin ventas registradas</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}