// Pedidos.jsx - Panel de admin para gestionar pedidos online
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const fmt = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR')
const ahora = () => new Date().toISOString()

const ESTADO_INFO = {
  pendiente:  { label: '🟡 Pendiente',   color: 'var(--amber)' },
  confirmado: { label: '🟢 Confirmado',  color: 'var(--green)' },
  rechazado:  { label: '🔴 Rechazado',   color: 'var(--red-light)' },
  cancelado:  { label: '⚫ Cancelado',    color: 'var(--muted)' },
}

export function Pedidos() {
  const { profile } = useAuth()
  const [pedidos, setPedidos] = useState([])
  const [pedidoAbierto, setPedidoAbierto] = useState(null)
  const [filtro, setFiltro] = useState('pendiente')
  const [loading, setLoading] = useState(true)
  const [editingItems, setEditingItems] = useState(null)  // copia editable cuando admin modifica
  const [editingDia, setEditingDia] = useState('')
  const [editingHorario, setEditingHorario] = useState('')
  const [editingNotaAdmin, setEditingNotaAdmin] = useState('')

  useEffect(() => {
    cargar()
    const canal = supabase.channel('pedidos-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => cargar())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [])

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('pedidos').select('*').order('created_at', { ascending: false })
    setPedidos(data || [])
    setLoading(false)
  }

  function abrirDetalle(p) {
    if (pedidoAbierto === p.id) { setPedidoAbierto(null); return }
    setPedidoAbierto(p.id)
    setEditingItems(JSON.parse(JSON.stringify(p.items || [])))
    setEditingDia(p.dia_entrega || '')
    setEditingHorario(p.horario_entrega || '')
    setEditingNotaAdmin(p.notas_admin || '')
  }

  function actualizarItemKg(idx, kg) {
    setEditingItems(items => items.map((it, i) => i === idx ? { ...it, kg: parseFloat(kg) || 0, subtotal: (parseFloat(kg) || 0) * it.precio_unitario } : it))
  }

  function quitarItemEdit(idx) {
    setEditingItems(items => items.filter((_, i) => i !== idx))
  }

  async function confirmarPedido(pedido) {
    const items = editingItems
    const total = items.reduce((s, i) => s + (i.subtotal || 0), 0)
    const huboCambios =
      JSON.stringify(items) !== JSON.stringify(pedido.items) ||
      editingDia !== pedido.dia_entrega ||
      editingHorario !== pedido.horario_entrega
    const chatActualizado = [...(pedido.mensajes_chat || []), {
      timestamp: ahora(),
      autor: 'admin',
      texto: huboCambios
        ? `✅ Pedido confirmado con ajustes por ${profile?.nombre || 'Admin'}.`
        : `✅ Pedido confirmado por ${profile?.nombre || 'Admin'}.`
    }]
    const update = {
      estado: 'confirmado',
      items,
      total_estimado: total,
      dia_entrega: editingDia || pedido.dia_entrega,
      horario_entrega: editingHorario || pedido.horario_entrega,
      notas_admin: editingNotaAdmin.trim() || null,
      editado_por_admin: huboCambios,
      confirmado_por: profile?.nombre || 'Admin',
      confirmado_en: ahora(),
      mensajes_chat: chatActualizado,
    }
    const { error } = await supabase.from('pedidos').update(update).eq('id', pedido.id)
    if (error) { alert('❌ Error: ' + error.message); return }
    setPedidoAbierto(null)
    cargar()
  }

  async function rechazarPedido(pedido) {
    const motivo = prompt('Motivo del rechazo (lo va a ver el cliente):')
    if (!motivo) return
    const chatActualizado = [...(pedido.mensajes_chat || []), {
      timestamp: ahora(),
      autor: 'admin',
      texto: `❌ Pedido rechazado por ${profile?.nombre || 'Admin'}. Motivo: ${motivo}`
    }]
    const { error } = await supabase.from('pedidos').update({
      estado: 'rechazado',
      rechazado_motivo: motivo,
      mensajes_chat: chatActualizado,
    }).eq('id', pedido.id)
    if (error) { alert('❌ Error: ' + error.message); return }
    setPedidoAbierto(null)
    cargar()
  }

  const pedidosFiltrados = pedidos.filter(p => filtro === 'todos' || p.estado === filtro)
  const cantPorEstado = {
    pendiente: pedidos.filter(p => p.estado === 'pendiente').length,
    confirmado: pedidos.filter(p => p.estado === 'confirmado').length,
    rechazado: pedidos.filter(p => p.estado === 'rechazado').length,
    cancelado: pedidos.filter(p => p.estado === 'cancelado').length,
  }

  return (
    <div>
      <div className="page-title">📥 PEDIDOS ONLINE</div>
      <div className="page-sub">Pedidos recibidos desde los portales de clientes mayoristas</div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {['pendiente', 'confirmado', 'rechazado', 'cancelado', 'todos'].map(e => {
          const info = ESTADO_INFO[e] || { label: 'Todos', color: 'var(--gold)' }
          const count = e === 'todos' ? pedidos.length : (cantPorEstado[e] || 0)
          return (
            <button key={e} onClick={() => setFiltro(e)}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: filtro === e ? info.color : 'transparent', color: filtro === e ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
              {e === 'todos' ? `📋 Todos (${count})` : `${info.label} (${count})`}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Cargando pedidos...</div>
      ) : pedidosFiltrados.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>Sin pedidos en este estado</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {pedidosFiltrados.map(p => {
            const info = ESTADO_INFO[p.estado] || ESTADO_INFO.pendiente
            const abierto = pedidoAbierto === p.id
            return (
              <div key={p.id} className="card" style={{ borderColor: info.color }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 250 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                      <span style={{ background: info.color, color: '#000', borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>{info.label}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--gold)' }}>{p.cliente_nombre}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {new Date(p.created_at).toLocaleString('es-AR')}</span>
                    </div>
                    <div style={{ fontSize: 13 }}>📅 Para el <strong>{p.dia_entrega}</strong> — 🕐 {p.horario_entrega}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{(p.items || []).length} producto(s) · Total: <strong style={{ color: 'var(--gold)' }}>{fmt(p.total_estimado)}</strong></div>
                  </div>
                  <button onClick={() => abrirDetalle(p)} className="btn btn-ghost btn-sm">
                    {abierto ? '▲ Cerrar' : '▼ Abrir'}
                  </button>
                </div>

                {abierto && (
                  <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      {/* Items editables */}
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>📦 Productos {p.estado === 'pendiente' && '(editable)'}</div>
                        <table style={{ width: '100%', fontSize: 12 }}>
                          <thead><tr><th>Producto</th><th>Kg</th><th>Precio/kg</th><th>Subtotal</th><th></th></tr></thead>
                          <tbody>
                            {(editingItems || p.items || []).map((it, i) => (
                              <tr key={i}>
                                <td>{it.nombre}</td>
                                <td>
                                  {p.estado === 'pendiente' ? (
                                    <input type="number" step="0.1" value={it.kg} onChange={e => actualizarItemKg(i, e.target.value)}
                                      style={{ background: 'var(--surface2)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 4, padding: '2px 6px', fontSize: 12, width: 60, textAlign: 'center' }} />
                                  ) : (
                                    <span>{it.kg} kg</span>
                                  )}
                                </td>
                                <td>{fmt(it.precio_unitario)}</td>
                                <td style={{ color: 'var(--gold)', fontWeight: 600 }}>{fmt(it.subtotal)}</td>
                                <td>
                                  {p.estado === 'pendiente' && (
                                    <button onClick={() => quitarItemEdit(i)} style={{ background: 'none', border: 'none', color: 'var(--red-light)', cursor: 'pointer' }}>🗑️</button>
                                  )}
                                </td>
                              </tr>
                            ))}
                            <tr style={{ borderTop: '1px solid var(--gold)' }}>
                              <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>TOTAL</td>
                              <td style={{ color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>
                                {fmt((editingItems || p.items || []).reduce((s, i) => s + (i.subtotal || 0), 0))}
                              </td>
                              <td></td>
                            </tr>
                          </tbody>
                        </table>

                        {p.estado === 'pendiente' && (
                          <div style={{ marginTop: 14 }}>
                            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>📅 Día de entrega</label>
                            <input type="date" value={editingDia} onChange={e => setEditingDia(e.target.value)}
                              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 13, marginBottom: 8 }} />
                            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🕐 Horario</label>
                            <input type="text" value={editingHorario} onChange={e => setEditingHorario(e.target.value)}
                              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box', marginBottom: 8 }} />
                            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>💬 Nota para el cliente (opcional)</label>
                            <textarea value={editingNotaAdmin} onChange={e => setEditingNotaAdmin(e.target.value)} rows={2}
                              placeholder="Ej: 'No tenemos vacío, te puse cuadril a precio similar'"
                              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 12, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                          </div>
                        )}

                        {p.notas_cliente && (
                          <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px', marginTop: 10, fontSize: 12 }}>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>📝 Nota del cliente</div>
                            <div>{p.notas_cliente}</div>
                          </div>
                        )}
                        {p.rechazado_motivo && (
                          <div style={{ background: '#3a1a1a', border: '1px solid var(--red-light)', borderRadius: 8, padding: '8px 12px', marginTop: 10, fontSize: 12 }}>
                            <div style={{ fontSize: 10, color: 'var(--red-light)' }}>Motivo de rechazo</div>
                            <div>{p.rechazado_motivo}</div>
                          </div>
                        )}

                        {p.estado === 'pendiente' && (
                          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                            <button onClick={() => confirmarPedido(p)} className="btn btn-gold" style={{ flex: 1 }}>✅ Confirmar pedido</button>
                            <button onClick={() => rechazarPedido(p)}
                              style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--red-light)' }}>❌ Rechazar</button>
                          </div>
                        )}
                      </div>

                      {/* Chat */}
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>💬 Conversación del chat</div>
                        <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 10, maxHeight: 400, overflowY: 'auto' }}>
                          {(p.mensajes_chat || []).map((m, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: m.autor === 'bot' ? 'flex-start' : m.autor === 'cliente' ? 'flex-end' : 'center', marginBottom: 6 }}>
                              <div style={{
                                background: m.autor === 'bot' ? 'var(--surface)' : m.autor === 'admin' ? 'var(--amber)' : 'var(--gold)',
                                color: m.autor === 'bot' ? 'var(--text)' : '#000',
                                borderRadius: 10,
                                padding: '6px 12px',
                                maxWidth: '85%',
                                fontSize: 12,
                              }}>
                                {m.autor === 'bot' && <div style={{ fontSize: 9, opacity: 0.7 }}>🤖 Bot</div>}
                                {m.autor === 'admin' && <div style={{ fontSize: 9, opacity: 0.7 }}>👤 Admin</div>}
                                {m.autor === 'cliente' && <div style={{ fontSize: 9, opacity: 0.7 }}>👤 Cliente</div>}
                                {m.texto}
                              </div>
                            </div>
                          ))}
                        </div>
                        {p.confirmado_por && (
                          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
                            ✅ Confirmado por <strong>{p.confirmado_por}</strong> el {new Date(p.confirmado_en).toLocaleString('es-AR')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default Pedidos
