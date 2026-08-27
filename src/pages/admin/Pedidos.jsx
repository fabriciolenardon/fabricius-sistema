// Pedidos.jsx - Panel de admin para gestionar pedidos online
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Paginador, { usePaginacion } from '../../components/Paginador'

import { fmtPrecio, parseNumero } from '../../lib/formatos'
import { enviarWhatsapp } from '../../lib/whatsapp'
import { getCampoPrecio, LISTAS } from '../../lib/listasPrecios'
const fmt = n => fmtPrecio(Math.abs(Number(n) || 0))
const ahora = () => new Date().toISOString()
// Etiqueta de la unidad de un item: kg / u (unidad) / tiras
const uLabel = u => u === 'unidad' ? 'u' : u === 'tiras' ? 'tiras' : 'kg'

const ESTADO_INFO = {
  pendiente:  { label: '🟡 Pendiente',   color: 'var(--amber)' },
  confirmado: { label: '🟢 En Depósito', color: 'var(--green)' },
  listo:      { label: '📦 Listo',       color: 'var(--gold)' },
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
  const [modalNuevo, setModalNuevo] = useState(false)
  // Toast de confirmación (ej. "pedido enviado a Depósito") — sin window.alert
  const [aviso, setAviso] = useState(null)

  function mostrarAviso(texto, tipo = 'success') {
    setAviso({ texto, tipo })
    setTimeout(() => setAviso(null), 6000)
  }

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
    setEditingItems(items => items.map((it, i) => i === idx ? { ...it, kg: parseNumero(kg), subtotal: (parseNumero(kg)) * it.precio_unitario } : it))
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
        ? `✅ Pedido confirmado con ajustes por ${profile?.nombre || 'Admin'}. 📦 Enviado a Depósito para su preparación.`
        : `✅ Pedido confirmado por ${profile?.nombre || 'Admin'}. 📦 Enviado a Depósito para su preparación.`
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
    mostrarAviso(`📦 Pedido de ${pedido.cliente_nombre} enviado a Depósito — el sector ya lo ve en su panel para prepararlo. Te llega la notificación acá cuando esté LISTO.`)
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
      // 'parcial': arranca solo con los productos que el sector marcó LISTOS
      //   (los demás en 0 → "despachar lo que está listo" en un click).
      // 'completo': arranca con lo efectivamente preparado (kg_real) o lo pedido.
      itemsBase = (pedido.items || []).map(it => {
        const kgReal = Number(it.kg_real) > 0 ? Number(it.kg_real) : it.kg
        return {
          producto_id: it.producto_id,
          nombre: it.nombre,
          unidad: it.unidad || 'kg',
          kg_pedido: it.kg,
          kg_despacho: tipo === 'parcial' ? (it.preparado ? kgReal : 0) : kgReal,
          precio_unitario: it.precio_unitario,
        }
      })
    }

    setModalDespacho({ tipo, pedido, items: itemsBase, remitoSeleccionado: '' })
  }

  function actualizarKgDespacho(idx, kg) {
    setModalDespacho(m => ({
      ...m,
      items: m.items.map((it, i) => i === idx ? { ...it, kg_despacho: parseNumero(kg) } : it)
    }))
  }

  async function confirmarDespacho() {
    const m = modalDespacho
    if (!m) return
    const pedido = m.pedido
    // "Despacho completo" = pedido entregado, SIEMPRE queda despachado aunque los
    // kg no coincidan con lo pedido (el pedido es relativo: "2 tiras" no es un kg
    // exacto). El cálculo de pendientes solo aplica a parcial/completar, y en kg.
    const pendientes = m.tipo === 'completo' ? [] : m.items
      .filter(it => (it.kg_pedido - it.kg_despacho) > 0.001)
      .map(it => ({
        producto_id: it.producto_id,
        nombre: it.nombre,
        unidad: 'kg',
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

  // Avisar al cliente por WhatsApp que su pedido está listo (abre wa.me con
  // el mensaje precargado — el envío final lo hace el admin desde su WhatsApp).
  async function avisarWhatsapp(pedido) {
    const { data: cli } = await supabase.from('clientes').select('telefono, nombre_fantasia, nombre').eq('id', pedido.cliente_id).maybeSingle()
    if (!cli?.telefono) { alert('El cliente no tiene teléfono cargado en su legajo (módulo Clientes).'); return }
    const detalle = (pedido.items || [])
      .map(it => `• ${it.nombre}: ${Number(it.kg_real) > 0 ? it.kg_real : it.kg} ${uLabel(it.unidad)}`)
      .join('\n')
    enviarWhatsapp(cli.telefono,
      `¡Hola ${cli.nombre_fantasia || cli.nombre}! 👋\n\n📦 Tu pedido ya está LISTO para retirar/recibir:\n\n${detalle}\n\n📅 Entrega: ${pedido.dia_entrega || 'a coordinar'}${pedido.horario_entrega ? ` · ${pedido.horario_entrega}` : ''}\n\nCarnicería Fabricius 🥩`)
  }

  // Remitar: abre el módulo Mayorista en pantalla dividida con un remito
  // PRE-CARGADO (cliente + productos + kg reales que mandó depósito). NO emite:
  // el admin revisa/edita y emite con su click. Lo real siempre va en kg.
  async function remitarPedido(pedido) {
    const { data: cli } = await supabase.from('clientes').select('id, nombre, domicilio').eq('id', pedido.cliente_id).maybeSingle()
    const items = (pedido.items || []).map(it => ({
      producto_id: it.producto_id || null,
      nombre: it.nombre,
      // Lo que manda depósito (columna Real) es SIEMPRE kg; si falta, cae a lo pedido.
      kg: Number(it.kg_real) > 0 ? Number(it.kg_real) : (Number(it.kg) || 0),
      precio_unitario: Number(it.precio_unitario) || 0,
      categoria: it.categoria || null,
    }))
    const payload = {
      cliente_id: pedido.cliente_id || null,
      cliente_nombre: cli?.nombre || pedido.cliente_nombre || '',
      domicilio: cli?.domicilio || '',
      pedido_id: pedido.id,
      items,
    }
    try { localStorage.setItem('remito_prefill', JSON.stringify(payload)) } catch {}
    if (typeof window.__abrirPanelEn === 'function') {
      window.__abrirPanelEn('/admin/ventas')  // pantalla dividida
    } else {
      window.location.href = '/admin/ventas'  // fallback (mobile / sin panel)
    }
  }

  const pedidosFiltrados = pedidos.filter(p => filtro === 'todos' || p.estado === filtro)
  // Paginación del listado filtrado — vuelve a página 1 cuando cambia el filtro
  // gracias al useEffect interno de usePaginacion que ajusta si pagina > totalPaginas.
  const pag = usePaginacion(pedidosFiltrados, 20)
  const cantPorEstado = {
    pendiente: pedidos.filter(p => p.estado === 'pendiente').length,
    confirmado: pedidos.filter(p => p.estado === 'confirmado').length,
    listo: pedidos.filter(p => p.estado === 'listo').length,
    incompleto: pedidos.filter(p => p.estado === 'incompleto').length,
    despachado: pedidos.filter(p => p.estado === 'despachado').length,
    rechazado: pedidos.filter(p => p.estado === 'rechazado').length,
    cancelado: pedidos.filter(p => p.estado === 'cancelado').length,
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div className="page-title">📥 PEDIDOS</div>
          <div className="page-sub">Pedidos de los portales de clientes + pedidos internos para el sector desposte</div>
        </div>
        <button onClick={() => setModalNuevo(true)} className="btn btn-gold" style={{ whiteSpace: 'nowrap' }}>
          ➕ Nuevo pedido
        </button>
      </div>

      {aviso && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 1100,
          padding: '14px 20px', borderRadius: 10, fontSize: 14, fontWeight: 700,
          background: aviso.tipo === 'error' ? '#3a1a1a' : '#1a2a1a',
          color: aviso.tipo === 'error' ? '#ff8b8b' : '#7dff7d',
          border: `1px solid ${aviso.tipo === 'error' ? '#ff6b6b' : '#3f6d2f'}`,
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)', maxWidth: 420,
        }}>{aviso.texto}</div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {['pendiente', 'confirmado', 'listo', 'incompleto', 'despachado', 'rechazado', 'cancelado', 'todos'].map(e => {
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
          {pag.items.map(p => {
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
                      {(p.items || []).length} producto(s)
                      {(p.remitos_enlazados || []).length > 0 && <> · 🧾 {(p.remitos_enlazados || []).length} remito(s) enlazados</>}
                    </div>
                  </div>
                  <button onClick={() => abrirDetalle(p)} className="btn btn-ghost btn-sm">
                    {abierto ? '▲ Cerrar' : '▼ Abrir'}
                  </button>
                </div>

                {abierto && <DetallePedido p={p} editingItems={editingItems} editingDia={editingDia} editingHorario={editingHorario} editingNotaAdmin={editingNotaAdmin} setEditingDia={setEditingDia} setEditingHorario={setEditingHorario} setEditingNotaAdmin={setEditingNotaAdmin} actualizarItemKg={actualizarItemKg} quitarItemEdit={quitarItemEdit} confirmarPedido={confirmarPedido} rechazarPedido={rechazarPedido} abrirModalDespacho={abrirModalDespacho} avisarWhatsapp={avisarWhatsapp} remitarPedido={remitarPedido} />}
              </div>
            )
          })}
        </div>
      )}

      {pedidosFiltrados.length > 0 && <Paginador {...pag.controles} label="pedidos" />}

      {modalDespacho && <ModalDespacho m={modalDespacho} setModalDespacho={setModalDespacho} remitosCliente={remitosCliente} actualizarKgDespacho={actualizarKgDespacho} confirmarDespacho={confirmarDespacho} />}
      {modalNuevo && <ModalNuevoPedido cerrar={() => setModalNuevo(false)} onCreado={() => { setModalNuevo(false); setFiltro('confirmado'); mostrarAviso('📦 Pedido creado y enviado a Depósito — el sector ya lo ve en su panel para prepararlo.'); cargar() }} profile={profile} />}
    </div>
  )
}

// Alta de pedido desde el admin: nace 'confirmado' (origen 'admin') y entra
// directo a la cola del panel del sector desposte, que carga los kg reales
// y lo marca LISTO.
function ModalNuevoPedido({ cerrar, onCreado, profile }) {
  const [clientes, setClientes] = useState([])
  const [precios, setPrecios] = useState([])
  const [clienteId, setClienteId] = useState('')
  const [listaSel, setListaSel] = useState('')  // '' = usar la lista del cliente
  const [busqueda, setBusqueda] = useState('')
  const [items, setItems] = useState([])
  const [dia, setDia] = useState('')
  const [horario, setHorario] = useState('')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('clientes').select('id, nombre, nombre_fantasia, lista_precios').order('nombre'),
      supabase.from('precios').select('*').order('nombre'),
    ]).then(([c, p]) => { setClientes(c.data || []); setPrecios(p.data || []) })
  }, [])

  const cliente = clientes.find(c => c.id === clienteId)
  // Lista efectiva: la elegida a mano, o si no la del cliente (fallback mayorista)
  const listaEfectiva = listaSel || cliente?.lista_precios || 'may'
  const campoPrecio = getCampoPrecio(listaEfectiva)
  const resultados = busqueda.trim().length >= 2
    ? precios.filter(p => p.nombre?.toLowerCase().includes(busqueda.trim().toLowerCase())).slice(0, 8)
    : []

  function agregarProducto(prod) {
    setItems(its => [...its, {
      producto_id: prod.id,
      nombre: prod.nombre,
      categoria: prod.categoria,
      kg: 1,
      unidad: 'kg',
      precio_unitario: Number(prod[campoPrecio]) || 0,
      subtotal: Number(prod[campoPrecio]) || 0,
    }])
    setBusqueda('')
  }

  function setItem(idx, cambios) {
    setItems(its => its.map((it, i) => (i === idx ? { ...it, ...cambios } : it)))
  }

  const inputStyle = { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' }

  async function crear() {
    if (!clienteId) { setError('Elegí el cliente'); return }
    if (items.length === 0) { setError('Agregá al menos un producto'); return }
    if (items.some(it => !(parseNumero(it.kg) > 0))) { setError('Todos los productos necesitan cantidad mayor a 0'); return }
    setGuardando(true); setError(null)
    const quien = profile?.nombre || 'Admin'
    const { error: e } = await supabase.from('pedidos').insert({
      cliente_id: clienteId,
      cliente_nombre: cliente?.nombre || '',
      estado: 'confirmado',
      origen: 'admin',
      dia_entrega: dia || null,
      horario_entrega: horario || null,
      items: items.map(({ subtotal, ...it }) => ({ ...it, kg: parseNumero(it.kg), precio_unitario: parseNumero(it.precio_unitario) })),
      // Sin total estimado: con tiras/unidades sin peso real no es un número viable.
      // El total real se define al pesar y remitir.
      total_estimado: null,
      notas_admin: nota.trim() || null,
      confirmado_por: quien,
      confirmado_en: ahora(),
      mensajes_chat: [{ timestamp: ahora(), autor: 'admin', texto: `📋 Pedido cargado por ${quien} para preparar en el sector desposte.` }],
    })
    setGuardando(false)
    if (e) {
      // Columna 'origen' inexistente = migración 86 sin aplicar
      setError(e.message.includes('origen') ? 'Falta aplicar la migración 86 en Supabase (columna "origen").' : e.message)
      return
    }
    onCreado()
  }

  return (
    <div onClick={cerrar} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 16, padding: 24, maxWidth: 640, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--gold)', letterSpacing: 1, marginBottom: 4 }}>➕ Nuevo pedido</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Entra directo a la cola del sector desposte para que lo preparen.</div>

        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>👥 Cliente</label>
        <select value={clienteId} onChange={e => { setClienteId(e.target.value); setItems([]); setListaSel('') }}
          style={{ ...inputStyle, width: '100%', marginBottom: 12 }}>
          <option value="">— Elegir cliente —</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}{c.nombre_fantasia ? ` (${c.nombre_fantasia})` : ''}</option>)}
        </select>

        {clienteId && (
          <>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🏷️ Lista de precios</label>
            <select value={listaEfectiva} onChange={e => setListaSel(e.target.value)} style={{ ...inputStyle, width: '100%', marginBottom: 12 }}>
              {Object.values(LISTAS).map(l => (
                <option key={l.codigo} value={l.codigo}>{l.labelEmoji}{l.codigo === (cliente?.lista_precios || '') ? ' — la del cliente' : ''}</option>
              ))}
            </select>

            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🔍 Agregar producto (precio {getCampoPrecio(listaEfectiva).replace('precio_', '')})</label>
            <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Escribí el nombre del producto..."
              style={{ ...inputStyle, width: '100%' }} />
            {resultados.length > 0 && (
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, overflow: 'hidden' }}>
                {resultados.map(p => (
                  <button key={p.id} onClick={() => agregarProducto(p)}
                    style={{ display: 'flex', justifyContent: 'space-between', width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}>
                    <span>{p.nombre}</span>
                    <span style={{ color: 'var(--gold)' }}>{fmt(p[campoPrecio])}</span>
                  </button>
                ))}
              </div>
            )}

            {items.length > 0 && (
              <table style={{ width: '100%', fontSize: 12, marginTop: 12 }}>
                <thead><tr><th style={{ textAlign: 'left' }}>Producto</th><th>Cant.</th><th>Unidad</th><th>Precio x kg/u</th><th></th></tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{it.nombre}</td>
                      <td style={{ textAlign: 'center' }}>
                        <input type="text" inputMode="decimal" value={it.kg} onChange={e => setItem(i, { kg: e.target.value })}
                          style={{ ...inputStyle, width: 64, textAlign: 'center' }} />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <select value={it.unidad} onChange={e => setItem(i, { unidad: e.target.value })} style={{ ...inputStyle, padding: '6px 6px' }}>
                          <option value="kg">kg</option>
                          <option value="unidad">unidad</option>
                          <option value="tiras">tiras</option>
                        </select>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input type="text" inputMode="decimal" value={it.precio_unitario} onChange={e => setItem(i, { precio_unitario: e.target.value })}
                          style={{ ...inputStyle, width: 90, textAlign: 'right' }} />
                      </td>
                      <td>
                        <button onClick={() => setItems(its => its.filter((_, j) => j !== i))}
                          style={{ background: 'none', border: 'none', color: 'var(--red-light)', cursor: 'pointer' }}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {items.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                El precio queda registrado por si hay un precio especial; el total real se define al pesar y remitir.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>📅 Día de entrega</label>
                <input type="date" value={dia} onChange={e => setDia(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🕐 Horario</label>
                <input type="text" value={horario} onChange={e => setHorario(e.target.value)} placeholder="mañana / tarde / 10:30" style={{ ...inputStyle, width: '100%' }} />
              </div>
            </div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', margin: '10px 0 4px' }}>📝 Nota para el sector desposte (opcional)</label>
            <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2} style={{ ...inputStyle, width: '100%', fontFamily: 'inherit' }} />
          </>
        )}

        {error && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--red-light)', fontWeight: 700 }}>⚠️ {error}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={cerrar} className="btn btn-ghost">Cancelar</button>
          <button onClick={crear} disabled={guardando} className="btn btn-gold">
            {guardando ? '⏳ Creando...' : '✅ Crear y mandar a preparar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DetallePedido({ p, editingItems, editingDia, editingHorario, editingNotaAdmin, setEditingDia, setEditingHorario, setEditingNotaAdmin, actualizarItemKg, quitarItemEdit, confirmarPedido, rechazarPedido, abrirModalDespacho, avisarWhatsapp, remitarPedido }) {
  const itemsRender = p.estado === 'pendiente' ? (editingItems || []) : (p.items || [])
  // kg reales cargados por el sector desposte (portal): se muestran apenas existan
  const hayKgReales = (p.items || []).some(it => Number(it.kg_real) > 0)
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>📦 Productos {p.estado === 'pendiente' && '(editable)'}</div>
          <table style={{ width: '100%', fontSize: 12 }}>
            <thead><tr><th>Producto</th><th>Cant.</th>{hayKgReales && <th>Real (kg)</th>}<th>Precio</th><th></th></tr></thead>
            <tbody>
              {itemsRender.map((it, i) => {
                const unidad = it.unidad || 'kg'
                return (
                  <tr key={i}>
                    <td>{it.preparado ? '✅ ' : ''}{it.nombre}</td>
                    <td>
                      {p.estado === 'pendiente' ? (
                        <input type="text" inputMode="decimal" value={it.kg} onChange={e => actualizarItemKg(i, e.target.value)}
                          style={{ background: 'var(--surface2)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 4, padding: '2px 6px', fontSize: 12, width: 60, textAlign: 'center' }} />
                      ) : (
                        <span>{it.kg} {uLabel(unidad)}</span>
                      )}
                    </td>
                    {hayKgReales && (
                      <td style={{ textAlign: 'center', fontWeight: 700, color: Number(it.kg_real) > 0 ? 'var(--green)' : 'var(--muted)' }}>
                        {Number(it.kg_real) > 0 ? `${it.kg_real} kg` : '—'}
                      </td>
                    )}
                    <td>{fmt(it.precio_unitario)}/{uLabel(unidad)}</td>
                    <td>
                      {p.estado === 'pendiente' && (
                        <button onClick={() => quitarItemEdit(i)} style={{ background: 'none', border: 'none', color: 'var(--red-light)', cursor: 'pointer' }}>🗑️</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {(p.items_pendientes || []).length > 0 && (
            <div style={{ marginTop: 14, background: '#2a1a08', border: '1px solid #ff9d3a', borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 11, color: '#ff9d3a', fontWeight: 700, marginBottom: 6 }}>📦 PENDIENTE DE DESPACHO</div>
              {(p.items_pendientes || []).map((it, i) => (
                <div key={i} style={{ fontSize: 12, padding: '2px 0' }}>
                  {it.nombre} — {it.kg_pendiente} {uLabel(it.unidad)}
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
              <button onClick={() => confirmarPedido(p)} className="btn btn-gold" style={{ flex: 1 }} title="Confirma el pedido y lo manda al panel del sector Depósito para que lo preparen">📦 Confirmar y enviar a Depósito</button>
              <button onClick={() => rechazarPedido(p)} style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--red-light)' }}>❌ Rechazar</button>
            </div>
          )}
          {p.estado === 'confirmado' && (
            <div style={{ marginTop: 14 }}>
              <div style={{ background: '#14230f', border: '1px solid #3f6d2f', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 8 }}>
                📦 <strong>Enviado a Depósito</strong> — el sector lo ve en su panel, carga los kg reales y lo marca LISTO. Te llega la notificación acá; no hace falta cargarlo a mano.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => abrirModalDespacho(p, 'completo')} style={{ background: 'var(--blue)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', flex: 1 }}>🚚 Despachar completo</button>
                <button onClick={() => abrirModalDespacho(p, 'parcial')} style={{ background: '#ff9d3a', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#000' }}>⚠️ Despacho parcial</button>
              </div>
            </div>
          )}
          {p.estado === 'listo' && (
            <div style={{ marginTop: 14 }}>
              <div style={{ background: '#14230f', border: '1px solid #3f6d2f', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 8 }}>
                📦 <strong>Preparado y listo</strong>{p.preparado_por ? <> por <strong>{p.preparado_por}</strong></> : null}{p.preparado_en ? <> el {new Date(p.preparado_en).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</> : null}.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => remitarPedido(p)} style={{ background: 'var(--gold)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 800, color: '#000' }}>🧾 Remitar</button>
                <button onClick={() => avisarWhatsapp(p)} style={{ background: '#25D366', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#000' }}>💬 Avisar al cliente</button>
                <button onClick={() => abrirModalDespacho(p, 'completo')} style={{ background: 'var(--blue)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', flex: 1 }}>🚚 Despachar completo</button>
                <button onClick={() => abrirModalDespacho(p, 'parcial')} style={{ background: '#ff9d3a', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#000' }}>⚠️ Despacho parcial</button>
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>🧾 Remitar abre el remito ya cargado (cliente + productos + kg reales) en pantalla dividida — vos revisás y emitís.</div>
            </div>
          )}
          {p.estado === 'incompleto' && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>🚚 Entrega por partes: despachá lo que ya está listo. Si en el modal bajás las cantidades, el pedido queda incompleto hasta terminar de entregar todo.</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => avisarWhatsapp(p)} style={{ background: '#25D366', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#000' }}>💬 Avisar al cliente</button>
                <button onClick={() => abrirModalDespacho(p, 'completar')} style={{ background: 'var(--green)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', flex: 1 }}>🚚 Entregar otra parte / completar</button>
              </div>
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

        {(() => {
          const esParcial = m.tipo !== 'completo'  // completo no tiene pendiente
          const remitoSel = remitosCliente.find(r => r.id === m.remitoSeleccionado)
          return (
            <>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                📦 Lo despachado se pesa en <strong>kg</strong> (aunque el pedido diga tiras/u). {esParcial ? 'Ajustá los kg de cada producto.' : 'El total real es el del remito que enlaces.'}
              </div>
              <table style={{ width: '100%', fontSize: 12, marginBottom: 16 }}>
                <thead><tr><th style={{ textAlign: 'left' }}>Producto</th><th>Pedido</th><th>Despachado (kg)</th>{esParcial && <th>Pendiente (kg)</th>}</tr></thead>
                <tbody>
                  {m.items.map((it, i) => {
                    const pendiente = it.kg_pedido - it.kg_despacho
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{it.nombre}</td>
                        <td style={{ textAlign: 'center', color: 'var(--muted)' }}>{it.kg_pedido} {uLabel(it.unidad)}</td>
                        <td style={{ textAlign: 'center' }}>
                          <input type="text" inputMode="decimal" value={it.kg_despacho}
                            onChange={e => actualizarKgDespacho(i, e.target.value)}
                            style={{ background: 'var(--surface2)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 4, padding: '4px 8px', fontSize: 13, width: 70, textAlign: 'center' }} /> kg
                        </td>
                        {esParcial && (
                          <td style={{ textAlign: 'center', color: pendiente > 0.001 ? '#ff9d3a' : 'var(--muted)', fontWeight: pendiente > 0.001 ? 700 : 400 }}>
                            {pendiente > 0.001 ? `${pendiente.toFixed(2)} kg` : '—'}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)', marginBottom: 8 }}>🧾 Enlazar remito emitido</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>Seleccioná el remito que corresponde a este despacho (últimos 30 del cliente). El total real sale del remito.</div>
                <select value={m.remitoSeleccionado} onChange={e => setModalDespacho(prev => ({ ...prev, remitoSeleccionado: e.target.value }))}
                  style={{ background: 'var(--surface)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 6, padding: '8px 12px', fontSize: 13, width: '100%' }}>
                  <option value="">— Sin remito (lo enlazás después) —</option>
                  {remitosCliente.map(r => (
                    <option key={r.id} value={r.id}>
                      N° {String(r.numero).padStart(5,'0')} — {r.fecha} — {fmt(r.total)}
                    </option>
                  ))}
                </select>
                {remitoSel && (
                  <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#14230f', border: '1px solid #3f6d2f', borderRadius: 8, padding: '8px 12px' }}>
                    <span style={{ fontSize: 12 }}>Remito N° {String(remitoSel.numero).padStart(5,'0')} · total real</span>
                    <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--gold)' }}>{fmt(remitoSel.total)}</span>
                  </div>
                )}
                {remitosCliente.length === 0 && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--amber)' }}>⚠️ Este cliente no tiene remitos emitidos aún. Podés enlazarlo después.</div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setModalDespacho(null)} className="btn btn-ghost">Cancelar</button>
                <button onClick={confirmarDespacho} className="btn btn-gold">
                  {m.tipo === 'completo' && '🚚 Confirmar despacho completo'}
                  {m.tipo === 'parcial' && '⚠️ Confirmar despacho parcial'}
                  {m.tipo === 'completar' && '✅ Completar despacho'}
                </button>
              </div>
            </>
          )
        })()}
      </div>
    </div>
  )
}

export default Pedidos
