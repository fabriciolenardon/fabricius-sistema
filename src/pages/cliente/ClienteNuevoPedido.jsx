// ClienteNuevoPedido.jsx - Wizard guiado para que el cliente arme un pedido
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const CATEGORIAS = {
  bovino_corte: '🥩 Bovinos — Cortes',
  bovino_brosa: '🫀 Brosas',
  bovino_pieza: '🍖 Piezas',
  cerdo_corte: '🐷 Cerdo',
  embutido: '🌭 Embutidos',
  pollo: '🍗 Pollo Cajones',
  rebozado: '🧊 Rebozados',
}

const fmt = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR')
const ahora = () => new Date().toISOString()

function fechaMinimaEntrega() {
  // 12 horas de anticipación mínima
  const d = new Date()
  d.setHours(d.getHours() + 12)
  return d.toISOString().split('T')[0]
}

export default function ClienteNuevoPedido() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [cliente, setCliente] = useState(null)
  const [precios, setPrecios] = useState([])
  const [loading, setLoading] = useState(true)

  // Estado del wizard
  const [paso, setPaso] = useState('inicio')  // inicio | categoria | producto | cantidad | otro | dia | horario | notas | resumen | enviando | enviado
  const [carrito, setCarrito] = useState([])  // items agregados
  const [categoriaSel, setCategoriaSel] = useState(null)
  const [productoSel, setProductoSel] = useState(null)
  const [kgInput, setKgInput] = useState('')
  const [diaEntrega, setDiaEntrega] = useState('')
  const [horarioTipo, setHorarioTipo] = useState('')  // 'manana' | 'tarde' | 'especifico'
  const [horarioEspecifico, setHorarioEspecifico] = useState('')
  const [notas, setNotas] = useState('')
  const [chat, setChat] = useState([])
  const chatRef = useRef(null)

  // Scroll automatico al final del chat
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [chat])

  useEffect(() => {
    if (!profile?.cliente_id) { setLoading(false); return }
    cargar()
  }, [profile?.cliente_id])

  async function cargar() {
    setLoading(true)
    const [{ data: cli }, { data: pr }] = await Promise.all([
      supabase.from('clientes').select('*').eq('id', profile.cliente_id).maybeSingle(),
      supabase.from('precios').select('*').order('nombre'),
    ])
    setCliente(cli)
    setPrecios(pr || [])
    setLoading(false)
    // Mensaje inicial del bot
    setChat([{
      timestamp: ahora(),
      autor: 'bot',
      texto: `¡Hola ${cli?.nombre || ''}! Soy el asistente de Fabricius. Te voy a guiar para armar tu pedido. ¿Qué categoría querés pedir?`
    }])
    setPaso('categoria')
  }

  function pushBot(texto) {
    setChat(c => [...c, { timestamp: ahora(), autor: 'bot', texto }])
  }

  function pushCliente(texto) {
    setChat(c => [...c, { timestamp: ahora(), autor: 'cliente', texto }])
  }

  const listaPrecioField = cliente?.lista_precios === 'may' ? 'precio_mayorista' : 'precio_carniceria'
  const productosPorCategoria = categoriaSel ? precios.filter(p => p.categoria === categoriaSel) : []

  // === ACCIONES ===

  function seleccionarCategoria(cat) {
    setCategoriaSel(cat)
    pushCliente(`Quiero pedir de la categoría: ${CATEGORIAS[cat]}`)
    pushBot(`Genial. Estos son los productos de ${CATEGORIAS[cat]}. Elegí cuál querés:`)
    setPaso('producto')
  }

  function seleccionarProducto(prod) {
    setProductoSel(prod)
    pushCliente(`Elijo: ${prod.nombre}`)
    pushBot(`¿Cuántos kilos de ${prod.nombre} querés? El precio es ${fmt(prod[listaPrecioField])}/kg.`)
    setPaso('cantidad')
  }

  function agregarAlCarrito() {
    const kg = parseFloat(kgInput)
    if (!kg || kg <= 0) { alert('Ingresá una cantidad válida en kg'); return }
    const precio_unitario = productoSel[listaPrecioField] || 0
    const subtotal = kg * precio_unitario
    const item = {
      producto_id: productoSel.id,
      nombre: productoSel.nombre,
      categoria: productoSel.categoria,
      kg,
      precio_unitario,
      subtotal,
    }
    setCarrito(c => [...c, item])
    pushCliente(`${kg} kg de ${productoSel.nombre}`)
    pushBot(`Listo, agregué ${kg} kg de ${productoSel.nombre} (${fmt(subtotal)}). ¿Querés agregar otro producto o seguir con el pedido?`)
    setKgInput('')
    setProductoSel(null)
    setCategoriaSel(null)
    setPaso('otro')
  }

  function agregarOtro() {
    pushCliente('Quiero agregar otro producto')
    pushBot('Perfecto, ¿de qué categoría?')
    setPaso('categoria')
  }

  function continuarConPedido() {
    if (carrito.length === 0) { alert('Tenés que agregar al menos 1 producto'); return }
    pushCliente('Listo con productos, sigamos')
    pushBot('¡Bien! ¿Para qué día necesitás el pedido? Tené en cuenta que pedimos al menos 12 horas de anticipación.')
    setPaso('dia')
  }

  function confirmarDia() {
    if (!diaEntrega) { alert('Elegí una fecha'); return }
    if (diaEntrega < fechaMinimaEntrega()) {
      alert(`La fecha mínima es ${fechaMinimaEntrega()} (12 horas de anticipación)`)
      return
    }
    pushCliente(`Para el día ${diaEntrega}`)
    pushBot('¿Y en qué horario te queda mejor?')
    setPaso('horario')
  }

  function elegirHorario(tipo, especifico) {
    setHorarioTipo(tipo)
    let textoHorario = ''
    if (tipo === 'manana') textoHorario = 'Por la mañana (8-12hs)'
    else if (tipo === 'tarde') textoHorario = 'Por la tarde (14-18hs)'
    else { textoHorario = `Horario específico: ${especifico}`; setHorarioEspecifico(especifico) }
    pushCliente(textoHorario)
    pushBot('¿Querés dejar alguna nota o aclaración? (opcional)')
    setPaso('notas')
  }

  function continuarSinNotas() {
    pushCliente('Sin notas')
    setPaso('resumen')
    pushBot('Listo, te muestro el resumen de tu pedido. Si está todo OK, confirmalo.')
  }

  function continuarConNotas() {
    const n = notas.trim()
    if (n) pushCliente(`Nota: ${n}`)
    setPaso('resumen')
    pushBot('Listo, te muestro el resumen de tu pedido. Si está todo OK, confirmalo.')
  }

  function quitarItem(idx) {
    const item = carrito[idx]
    setCarrito(c => c.filter((_, i) => i !== idx))
    pushCliente(`Quito del pedido: ${item.nombre}`)
    pushBot('Ok, lo quité del pedido.')
  }

  async function confirmarPedido() {
    if (!cliente) return
    if (carrito.length === 0) { alert('No hay productos en el pedido'); return }
    setPaso('enviando')

    const horarioFinal = horarioTipo === 'especifico'
      ? horarioEspecifico
      : horarioTipo === 'manana' ? 'mañana (8-12hs)' : 'tarde (14-18hs)'

    const total = carrito.reduce((s, i) => s + i.subtotal, 0)
    const chatFinal = [...chat, { timestamp: ahora(), autor: 'cliente', texto: '✅ Pedido CONFIRMADO' }]

    const { data, error } = await supabase.from('pedidos').insert({
      cliente_id: cliente.id,
      cliente_nombre: cliente.nombre,
      estado: 'pendiente',
      dia_entrega: diaEntrega,
      horario_entrega: horarioFinal,
      items: carrito,
      mensajes_chat: chatFinal,
      total_estimado: total,
      notas_cliente: notas.trim() || null,
    }).select().single()

    if (error) {
      alert('❌ Error al guardar pedido: ' + error.message)
      setPaso('resumen')
      return
    }
    setPaso('enviado')
  }

  if (loading) return <div style={{ padding: 40, color: 'var(--muted)', textAlign: 'center' }}>Cargando...</div>
  if (!cliente) return <div style={{ padding: 40, color: 'var(--muted)', textAlign: 'center' }}>Tu perfil de cliente no pudo cargarse. Contactá al administrador.</div>

  const total = carrito.reduce((s, i) => s + i.subtotal, 0)

  // === RENDER ===
  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="page-title">📥 NUEVO PEDIDO</div>
      <div className="page-sub">Te guío paso a paso para armar tu pedido</div>

      <div style={{ display: 'grid', gridTemplateColumns: carrito.length > 0 ? '2fr 1fr' : '1fr', gap: 16, alignItems: 'flex-start' }}>
        {/* COLUMNA IZQUIERDA: CHAT + ACCIÓN ACTUAL */}
        <div>
          {/* Chat */}
          <div ref={chatRef} className="card" style={{ marginBottom: 16, maxHeight: 320, overflowY: 'auto', background: 'var(--surface2)' }}>
            {chat.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.autor === 'bot' ? 'flex-start' : 'flex-end', marginBottom: 8 }}>
                <div style={{
                  background: m.autor === 'bot' ? 'var(--surface)' : 'var(--gold)',
                  color: m.autor === 'bot' ? 'var(--text)' : '#000',
                  borderRadius: 12,
                  padding: '8px 14px',
                  maxWidth: '75%',
                  fontSize: 13,
                  border: m.autor === 'bot' ? '1px solid var(--border)' : 'none',
                }}>
                  {m.autor === 'bot' && <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 2 }}>🤖 Bot Fabricius</div>}
                  {m.texto}
                </div>
              </div>
            ))}
          </div>

          {/* ACCIÓN SEGÚN PASO */}
          {paso === 'categoria' && (
            <div className="card">
              <div className="card-title">Elegí una categoría</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {Object.entries(CATEGORIAS).map(([id, label]) => (
                  <button key={id} onClick={() => seleccionarCategoria(id)}
                    style={{ padding: '14px', borderRadius: 10, border: '1px solid var(--gold)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 14, fontWeight: 600, textAlign: 'left' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {paso === 'producto' && (
            <div className="card">
              <div className="card-title">Productos disponibles — {CATEGORIAS[categoriaSel]}</div>
              {productosPorCategoria.length === 0 ? (
                <div className="empty">Sin productos en esta categoría</div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {productosPorCategoria.map(p => (
                    <button key={p.id} onClick={() => seleccionarProducto(p)}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{p.nombre}</span>
                      <span style={{ color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p[listaPrecioField])}/kg</span>
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => { setCategoriaSel(null); setPaso('categoria') }} className="btn btn-ghost" style={{ marginTop: 12 }}>← Cambiar de categoría</button>
            </div>
          )}

          {paso === 'cantidad' && (
            <div className="card">
              <div className="card-title">¿Cuántos kg de {productoSel.nombre}?</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input type="number" step="0.1" min="0.1" autoFocus value={kgInput} onChange={e => setKgInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && agregarAlCarrito()}
                  placeholder="Ej: 5"
                  style={{ background: 'var(--surface2)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 8, padding: '10px 14px', fontSize: 18, width: 120, textAlign: 'center' }} />
                <span style={{ fontSize: 14, color: 'var(--muted)' }}>kg</span>
                <button onClick={agregarAlCarrito} className="btn btn-gold">✅ Agregar al pedido</button>
              </div>
              {kgInput && parseFloat(kgInput) > 0 && (
                <div style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>
                  Subtotal: <strong style={{ color: 'var(--gold)' }}>{fmt(parseFloat(kgInput) * (productoSel[listaPrecioField] || 0))}</strong>
                </div>
              )}
            </div>
          )}

          {paso === 'otro' && (
            <div className="card">
              <div className="card-title">¿Agregar otro producto?</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={agregarOtro} className="btn btn-ghost">➕ Sí, agregar otro</button>
                <button onClick={continuarConPedido} className="btn btn-gold">➡️ No, seguir con el pedido</button>
              </div>
            </div>
          )}

          {paso === 'dia' && (
            <div className="card">
              <div className="card-title">¿Para qué día necesitás el pedido?</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>📅 Mínimo 12 horas de anticipación. Te avisaremos por WhatsApp cuando esté listo.</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input type="date" autoFocus value={diaEntrega} min={fechaMinimaEntrega()} onChange={e => setDiaEntrega(e.target.value)}
                  style={{ background: 'var(--surface2)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 8, padding: '10px 14px', fontSize: 14 }} />
                <button onClick={confirmarDia} className="btn btn-gold">Continuar</button>
              </div>
            </div>
          )}

          {paso === 'horario' && (
            <div className="card">
              <div className="card-title">¿En qué horario te queda mejor?</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
                <button onClick={() => elegirHorario('manana')}
                  style={{ padding: '14px', borderRadius: 10, border: '1px solid var(--gold)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  ☀️ Mañana<br /><span style={{ fontSize: 11, color: 'var(--muted)' }}>8 a 12 hs</span>
                </button>
                <button onClick={() => elegirHorario('tarde')}
                  style={{ padding: '14px', borderRadius: 10, border: '1px solid var(--gold)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  🌅 Tarde<br /><span style={{ fontSize: 11, color: 'var(--muted)' }}>14 a 18 hs</span>
                </button>
                <button onClick={() => setHorarioTipo('especifico_input')}
                  style={{ padding: '14px', borderRadius: 10, border: '1px solid var(--gold)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  🕐 Horario<br /><span style={{ fontSize: 11, color: 'var(--muted)' }}>específico</span>
                </button>
              </div>
              {horarioTipo === 'especifico_input' && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
                  <input type="time" autoFocus value={horarioEspecifico} onChange={e => setHorarioEspecifico(e.target.value)}
                    style={{ background: 'var(--surface2)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 8, padding: '10px 14px', fontSize: 14 }} />
                  <button onClick={() => elegirHorario('especifico', horarioEspecifico)} disabled={!horarioEspecifico} className="btn btn-gold">Continuar</button>
                </div>
              )}
            </div>
          )}

          {paso === 'notas' && (
            <div className="card">
              <div className="card-title">¿Alguna nota o aclaración? (opcional)</div>
              <textarea autoFocus value={notas} onChange={e => setNotas(e.target.value)} rows={3}
                placeholder="Ej: que sea fresco, cortado fino, dejar en la puerta, etc."
                style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '10px 14px', fontSize: 13, width: '100%', boxSizing: 'border-box', marginBottom: 10, fontFamily: 'inherit' }} />
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={continuarSinNotas} className="btn btn-ghost">Sin notas</button>
                <button onClick={continuarConNotas} className="btn btn-gold">Continuar</button>
              </div>
            </div>
          )}

          {paso === 'resumen' && (
            <div className="card" style={{ borderColor: 'var(--gold)' }}>
              <div className="card-title">📝 Resumen final de tu pedido</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>Revisalo bien. Una vez confirmado, no podés modificarlo (solo cancelarlo).</div>

              <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>📦 Productos</div>
                {carrito.map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                    <span>{it.nombre} — {it.kg} kg</span>
                    <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{fmt(it.subtotal)}</span>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700 }}>
                  <span>Total estimado</span>
                  <span style={{ color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive", fontSize: 24 }}>{fmt(total)}</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>📅 Día de entrega</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{diaEntrega}</div>
                </div>
                <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>🕐 Horario</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {horarioTipo === 'manana' ? 'Mañana (8-12hs)' : horarioTipo === 'tarde' ? 'Tarde (14-18hs)' : horarioEspecifico}
                  </div>
                </div>
              </div>

              {notas.trim() && (
                <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 10, marginBottom: 14 }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>📝 Notas</div>
                  <div style={{ fontSize: 13 }}>{notas}</div>
                </div>
              )}

              <button onClick={confirmarPedido} className="btn btn-gold" style={{ width: '100%', padding: 14, fontSize: 15 }}>✅ Confirmar y enviar pedido</button>
            </div>
          )}

          {paso === 'enviando' && (
            <div className="card" style={{ textAlign: 'center', padding: 30 }}>
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>Enviando tu pedido...</div>
            </div>
          )}

          {paso === 'enviado' && (
            <div className="card" style={{ background: '#1a3a1a', border: '2px solid var(--green)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
              <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 32, color: 'var(--green)', marginBottom: 8 }}>✅ ¡PEDIDO ENVIADO!</div>
              <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 6 }}>Tu pedido quedó registrado. Te avisaremos por WhatsApp cuando esté confirmado y cuando esté listo para retirar.</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>Podés ver el estado en cualquier momento desde "📋 Mis pedidos".</div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button onClick={() => navigate('/cliente/pedidos')} className="btn btn-gold">📋 Ver mis pedidos</button>
                <button onClick={() => navigate('/cliente/dashboard')} className="btn btn-ghost">🏠 Volver al inicio</button>
              </div>
            </div>
          )}
        </div>

        {/* COLUMNA DERECHA: CARRITO en vivo */}
        {carrito.length > 0 && (
          <div className="card" style={{ position: 'sticky', top: 80, borderColor: 'var(--gold)' }}>
            <div className="card-title">🛒 Tu pedido</div>
            <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 10 }}>
              {carrito.map((it, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{it.nombre}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>{it.kg} kg × {fmt(it.precio_unitario)}/kg</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmt(it.subtotal)}</span>
                    {(paso === 'otro' || paso === 'resumen' || paso === 'categoria') && (
                      <button onClick={() => quitarItem(i)} style={{ background: 'none', border: 'none', color: 'var(--red-light)', cursor: 'pointer' }}>🗑️</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '2px solid var(--gold)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>TOTAL</span>
              <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 26, color: 'var(--gold)' }}>{fmt(total)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
