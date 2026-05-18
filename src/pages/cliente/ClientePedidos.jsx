// ClientePedidos.jsx - Historial de pedidos del cliente
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const fmt = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR')

const ESTADO_INFO = {
  pendiente:  { label: '🟡 Pendiente',   color: 'var(--amber)',     bg: '#2a2410' },
  confirmado: { label: '🟢 Confirmado',  color: 'var(--green)',     bg: '#1a3a1a' },
  rechazado:  { label: '🔴 Rechazado',   color: 'var(--red-light)', bg: '#3a1a1a' },
  cancelado:  { label: '⚫ Cancelado',    color: 'var(--muted)',     bg: 'var(--surface2)' },
}

export default function ClientePedidos() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [pedidos, setPedidos] = useState([])
  const [pedidoAbierto, setPedidoAbierto] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.cliente_id) { setLoading(false); return }
    cargar()
    const canal = supabase.channel('pedidos-cliente')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `cliente_id=eq.${profile.cliente_id}` }, () => cargar())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [profile?.cliente_id])

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('pedidos').select('*').eq('cliente_id', profile.cliente_id).order('created_at', { ascending: false })
    setPedidos(data || [])
    setLoading(false)
  }

  async function cancelarPedido(pedido) {
    if (!confirm(`¿Cancelar el pedido del ${pedido.dia_entrega}?`)) return
    const { error } = await supabase.from('pedidos').update({ estado: 'cancelado' }).eq('id', pedido.id)
    if (error) { alert('❌ Error: ' + error.message); return }
    cargar()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
        <div>
          <div className="page-title">📋 MIS PEDIDOS</div>
          <div className="page-sub">Historial de pedidos realizados desde tu portal</div>
        </div>
        <button onClick={() => navigate('/cliente/nuevo-pedido')} className="btn btn-gold">📥 Nuevo pedido</button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Cargando...</div>
      ) : pedidos.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 30 }}>
          <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 10 }}>Todavía no hiciste pedidos.</div>
          <button onClick={() => navigate('/cliente/nuevo-pedido')} className="btn btn-gold">📥 Hacer mi primer pedido</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {pedidos.map(p => {
            const info = ESTADO_INFO[p.estado] || ESTADO_INFO.pendiente
            const abierto = pedidoAbierto === p.id
            return (
              <div key={p.id} className="card" style={{ borderColor: info.color, background: abierto ? info.bg : 'var(--surface)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ background: info.color, color: '#000', borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>{info.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{new Date(p.created_at).toLocaleString('es-AR')}</span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>📅 Para el {p.dia_entrega} — 🕐 {p.horario_entrega}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{(p.items || []).length} producto(s) · Total estimado: <strong style={{ color: 'var(--gold)' }}>{fmt(p.total_estimado)}</strong></div>
                    {p.editado_por_admin && <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>⚠️ El admin ajustó el pedido</div>}
                    {p.rechazado_motivo && <div style={{ fontSize: 12, color: 'var(--red-light)', marginTop: 4 }}>Motivo: {p.rechazado_motivo}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setPedidoAbierto(abierto ? null : p.id)} className="btn btn-ghost btn-sm">
                      {abierto ? '▲ Ocultar' : '▼ Ver detalle'}
                    </button>
                    {p.estado === 'pendiente' && (
                      <button onClick={() => cancelarPedido(p)} style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'var(--red-light)' }}>❌ Cancelar</button>
                    )}
                  </div>
                </div>

                {abierto && (
                  <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                    {/* Items */}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>📦 Productos</div>
                    <table style={{ width: '100%', marginBottom: 14 }}>
                      <thead><tr><th>Producto</th><th>Kg</th><th>Precio/kg</th><th style={{ textAlign: 'right' }}>Subtotal</th></tr></thead>
                      <tbody>
                        {(p.items || []).map((it, i) => (
                          <tr key={i}>
                            <td>{it.nombre}</td>
                            <td>{it.kg} kg</td>
                            <td>{fmt(it.precio_unitario)}</td>
                            <td style={{ textAlign: 'right', color: 'var(--gold)', fontWeight: 600 }}>{fmt(it.subtotal)}</td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: '2px solid var(--gold)' }}>
                          <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>TOTAL</td>
                          <td style={{ textAlign: 'right', fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--gold)' }}>{fmt(p.total_estimado)}</td>
                        </tr>
                      </tbody>
                    </table>

                    {/* Notas */}
                    {p.notas_cliente && (
                      <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 12 }}>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>📝 Tu nota</div>
                        <div>{p.notas_cliente}</div>
                      </div>
                    )}
                    {p.notas_admin && (
                      <div style={{ background: '#2a1a08', border: '1px solid var(--amber)', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 12 }}>
                        <div style={{ fontSize: 10, color: 'var(--amber)' }}>💬 Nota del admin</div>
                        <div>{p.notas_admin}</div>
                      </div>
                    )}

                    {/* Chat */}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>💬 Conversación del pedido</div>
                    <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 10, maxHeight: 220, overflowY: 'auto' }}>
                      {(p.mensajes_chat || []).map((m, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: m.autor === 'bot' ? 'flex-start' : 'flex-end', marginBottom: 6 }}>
                          <div style={{
                            background: m.autor === 'bot' ? 'var(--surface)' : m.autor === 'admin' ? 'var(--amber)' : 'var(--gold)',
                            color: m.autor === 'bot' ? 'var(--text)' : '#000',
                            borderRadius: 10,
                            padding: '6px 12px',
                            maxWidth: '80%',
                            fontSize: 12,
                          }}>
                            {m.autor === 'bot' && <div style={{ fontSize: 9, opacity: 0.7 }}>🤖 Bot</div>}
                            {m.autor === 'admin' && <div style={{ fontSize: 9, opacity: 0.7 }}>👤 Admin</div>}
                            {m.texto}
                          </div>
                        </div>
                      ))}
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
