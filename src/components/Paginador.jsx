// ============================================================
// Paginador — componente y hook reutilizables
// ============================================================
// Uso típico:
//   const pag = usePaginacion(arrayCompleto, 20)
//   <tbody>{pag.items.map(...)}</tbody>
//   <Paginador {...pag.controles} />
// ============================================================
import { useState, useMemo, useEffect } from 'react'

const TAMANOS = [10, 20, 50, 100]

export function usePaginacion(array, defaultSize = 20) {
  const [size, setSize] = useState(defaultSize)
  const [pagina, setPagina] = useState(1)
  const total = array?.length || 0
  const totalPaginas = Math.max(1, Math.ceil(total / size))

  // Si cambia el array y la página queda fuera de rango, volver a la última válida
  useEffect(() => {
    if (pagina > totalPaginas) setPagina(totalPaginas)
  }, [totalPaginas, pagina])

  const items = useMemo(() => {
    if (!array) return []
    const desde = (pagina - 1) * size
    return array.slice(desde, desde + size)
  }, [array, pagina, size])

  const desde = total === 0 ? 0 : (pagina - 1) * size + 1
  const hasta = Math.min(pagina * size, total)

  return {
    items,
    controles: {
      pagina, size, total, totalPaginas, desde, hasta,
      setPagina, setSize,
    },
  }
}

export default function Paginador({ pagina, size, total, totalPaginas, desde, hasta, setPagina, setSize, label = 'registros' }) {
  if (total === 0) return null
  const btnStyle = (disabled) => ({
    padding: '6px 12px',
    background: disabled ? 'var(--surface2)' : 'var(--surface)',
    color: disabled ? 'var(--muted)' : 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "'DM Sans',sans-serif",
    opacity: disabled ? 0.4 : 1,
  })
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8,
      marginTop: 10, fontSize: 12, color: 'var(--muted)',
    }}>
      <div>
        <span style={{ color: 'var(--text)', fontWeight: 600 }}>{desde}–{hasta}</span> de <span style={{ color: 'var(--text)', fontWeight: 600 }}>{total}</span> {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
        <span>Mostrar:</span>
        <select value={size}
          onChange={e => { setSize(Number(e.target.value)); setPagina(1) }}
          style={{
            background: 'var(--surface)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 6,
            padding: '4px 8px', fontSize: 12, cursor: 'pointer',
            fontFamily: "'DM Sans',sans-serif",
          }}>
          {TAMANOS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={() => setPagina(1)} disabled={pagina === 1} style={btnStyle(pagina === 1)}>« Primera</button>
        <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina === 1} style={btnStyle(pagina === 1)}>‹ Ant</button>
        <span style={{ minWidth: 90, textAlign: 'center', color: 'var(--text)', fontWeight: 600 }}>
          Pág {pagina} / {totalPaginas}
        </span>
        <button onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={pagina === totalPaginas} style={btnStyle(pagina === totalPaginas)}>Sig ›</button>
        <button onClick={() => setPagina(totalPaginas)} disabled={pagina === totalPaginas} style={btnStyle(pagina === totalPaginas)}>Última »</button>
      </div>
    </div>
  )
}
