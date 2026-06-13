// ============================================================
// CAJAS — Historial individual de cajas CB / PT
// ============================================================
// Espejo de la pestaña "Piezas" pero para las cajas bovinas trackeadas
// individualmente en la tabla `cajas_stock`. Permite:
//   - Ver el stock real (cajas disponibles) con su peso individual
//   - Ver las cajas vendidas: a qué cliente, cuándo, por cuánto
//   - Filtrar por tipo (CB/PT), estado (disponible/vendida) y producto
//   - Re-asignar producto a cajas legacy sin vincular (para que aparezcan
//     en el selector al venderse)
// ============================================================
import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import Paginador, { usePaginacion } from '../../components/Paginador'
import { fmtPrecio, fmtKg } from '../../lib/formatos'

const fmt$ = n => fmtPrecio(Math.abs(Number(n) || 0))

export default function CajasTab() {
  const [cajas, setCajas] = useState([])
  const [productos, setProductos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroTipo, setFiltroTipo] = useState('todos')          // 'todos' | 'CB' | 'PT'
  const [filtroEstado, setFiltroEstado] = useState('disponible') // 'todos' | 'disponible' | 'vendida'
  const [filtroProducto, setFiltroProducto] = useState('todos')  // 'todos' | productoId | 'sin_asignar'
  const [editandoProducto, setEditandoProducto] = useState(null) // caja en edicion de producto_id
  const [msg, setMsg] = useState(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const [{ data: cjs }, { data: prods }] = await Promise.all([
      supabase.from('cajas_stock').select('*')
        .order('estado', { ascending: true })   // disponibles primero
        .order('fecha_ingreso', { ascending: false }),
      supabase.from('precios').select('id, nombre, categoria')
        .in('categoria', ['bovino_caja_cb', 'bovino_caja_pt'])
        .order('nombre'),
    ])
    setCajas(cjs || [])
    setProductos(prods || [])
    setLoading(false)
  }

  function showMsg(texto, tipo = 'success', ms = 3500) {
    setMsg({ texto, tipo })
    setTimeout(() => setMsg(null), ms)
  }

  async function asignarProducto(cajaId, productoId) {
    const { error } = await supabase.from('cajas_stock').update({
      producto_id: productoId || null,
      updated_at: new Date().toISOString(),
    }).eq('id', cajaId)
    if (error) { showMsg('Error: ' + error.message, 'error'); return }
    setEditandoProducto(null)
    showMsg('✅ Producto asignado a la caja')
    cargar()
  }

  const productoNombre = (id) => {
    if (!id) return null
    return productos.find(p => p.id === id)?.nombre || '— (producto borrado)'
  }

  // Aplicar filtros
  const cajasFiltradas = useMemo(() => {
    return cajas.filter(c => {
      if (filtroTipo !== 'todos' && c.tipo_caja !== filtroTipo) return false
      if (filtroEstado !== 'todos' && c.estado !== filtroEstado) return false
      if (filtroProducto === 'sin_asignar' && c.producto_id) return false
      if (filtroProducto !== 'todos' && filtroProducto !== 'sin_asignar' && c.producto_id !== filtroProducto) return false
      return true
    })
  }, [cajas, filtroTipo, filtroEstado, filtroProducto])

  // Totales y stats
  const stats = useMemo(() => {
    const dispCB = cajas.filter(c => c.estado === 'disponible' && c.tipo_caja === 'CB')
    const dispPT = cajas.filter(c => c.estado === 'disponible' && c.tipo_caja === 'PT')
    const sinAsignar = cajas.filter(c => c.estado === 'disponible' && !c.producto_id).length
    return {
      cantCB: dispCB.length,
      kgCB: dispCB.reduce((s, c) => s + Number(c.kg || 0), 0),
      cantPT: dispPT.length,
      kgPT: dispPT.reduce((s, c) => s + Number(c.kg || 0), 0),
      sinAsignar,
    }
  }, [cajas])

  const pag = usePaginacion(cajasFiltradas, 20)

  return (
    <div>
      {msg && (
        <div style={{
          background: msg.tipo === 'error' ? '#3a1a1a' : '#1a2a1a',
          border: `1px solid ${msg.tipo === 'error' ? '#5a2a2a' : '#2d5a2d'}`,
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          color: msg.tipo === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600,
        }}>{msg.texto}</div>
      )}

      {/* Tarjetas resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div className="stat" style={{ borderColor: '#7db5ff' }}>
          <div className="stat-label">📦 Cajas CB disponibles</div>
          <div className="stat-value" style={{ color: '#7db5ff' }}>{stats.cantCB}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtKg(stats.kgCB)}</div>
        </div>
        <div className="stat" style={{ borderColor: '#ffd17a' }}>
          <div className="stat-label">📦 Cajas PT disponibles</div>
          <div className="stat-value" style={{ color: '#ffd17a' }}>{stats.cantPT}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtKg(stats.kgPT)}</div>
        </div>
        {stats.sinAsignar > 0 && (
          <div className="stat" style={{ borderColor: '#ff8b8b' }}>
            <div className="stat-label">⚠️ Sin producto asignado</div>
            <div className="stat-value" style={{ color: '#ff8b8b' }}>{stats.sinAsignar}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>asignalas abajo</div>
          </div>
        )}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 11, color: 'var(--muted)' }}>Tipo:</label>
        {['todos', 'CB', 'PT'].map(t => (
          <button key={t} onClick={() => setFiltroTipo(t)}
            style={{
              padding: '6px 12px', borderRadius: 6,
              border: `1px solid ${filtroTipo === t ? 'var(--gold)' : 'var(--border)'}`,
              background: filtroTipo === t ? 'var(--gold)' : 'transparent',
              color: filtroTipo === t ? '#000' : 'var(--muted)',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>{t === 'todos' ? 'Todos' : t}</button>
        ))}
        <span style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <label style={{ fontSize: 11, color: 'var(--muted)' }}>Estado:</label>
        {[
          { id: 'disponible', label: '📦 Disponibles' },
          { id: 'vendida', label: '✅ Vendidas' },
          { id: 'todos', label: 'Todas' },
        ].map(e => (
          <button key={e.id} onClick={() => setFiltroEstado(e.id)}
            style={{
              padding: '6px 12px', borderRadius: 6,
              border: `1px solid ${filtroEstado === e.id ? 'var(--gold)' : 'var(--border)'}`,
              background: filtroEstado === e.id ? 'var(--gold)' : 'transparent',
              color: filtroEstado === e.id ? '#000' : 'var(--muted)',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>{e.label}</button>
        ))}
        <span style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <label style={{ fontSize: 11, color: 'var(--muted)' }}>Producto:</label>
        <select value={filtroProducto} onChange={e => setFiltroProducto(e.target.value)}
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '5px 10px', fontSize: 12 }}>
          <option value="todos">Todos</option>
          <option value="sin_asignar">⚠️ Sin asignar</option>
          {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <button onClick={cargar} style={{ marginLeft: 'auto', padding: '6px 12px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
          🔄 Recargar
        </button>
      </div>

      {loading && <p style={{ color: 'var(--muted)' }}>Cargando cajas...</p>}

      {!loading && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, minWidth: 900 }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>#</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Tipo</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Kg</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Producto</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Fecha ingreso</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Proveedor</th>
                  <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Estado</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Cliente / Salida</th>
                </tr>
              </thead>
              <tbody>
                {pag.items.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                    Sin cajas para los filtros seleccionados
                  </td></tr>
                )}
                {pag.items.map(c => {
                  const estadoColor = c.estado === 'disponible' ? '#7dff7d' : c.estado === 'vendida' ? 'var(--muted)' : '#ff8b8b'
                  return (
                    <tr key={c.id} style={{ borderTop: '1px solid var(--border)', opacity: c.estado === 'vendida' ? 0.7 : 1 }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)' }}>#{c.id}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ background: c.tipo_caja === 'CB' ? '#1a2a3a' : '#2a2010', color: c.tipo_caja === 'CB' ? '#7db5ff' : '#ffd17a', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>{c.tipo_caja}</span>
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px 12px', fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: 'var(--gold)' }}>
                        {fmtKg(Number(c.kg || 0))}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {editandoProducto === c.id ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <select id={`prod-${c.id}`} defaultValue={c.producto_id || ''}
                              style={{ background: 'var(--surface)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
                              <option value="">— Sin asignar —</option>
                              {productos.filter(p => p.categoria === `bovino_caja_${c.tipo_caja.toLowerCase()}`).map(p => (
                                <option key={p.id} value={p.id}>{p.nombre}</option>
                              ))}
                            </select>
                            <button onClick={() => {
                              const sel = document.getElementById(`prod-${c.id}`)
                              asignarProducto(c.id, sel.value)
                            }} style={{ background: 'var(--gold)', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#000' }}>💾</button>
                            <button onClick={() => setEditandoProducto(null)}
                              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 11 }}>✕</button>
                          </div>
                        ) : (
                          <>
                            {c.producto_id ? (
                              <span style={{ fontSize: 12 }}>{productoNombre(c.producto_id)}</span>
                            ) : (
                              <span style={{ fontSize: 11, color: '#ff8b8b', fontStyle: 'italic' }}>⚠️ sin asignar</span>
                            )}
                            <button onClick={() => setEditandoProducto(c.id)}
                              style={{ marginLeft: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 10 }}>✏️</button>
                          </>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 12 }}>{c.fecha_ingreso || '—'}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--muted)' }}>{c.proveedor_origen || '—'}</td>
                      <td style={{ textAlign: 'center', padding: '8px 12px' }}>
                        <span style={{ fontSize: 11, color: estadoColor, fontWeight: 700 }}>
                          {c.estado === 'disponible' ? '📦 DISP' : c.estado === 'vendida' ? '✅ VEND' : c.estado.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 12 }}>
                        {c.estado === 'vendida' ? (
                          <div>
                            <div>{c.cliente_nombre || '—'}</div>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                              {c.fecha_salida || ''}{c.total_venta > 0 ? ` · ${fmt$(c.total_venta)}` : ''}
                            </div>
                          </div>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '0 12px 12px' }}>
            <Paginador {...pag.controles} label="cajas" />
          </div>
        </div>
      )}
    </div>
  )
}
