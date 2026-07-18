// ============================================================
// DESPOSTE PEDIDOS — Panel principal del sector
// ============================================================
// Flujo: el admin carga/confirma pedidos → acá el operario los ve en cola,
// va cargando los KG REALES de cada ítem a medida que los prepara, y cuando
// está todo marca PEDIDO LISTO (estado 'listo'). El admin lo ve al instante
// (realtime), remita y avisa al cliente.
// El operario NO toca precios ni stock acá: solo kg reales + estado.
// Confirmación inline (sin window.confirm — iOS/PWA los suprime).
// ============================================================
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { parseNumero, fmtKg } from '../../lib/formatos'

const ahora = () => new Date().toISOString()
// Etiqueta de la unidad de un item: kg / u (unidad) / tiras
const uLabel = u => u === 'unidad' ? 'u' : u === 'tiras' ? 'tiras' : 'kg'

const inp = {
  background: 'var(--surface2)', border: '2px solid var(--gold)', color: 'var(--text)',
  borderRadius: 10, padding: '12px 14px', fontFamily: "'DM Sans', sans-serif",
  fontSize: 20, fontWeight: 700, width: 110, boxSizing: 'border-box', textAlign: 'right',
}

export default function DespostePedidos() {
  const { profile } = useAuth()
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(true)
  const [abierto, setAbierto] = useState(null)      // pedido.id expandido
  const [kgReales, setKgReales] = useState([])      // items en edición del abierto
  const [guardando, setGuardando] = useState(false)
  const [confirmandoListo, setConfirmandoListo] = useState(false)
  const [msg, setMsg] = useState(null)
  const [precios, setPrecios] = useState([])       // catálogo para añadir productos
  const [busqueda, setBusqueda] = useState('')     // búsqueda del "añadir producto"

  function aviso(texto, tipo = 'success') {
    setMsg({ texto, tipo })
    setTimeout(() => setMsg(null), 5000)
  }

  useEffect(() => {
    cargar()
    // El desposte puede leer precios (RLS mig 30) — para añadir un producto al pedido.
    supabase.from('precios').select('id, nombre, categoria, precio_mayorista').order('nombre')
      .then(({ data }) => setPrecios(data || []))
    const canal = supabase.channel('pedidos-desposte')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => cargar())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [])

  async function cargar() {
    // 'incompleto' = pedido que se está entregando por partes durante la semana:
    // el sector lo sigue viendo para preparar lo que falta.
    const { data } = await supabase.from('pedidos').select('*')
      .in('estado', ['confirmado', 'listo', 'incompleto'])
      .order('dia_entrega', { ascending: true })
      .order('created_at', { ascending: true })
    setPedidos(data || [])
    setLoading(false)
  }

  function abrir(p) {
    if (abierto === p.id) { setAbierto(null); return }
    setAbierto(p.id)
    setConfirmandoListo(false)
    setBusqueda('')
    setKgReales((p.items || []).map(it => ({ ...it })))
  }

  function setKgReal(idx, v) {
    setKgReales(items => items.map((it, i) => i === idx ? { ...it, kg_real: v } : it))
  }

  // Marca/desmarca un producto como listo para entregar (seguimiento por parte)
  function togglePreparado(idx) {
    setKgReales(items => items.map((it, i) => i === idx ? { ...it, preparado: !it.preparado } : it))
  }

  // Añadir un producto que faltaba / que sumó el cliente. El desposte NO fija
  // precios: se guarda el mayorista como referencia (unidad kg) y el admin lo
  // ajusta al remitar. El item queda marcado como agregado en depósito.
  function agregarProducto(prod) {
    setKgReales(items => [...items, {
      producto_id: prod.id,
      nombre: prod.nombre,
      categoria: prod.categoria,
      kg: 0,                 // no fue "pedido": lo agrega depósito
      unidad: 'kg',
      precio_unitario: Number(prod.precio_mayorista) || 0,
      kg_real: '',
      preparado: false,
      agregado_desposte: true,
    }])
    setBusqueda('')
  }

  function quitarItem(idx) {
    setKgReales(items => items.filter((_, i) => i !== idx))
  }

  // Persiste kg reales + flag "preparado" dentro del JSON items
  function itemsConKgReal() {
    return kgReales.map(it => {
      const v = parseNumero(it.kg_real)
      return { ...it, kg_real: v > 0 ? v : null, preparado: !!it.preparado }
    })
  }

  async function guardarAvance(p) {
    setGuardando(true)
    const { error } = await supabase.from('pedidos').update({ items: itemsConKgReal() }).eq('id', p.id)
    if (error) aviso('❌ Error al guardar: ' + error.message, 'error')
    else aviso('💾 Avance guardado')
    setGuardando(false)
    cargar()
  }

  async function marcarListo(p) {
    setGuardando(true)
    // Marcar TODO listo: los productos quedan preparados = true
    const items = itemsConKgReal().map(it => ({ ...it, preparado: true }))
    const operario = profile?.nombre || 'Sector desposte'
    const chatActualizado = [...(p.mensajes_chat || []), {
      timestamp: ahora(),
      autor: 'admin',
      texto: `📦 Pedido preparado y LISTO por ${operario} (sector desposte).`,
    }]
    const { error } = await supabase.from('pedidos').update({
      estado: 'listo',
      items,
      preparado_por: operario,
      preparado_en: ahora(),
      mensajes_chat: chatActualizado,
    }).eq('id', p.id)
    if (error) aviso('❌ Error: ' + error.message, 'error')
    else {
      aviso(`✅ Pedido de ${p.cliente_nombre} marcado como LISTO. El admin ya lo ve.`)
      setAbierto(null)
    }
    setGuardando(false)
    setConfirmandoListo(false)
    cargar()
  }

  // Entrega por partes: guarda el avance y le avisa al admin qué productos ya
  // están listos para despachar, SIN cerrar el pedido (sigue en curso).
  async function avisarParteLista(p) {
    setGuardando(true)
    const items = itemsConKgReal()
    const operario = profile?.nombre || 'Sector desposte'
    const listosTxt = items.filter(it => it.preparado).map(it => it.nombre).join(', ') || '—'
    const chatActualizado = [...(p.mensajes_chat || []), {
      timestamp: ahora(),
      autor: 'admin',
      texto: `📦 ${operario} avisa que ya hay parte lista para entregar: ${listosTxt}.`,
    }]
    const { error } = await supabase.from('pedidos').update({
      items, preparado_por: operario, preparado_en: ahora(), mensajes_chat: chatActualizado,
    }).eq('id', p.id)
    if (error) aviso('❌ Error: ' + error.message, 'error')
    else { aviso('📣 Aviso enviado al admin con lo que está listo.'); setAbierto(null) }
    setGuardando(false)
    cargar()
  }

  // Tienen trabajo pendiente: recién confirmados + los que se entregan por partes
  const paraPreparar = pedidos.filter(p => p.estado === 'confirmado' || p.estado === 'incompleto')
  const listos = pedidos.filter(p => p.estado === 'listo')

  if (loading) return <p style={{ color: 'var(--muted)', fontSize: 16 }}>Cargando pedidos...</p>

  return (
    <div>
      {msg && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 1000,
          padding: '18px 24px', borderRadius: 10, fontSize: 16, fontWeight: 700,
          background: msg.tipo === 'error' ? '#3a1a1a' : '#1a2a1a',
          color: msg.tipo === 'error' ? '#ff8b8b' : '#7dff7d',
          border: `1px solid ${msg.tipo === 'error' ? '#ff6b6b' : '#7dff7d'}`,
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)', maxWidth: 460,
        }}>{msg.texto}</div>
      )}

      <h2 style={{ fontSize: 22, marginBottom: 4 }}>📥 Pedidos para preparar ({paraPreparar.length})</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0, marginBottom: 16 }}>
        Cargá los kg reales y tildá cada producto que va quedando listo. Si el pedido se entrega por partes durante la semana, avisá qué está listo y el resto lo seguís acá.
      </p>

      {paraPreparar.length === 0 && (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', background: 'var(--surface)', borderRadius: 12, marginBottom: 24 }}>
          🎉 No hay pedidos pendientes de preparar.
        </div>
      )}

      {paraPreparar.map(p => {
        const estaAbierto = abierto === p.id
        const items = estaAbierto ? kgReales : (p.items || [])
        const totalItems = (p.items || []).length
        const listosCount = (p.items || []).filter(it => it.preparado).length
        const enCurso = p.estado === 'incompleto'
        const pendientesEntrega = p.items_pendientes || []
        // "Todo listo" = todos los productos tildados como preparados
        const todosOk = estaAbierto && kgReales.length > 0 && kgReales.every(it => it.preparado)
        const algoListo = estaAbierto && kgReales.some(it => it.preparado)
        return (
          <div key={p.id} style={{ background: 'var(--surface)', border: `2px solid ${estaAbierto ? 'var(--gold)' : enCurso ? '#ff9d3a' : 'var(--border)'}`, borderRadius: 14, padding: 18, marginBottom: 14 }}>
            <div onClick={() => abrir(p)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', cursor: 'pointer' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--gold)' }}>{p.cliente_nombre}</div>
                  {enCurso && <span style={{ background: '#2a1a08', color: '#ff9d3a', border: '1px solid #ff9d3a', borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 800 }}>🚚 ENTREGA EN CURSO</span>}
                </div>
                <div style={{ fontSize: 14, marginTop: 2 }}>
                  📅 Para el <strong>{p.dia_entrega || 'sin fecha'}</strong>{p.horario_entrega ? <> · 🕐 {p.horario_entrega}</> : null}
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                  {listosCount}/{totalItems} producto(s) listos
                  {p.origen === 'admin' ? ' · cargado por el admin' : ' · pedido del cliente'}
                </div>
              </div>
              <button style={{ padding: '12px 18px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 10, cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>
                {estaAbierto ? '▲ Cerrar' : '▼ Preparar'}
              </button>
            </div>

            {enCurso && pendientesEntrega.length > 0 && (
              <div style={{ background: '#2a1a08', border: '1px solid #ff9d3a', borderRadius: 10, padding: '10px 14px', marginTop: 12, fontSize: 13 }}>
                <div style={{ color: '#ff9d3a', fontWeight: 700, marginBottom: 4 }}>⏳ Todavía falta entregar:</div>
                {pendientesEntrega.map((it, i) => (
                  <div key={i}>• {it.nombre} — {it.kg_pendiente} {uLabel(it.unidad)}</div>
                ))}
              </div>
            )}

            {(p.notas_admin || p.notas_cliente) && estaAbierto && (
              <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '10px 14px', marginTop: 12, fontSize: 14 }}>
                {p.notas_admin && <div>📝 <strong>Nota del admin:</strong> {p.notas_admin}</div>}
                {p.notas_cliente && <div>💬 <strong>Nota del cliente:</strong> {p.notas_cliente}</div>}
              </div>
            )}

            {estaAbierto && (
              <div style={{ marginTop: 14 }}>
                {items.map((it, i) => {
                  const u = uLabel(it.unidad)
                  const prep = !!it.preparado
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                      padding: '12px 14px', borderRadius: 10, marginBottom: 8,
                      background: prep ? '#14230f' : 'var(--surface2)',
                      border: `1px solid ${prep ? '#3f6d2f' : 'var(--border)'}`,
                    }}>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>
                          {prep ? '✅ ' : ''}{it.nombre}
                          {it.agregado_desposte && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, background: 'var(--gold)', color: '#000', borderRadius: 5, padding: '1px 7px' }}>➕ AGREGADO</span>}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                          {it.agregado_desposte ? 'Agregado en depósito' : `Pedido: ${it.kg} ${u}`}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {/* Lo real SIEMPRE se pesa y se carga en KG (aunque el pedido diga tiras/u) */}
                        <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 700 }}>Real (kg):</span>
                        <input type="number" inputMode="decimal" step="0.01" min="0"
                          value={it.kg_real ?? ''}
                          onChange={e => setKgReal(i, e.target.value)}
                          placeholder="0" style={inp} />
                        <span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 700 }}>kg</span>
                      </div>
                      <button onClick={() => togglePreparado(i)}
                        style={{
                          padding: '12px 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
                          fontSize: 14, fontWeight: 800, minWidth: 120,
                          background: prep ? 'var(--green)' : 'var(--surface)',
                          color: prep ? '#000' : 'var(--muted)',
                          borderStyle: 'solid', borderWidth: 1, borderColor: prep ? 'var(--green)' : 'var(--border)',
                        }}>
                        {prep ? '✅ Listo' : '⏳ Marcar listo'}
                      </button>
                      {it.agregado_desposte && (
                        <button onClick={() => quitarItem(i)} title="Quitar producto agregado"
                          style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', color: '#ff8b8b', borderRadius: 10, padding: '12px 14px', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>🗑️</button>
                      )}
                    </div>
                  )
                })}

                {/* Añadir un producto que el cliente sumó o que faltaba */}
                <div style={{ marginTop: 8, marginBottom: 4 }}>
                  <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
                    placeholder="➕ Añadir un producto al pedido (escribí el nombre)…"
                    style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface2)', border: '1px dashed var(--gold)', color: 'var(--text)', borderRadius: 10, padding: '12px 14px', fontSize: 15 }} />
                  {busqueda.trim().length >= 2 && (
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, marginTop: 4, overflow: 'hidden' }}>
                      {precios.filter(pr => pr.nombre?.toLowerCase().includes(busqueda.trim().toLowerCase())).slice(0, 8).map(pr => (
                        <button key={pr.id} onClick={() => agregarProducto(pr)}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', fontSize: 15 }}>
                          {pr.nombre}
                        </button>
                      ))}
                      {precios.filter(pr => pr.nombre?.toLowerCase().includes(busqueda.trim().toLowerCase())).length === 0 && (
                        <div style={{ padding: '10px 14px', color: 'var(--muted)', fontSize: 13 }}>Sin resultados.</div>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                  <button onClick={() => guardarAvance(p)} disabled={guardando}
                    style={{ padding: '14px 20px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 10, cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>
                    💾 Guardar avance
                  </button>

                  {/* Entrega por partes: avisar lo que está listo sin cerrar el pedido.
                      En pedidos en curso (incompleto) es la ÚNICA acción de cierre del
                      sector — terminar de entregar lo hace el admin. */}
                  <button onClick={() => avisarParteLista(p)} disabled={guardando || !algoListo}
                    style={{
                      flex: enCurso ? 1 : 'initial', minWidth: enCurso ? 200 : 'initial',
                      padding: '14px 20px', borderRadius: 10, border: 'none',
                      background: algoListo ? '#ff9d3a' : 'var(--surface2)', color: algoListo ? '#000' : 'var(--muted)',
                      cursor: algoListo ? 'pointer' : 'not-allowed', fontSize: 15, fontWeight: 800,
                    }}>
                    📣 Avisar parte lista
                  </button>

                  {!enCurso && (confirmandoListo ? (
                    <div style={{ flex: 1, minWidth: 260, background: 'var(--surface2)', border: '2px solid var(--gold)', borderRadius: 10, padding: 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                        {todosOk
                          ? `¿Marcar TODO el pedido de ${p.cliente_nombre} como LISTO?`
                          : `⚠️ Hay productos sin tildar como listos. ¿Marcar TODO listo igual?`}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => marcarListo(p)} disabled={guardando}
                          style={{ flex: 1, padding: 12, background: 'var(--green)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, fontSize: 15 }}>
                          {guardando ? '⏳ Guardando...' : '✅ Sí, todo listo'}
                        </button>
                        <button onClick={() => setConfirmandoListo(false)} disabled={guardando}
                          style={{ padding: '12px 16px', background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmandoListo(true)} disabled={guardando}
                      style={{
                        flex: 1, minWidth: 200, padding: 14, borderRadius: 10, border: 'none',
                        background: todosOk ? 'var(--green)' : 'var(--gold)', color: '#000',
                        cursor: 'pointer', fontFamily: "'Bebas Neue', cursive", fontSize: 21, letterSpacing: 2,
                      }}>
                      📦 TODO LISTO
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Listos, esperando despacho del admin */}
      <h2 style={{ fontSize: 22, marginTop: 28, marginBottom: 10 }}>✅ Listos — esperando despacho ({listos.length})</h2>
      {listos.length === 0 && (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', background: 'var(--surface)', borderRadius: 12 }}>
          No hay pedidos listos sin despachar.
        </div>
      )}
      {listos.map(p => {
        const totKgReal = (p.items || []).reduce((s, it) => s + parseNumero(it.kg_real), 0)
        return (
          <div key={p.id} style={{ background: 'var(--surface)', border: '1px solid #3f6d2f', borderRadius: 12, padding: 14, marginBottom: 10, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>📦 {p.cliente_nombre}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                Para el {p.dia_entrega || 'sin fecha'} · {(p.items || []).length} producto(s) · {fmtKg(totKgReal)} reales
                {p.preparado_por ? ` · preparado por ${p.preparado_por}` : ''}
              </div>
            </div>
            <span style={{ background: '#1a2a1a', color: '#7dff7d', border: '1px solid #3f6d2f', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 800 }}>
              LISTO ✅
            </span>
          </div>
        )
      })}
    </div>
  )
}
