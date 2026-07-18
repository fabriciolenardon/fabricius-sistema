import { useState, useEffect, useRef } from 'react'

// ═══════════════════════════════════════════════════════════
// PANEL DIVIDIDO — trabajar en DOS módulos a la vez sin abrir otra pestaña.
// Se abre con el botón ⧉ del header (solo escritorio). El panel derecho es un
// iframe de la misma app (misma sesión de Supabase, mismo deploy): cada módulo
// corre completo e independiente, igual que si fuera otra pestaña, pero al
// lado. AdminLayout detecta que corre adentro del panel (window.self !==
// window.top) y esconde header/menú/widgets para mostrar SOLO el módulo.
// El divisor se arrastra para repartir el ancho; módulo y ancho quedan
// recordados en localStorage.
// ═══════════════════════════════════════════════════════════

const ANCHO_MIN = 25   // % de la pantalla
const ANCHO_MAX = 65

export default function PanelDividido({ items, ancho, setAncho, onCerrar, ruta, onRutaChange, nonce = 0 }) {
  // La ruta la controla AdminLayout (para poder abrir el panel en un módulo
  // puntual desde afuera, ej. "Remitar"). Persistencia de panel_ruta vive allá.
  const setRuta = onRutaChange
  const [arrastrando, setArrastrando] = useState(false)

  useEffect(() => { localStorage.setItem('panel_ancho', String(ancho)) }, [ancho])

  // Arrastre del divisor. Mientras se arrastra, el iframe no captura el mouse
  // (pointerEvents none) — si no, los mousemove mueren adentro del iframe.
  useEffect(() => {
    if (!arrastrando) return
    function mover(e) {
      const pct = ((window.innerWidth - e.clientX) / window.innerWidth) * 100
      setAncho(Math.min(ANCHO_MAX, Math.max(ANCHO_MIN, pct)))
    }
    function soltar() { setArrastrando(false) }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', mover)
    window.addEventListener('mouseup', soltar)
    return () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', mover)
      window.removeEventListener('mouseup', soltar)
    }
  }, [arrastrando, setAncho])

  const btnStyle = {
    background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7,
    color: 'var(--text2)', cursor: 'pointer', padding: '4px 9px', fontSize: 13,
    minHeight: 28, display: 'flex', alignItems: 'center',
  }

  return (
    <>
      {/* Divisor arrastrable */}
      <div
        onMouseDown={() => setArrastrando(true)}
        style={{
          position: 'fixed', top: 56, bottom: 0, right: `${ancho}vw`, width: 7,
          cursor: 'col-resize', zIndex: 151, background: arrastrando ? 'var(--gold)' : 'transparent',
          transition: arrastrando ? 'none' : 'background 0.15s',
        }}
        onMouseOver={e => { if (!arrastrando) e.currentTarget.style.background = 'rgba(212,175,55,0.35)' }}
        onMouseOut={e => { if (!arrastrando) e.currentTarget.style.background = 'transparent' }}
      />

      <aside style={{
        position: 'fixed', top: 56, right: 0, bottom: 0, width: `${ancho}vw`, zIndex: 150,
        display: 'flex', flexDirection: 'column', background: '#0a0a08',
        borderLeft: '1px solid rgba(212,175,55,0.4)', boxShadow: '-8px 0 24px rgba(0,0,0,0.45)',
      }}>
        {/* Barra del panel: selector de módulo + abrir en pestaña + cerrar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
          <span style={{ fontSize: 14, color: 'var(--gold)' }}>⧉</span>
          <select
            value={ruta}
            onChange={e => setRuta(e.target.value)}
            style={{ flex: 1, background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 8px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", minWidth: 0 }}>
            {items.map(it => (
              <option key={it.to} value={it.to}>{it.icon} {it.label}</option>
            ))}
          </select>
          <button title="Abrir este módulo en otra pestaña" style={btnStyle}
            onClick={() => window.open(ruta, '_blank')}>↗</button>
          <button title="Cerrar panel" style={btnStyle} onClick={onCerrar}>✕</button>
        </div>

        {/* El módulo en sí. key={ruta} fuerza un iframe fresco al cambiar de
            módulo (navegación limpia, sin historial raro adentro). */}
        <iframe
          key={`${ruta}-${nonce}`}
          src={ruta}
          title="Panel dividido"
          style={{ flex: 1, width: '100%', border: 'none', pointerEvents: arrastrando ? 'none' : 'auto', background: '#0a0a08' }}
        />
      </aside>
    </>
  )
}
