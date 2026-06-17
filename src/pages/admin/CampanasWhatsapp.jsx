// CampanasWhatsapp.jsx — Enviar campañas/ofertas por WhatsApp con plantilla
// aprobada de Meta. Elegís la oferta de la semana, a quiénes les llega
// (clientes por tipo o contactos de WhatsApp), probás a tu número y mandás.
// El texto libre masivo está prohibido por Meta → SIEMPRE va por plantilla.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

// El cuerpo de la plantilla 'ofertas_semana' (espejo de lo aprobado en Meta).
const renderMensaje = (nombre, oferta) =>
  `¡Hola ${nombre}! 🥩 En Carnicerías Fabricius esta semana tenemos: ${oferta || '…'}. ¡Te esperamos!`

const FUENTES = [
  { id: 'may',  label: '🚚 Mayoristas',        desc: 'Clientes mayoristas con teléfono' },
  { id: 'carn', label: '🏪 Carnicerías',       desc: 'Clientes carnicería con teléfono' },
  { id: 'cli',  label: '👥 Todos los clientes', desc: 'Todos los clientes con teléfono' },
  { id: 'wa',   label: '💬 Contactos WhatsApp', desc: 'Todos los que escribieron a Iris' },
]

const soloDigitos = (n) => String(n || '').replace(/[^0-9]/g, '')

export default function CampanasWhatsapp() {
  const [oferta, setOferta] = useState('')
  const [fuente, setFuente] = useState('may')
  const [lista, setLista] = useState([])          // [{telefono, nombre}]
  const [excluidos, setExcluidos] = useState(new Set())
  const [cargando, setCargando] = useState(false)
  const [numeroPrueba, setNumeroPrueba] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [historial, setHistorial] = useState([])

  // Cargar destinatarios según la fuente elegida.
  useEffect(() => {
    let vivo = true
    setCargando(true); setExcluidos(new Set())
    async function cargar() {
      let items = []
      if (fuente === 'wa') {
        const { data } = await supabase.from('wa_contactos').select('telefono,nombre,alias').order('ultimo_at', { ascending: false })
        items = (data || []).map(c => ({ telefono: c.telefono, nombre: c.alias || c.nombre || c.telefono }))
      } else {
        let q = supabase.from('clientes').select('nombre,nombre_fantasia,telefono,tipo')
        if (fuente === 'may') q = q.eq('tipo', 'mayorista')
        else if (fuente === 'carn') q = q.eq('tipo', 'carniceria')
        const { data } = await q
        items = (data || [])
          .filter(c => soloDigitos(c.telefono).length >= 8)
          .map(c => ({ telefono: c.telefono, nombre: c.nombre || c.nombre_fantasia || c.telefono }))
      }
      // Dedup por teléfono normalizado.
      const vistos = new Set(); const dedup = []
      for (const it of items) {
        const k = soloDigitos(it.telefono)
        if (k.length < 8 || vistos.has(k)) continue
        vistos.add(k); dedup.push(it)
      }
      if (vivo) { setLista(dedup); setCargando(false) }
    }
    cargar()
    return () => { vivo = false }
  }, [fuente])

  useEffect(() => { cargarHistorial() }, [])
  async function cargarHistorial() {
    const { data } = await supabase.from('wa_campanas').select('*').order('creado_at', { ascending: false }).limit(20)
    setHistorial(data || [])
  }

  const seleccionados = useMemo(
    () => lista.filter(d => !excluidos.has(soloDigitos(d.telefono))),
    [lista, excluidos])

  function toggle(tel) {
    const k = soloDigitos(tel)
    setExcluidos(prev => { const s = new Set(prev); s.has(k) ? s.delete(k) : s.add(k); return s })
  }

  async function llamar(destinatarios, prueba) {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { alert('Sesión expirada, volvé a entrar.'); return null }
    const r = await fetch('/api/wa-campana', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ oferta: oferta.trim(), destinatarios, prueba }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { alert('No se pudo enviar: ' + (j.error || r.status)); return null }
    return j
  }

  async function probar() {
    const tel = soloDigitos(numeroPrueba)
    if (!oferta.trim()) { alert('Escribí la oferta primero.'); return }
    if (tel.length < 8) { alert('Poné un número de prueba válido (con código de país, ej. 5493574...).'); return }
    setEnviando(true); setResultado(null)
    const j = await llamar([{ telefono: tel, nombre: 'Fabri' }], true)
    setEnviando(false)
    if (j) setResultado({ ...j, titulo: j.enviados ? '✅ Prueba enviada a tu número' : '❌ La prueba no salió' })
  }

  async function enviarCampana() {
    if (!oferta.trim()) { alert('Escribí la oferta primero.'); return }
    if (seleccionados.length === 0) { alert('No hay destinatarios seleccionados.'); return }
    if (!confirm(`Vas a enviar la oferta a ${seleccionados.length} contacto(s) por WhatsApp.\n\n¿Probaste primero a tu número? Confirmá para enviar a todos.`)) return
    if (!confirm(`Última confirmación: enviar a ${seleccionados.length} contacto(s). Esto NO se puede deshacer.`)) return
    setEnviando(true); setResultado(null)
    const j = await llamar(seleccionados.map(d => ({ telefono: d.telefono, nombre: d.nombre })), false)
    setEnviando(false)
    if (j) {
      setResultado({ ...j, titulo: `📣 Campaña enviada · ${j.enviados} ok · ${j.fallidos} con error` })
      cargarHistorial()
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 16, alignItems: 'start' }}>
      {/* ── Columna principal ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={aviso}>
          📣 Las campañas salen por <strong>plantilla aprobada de Meta</strong> (así no banean el número). Escribí la oferta, elegí a quién y <strong>probá siempre primero a tu número</strong> antes de mandar a todos.
        </div>

        {/* Oferta */}
        <div style={card}>
          <label style={lbl}>🥩 Oferta de la semana</label>
          <textarea value={oferta} onChange={e => setOferta(e.target.value)} rows={3}
            placeholder="Ej: asado a $9.500 el kilo, vacío a $11.000 y bondiola a $8.200"
            style={textarea} />
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Vista previa:</div>
          <div style={preview}>{renderMensaje(seleccionados[0]?.nombre?.split(' ')[0] || 'Carlos', oferta.trim())}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>El nombre se completa solo con cada cliente. La firma “Carnicerías Fabricius — Río Primero, Córdoba” va al pie (de la plantilla).</div>
        </div>

        {/* Destinatarios */}
        <div style={card}>
          <label style={lbl}>📋 Destinatarios</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 12px' }}>
            {FUENTES.map(f => (
              <button key={f.id} onClick={() => setFuente(f.id)} title={f.desc}
                style={{ ...chip, ...(fuente === f.id ? chipOn : {}) }}>{f.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 8 }}>
            {cargando ? 'Cargando…' : <><strong>{seleccionados.length}</strong> de {lista.length} seleccionados</>}
          </div>
          <div style={listaBox}>
            {!cargando && lista.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13, padding: 8 }}>No hay contactos con teléfono en esta fuente.</div>}
            {lista.map(d => {
              const k = soloDigitos(d.telefono)
              const on = !excluidos.has(k)
              return (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', opacity: on ? 1 : 0.45 }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(d.telefono)} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.nombre}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{d.telefono}</span>
                </label>
              )
            })}
          </div>
        </div>

        {/* Acciones */}
        <div style={card}>
          <label style={lbl}>📲 Probar primero</label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <input value={numeroPrueba} onChange={e => setNumeroPrueba(e.target.value)}
              placeholder="Tu número (ej. 5493574...)" style={{ ...input, flex: 1, minWidth: 180 }} />
            <button onClick={probar} disabled={enviando} style={{ ...btn, ...btnBlue, opacity: enviando ? 0.5 : 1 }}>
              {enviando ? '…' : 'Probar a mi número'}
            </button>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0' }} />
          <button onClick={enviarCampana} disabled={enviando || seleccionados.length === 0}
            style={{ ...btn, ...btnGreen, width: '100%', opacity: (enviando || seleccionados.length === 0) ? 0.5 : 1 }}>
            {enviando ? 'Enviando…' : `🚀 Enviar la oferta a ${seleccionados.length} contacto(s)`}
          </button>
          {resultado && (
            <div style={{ ...resBox, borderColor: resultado.fallidos ? 'var(--gold)' : 'var(--green)' }}>
              <div style={{ fontWeight: 700, marginBottom: resultado.errores?.length ? 6 : 0 }}>{resultado.titulo}</div>
              {resultado.errores?.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Errores: {resultado.errores.slice(0, 5).map(e => `${e.tel}`).join(', ')}{resultado.errores.length > 5 ? '…' : ''}
                  <div style={{ marginTop: 4, opacity: 0.8 }}>{resultado.errores[0]?.error?.slice(0, 140)}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Historial ── */}
      <div style={card}>
        <label style={lbl}>🕘 Campañas enviadas</label>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {historial.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Todavía no enviaste campañas.</div>}
          {historial.map(c => (
            <div key={c.id} style={{ borderLeft: '3px solid var(--gold)', paddingLeft: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {new Date(c.creado_at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', margin: '2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.oferta}</div>
              <div style={{ fontSize: 12 }}>
                <span style={{ color: 'var(--green)' }}>✓ {c.enviados}</span>
                {c.fallidos > 0 && <span style={{ color: 'var(--gold)', marginLeft: 8 }}>✗ {c.fallidos}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }
const lbl = { fontSize: 13, fontWeight: 800, color: 'var(--text)', letterSpacing: 0.3 }
const aviso = { background: 'rgba(0,170,255,0.06)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }
const textarea = { width: '100%', marginTop: 8, padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'DM Sans',sans-serif", fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }
const input = { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'DM Sans',sans-serif", fontSize: 14, boxSizing: 'border-box' }
const preview = { marginTop: 6, padding: 12, borderRadius: 10, background: 'rgba(37,211,102,0.10)', border: '1px solid rgba(37,211,102,0.3)', color: 'var(--text)', fontSize: 14, lineHeight: 1.45 }
const chip = { padding: '8px 12px', borderRadius: 999, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans',sans-serif" }
const chipOn = { background: 'var(--gold)', color: '#000', borderColor: 'var(--gold)' }
const listaBox = { maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 4 }
const btn = { padding: '11px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 800, fontFamily: "'DM Sans',sans-serif" }
const btnBlue = { background: 'var(--blue)', color: '#fff' }
const btnGreen = { background: 'var(--green)', color: '#000' }
const resBox = { marginTop: 12, padding: 12, borderRadius: 10, border: '1px solid var(--green)', background: 'rgba(255,255,255,0.03)', fontSize: 13, color: 'var(--text)' }
