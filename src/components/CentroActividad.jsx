// CentroActividad — widget flotante de actividad en vivo (bottom-left).
// Muestra y va rotando las conversaciones de WhatsApp sin leer y los pedidos
// pendientes (minoristas de Iris + mayoristas). Cuando entra algo nuevo suena un
// beep, salta una notificación del navegador y el widget se abre/destaca solo.
// Va en bottom-LEFT para no pisarse con el chat de Iris (bottom-right).
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCentroActividad, RUTA_ACTIVIDAD } from '../lib/useCentroActividad'

const COLOR = { conv: 'var(--green)', min: 'var(--gold)', may: 'var(--blue)' }
const LS = 'centroActividad_colapsado'
const horaCorta = iso => { try { return iso ? new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Cordoba', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '' } catch { return '' } }

export default function CentroActividad() {
  const { feed, nuevoSignal } = useCentroActividad()
  const navigate = useNavigate()
  const [colapsado, setColapsado] = useState(() => { try { return localStorage.getItem(LS) === '1' } catch { return false } })
  const [autoAbierto, setAutoAbierto] = useState(false)
  const [idx, setIdx] = useState(0)
  const [flash, setFlash] = useState(false)
  const [hover, setHover] = useState(false)
  const autoTimer = useRef(null)

  const abierto = !colapsado || autoAbierto

  // Novedad → saltar al más nuevo, flashear, y si estaba oculto abrir unos segundos
  useEffect(() => {
    if (nuevoSignal === 0) return
    setIdx(0); setFlash(true)
    const f = setTimeout(() => setFlash(false), 1400)
    setAutoAbierto(true)
    clearTimeout(autoTimer.current)
    autoTimer.current = setTimeout(() => setAutoAbierto(false), 8000)
    return () => clearTimeout(f)
  }, [nuevoSignal])

  // Rotación automática (pausa en hover o con 0/1 ítems)
  useEffect(() => {
    if (!abierto || hover || feed.length <= 1) return
    const t = setInterval(() => setIdx(i => (i + 1) % feed.length), 5000)
    return () => clearInterval(t)
  }, [abierto, hover, feed.length])

  useEffect(() => { if (idx >= feed.length) setIdx(0) }, [feed.length, idx])

  function toggle(v) {
    setColapsado(v); setAutoAbierto(false)
    try { localStorage.setItem(LS, v ? '1' : '0') } catch { /* noop */ }
  }

  // Antes, si no había actividad y estaba minimizado, el widget desaparecía
  // del todo y no quedaba botón para reabrirlo. Ahora SIEMPRE queda el botón 📡.

  const total = feed.length
  const cuenta = { conv: 0, min: 0, may: 0 }
  feed.forEach(f => { cuenta[f.tipo]++ })
  const item = feed[Math.min(idx, Math.max(0, feed.length - 1))]
  const ir = ruta => navigate(ruta)

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div style={{ position: 'fixed', left: 16, bottom: 18, zIndex: 9998, fontFamily: "'DM Sans', sans-serif" }}>
        {!abierto ? (
          <button onClick={() => toggle(false)} title="Actividad en vivo" style={{ ...pill, animation: flash ? 'ca-pulse 0.8s ease 2' : 'none' }}>
            📡{total > 0 ? <span style={{ fontWeight: 800, marginLeft: 4 }}>{total}</span> : null}
          </button>
        ) : (
          <div style={{ ...card, animation: flash ? 'ca-flash 1.2s ease' : 'none' }}
            onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
            <div style={hdr}>
              <span style={{ fontWeight: 800, fontSize: 12, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 6px var(--green)', animation: 'ca-blink 1.6s ease infinite' }} />
                Actividad en vivo
              </span>
              <button onClick={() => toggle(true)} title="Ocultar" style={btnX}>—</button>
            </div>

            {item ? (
              <div onClick={() => ir(item.ruta)} style={{ ...itemBox, borderLeft: `3px solid ${COLOR[item.tipo]}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: COLOR[item.tipo], textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.icono} {item.etiqueta}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>{horaCorta(item.hora)}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{item.titulo}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.detalle}</div>
                <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 3 }}>Tocá para abrir →</div>
              </div>
            ) : (
              <div style={{ padding: '16px 12px', fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>✅ Todo al día, sin pendientes.</div>
            )}

            <div style={ftr}>
              <Contador color="var(--green)" icono="💬" n={cuenta.conv} onClick={() => ir(RUTA_ACTIVIDAD.conv)} titulo="Conversaciones sin leer" />
              <Contador color="var(--gold)" icono="🛒" n={cuenta.min} onClick={() => ir(RUTA_ACTIVIDAD.min)} titulo="Pedidos minoristas (Iris)" />
              <Contador color="var(--blue)" icono="📦" n={cuenta.may} onClick={() => ir(RUTA_ACTIVIDAD.may)} titulo="Pedidos mayoristas" />
              {total > 1 && <span style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--muted)' }}>{(idx % total) + 1}/{total}</span>}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function Contador({ color, icono, n, onClick, titulo }) {
  return (
    <button onClick={onClick} title={titulo}
      style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, padding: '2px 5px', borderRadius: 6, opacity: n ? 1 : 0.45 }}>
      <span style={{ fontSize: 12 }}>{icono}</span>
      <span style={{ fontSize: 11, fontWeight: 800, color: n ? color : 'var(--muted)' }}>{n}</span>
    </button>
  )
}

const pill = { display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface2)', border: '1px solid var(--border2)', color: 'var(--text)', borderRadius: 22, padding: '9px 14px', fontSize: 13, cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.4)', fontFamily: "'DM Sans', sans-serif" }
const card = { width: 300, maxWidth: 'calc(100vw - 32px)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12, boxShadow: '0 8px 28px rgba(0,0,0,0.5)', overflow: 'hidden' }
const hdr = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }
const itemBox = { padding: '10px 12px', cursor: 'pointer', background: 'var(--surface)' }
const ftr = { display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', borderTop: '1px solid var(--border)', background: 'var(--surface2)' }
const btnX = { background: 'none', border: 'none', color: 'var(--muted)', fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: '0 4px', fontWeight: 800 }

const KEYFRAMES = `
@keyframes ca-pulse { 0%{transform:scale(1)} 50%{transform:scale(1.12); box-shadow:0 0 0 6px rgba(39,174,96,0.25)} 100%{transform:scale(1)} }
@keyframes ca-flash { 0%{box-shadow:0 0 0 0 rgba(39,174,96,0.55)} 100%{box-shadow:0 8px 28px rgba(0,0,0,0.5)} }
@keyframes ca-blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
`
