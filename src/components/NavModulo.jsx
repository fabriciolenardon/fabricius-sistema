// ============================================================
// Navegación de módulo: barra lateral + ruta + pestañas + pastillas
// ============================================================
// Reemplaza la "escalera" de filas de botones iguales (una fila por nivel,
// cada una empujando la pantalla para abajo). Cada nivel tiene su forma:
//   1. Barra lateral agrupada (<ModuloConNav>)
//   2. Pestañas subrayadas     (<Pestanas>)
//   3. Pastillas chicas        (<Pastillas>)
// Arriba del contenido va la ruta (Depósito › Desposte › Mermas): cada nivel
// la completa con useMiga(nivel, label) desde adentro de su pantalla.
//
// Ctrl+K NO se usa acá: ya es el buscador general (BuscadorGlobal). El salto
// rápido del módulo es el buscador de arriba de la barra.
// ============================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useEsMovil } from '../lib/useEsMovil'

const MigasCtx = createContext(null)

// Registra el nombre del nivel `nivel` (2 o 3) en la ruta de arriba. Con
// label null el nivel no se muestra. Se limpia sola al desmontar.
export function useMiga(nivel, label) {
  const set = useContext(MigasCtx)
  useEffect(() => {
    if (!set) return
    set(nivel, label || null)
    return () => set(nivel, null)
  }, [set, nivel, label])
}

const CLAVE_COLAPSADA = 'nav_modulo_colapsada'
const sinAcentos = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * grupos:  [{ titulo, items: [{ id, icono, label }] }]
 * activo:  id del item elegido
 * onCambiar(id): elegir un item (también se llama al tocar el item ya activo
 *   o su nombre en la ruta, para volver al inicio de esa sección)
 * atajos:  [{ label, ruta, icono, destino }] entradas extra del buscador que
 *   llevan a un nivel más adentro; onAtajo(destino) las resuelve.
 */
export function ModuloConNav({ titulo, subtitulo, grupos, activo, onCambiar, atajos = [], onAtajo, children }) {
  const esMovil = useEsMovil()
  const [colapsada, setColapsada] = useState(() => {
    try { return localStorage.getItem(CLAVE_COLAPSADA) === '1' } catch { return false }
  })
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [migas, setMigas] = useState({})
  const inputRef = useRef()

  const setMiga = useCallback((n, l) => setMigas(m => (m[n] === l ? m : { ...m, [n]: l })), [])

  function alternarColapsada() {
    setColapsada(c => {
      try { localStorage.setItem(CLAVE_COLAPSADA, c ? '0' : '1') } catch {}
      return !c
    })
  }

  const itemActivo = grupos.flatMap(g => g.items).find(i => i.id === activo)

  // Resultados del buscador: secciones + atajos a niveles de adentro
  const resultados = useMemo(() => {
    const q = sinAcentos(busqueda.trim())
    if (!q) return []
    const secciones = grupos.flatMap(g => g.items.map(i => ({
      key: 'i-' + i.id, icono: i.icono, label: i.label, ruta: g.titulo, ir: () => onCambiar(i.id),
    })))
    const extra = atajos.map((a, n) => ({
      key: 'a-' + n, icono: a.icono, label: a.label, ruta: a.ruta, ir: () => onAtajo?.(a.destino),
    }))
    return [...secciones, ...extra].filter(r => sinAcentos(r.label + ' ' + r.ruta).includes(q)).slice(0, 8)
  }, [busqueda, grupos, atajos, onCambiar, onAtajo])

  function elegir(ir) {
    ir()
    setBusqueda('')
    setMenuAbierto(false)
  }

  const angosta = colapsada && !esMovil

  const buscador = (
    <div style={{ position: 'relative', marginBottom: 6 }}>
      <input ref={inputRef} value={busqueda} onChange={e => setBusqueda(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && resultados[0]) elegir(resultados[0].ir)
          if (e.key === 'Escape') setBusqueda('')
        }}
        placeholder="🔍 Ir a…"
        style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', fontSize: 12.5, borderRadius: 8,
          border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)',
          fontFamily: "'DM Sans',sans-serif" }} />
      {resultados.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 30, marginTop: 4,
          minWidth: '100%', width: esMovil ? '100%' : 260, background: 'var(--surface3)',
          border: '1px solid var(--border2)', borderRadius: 8, padding: 4, boxShadow: '0 8px 24px rgba(0,0,0,.45)' }}>
          {resultados.map((r, n) => (
            <button key={r.key} onClick={() => elegir(r.ir)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                padding: '7px 8px', border: 'none', borderRadius: 6, cursor: 'pointer',
                background: n === 0 ? 'rgba(201,168,76,0.12)' : 'transparent', color: 'var(--text)',
                fontFamily: "'DM Sans',sans-serif", fontSize: 12.5 }}>
              <span style={{ width: 18, textAlign: 'center' }}>{r.icono}</span>
              <span style={{ flex: 1 }}>{r.label}</span>
              <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{r.ruta}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )

  const lista = (
    <nav>
      {grupos.map(g => (
        <div key={g.titulo} style={{ marginBottom: angosta ? 6 : 10 }}>
          {angosta
            ? <div style={{ height: 1, background: 'var(--border)', margin: '6px 8px' }} />
            : <div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.8,
                fontWeight: 700, margin: '10px 10px 4px' }}>{g.titulo}</div>}
          {g.items.map(i => {
            const on = i.id === activo
            return (
              <button key={i.id} onClick={() => { onCambiar(i.id); setMenuAbierto(false) }}
                title={angosta ? i.label : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  justifyContent: angosta ? 'center' : 'flex-start',
                  padding: angosta ? '9px 0' : '8px 10px', marginBottom: 2, borderRadius: 8, cursor: 'pointer',
                  border: 'none', borderLeft: `3px solid ${on ? 'var(--gold)' : 'transparent'}`,
                  background: on ? 'rgba(201,168,76,0.14)' : 'transparent',
                  color: on ? 'var(--gold-light)' : 'var(--text2)',
                  fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: on ? 700 : 500,
                  transition: 'background .15s, color .15s' }}
                onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'var(--surface2)' }}
                onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}>
                <span style={{ fontSize: 15, width: 20, textAlign: 'center' }}>{i.icono}</span>
                {!angosta && <span>{i.label}</span>}
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )

  const ruta = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12.5,
      color: 'var(--muted)', marginBottom: 14, fontFamily: "'DM Sans',sans-serif" }}>
      <span style={{ fontWeight: 700, letterSpacing: 1 }}>{titulo}</span>
      {itemActivo && <>
        <span>›</span>
        {/* Tocar la sección vuelve a su pantalla de inicio */}
        <button onClick={() => onCambiar(activo)} title="Volver al inicio de esta sección"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5,
            fontFamily: "'DM Sans',sans-serif", color: migas[2] ? 'var(--text2)' : 'var(--gold-light)',
            fontWeight: migas[2] ? 500 : 700 }}>{itemActivo.icono} {itemActivo.label}</button>
      </>}
      {migas[2] && <><span>›</span><span style={{ color: migas[3] ? 'var(--text2)' : 'var(--gold-light)', fontWeight: migas[3] ? 500 : 700 }}>{migas[2]}</span></>}
      {migas[2] && migas[3] && <><span>›</span><span style={{ color: 'var(--gold-light)', fontWeight: 700 }}>{migas[3]}</span></>}
    </div>
  )

  return (
    <MigasCtx.Provider value={setMiga}>
      <div>
        <div className="page-title">{titulo}</div>
        {subtitulo && <div className="page-sub">{subtitulo}</div>}

        {esMovil ? (
          // En el celular la barra se guarda detrás de un botón
          <div style={{ marginBottom: 14 }}>
            <button onClick={() => setMenuAbierto(a => !a)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px',
                borderRadius: 10, border: '1px solid var(--border2)', background: 'var(--surface2)',
                color: 'var(--text)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontSize: 14, fontWeight: 700 }}>
              <span style={{ fontSize: 18 }}>☰</span>
              <span style={{ flex: 1, textAlign: 'left' }}>{itemActivo ? `${itemActivo.icono} ${itemActivo.label}` : 'Secciones'}</span>
              <span style={{ color: 'var(--muted)' }}>{menuAbierto ? '▲' : '▼'}</span>
            </button>
            {menuAbierto && (
              <div style={{ marginTop: 6, padding: 8, borderRadius: 10, border: '1px solid var(--border2)', background: 'var(--surface)' }}>
                {buscador}
                {lista}
              </div>
            )}
          </div>
        ) : null}

        <div style={{ display: esMovil ? 'block' : 'grid', gridTemplateColumns: `${angosta ? 58 : 210}px minmax(0, 1fr)`, gap: 20, alignItems: 'start' }}>
          {!esMovil && (
            <aside style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
              padding: angosta ? '8px 6px' : 10, transition: 'padding .15s' }}>
              {!angosta && buscador}
              {lista}
              <button onClick={alternarColapsada} title={angosta ? 'Mostrar nombres' : 'Achicar la barra'}
                style={{ width: '100%', marginTop: 4, padding: '6px 0', border: 'none', borderTop: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 12,
                  fontFamily: "'DM Sans',sans-serif" }}>
                {angosta ? '»' : '« achicar'}
              </button>
            </aside>
          )}
          <div style={{ minWidth: 0 }}>
            {ruta}
            {children}
          </div>
        </div>
      </div>
    </MigasCtx.Provider>
  )
}

// Nivel 2: pestañas subrayadas en una sola línea (en el celular se deslizan)
// items: [{ id, label, icono? }]
export function Pestanas({ items, value, onChange, style }) {
  // Si no entran todas, la elegida se corre a la vista (solo en horizontal:
  // scrollIntoView movería también la página para arriba o abajo).
  const filaRef = useRef()
  useEffect(() => {
    const fila = filaRef.current
    const on = fila?.querySelector('[data-on="1"]')
    if (!fila || !on) return
    if (on.offsetLeft < fila.scrollLeft || on.offsetLeft + on.offsetWidth > fila.scrollLeft + fila.clientWidth) {
      fila.scrollLeft = on.offsetLeft - 16
    }
  }, [value])
  return (
    <div ref={filaRef} style={{ position: 'relative', display: 'flex', gap: 4, borderBottom: '1px solid var(--border2)', marginBottom: 18,
      overflowX: 'auto', scrollbarWidth: 'none', ...style }}>
      {items.map(t => {
        const on = t.id === value
        return (
          <button key={t.id} onClick={() => onChange(t.id)} data-on={on ? '1' : undefined}
            style={{ flexShrink: 0, padding: '9px 14px', background: 'transparent', border: 'none',
              borderBottom: `2px solid ${on ? 'var(--gold)' : 'transparent'}`, marginBottom: -1,
              color: on ? 'var(--text)' : 'var(--muted)', cursor: 'pointer', whiteSpace: 'nowrap',
              fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: on ? 700 : 500,
              transition: 'color .15s, border-color .15s' }}
            onMouseEnter={e => { if (!on) e.currentTarget.style.color = 'var(--text2)' }}
            onMouseLeave={e => { if (!on) e.currentTarget.style.color = 'var(--muted)' }}>
            {t.icono && <span style={{ marginRight: 6 }}>{t.icono}</span>}{t.label}
          </button>
        )
      })}
    </div>
  )
}

// Nivel 3: pastillas chicas, se leen como un filtro dentro de la pantalla
export function Pastillas({ items, value, onChange, style }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, ...style }}>
      {items.map(t => {
        const on = t.id === value
        return (
          <button key={t.id} onClick={() => onChange(t.id)}
            style={{ padding: '5px 13px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
              border: `1px solid ${on ? 'var(--gold)' : 'var(--border2)'}`,
              background: on ? 'var(--gold)' : 'transparent', color: on ? '#000' : 'var(--text2)',
              fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: on ? 700 : 500 }}>
            {t.icono && <span style={{ marginRight: 5 }}>{t.icono}</span>}{t.label}
          </button>
        )
      })}
    </div>
  )
}
