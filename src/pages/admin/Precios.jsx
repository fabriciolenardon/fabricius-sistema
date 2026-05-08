import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'

const CATEGORIAS = {
  bovino_corte: '🥩 Bovinos — Cortes',
  bovino_brosa: '🫀 Brosas',
  bovino_pieza: '🍖 Piezas',
  cerdo_corte: '🐷 Cerdo',
  embutido: '🌭 Embutidos',
  pollo: '🍗 Pollo Cajones',
  rebozado: '🧊 Rebozados',
}

const VACIO = { categoria: 'bovino_corte', nombre: '', precio_carniceria: '', precio_mayorista: '', precio_minorista: '' }
const fmt = n => n != null ? '$' + Math.round(n).toLocaleString('es-AR') : '—'
const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%', boxSizing: 'border-box' }

export default function Precios() {
  const [tab, setTab] = useState('ver')
  const [precios, setPrecios] = useState([])
  const [filtro, setFiltro] = useState('bovino_corte')
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(VACIO)
  const [editando, setEditando] = useState(null)
  const [msg, setMsg] = useState('')
  const [chatMsgs, setChatMsgs] = useState([{ rol: 'ia', texto: '¡Hola Fabricio! 🥩 Soy tu asistente de Carnicerías Fabricius. Podés pedirme que consulte precios, te ayude a entender la lista o lo que necesites.' }])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('precios').select('*').order('nombre')
    setPrecios(data || [])
    setLoading(false)
  }

  function mostrarMsg(texto) { setMsg(texto); setTimeout(() => setMsg(''), 3000) }

  async function guardar() {
    if (!form.nombre.trim()) return mostrarMsg('❌ El nombre es obligatorio')
    setLoading(true)
    const datos = {
      categoria: form.categoria,
      nombre: form.nombre,
      precio_carniceria: form.precio_carniceria === '' ? null : Number(form.precio_carniceria),
      precio_mayorista: form.precio_mayorista === '' ? null : Number(form.precio_mayorista),
      precio_minorista: form.precio_minorista === '' ? null : Number(form.precio_minorista),
    }
    if (editando) {
      await supabase.from('precios').update(datos).eq('id', editando)
      mostrarMsg('✅ Precio actualizado')
    } else {
      await supabase.from('precios').insert(datos)
      mostrarMsg('✅ Producto agregado')
    }
    setForm(VACIO); setEditando(null)
    await cargar(); setLoading(false)
  }

  async function eliminar(id) {
    if (!confirm('¿Seguro que querés eliminar este producto?')) return
    await supabase.from('precios').delete().eq('id', id)
    mostrarMsg('🗑️ Eliminado'); await cargar()
  }

  function editar(p) {
    setEditando(p.id)
    setForm({ categoria: p.categoria, nombre: p.nombre, precio_carniceria: p.precio_carniceria ?? '', precio_mayorista: p.precio_mayorista ?? '', precio_minorista: p.precio_minorista ?? '' })
    setFiltro(p.categoria)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function enviarChat() {
    if (!chatInput.trim() || chatLoading) return
    const pregunta = chatInput.trim()
    setChatInput('')
    setChatMsgs(m => [...m, { rol: 'user', texto: pregunta }])
    setChatLoading(true)
    const listaTexto = precios.map(p =>
      `- ${p.nombre} (${CATEGORIAS[p.categoria]}): Carn $${p.precio_carniceria ?? '—'} / May $${p.precio_mayorista ?? '—'} / Min $${p.precio_minorista ?? '—'}`
    ).join('\n')
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openrouter/auto',
          messages: [
            { role: 'system', content: `Sos el asistente de Carnicerías Fabricius, una carnicería mayorista argentina. Respondé en español argentino, de forma amigable y directa.\n\nREGLAS IMPORTANTES:\n1. NUNCA inventes precios. Solo usá los precios exactos de la lista.\n2. Cuando pregunten por un producto, respondé EXACTAMENTE así:\n"El precio de [NOMBRE PRODUCTO] es:\n🔴 Precio Carnicería: $[precio] por kg (para carnicerías revendedoras)\n🟡 Precio Mayorista: $[precio] por kg (para compradores al por mayor)\n🟢 Precio Minorista: $[precio] por kg (para consumidor final)"\n3. Si el precio es — significa que no aplica para esa lista.\n4. Si no encontrás el producto exacto, buscá el más parecido y avisá.\n\nLISTA DE PRECIOS (Carn=carnicería / May=mayorista / Min=minorista):\n${listaTexto}` },
            ...chatMsgs.filter((_, i) => i > 0).map(m => ({ role: m.rol === 'user' ? 'user' : 'assistant', content: m.texto })),
            { role: 'user', content: pregunta }
          ]
        })
      })
      const data = await res.json()
      const respuesta = (data.choices?.[0]?.message?.content || JSON.stringify(data)).replace(/\*\*/g, '').replace(/\*/g, '')
      setChatMsgs(m => [...m, { rol: 'ia', texto: respuesta }])
    } catch (err) {
      setChatMsgs(m => [...m, { rol: 'ia', texto: '❌ Error: ' + err.message }])
    }
    setChatLoading(false)
  }

  const productosFiltrados = precios.filter(p => p.categoria === filtro)
  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: tab === id ? 'var(--gold)' : 'var(--surface)', color: tab === id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 13 }}>
      {label}
    </button>
  )

  return (
    <div>
      <div className="page-title">PRECIOS</div>
      <div className="page-sub">Consultá, administrá y usá la IA para gestionar tus precios</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {tabBtn('ver', '📋 Ver Precios')}
        {tabBtn('admin', '✏️ Administrar')}
        {tabBtn('chat', '🤖 Asistente IA')}
      </div>
      {msg && <div style={{ background: '#1a2a1a', border: '1px solid #2d5a2d', borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: '#7dff7d', fontWeight: 600 }}>{msg}</div>}

      {tab === 'ver' && (
        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {Object.entries(CATEGORIAS).map(([id, label]) => (
              <button key={id} onClick={() => setFiltro(id)}
                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: filtro === id ? 'var(--gold)' : 'transparent', color: filtro === id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
                {label}
              </button>
            ))}
          </div>
          <div className="card">
            <div className="card-title">{CATEGORIAS[filtro]}</div>
            {loading ? <p style={{ color: 'var(--muted)' }}>Cargando...</p> : (
              <table>
                <thead><tr>
                  <th style={{ width: '50%' }}>Producto</th>
                  <th style={{ color: 'var(--red-light)' }}>🔴 Carnicería</th>
                  <th style={{ color: 'var(--amber)' }}>🟡 Mayorista</th>
                  <th style={{ color: 'var(--green)' }}>🟢 Minorista</th>
                </tr></thead>
                <tbody>
                  {productosFiltrados.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>{p.nombre}</td>
                      <td style={{ color: 'var(--red-light)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_carniceria)}</td>
                      <td style={{ color: 'var(--amber)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_mayorista)}</td>
                      <td style={{ color: 'var(--green)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_minorista)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'admin' && (
        <div>
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-title">{editando ? '✏️ Editando producto' : '➕ Agregar producto'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Categoría</label>
                <select value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} style={inp}>
                  {Object.entries(CATEGORIAS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nombre del producto</label>
                <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: Asado x kg" style={inp} />
              </div>
              {[['precio_carniceria', '🔴 Precio Carnicería'], ['precio_mayorista', '🟡 Precio Mayorista'], ['precio_minorista', '🟢 Precio Minorista']].map(([campo, label]) => (
                <div key={campo}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{label}</label>
                  <input type="number" value={form[campo]} onChange={e => setForm({ ...form, [campo]: e.target.value })} placeholder="Vacío = —" style={inp} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={guardar} disabled={loading}
                style={{ flex: 1, padding: '10px 0', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                {loading ? 'Guardando...' : editando ? '💾 Guardar cambios' : '➕ Agregar'}
              </button>
              {editando && (
                <button onClick={() => { setEditando(null); setForm(VACIO) }}
                  style={{ padding: '10px 20px', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                  Cancelar
                </button>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {Object.entries(CATEGORIAS).map(([id, label]) => (
              <button key={id} onClick={() => setFiltro(id)}
                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: filtro === id ? 'var(--gold)' : 'transparent', color: filtro === id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
                {label}
              </button>
            ))}
          </div>
          <div className="card">
            <div className="card-title">{CATEGORIAS[filtro]} — {productosFiltrados.length} productos</div>
            <table>
              <thead><tr>
                <th>Producto</th>
                <th style={{ color: 'var(--red-light)' }}>🔴 Carn.</th>
                <th style={{ color: 'var(--amber)' }}>🟡 May.</th>
                <th style={{ color: 'var(--green)' }}>🟢 Min.</th>
                <th>Acciones</th>
              </tr></thead>
              <tbody>
                {productosFiltrados.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.nombre}</td>
                    <td style={{ color: 'var(--red-light)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_carniceria)}</td>
                    <td style={{ color: 'var(--amber)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_mayorista)}</td>
                    <td style={{ color: 'var(--green)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_minorista)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => editar(p)} style={{ padding: '4px 10px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>✏️</button>
                        <button onClick={() => eliminar(p.id)} style={{ padding: '4px 10px', background: '#3a1a1a', color: '#ff6b6b', border: '1px solid #5a2a2a', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'chat' && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 520 }}>
          <div className="card-title">🤖 Asistente IA — Carnicerías Fabricius</div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16, paddingRight: 4 }}>
            {chatMsgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.rol === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '80%', padding: '10px 14px', borderRadius: 12, background: m.rol === 'user' ? 'var(--gold)' : 'var(--surface)', color: m.rol === 'user' ? '#000' : 'var(--text)', fontSize: 14, lineHeight: 1.5, fontFamily: "'DM Sans',sans-serif", border: m.rol === 'ia' ? '1px solid var(--border)' : 'none', whiteSpace: 'pre-wrap' }}>
                  {m.texto}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: 14 }}>Pensando... ⏳</div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && enviarChat()} placeholder="Preguntame sobre precios, productos..." style={{ ...inp, flex: 1 }} />
            <button onClick={enviarChat} disabled={chatLoading} style={{ padding: '8px 18px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
              Enviar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
