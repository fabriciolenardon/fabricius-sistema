import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
const CATEGORIAS = {
  bovino_mr: '🐄 Media Reses',
  bovino_corte: '🥩 Bovinos — Cortes',
  bovino_brosa: '🫀 Brosas',
  bovino_pieza: '🍖 Piezas Bovinas',
  bovino_caja_cb: '📦 Cajas Bovinas CB',
  bovino_caja_pt: '📦 Cajas Bovinas PT',
  cerdo_corte: '🐷 Cerdo — Cortes',
  cerdo_pieza: '🐷 Cerdo — Piezas',
  embutido: '🌭 Embutidos',
  pollo: '🍗 Pollo Cajones',
  rebozado: '🧊 Rebozados',
  almacen: '🛒 Almacén',
  bebidas: '🥤 Bebidas',
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
  const [chatMsgs, setChatMsgs] = useState([{ rol: 'ia', texto: '¡Hola! 🥩 Soy el asistente de Carnicerías Fabricius. Consultame precios, productos o lo que necesites.' }])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  // Actualización masiva
  const [masivoCat, setMasivoCat] = useState('todas')
  const [masivoLista, setMasivoLista] = useState('todas')
  const [masivoPct, setMasivoPct] = useState('')
  const [masivoLoading, setMasivoLoading] = useState(false)
  const [masivoPreview, setMasivoPreview] = useState([])

  // Ofertas
  const [ofertas, setOfertas] = useState([])
  const [ofertaForm, setOfertaForm] = useState({ precio_id: '', precio_oferta: '', fecha_inicio: new Date().toISOString().split('T')[0], fecha_fin: '', notas: '' })
  const [ofertaLoading, setOfertaLoading] = useState(false)
  const [busquedaOferta, setBusquedaOferta] = useState('')
  const [mostrarDropdown, setMostrarDropdown] = useState(false)
  const [productoSeleccionado, setProductoSeleccionado] = useState(null)

  useEffect(() => { cargar(); cargarOfertas() }, [])

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('precios').select('*').order('nombre')
    setPrecios(data || [])
    setLoading(false)
  }

  async function cargarOfertas() {
    const { data } = await supabase.from('ofertas').select('*').order('fecha_inicio', { ascending: false })
    setOfertas(data || [])
  }

  function mostrarMsg(texto) { setMsg(texto); setTimeout(() => setMsg(''), 3000) }

  async function guardar() {
    if (!form.nombre.trim()) return mostrarMsg('❌ El nombre es obligatorio')
    setLoading(true)
    const datos = {
      categoria: form.categoria, nombre: form.nombre,
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

  // Masivo
  function calcularPreview() {
    const pct = parseFloat(masivoPct)
    if (!pct) return setMasivoPreview([])
    const filtrados = masivoCat === 'todas' ? precios : precios.filter(p => p.categoria === masivoCat)
    setMasivoPreview(filtrados.map(p => ({
      ...p,
      nuevo_carniceria: masivoLista === 'todas' || masivoLista === 'carniceria' ? Math.round((p.precio_carniceria || 0) * (1 + pct / 100)) : p.precio_carniceria,
      nuevo_mayorista: masivoLista === 'todas' || masivoLista === 'mayorista' ? Math.round((p.precio_mayorista || 0) * (1 + pct / 100)) : p.precio_mayorista,
      nuevo_minorista: masivoLista === 'todas' || masivoLista === 'minorista' ? Math.round((p.precio_minorista || 0) * (1 + pct / 100)) : p.precio_minorista,
    })))
  }

  async function aplicarMasivo() {
    if (!masivoPct || masivoPreview.length === 0) return
    if (!confirm(`¿Confirmar actualización de ${masivoPreview.length} productos con ${masivoPct}%?`)) return
    setMasivoLoading(true)
    for (const p of masivoPreview) {
      const update = {}
      if (masivoLista === 'todas' || masivoLista === 'carniceria') update.precio_carniceria = p.nuevo_carniceria
      if (masivoLista === 'todas' || masivoLista === 'mayorista') update.precio_mayorista = p.nuevo_mayorista
      if (masivoLista === 'todas' || masivoLista === 'minorista') update.precio_minorista = p.nuevo_minorista
      await supabase.from('precios').update(update).eq('id', p.id)
    }
    setMasivoLoading(false)
    setMasivoPct(''); setMasivoPreview([])
    mostrarMsg(`✅ ${masivoPreview.length} productos actualizados con ${masivoPct}%`)
    await cargar()
  }

  // Ofertas
  function seleccionarProductoOferta(p) {
    setProductoSeleccionado(p)
    setBusquedaOferta(p.nombre)
    setOfertaForm(f => ({ ...f, precio_id: p.id }))
    setMostrarDropdown(false)
  }

  async function guardarOferta() {
    if (!ofertaForm.precio_id || !ofertaForm.precio_oferta || !ofertaForm.fecha_inicio || !ofertaForm.fecha_fin) {
      mostrarMsg('❌ Completá todos los campos de la oferta'); return
    }
    if (new Date(ofertaForm.fecha_fin) < new Date(ofertaForm.fecha_inicio)) {
      mostrarMsg('❌ La fecha de fin debe ser posterior al inicio'); return
    }
    setOfertaLoading(true)
    await supabase.from('ofertas').insert({
      precio_id: ofertaForm.precio_id,
      producto_nombre: productoSeleccionado?.nombre,
      precio_original_carniceria: productoSeleccionado?.precio_carniceria,
      precio_original_mayorista: productoSeleccionado?.precio_mayorista,
      precio_original_minorista: productoSeleccionado?.precio_minorista,
      precio_oferta: parseFloat(ofertaForm.precio_oferta),
      fecha_inicio: ofertaForm.fecha_inicio,
      fecha_fin: ofertaForm.fecha_fin,
      activa: true,
      notas: ofertaForm.notas
    })
    setOfertaLoading(false)
    mostrarMsg('✅ Oferta registrada correctamente')
    setOfertaForm({ precio_id: '', precio_oferta: '', fecha_inicio: new Date().toISOString().split('T')[0], fecha_fin: '', notas: '' })
    setBusquedaOferta(''); setProductoSeleccionado(null)
    await cargarOfertas()
  }

  async function desactivarOferta(id) {
    await supabase.from('ofertas').update({ activa: false }).eq('id', id)
    mostrarMsg('✅ Oferta desactivada')
    await cargarOfertas()
  }

  const hoy = new Date().toISOString().split('T')[0]
  const ofertasVigentes = ofertas.filter(o => o.activa && o.fecha_inicio <= hoy && o.fecha_fin >= hoy)
  const ofertasVencidas = ofertas.filter(o => !o.activa || o.fecha_fin < hoy)
  const productosFiltrados = precios.filter(p => p.categoria === filtro)
  const productosBusqueda = precios.filter(p => p.nombre.toLowerCase().includes(busquedaOferta.toLowerCase()))

  // Precios vigentes aplicando ofertas
  const preciosConOfertas = precios.map(p => {
    const oferta = ofertasVigentes.find(o => o.precio_id === p.id)
    if (oferta) return { ...p, precio_carniceria: oferta.precio_oferta, precio_mayorista: oferta.precio_oferta, precio_minorista: oferta.precio_oferta, enOferta: true, oferta }
    return p
  })
  const productosFiltradosConOfertas = preciosConOfertas.filter(p => p.categoria === filtro)

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
            { role: 'system', content: `Sos el asistente de Carnicerías Fabricius. Respondé en español argentino, directo y sin markdown.\n\nLISTA DE PRECIOS:\n${listaTexto}` },
            ...chatMsgs.filter((_, i) => i > 0).map(m => ({ role: m.rol === 'user' ? 'user' : 'assistant', content: m.texto })),
            { role: 'user', content: pregunta }
          ]
        })
      })
      const data = await res.json()
      const respuesta = (data.choices?.[0]?.message?.content || '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/#/g, '').trim()
      setChatMsgs(m => [...m, { rol: 'ia', texto: respuesta }])
    } catch (err) {
      setChatMsgs(m => [...m, { rol: 'ia', texto: '❌ Error: ' + err.message }])
    }
    setChatLoading(false)
  }

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: tab === id ? 'var(--gold)' : 'var(--surface)', color: tab === id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 13 }}>
      {label}
    </button>
  )

  return (
    <div>
      <div className="page-title">PRECIOS</div>
      <div className="page-sub">Consultá, administrá y usá la IA para gestionar tus precios</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabBtn('ver', '📋 Ver Precios')}
        {tabBtn('admin', '✏️ Administrar')}
        {tabBtn('masivo', '🚀 Actualización masiva')}
        {tabBtn('ofertas', `🏷️ Ofertas${ofertasVigentes.length > 0 ? ` (${ofertasVigentes.length})` : ''}`)}
        {tabBtn('chat', '🤖 Asistente IA')}
{tabBtn('plu', '🏷️ PLU / Balanza')}
      </div>
      {msg && <div style={{ background: msg.includes('❌') ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${msg.includes('❌') ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: msg.includes('❌') ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>{msg}</div>}

      {tab === 'ver' && (
        <div>
          {ofertasVigentes.length > 0 && (
            <div style={{ background: '#1a2a0a', border: '1px solid #4a8a2a', borderRadius: 10, padding: '10px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#7dff7d', marginBottom: 6 }}>🏷️ Ofertas vigentes esta semana</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {ofertasVigentes.map(o => (
                  <div key={o.id} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '6px 12px', fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>{o.producto_nombre}</span>
                    <span style={{ color: 'var(--gold)', fontWeight: 700, marginLeft: 8 }}>${Math.round(o.precio_oferta).toLocaleString('es-AR')}</span>
                    <span style={{ color: 'var(--muted)', marginLeft: 6 }}>hasta {o.fecha_fin}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                  <th style={{ width: '45%' }}>Producto</th>
                  <th style={{ color: 'var(--red-light)' }}>🔴 Carnicería</th>
                  <th style={{ color: 'var(--amber)' }}>🟡 Mayorista</th>
                  <th style={{ color: 'var(--green)' }}>🟢 Minorista</th>
                </tr></thead>
                <tbody>
                  {productosFiltradosConOfertas.map(p => (
                    <tr key={p.id} style={{ background: p.enOferta ? 'rgba(125,255,125,0.04)' : 'transparent' }}>
                      <td style={{ fontWeight: 500 }}>
                        {p.nombre}
                        {p.enOferta && <span style={{ marginLeft: 8, background: '#4a8a2a', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>🏷️ OFERTA</span>}
                      </td>
                      <td style={{ color: p.enOferta ? '#7dff7d' : 'var(--red-light)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_carniceria)}</td>
                      <td style={{ color: p.enOferta ? '#7dff7d' : 'var(--amber)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_mayorista)}</td>
                      <td style={{ color: p.enOferta ? '#7dff7d' : 'var(--green)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_minorista)}</td>
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

      {tab === 'masivo' && (
        <div>
          <div className="card" style={{ marginBottom: 20, borderColor: 'var(--gold)' }}>
            <div className="card-title">🚀 Actualización masiva de precios</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Actualizá todos los precios de una categoría con un porcentaje de aumento o reducción.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Categoría</label>
                <select value={masivoCat} onChange={e => { setMasivoCat(e.target.value); setMasivoPreview([]) }} style={inp}>
                  <option value="todas">📦 Todas las categorías</option>
                  {Object.entries(CATEGORIAS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Lista de precios</label>
                <select value={masivoLista} onChange={e => { setMasivoLista(e.target.value); setMasivoPreview([]) }} style={inp}>
                  <option value="todas">💰 Todas las listas</option>
                  <option value="carniceria">🔴 Solo Carnicería</option>
                  <option value="mayorista">🟡 Solo Mayorista</option>
                  <option value="minorista">🟢 Solo Minorista</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Porcentaje (+ aumento / - reducción)</label>
                <input type="number" step="0.5" placeholder="Ej: 10 para +10%" value={masivoPct} onChange={e => { setMasivoPct(e.target.value); setMasivoPreview([]) }} style={{ ...inp, borderColor: masivoPct ? 'var(--gold)' : 'var(--border)' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={calcularPreview} disabled={!masivoPct}
                style={{ padding: '10px 20px', background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--gold)', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}>
                👁️ Ver preview
              </button>
              <button onClick={aplicarMasivo} disabled={masivoLoading || masivoPreview.length === 0}
                style={{ padding: '10px 20px', background: masivoPreview.length > 0 ? 'var(--gold)' : 'var(--surface2)', color: masivoPreview.length > 0 ? '#000' : 'var(--muted)', border: 'none', borderRadius: 8, fontWeight: 700, cursor: masivoPreview.length > 0 ? 'pointer' : 'not-allowed', fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}>
                {masivoLoading ? '⏳ Aplicando...' : `✅ Aplicar a ${masivoPreview.length} productos`}
              </button>
            </div>
          </div>
          {masivoPreview.length > 0 && (
            <div className="card">
              <div className="card-title">👁️ Preview — {masivoPreview.length} productos afectados</div>
              <table>
                <thead><tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  {(masivoLista === 'todas' || masivoLista === 'carniceria') && <th style={{ color: 'var(--red-light)' }}>🔴 Carn. → nuevo</th>}
                  {(masivoLista === 'todas' || masivoLista === 'mayorista') && <th style={{ color: 'var(--amber)' }}>🟡 May. → nuevo</th>}
                  {(masivoLista === 'todas' || masivoLista === 'minorista') && <th style={{ color: 'var(--green)' }}>🟢 Min. → nuevo</th>}
                </tr></thead>
                <tbody>
                  {masivoPreview.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>{p.nombre}</td>
                      <td style={{ fontSize: 11, color: 'var(--muted)' }}>{CATEGORIAS[p.categoria]}</td>
                      {(masivoLista === 'todas' || masivoLista === 'carniceria') && <td>{fmt(p.precio_carniceria)} → <strong style={{ color: 'var(--gold)' }}>{fmt(p.nuevo_carniceria)}</strong></td>}
                      {(masivoLista === 'todas' || masivoLista === 'mayorista') && <td>{fmt(p.precio_mayorista)} → <strong style={{ color: 'var(--gold)' }}>{fmt(p.nuevo_mayorista)}</strong></td>}
                      {(masivoLista === 'todas' || masivoLista === 'minorista') && <td>{fmt(p.precio_minorista)} → <strong style={{ color: 'var(--gold)' }}>{fmt(p.nuevo_minorista)}</strong></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'ofertas' && (
        <div>
          {/* NUEVA OFERTA */}
          <div className="card" style={{ marginBottom: 20, borderColor: '#4a8a2a' }}>
            <div className="card-title">🏷️ Nueva oferta semanal</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              El precio de oferta aplica igual para todas las listas (carnicería, mayorista y minorista) durante la vigencia.
            </div>

            <div style={{ position: 'relative', marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Buscar producto</label>
              <input
                value={busquedaOferta}
                onChange={e => { setBusquedaOferta(e.target.value); setMostrarDropdown(true); setProductoSeleccionado(null); setOfertaForm(f => ({ ...f, precio_id: '' })) }}
                onFocus={() => setMostrarDropdown(true)}
                placeholder="Escribí el nombre del producto..."
                style={{ ...inp, borderColor: productoSeleccionado ? '#4a8a2a' : 'var(--border)' }}
              />
              {mostrarDropdown && busquedaOferta && productosBusqueda.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 100, maxHeight: 200, overflowY: 'auto' }}>
                  {productosBusqueda.map(p => (
                    <div key={p.id} onClick={() => seleccionarProductoOferta(p)}
                      style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}
                      onMouseOver={e => e.currentTarget.style.background = 'var(--surface2)'}
                      onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                      <span style={{ fontWeight: 600 }}>{p.nombre}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{CATEGORIAS[p.categoria]}</span>
                    </div>
                  ))}
                </div>
              )}
              {productoSeleccionado && (
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
                  Precios actuales — 🔴 Carn: {fmt(productoSeleccionado.precio_carniceria)} / 🟡 May: {fmt(productoSeleccionado.precio_mayorista)} / 🟢 Min: {fmt(productoSeleccionado.precio_minorista)}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>💥 Precio de oferta ($)</label>
                <input type="number" value={ofertaForm.precio_oferta} onChange={e => setOfertaForm(f => ({ ...f, precio_oferta: e.target.value }))} placeholder="Precio promocional" style={{ ...inp, borderColor: 'var(--green)' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>📅 Fecha inicio</label>
                <input type="date" value={ofertaForm.fecha_inicio} onChange={e => setOfertaForm(f => ({ ...f, fecha_inicio: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>📅 Fecha fin</label>
                <input type="date" value={ofertaForm.fecha_fin} onChange={e => setOfertaForm(f => ({ ...f, fecha_fin: e.target.value }))} style={inp} />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Notas</label>
              <input value={ofertaForm.notas} onChange={e => setOfertaForm(f => ({ ...f, notas: e.target.value }))} placeholder="Ej: Oferta de semana santa, liquidación..." style={inp} />
            </div>

            {productoSeleccionado && ofertaForm.precio_oferta && (
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
                <span style={{ color: 'var(--muted)' }}>Precio actual: </span>
                <span style={{ textDecoration: 'line-through', color: 'var(--red-light)' }}>{fmt(productoSeleccionado.precio_carniceria)}</span>
                <span style={{ color: 'var(--muted)', margin: '0 8px' }}>→</span>
                <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 16 }}>{fmt(parseFloat(ofertaForm.precio_oferta))}</span>
                {productoSeleccionado.precio_carniceria > 0 && (
                  <span style={{ marginLeft: 8, background: '#4a8a2a', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                    -{Math.round((1 - parseFloat(ofertaForm.precio_oferta) / productoSeleccionado.precio_carniceria) * 100)}%
                  </span>
                )}
              </div>
            )}

            <button onClick={guardarOferta} disabled={ofertaLoading}
              style={{ padding: '10px 24px', background: '#4a8a2a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
              {ofertaLoading ? '⏳ Guardando...' : '✅ Registrar oferta'}
            </button>
          </div>

          {/* OFERTAS VIGENTES */}
          {ofertasVigentes.length > 0 && (
            <div className="card" style={{ marginBottom: 16, borderColor: '#4a8a2a' }}>
              <div className="card-title">✅ Ofertas vigentes ahora</div>
              <table>
                <thead><tr><th>Producto</th><th>Precio oferta</th><th>Precio original</th><th>Descuento</th><th>Vigencia</th><th>Acciones</th></tr></thead>
                <tbody>
                  {ofertasVigentes.map(o => (
                    <tr key={o.id}>
                      <td style={{ fontWeight: 600 }}>{o.producto_nombre}</td>
                      <td style={{ color: 'var(--green)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(o.precio_oferta)}</td>
                      <td style={{ color: 'var(--muted)', textDecoration: 'line-through' }}>{fmt(o.precio_original_carniceria)}</td>
                      <td>
                        {o.precio_original_carniceria > 0 && (
                          <span style={{ background: '#4a8a2a', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                            -{Math.round((1 - o.precio_oferta / o.precio_original_carniceria) * 100)}%
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--muted)' }}>{o.fecha_inicio} → {o.fecha_fin}</td>
                      <td>
                        <button onClick={() => desactivarOferta(o.id)}
                          style={{ padding: '4px 10px', background: '#3a1a1a', color: '#ff6b6b', border: '1px solid #5a2a2a', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                          ✕ Desactivar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* HISTORIAL */}
          {ofertasVencidas.length > 0 && (
            <div className="card">
              <div className="card-title">📁 Historial de ofertas</div>
              <table>
                <thead><tr><th>Producto</th><th>Precio oferta</th><th>Vigencia</th><th>Estado</th></tr></thead>
                <tbody>
                  {ofertasVencidas.map(o => (
                    <tr key={o.id} style={{ opacity: 0.6 }}>
                      <td>{o.producto_nombre}</td>
                      <td style={{ color: 'var(--muted)' }}>{fmt(o.precio_oferta)}</td>
                      <td style={{ fontSize: 11, color: 'var(--muted)' }}>{o.fecha_inicio} → {o.fecha_fin}</td>
                      <td><span style={{ background: '#3a1a1a', color: '#ff6b6b', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>Vencida</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
            <button onClick={enviarChat} disabled={chatLoading} style={{ padding: '8px 18px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>Enviar</button>
          </div>
        </div>
      )}

     {tab === 'plu' && (
  <PLUTab precios={precios} ofertas={ofertas} />
)}    </div>
  )
function PLUTab({ precios, ofertas = [] }) {
  const [plus, setPlus] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  useEffect(() => { cargarPlus() }, [precios])

 async function cargarPlus() {
    setLoading(true)
    const { data: plusGuardados } = await supabase.from('plu').select('*').order('codigo')
    const guardados = plusGuardados || []

    // Detectar productos nuevos que no tienen PLU asignado
    const idsConPlu = new Set(guardados.map(p => p.precio_id))
    const productosSinPlu = precios.filter(p =>
      p.precio_minorista > 0 && !idsConPlu.has(p.id)
    )

    // Asignar códigos nuevos a partir del último usado
    const maxCodigo = guardados.reduce((max, p) => {
      const n = parseInt(p.codigo, 10) || 0
      return n > max ? n : max
    }, 0)

    const nuevosPlus = productosSinPlu.map((p, i) => ({
      codigo: String(maxCodigo + i + 1).padStart(4, '0'),
      nombre: p.nombre,
      precio: p.precio_minorista,
      categoria: p.categoria,
      precio_id: p.id
    }))

    // Combinar guardados + nuevos
    const todos = [...guardados, ...nuevosPlus].sort((a, b) =>
      (a.codigo || '').localeCompare(b.codigo || '')
    )
    setPlus(todos)
    setLoading(false)
  }
  async function guardarTodos() {
    await supabase.from('plu').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    for (const p of plus) {
      await supabase.from('plu').insert({
        codigo: p.codigo,
        nombre: p.nombre,
        precio: p.precio,
        categoria: p.categoria,
        precio_id: p.precio_id
      })
    }
    setMsg('✅ PLU guardados correctamente')
    setTimeout(() => setMsg(''), 3000)
    cargarPlus()
  }

  function exportarCSV() {
  const hoy = new Date().toISOString().split('T')[0]
  const header = 'Codigo,Nombre,Precio\n'
  const rows = plus.map(p => {
    const ofertaVigente = ofertas?.find(o => 
      o.precio_id === p.precio_id && 
      o.activa && 
      o.fecha_inicio <= hoy && 
      o.fecha_fin >= hoy
    )
    const precioFinal = ofertaVigente ? ofertaVigente.precio_oferta : p.precio
    return `${p.codigo},"${p.nombre}",${precioFinal}`
  }).join('\n')
  const blob = new Blob([header + rows], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'PLU_Fabricius.csv'
  a.click()
}
  function editarPrecio(idx, valor) {
    setPlus(prev => prev.map((p, i) => i === idx ? { ...p, precio: parseFloat(valor) || 0 } : p))
  }

  function editarNombre(idx, valor) {
    setPlus(prev => prev.map((p, i) => i === idx ? { ...p, nombre: valor } : p))
  }

  function editarCodigo(idx, valor) {
    setPlus(prev => prev.map((p, i) => i === idx ? { ...p, codigo: valor } : p))
  }

  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '5px 8px', fontFamily: "'DM Sans',sans-serif", fontSize: 12 }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, borderColor: 'var(--gold)' }}>
        <div className="card-title">🏷️ PLU para Balanza Cuora Max</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
          Estos son los códigos PLU que se cargan en la balanza. Podés editar el código, nombre y precio, y exportar el archivo para importar en Qendra.
        </div>
        {msg && <div style={{ background: '#1a2a1a', border: '1px solid #2d5a2d', borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: '#7dff7d', fontWeight: 600 }}>{msg}</div>}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <button onClick={guardarTodos} className="btn btn-gold">💾 Guardar PLU</button>
          <button onClick={exportarCSV} className="btn btn-ghost">📥 Exportar CSV para Qendra</button>
        </div>
        {loading ? <div style={{ color: 'var(--muted)' }}>Cargando...</div> : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 80 }}>Código PLU</th>
                <th>Nombre en balanza</th>
                <th style={{ width: 120 }}>Precio minorista</th>
                <th>Categoría</th>
              </tr>
            </thead>
            <tbody>
              {plus.map((p, i) => (
                <tr key={i}>
                  <td><input value={p.codigo} onChange={e => editarCodigo(i, e.target.value)} style={{ ...inp, width: 70, textAlign: 'center', fontWeight: 700, color: 'var(--gold)' }} /></td>
                  <td><input value={p.nombre} onChange={e => editarNombre(i, e.target.value)} style={{ ...inp, width: '100%' }} /></td>
                  <td><input type="number" value={p.precio} onChange={e => editarPrecio(i, e.target.value)} style={{ ...inp, width: 100, borderColor: 'var(--green)' }} /></td>
                  <td style={{ fontSize: 11, color: 'var(--muted)' }}>{p.categoria}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
}