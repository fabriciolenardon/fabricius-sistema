// Pedidos.jsx - Panel de admin para gestionar pedidos online
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const fmt = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR')
const ahora = () => new Date().toISOString()

const ESTADO_INFO = {
  pendiente:  { label: '🟡 Pendiente',   color: 'var(--amber)' },
  confirmado: { label: '🟢 Confirmado',  color: 'var(--green)' },
  incompleto: { label: '🟠 Incompleto',  color: '#ff9d3a' },
  despachado: { label: '🚚 Despachado',  color: 'var(--blue)' },
  rechazado:  { label: '🔴 Rechazado',   color: 'var(--red-light)' },
  cancelado:  { label: '⚫ Cancelado',    color: 'var(--muted)' },
}

export function Pedidos() {
  const { profile } = useAuth()
  const [pedidos, setPedidos] = useState([])
  const [pedidoAbierto, setPedidoAbierto] = useState(null)
  const [filtro, setFiltro] = useState('pendiente')
  const [loading, setLoading] = useState(true)
  const [editingItems, setEditingItems] = useState(null)
  const [editingDia, setEditingDia] = useState('')
  const [editingHorario, setEditingHorario] = useState('')
  const [editingNotaAdmin, setEditingNotaAdmin] = useState('')
  const [modalDespacho, setModalDespacho] = useState(null)
  const [remitosCliente, setRemitosCliente] = useState([])

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

  async function abrirModalDespacho(pedido, tipo) {
    const { data: remitos } = await supabase
      .from('remitos')
      .select('id, numero, fecha, total, items')
      .eq('cliente_id', pedido.cliente_id)
      .order('created_at', { ascending: false })
      .limit(30)
    setRemitosCliente(remitos || [])

    let itemsBase = []
    if (tipo === 'completar') {
      itemsBase = (pedido.items_pendientes || []).map(it => ({
        producto_id: it.producto_id,
        nombre: it.nombre,
        unidad: it.unidad || 'kg',
        kg_pedido: it.kg_pendiente,
        kg_despacho: it.kg_pendiente,
        precio_unitario: it.precio_unitario,
      }))
    } else {
      itemsBase = (pedido.items || []).map(it => ({
        producto_id: it.producto_id,
        nombre: it.nombre,
        unidad: it.unidad || 'kg',
        kg_pedido: it.kg,
        kg_despacho: it.kg,
        precio_unitario: it.precio_unitario,
      }))
    }

    setModalDespacho({ tipo, pedido, items: itemsBase, remitoSeleccionado: '' })
  }

  function actualizarKgDespacho(idx, kg) {
    setModalDespacho(m => ({
      ...m,
      items: m.items.map((it, i) => i === idx ? { ...it, kg_despacho: parseFloat(kg) || 0 } : it)
    }))
  }

  async function confirmarDespacho() {
    const m = modalDespacho
    if (!m) return
    const pedido = m.pedido
    const pendientes = m.items
      .filter(it => (it.kg_pedido - it.kg_despacho) > 0.001)
      .map(it => ({
        producto_id: it.producto_id,
        nombre: it.nombre,
        unidad: it.unidad || 'kg',
        kg_pendiente: it.kg_pedido - it.kg_despacho,
        precio_unitario: it.precio_unitario,
        subtotal_pendiente: (it.kg_pedido - it.kg_despacho) * it.precio_unitario,
      }))

    const nuevoEstado = pendientes.length > 0 ? 'incompleto' : 'despachado'

    let nuevoRemitoEnlazado = null
    if (m.remitoSeleccionado) {
      const r = remitosCliente.find(x => x.id === m.remitoSeleccionado)
      if (r) {
        nuevoRemitoEnlazado = {
          remito_id: r.id,
          numero: r.numero,
          fecha: r.fecha,
          total: r.total,
          tipo: pendientes.length > 0 ? 'parcial' : (m.tipo === 'completar' ? 'final' : 'completo'),
          enlazado_en: ahora(),
        }
      }
    }

    const remitosAcumulados = [...(pedido.remitos_enlazados || [])]
    if (nuevoRemitoEnlazado) remitosAcumulados.push(nuevoRemitoEnlazado)

    const chatNuevo = [...(pedido.mensajes_chat || []), {
      timestamp: ahora(),
      autor: 'admin',
      texto: nuevoEstado === 'despachado'
        ? `🚚 Pedido despachado COMPLETO por ${profile?.nombre || 'Admin'}.${nuevoRemitoEnlazado ? ` Remito N° ${String(nuevoRemitoEnlazado.numero).padStart(5,'0')} enlazado.` : ''}`
        : `⚠️ Despacho parcial por ${profile?.nombre || 'Admin'}. Quedan ${pendientes.length} item(s) pendiente(s).${nuevoRemitoEnlazado ? ` Remito N° ${String(nuevoRemitoEnlazado.numero).padStart(5,'0')} enlazado.` : ''}`
    }]

    const update = {
      estado: nuevoEstado,
      items_pendientes: pendientes,
      remitos_enlazados: remitosAcumulados,
      mensajes_chat: chatNuevo,
    }
    if (nuevoEstado === 'despachado') {
      update.despachado_por = profile?.nombre || 'Admin'
      update.despachado_en = ahora()
    }

    const { error } = await supabase.from('pedidos').update(update).eq('id', pedido.id)
    if (error) { alert('❌ Error al guardar despacho: ' + error.message); return }

    setModalDespacho(null)
    cargar()
  }

  const pedidosFiltrados = pedidos.filter(p => filtro === 'todos' || p.estado === filtro)
  const cantPorEstado = {
    pendiente: pedidos.filter(p => p.estado === 'pendiente').length,
    confirmado: pedidos.filter(p => p.estado === 'confirmado').length,
    incompleto: pedidos.filter(p => p.estado === 'incompleto').length,
    despachado: pedidos.filter(p => p.estado === 'despachado').length,
    rechazado: pedidos.filter(p => p.estado === 'rechazado').length,
    cancelado: pedidos.filter(p => p.estado === 'cancelado').length,
  }

  return (
    <div>
      <div className="page-title">📥 PEDIDOS ONLINE</div>
      <div className="page-sub">Pedidos recibidos desde los portales de clientes mayoristas</div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {['pendiente', 'confirmado', 'incompleto', 'despachado', 'rechazado', 'cancelado', 'todos'].map(e => {
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
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                      {(p.items || []).length} producto(s) · Total: <strong style={{ color: 'var(--gold)' }}>{fmt(p.total_estimado)}</strong>
                      {(p.remitos_enlazados || []).length > 0 && <> · 🧾 {(p.remitos_enlazados || []).length} remito(s) enlazados</>}
                    </div>
                  </div>
                  <button onClick={() => abrirDetalle(p)} className="btn btn-ghost btn-sm">
                    {abierto ? '▲ Cerrar' : '▼ Abrir'}
                  </button>
                </div>

                {abierto && <DetallePedido p={p} editingItems={editingItems} editingDia={editingDia} editingHorario={editingHorario} editingNotaAdmin={editingNotaAdmin} setEditingDia={setEditingDia} setEditingHorario={setEditingHorario} setEditingNotaAdmin={setEditingNotaAdmin} actualizarItemKg={actualizarItemKg} quitarItemEdit={quitarItemEdit} confirmarPedido={confirmarPedido} rechazarPedido={rechazarPedido} abrirModalDespacho={abrirModalDespacho} />}
              </div>
            )
          })}
        </div>
      )}

      {modalDespacho && <ModalDespacho m={modalDespacho} setModalDespacho={setModalDespacho} remitosCliente={remitosCliente} actualizarKgDespacho={actualizarKgDespacho} confirmarDespacho={confirmarDespacho} />}
    </div>
  )
}

function DetallePedido({ p, editingItems, editingDia, editingHorario, editingNotaAdmin, setEditingDia, setEditingHorario, setEditingNotaAdmin, actualizarItemKg, quitarItemEdit, confirmarPedido, rechazarPedido, abrirModalDespacho }) {
  const itemsRender = p.estado === 'pendiente' ? (editingItems || []) : (p.items || [])
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>📦 Productos {p.estado === 'pendiente' && '(editable)'}</div>
          <table style={{ width: '100%', fontSize: 12 }}>
            <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th><th></th></tr></thead>
            <tbody>
              {itemsRender.map((it, i) => {
                const unidad = it.unidad || 'kg'
                return (
                  <tr key={i}>
                    <td>{it.nombre}</td>
                    <td>
                      {p.estado === 'pendiente' ? (
                        <input type="number" step="0.1" value={it.kg} onChange={e => actualizarItemKg(i, e.target.value)}
                          style={{ background: 'var(--surface2)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 4, padding: '2px 6px', fontSize: 12, width: 60, textAlign: 'center' }} />
                      ) : (
                        <span>{it.kg} {unidad === 'unidad' ? 'u' : 'kg'}</span>
                      )}
                    </td>
                    <td>{fmt(it.precio_unitario)}/{unidad === 'unidad' ? 'u' : 'kg'}</td>
                    <td style={{ color: 'var(--gold)', fontWeight: 600 }}>{fmt(it.subtotal)}</td>
                    <td>
                      {p.estado === 'pendiente' && (
                        <button onClick={() => quitarItemEdit(i)} style={{ background: 'none', border: 'none', color: 'var(--red-light)', cursor: 'pointer' }}>🗑️</button>
                      )}
                    </td>
                  </tr>
                )
              })}
              <tr style={{ borderTop: '1px solid var(--gold)' }}>
                <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>TOTAL</td>
                <td style={{ color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>
                  {fmt(itemsRender.reduce((s, i) => s + (i.subtotal || 0), 0))}
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>

          {(p.items_pendientes || []).length > 0 && (
            <div style={{ marginTop: 14, background: '#2a1a08', border: '1px solid #ff9d3a', borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 11, color: '#ff9d3a', fontWeight: 700, marginBottom: 6 }}>📦 PENDIENTE DE DESPACHO</div>
              {(p.items_pendientes || []).map((it, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
                  <span>{it.nombre} — {it.kg_pendiente} {(it.unidad || 'kg') === 'unidad' ? 'u' : 'kg'}</span>
                  <span style={{ color: 'var(--gold)' }}>{fmt(it.subtotal_pendiente)}</span>
                </div>
              ))}
            </div>
          )}

          {(p.remitos_enlazados || []).length > 0 && (
            <div style={{ marginTop: 14, background: 'var(--surface2)', borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>🧾 Remitos enlazados</div>
              {(p.remitos_enlazados || []).map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
                  <span>N° {String(r.numero).padStart(5,'0')} — {r.fecha} <span style={{ color: 'var(--muted)' }}>({r.tipo})</span></span>
                  <span style={{ color: 'var(--gold)' }}>{fmt(r.total)}</span>
                </div>
              ))}
            </div>
          )}

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
              <button onClick={() => rechazarPedido(p)} style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--red-light)' }}>❌ Rechazar</button>
            </div>
          )}
          {p.estado === 'confirmado' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => abrirModalDespacho(p, 'completo')} style={{ background: 'var(--blue)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', flex: 1 }}>🚚 Despachar completo</button>
              <button onClick={() => abrirModalDespacho(p, 'parcial')} style={{ background: '#ff9d3a', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#000' }}>⚠️ Despacho parcial</button>
            </div>
          )}
          {p.estado === 'incompleto' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => abrirModalDespacho(p, 'completar')} style={{ background: 'var(--green)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', flex: 1 }}>✅ Completar despacho</button>
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>💬 Conversación del chat</div>
          <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 10, maxHeight: 400, overflowY: 'auto' }}>
            {(p.mensajes_chat || []).map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.autor === 'bot' ? 'flex-start' : m.autor === 'cliente' ? 'flex-end' : 'center', marginBottom: 6 }}>
                <div style={{
                  background: m.autor === 'bot' ? 'var(--surface)' : m.autor === 'admin' ? 'var(--amber)' : 'var(--gold)',
                  color: m.autor === 'bot' ? 'var(--text)' : '#000',
                  borderRadius: 10, padding: '6px 12px', maxWidth: '85%', fontSize: 12,
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
          {p.despachado_por && (
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>
              🚚 Despachado por <strong>{p.despachado_por}</strong> el {new Date(p.despachado_en).toLocaleString('es-AR')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ModalDespacho({ m, setModalDespacho, remitosCliente, actualizarKgDespacho, confirmarDespacho }) {
  return (
    <div onClick={() => setModalDespacho(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 16, padding: 24, maxWidth: 700, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--gold)', letterSpacing: 1, marginBottom: 12 }}>
          {m.tipo === 'completo' && '🚚 Despachar completo'}
          {m.tipo === 'parcial' && '⚠️ Despacho parcial'}
          {m.tipo === 'completar' && '✅ Completar despacho'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          Cliente: <strong>{m.pedido.cliente_nombre}</strong> · Pedido para el {m.pedido.dia_entrega}
        </div>

        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>📦 Items a despachar (podés ajustar las cantidades si es parcial)</div>
        <table style={{ width: '100%', fontSize: 12, marginBottom: 16 }}>
          <thead><tr><th style={{ textAlign: 'left' }}>Producto</th><th>Pedido</th><th>Despachado</th><th>Pendiente</th><th>Subtotal</th></tr></thead>
          <tbody>
            {m.items.map((it, i) => {
              const pendiente = it.kg_pedido - it.kg_despacho
              const u = (it.unidad || 'kg') === 'unidad' ? 'u' : 'kg'
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{it.nombre}</td>
                  <td style={{ textAlign: 'center' }}>{it.kg_pedido} {u}</td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="number" step="0.1" min="0" max={it.kg_pedido} value={it.kg_despacho}
                      onChange={e => actualizarKgDespacho(i, e.target.value)}
                      style={{ background: 'var(--surface2)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 4, padding: '4px 8px', fontSize: 13, width: 70, textAlign: 'center' }} /> {u}
                  </td>
                  <td style={{ textAlign: 'center', color: pendiente > 0.001 ? '#ff9d3a' : 'var(--muted)', fontWeight: pendiente > 0.001 ? 700 : 400 }}>
                    {pendiente > 0.001 ? `${pendiente.toFixed(1)} ${u}` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--gold)', fontWeight: 600 }}>
                    {fmt(it.kg_despacho * it.precio_unitario)}
                  </td>
                </tr>
              )
            })}
            <tr style={{ borderTop: '2px solid var(--gold)' }}>
              <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>TOTAL DESPACHO</td>
              <td style={{ textAlign: 'right', color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>
                {fmt(m.items.reduce((s, it) => s + (it.kg_despacho * it.precio_unitario), 0))}
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)', marginBottom: 8 }}>🧾 Enlazar remito emitido</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>Seleccioná el remito que corresponde a este despacho (últimos 30 del cliente)</div>
          <select value={m.remitoSeleccionado} onChange={e => setModalDespacho(prev => ({ ...prev, remitoSeleccionado: e.target.value }))}
            style={{ background: 'var(--surface)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 6, padding: '8px 12px', fontSize: 13, width: '100%' }}>
            <option value="">— Sin remito (lo enlazás después) —</option>
            {remitosCliente.map(r => (
              <option key={r.id} value={r.id}>
                N° {String(r.numero).padStart(5,'0')} — {r.fecha} — {fmt(r.total)}
              </option>
            ))}
          </select>
          {remitosCliente.length === 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--amber)' }}>⚠️ Este cliente no tiene remitos emitidos aún. Podés enlazarlo después.</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={() => setModalDespacho(null)} className="btn btn-ghost">Cancelar</button>
          <button onClick={confirmarDespacho} className="btn btn-gold">
            {m.items.some(it => (it.kg_pedido - it.kg_despacho) > 0.001) ? '⚠️ Confirmar despacho parcial' : '🚚 Confirmar despacho completo'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default Pedidos
