// ConversacionesWhatsapp.jsx — Inbox en vivo de las charlas que atiende Iris.
// Ver en tiempo real, intervenir a mano (envía por /api/wa-send), pausar/
// reactivar Iris por contacto, y editar las "Respuestas de Iris" (wa_config).
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

const TZ = 'America/Argentina/Cordoba'
const horaCorta = iso => iso ? new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : ''
const fechaHora = iso => iso ? new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)).replace(',', '') : ''

// ── Identificación del contacto ──
// El telefono es el wa_id (AR: 549 + 10 dígitos). Lo mostramos legible para saber
// con quién habla Iris y poder contactarlo. El nombre de perfil de WhatsApp a veces
// es basura (ej "…" de 1 carácter) o no viene → en ese caso mostramos el número.
const soloDigitos = s => String(s || '').replace(/\D/g, '')
function fmtTelefono(wa) {
  const d = soloDigitos(wa)
  const m = d.match(/^54(9)?(\d{10})$/)  // AR: 9 opcional + 10 dígitos (área + número)
  if (m) { const n = m[2]; return `+54${m[1] ? ' 9' : ''} ${n.slice(0, 4)} ${n.slice(4, 6)}-${n.slice(6)}` }
  return d ? '+' + d : ''
}
const nombreUtil = n => !!(n && n.trim().length >= 2 && /[a-zA-ZÀ-ÿ]/.test(n))
// El ALIAS (que el admin pone a mano) manda sobre el nombre de perfil de WhatsApp.
const displayNombre = c => (c?.alias && c.alias.trim()) || (nombreUtil(c?.nombre) ? c.nombre.trim() : fmtTelefono(c?.telefono))

const CAMPOS_CONFIG = [
  { clave: 'horarios', label: '🕐 Horarios', ph: 'Ej: Lun a Sáb de 8 a 13 y 17 a 21. Dom cerrado.' },
  { clave: 'direccion', label: '📍 Dirección', ph: 'Ej: San Martín 123, Río Primero.' },
  { clave: 'formas_pago', label: '💳 Formas de pago', ph: 'Ej: Efectivo, débito, crédito, transferencia.' },
  { clave: 'envios', label: '🚚 Envíos', ph: 'Ej: Hacemos envíos en Río Primero, sin cargo desde $X.' },
  { clave: 'instrucciones_extra', label: '✨ Instrucciones extra para Iris', ph: 'Cualquier indicación libre: promos, aclaraciones, tono, etc.' },
]

export default function ConversacionesWhatsapp() {
  const [contactos, setContactos] = useState([])
  const [sel, setSel] = useState(null)        // telefono seleccionado
  const [mensajes, setMensajes] = useState([])
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [cfgAbierta, setCfgAbierta] = useState(false)
  const finRef = useRef(null)
  const selRef = useRef(null)
  selRef.current = sel

  // ── Contactos (lista) + realtime ──
  useEffect(() => {
    cargarContactos()
    const canal = supabase.channel('wa-contactos-inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_contactos' }, () => cargarContactos())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [])

  async function cargarContactos() {
    const { data } = await supabase.from('wa_contactos').select('*').order('ultimo_at', { ascending: false })
    setContactos(data || [])
    setCargando(false)
  }

  // ── Mensajes del contacto seleccionado + realtime ──
  useEffect(() => {
    if (!sel) { setMensajes([]); return }
    cargarMensajes(sel)
    marcarLeido(sel)
    const canal = supabase.channel('wa-msgs-' + sel)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_mensajes', filter: `telefono=eq.${sel}` },
        payload => { if (selRef.current === sel) setMensajes(m => [...m, payload.new]) })
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [sel])

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [mensajes])

  async function cargarMensajes(tel) {
    const { data } = await supabase.from('wa_mensajes').select('*').eq('telefono', tel).order('created_at', { ascending: true }).limit(500)
    setMensajes(data || [])
  }

  async function marcarLeido(tel) {
    await supabase.from('wa_contactos').update({ no_leidos: 0 }).eq('telefono', tel)
    setContactos(cs => cs.map(c => c.telefono === tel ? { ...c, no_leidos: 0 } : c))
  }

  const contactoSel = contactos.find(c => c.telefono === sel)

  async function enviar() {
    const t = texto.trim()
    if (!t || !sel || enviando) return
    setEnviando(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { alert('Sesión expirada, volvé a entrar.'); setEnviando(false); return }
      const r = await fetch('/api/wa-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: sel, text: t }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { alert('No se pudo enviar: ' + (j.error || r.status)); setEnviando(false); return }
      setTexto('')
      // el mensaje aparece por realtime; recargamos por las dudas
      cargarMensajes(sel)
    } catch (e) { alert('Error: ' + e.message) }
    setEnviando(false)
  }

  async function togglePausa() {
    if (!contactoSel) return
    const nuevo = !contactoSel.iris_pausada
    await supabase.from('wa_contactos').update({ iris_pausada: nuevo }).eq('telefono', sel)
    setContactos(cs => cs.map(c => c.telefono === sel ? { ...c, iris_pausada: nuevo } : c))
  }

  // Alias interno: el nombre que vos le ponés al contacto (manda sobre el perfil
  // de WhatsApp). El webhook nunca lo pisa. Vacío = borra el alias.
  async function editarAlias() {
    if (!sel) return
    const a = prompt('Alias para este contacto (el nombre que querés verle acá, ej "Cliente sorteo 89"):', contactoSel?.alias || '')
    if (a === null) return
    const alias = a.trim() || null
    await supabase.from('wa_contactos').update({ alias }).eq('telefono', sel)
    setContactos(cs => cs.map(c => c.telefono === sel ? { ...c, alias } : c))
  }

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 820
  const mostrarHilo = !isMobile || !!sel

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 30, letterSpacing: 1, margin: 0, color: 'var(--text)' }}>💬 Conversaciones WhatsApp</h1>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>Mirá en vivo cómo atiende Iris. Podés responder a mano y pausarla cuando quieras.</div>
        </div>
        <button onClick={() => setCfgAbierta(true)} style={btnGold}>⚙️ Respuestas de Iris</button>
      </div>

      <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 180px)', minHeight: 420 }}>
        {/* Lista de contactos */}
        {(!isMobile || !sel) && (
          <div style={{ width: isMobile ? '100%' : 320, flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflowY: 'auto' }}>
            {cargando ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Cargando…</div>
            ) : contactos.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Todavía no hay conversaciones.<br />Cuando un cliente escriba, aparece acá.</div>
            ) : contactos.map(c => (
              <div key={c.telefono} onClick={() => setSel(c.telefono)}
                style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: sel === c.telefono ? 'var(--surface2)' : 'transparent', display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{c.iris_pausada ? '🙋' : '🤖'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayNombre(c)}</span>
                    <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>{fechaHora(c.ultimo_at)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.ultimo_mensaje || ''}</span>
                    {c.no_leidos > 0 && <span style={{ background: 'var(--green)', color: '#000', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 6px', flexShrink: 0 }}>{c.no_leidos}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Hilo */}
        {mostrarHilo && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            {!sel ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 14, textAlign: 'center', padding: 20 }}>
                Elegí una conversación de la izquierda para verla 👈
              </div>
            ) : (
              <>
                {/* Cabecera del hilo */}
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface2)' }}>
                  {isMobile && <button onClick={() => setSel(null)} style={{ background: 'none', border: 'none', color: 'var(--text)', fontSize: 18, cursor: 'pointer' }}>←</button>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(contactoSel?.alias && contactoSel.alias.trim()) || (nombreUtil(contactoSel?.nombre) ? contactoSel.nombre.trim() : 'Sin nombre')}</span>
                      <button onClick={editarAlias} title="Poner / editar alias (nombre interno)" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1, flexShrink: 0 }}>✏️</button>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <a href={`https://wa.me/${soloDigitos(sel)}`} target="_blank" rel="noreferrer" style={{ color: 'var(--green)', textDecoration: 'none', fontWeight: 600 }}>📱 {fmtTelefono(sel)}</a>
                      <span style={{ color: contactoSel?.iris_pausada ? 'var(--amber)' : 'var(--green)' }}>
                        {contactoSel?.iris_pausada ? '🙋 Lo atendés vos (Iris pausada)' : '🤖 Iris respondiendo'}
                      </span>
                    </div>
                  </div>
                  <button onClick={togglePausa} style={contactoSel?.iris_pausada ? btnGreen : btnSec}>
                    {contactoSel?.iris_pausada ? '🤖 Reactivar Iris' : '⏸️ Pausar Iris'}
                  </button>
                </div>

                {/* Mensajes */}
                <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {mensajes.map(m => {
                    const out = m.direccion === 'out'
                    const esIris = m.autor === 'iris'
                    return (
                      <div key={m.id} style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' }}>
                        <div style={{ maxWidth: '78%', padding: '8px 11px', borderRadius: 10, fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap',
                          background: out ? (esIris ? 'rgba(74,222,128,0.15)' : 'rgba(96,165,250,0.18)') : 'var(--surface2)',
                          border: '1px solid var(--border)', color: 'var(--text)' }}>
                          {out && <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 2, color: esIris ? 'var(--green)' : 'var(--blue)' }}>{esIris ? '🤖 Iris' : '🙋 Vos'}</div>}
                          {m.media_url && <MediaWa path={m.media_url} tipo={m.tipo} />}
                          {m.texto && <div style={{ marginTop: m.media_url ? 4 : 0 }}>{m.texto}</div>}
                          <div style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'right', marginTop: 3 }}>{horaCorta(m.created_at)}</div>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={finRef} />
                </div>

                {/* Input */}
                <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                  <input value={texto} onChange={e => setTexto(e.target.value)} onKeyDown={e => e.key === 'Enter' && enviar()}
                    placeholder={contactoSel?.iris_pausada ? 'Escribí tu respuesta…' : 'Escribí para responder vos (pausá Iris si no querés que conteste encima)'}
                    style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '10px 12px', fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none' }} />
                  <button onClick={enviar} disabled={enviando || !texto.trim()} style={{ ...btnGreen, opacity: enviando || !texto.trim() ? 0.5 : 1, minWidth: 46 }}>{enviando ? '…' : '➤'}</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {cfgAbierta && <ModalConfig onClose={() => setCfgAbierta(false)} />}
    </div>
  )
}

// Muestra un archivo entrante de WhatsApp (foto/comprobante/audio/documento).
// El path está en wa_mensajes.media_url; generamos una URL firmada temporal del
// bucket privado wa-media para verlo. La foto se abre en grande al clickear.
function MediaWa({ path, tipo }) {
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let alive = true
    setUrl(null); setErr(false)
    supabase.storage.from('wa-media').createSignedUrl(path, 3600)
      .then(({ data, error }) => { if (!alive) return; if (error || !data?.signedUrl) setErr(true); else setUrl(data.signedUrl) })
    return () => { alive = false }
  }, [path])
  if (err) return <div style={{ fontSize: 11, color: 'var(--muted)' }}>📎 No se pudo cargar el archivo</div>
  if (!url) return <div style={{ fontSize: 11, color: 'var(--muted)' }}>⏳ Cargando archivo…</div>
  if (tipo === 'image' || tipo === 'sticker') {
    return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="adjunto" style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8, display: 'block' }} /></a>
  }
  if (tipo === 'audio') return <audio controls src={url} style={{ maxWidth: 240, display: 'block' }} />
  return <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', fontWeight: 600 }}>📎 Abrir archivo</a>
}

// ── Modal: Respuestas de Iris (wa_config editable) ──
function ModalConfig({ onClose }) {
  const [valores, setValores] = useState({})
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('wa_config').select('clave,valor')
      const v = {}; (data || []).forEach(r => v[r.clave] = r.valor || '')
      setValores(v); setCargando(false)
    })()
  }, [])

  async function guardar() {
    setGuardando(true)
    const filas = CAMPOS_CONFIG.map(c => ({ clave: c.clave, valor: valores[c.clave] || '', updated_at: new Date().toISOString() }))
    const { error } = await supabase.from('wa_config').upsert(filas, { onConflict: 'clave' })
    setGuardando(false)
    if (error) { alert('Error al guardar: ' + error.message); return }
    setOk(true); setTimeout(() => setOk(false), 2000)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>⚙️ Respuestas de Iris</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>Esto es lo que Iris usa para responder. Editá y guardá; los cambios aplican al toque.</div>
        {cargando ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Cargando…</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {CAMPOS_CONFIG.map(c => (
              <div key={c.clave}>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>{c.label}</label>
                <textarea value={valores[c.clave] || ''} onChange={e => setValores(v => ({ ...v, [c.clave]: e.target.value }))}
                  placeholder={c.ph} rows={c.clave === 'instrucciones_extra' ? 3 : 2}
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
            ))}
            <button onClick={guardar} disabled={guardando} style={{ ...btnGreen, marginTop: 4 }}>{guardando ? 'Guardando…' : ok ? '✅ Guardado' : 'Guardar cambios'}</button>
          </div>
        )}
      </div>
    </div>
  )
}

const btnSec = { padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--surface)', color: 'var(--text2)', border: '1px solid var(--border)', fontFamily: "'DM Sans', sans-serif" }
const btnGreen = { padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'var(--green)', color: '#000', border: 'none', fontFamily: "'DM Sans', sans-serif" }
const btnGold = { padding: '8px 13px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'var(--gold)', color: '#000', border: 'none', fontFamily: "'DM Sans', sans-serif" }
