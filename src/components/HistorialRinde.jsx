// ============================================================
// 📉 HISTORIAL DE RINDE — cuánto deja cada ciclo, y cómo viene
// ============================================================
// Pedido de Fabricio (15/09/2026): saber la merma aproximada de cada ciclo,
// por separado. Son tres y NO se pueden mezclar — cada uno rinde distinto:
//
//   tipo_desposte='piezas'      media res → piezas          merma ~3%
//   tipo_desposte='kilo'        media res → venta por kilo  merma ~24%
//   tipo_desposte='pieza_kilo'  pieza → cortes              merma ~24%
//
// EL RINDE SE MIDE CONTRA LO QUE ENTRÓ AL STOCK, no contra `kg_neto`: en los
// despostes a piezas ese campo quedó igual al peso de la media (rinde 100%) y
// la merma real está en la resta contra la suma de las piezas. Usando la suma
// de piezas la cuenta sale bien para los tres ciclos.
// ============================================================
import { useState, useEffect } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { fmtKg } from '../lib/formatos'

const n = v => Number(v) || 0
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// Kilos que realmente salieron: la suma de lo pesado, que es lo que entró al
// stock. Ver la cabecera para por qué no se usa kg_neto.
const kgSalida = d => (Array.isArray(d.piezas) ? d.piezas : []).reduce((s, p) => s + n(p?.kg), 0)
const rindeDe = d => {
  const entra = n(d.kg_media_res), sale = kgSalida(d)
  if (!(entra > 0) || !(sale > 0)) return null
  return (sale / entra) * 100
}
const mesDe = f => {
  const s = String(f || '')
  if (!/^\d{4}-\d{2}/.test(s)) return '—'
  return MESES[Number(s.slice(5, 7)) - 1] + ' ' + s.slice(2, 4)
}

export default function HistorialRinde({ tipos, titulo, queEntra = 'entró', queSale = 'salió', ultimos = 20 }) {
  const [desp, setDesp] = useState([])
  const [cargando, setCargando] = useState(true)
  const [verTodo, setVerTodo] = useState(false)

  useEffect(() => {
    let vivo = true
    setCargando(true)
    ;(async () => {
      const { data, error } = await fetchAllRows(() => supabase.from('despostes')
        .select('id, fecha, created_at, modelo, tipo_desposte, kg_media_res, kg_neto, merma_pct, piezas')
        .in('tipo_desposte', tipos)
        .order('fecha', { ascending: false }).order('created_at', { ascending: false }))
      if (!vivo) return
      if (error) console.warn('Error cargando el rinde:', error.message)
      setDesp(data || [])
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [tipos.join(',')])

  const validos = desp.filter(d => rindeDe(d) != null)
  // Ponderado por kilo: un desposte de 120 kg no puede pesar lo mismo que uno
  // de 40 en el promedio.
  const pond = filas => {
    const e = filas.reduce((s, d) => s + n(d.kg_media_res), 0)
    const sa = filas.reduce((s, d) => s + kgSalida(d), 0)
    return e > 0 ? { rinde: (sa / e) * 100, entra: e, sale: sa } : null
  }
  const recientes = validos.slice(0, ultimos)
  const rReciente = pond(recientes)
  const rTotal = pond(validos)

  // Por mes, para ver si el rinde viene mejorando o cayendo.
  const porMes = {}
  validos.forEach(d => {
    const m = mesDe(d.fecha)
    ;(porMes[m] = porMes[m] || []).push(d)
  })
  const meses = Object.entries(porMes).slice(0, 6)

  const rindes = recientes.map(rindeDe).filter(r => r != null)
  const mejor = rindes.length ? Math.max(...rindes) : null
  const peor = rindes.length ? Math.min(...rindes) : null

  const card = { background: 'var(--surface2)', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--border)' }
  const mono = { fontFamily: "'IBM Plex Mono',monospace", fontVariantNumeric: 'tabular-nums' }
  const th = { textAlign: 'left', padding: '6px 8px', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid var(--border)' }
  const td = { padding: '6px 8px', fontSize: 12, borderBottom: '1px solid var(--border)' }

  if (cargando) return <div className="card"><div className="card-title">{titulo}</div><div className="empty">Cargando…</div></div>
  if (validos.length === 0) return <div className="card"><div className="card-title">{titulo}</div><div className="empty">Todavía no hay despostes de este tipo</div></div>

  const lista = verTodo ? validos.slice(0, 60) : validos.slice(0, 8)

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">{titulo}</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        <div style={{ ...card, borderColor: 'var(--gold)' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>Rinde · últimos {recientes.length}</div>
          <div style={{ ...mono, fontSize: 23, color: 'var(--gold)' }}>{rReciente ? rReciente.rinde.toFixed(1) + '%' : '—'}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>merma {rReciente ? (100 - rReciente.rinde).toFixed(1) + '%' : '—'}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>Mejor / peor</div>
          <div style={{ ...mono, fontSize: 17 }}>
            <span style={{ color: 'var(--green)' }}>{mejor != null ? mejor.toFixed(1) + '%' : '—'}</span>
            <span style={{ color: 'var(--muted)' }}> / </span>
            <span style={{ color: 'var(--red-light)' }}>{peor != null ? peor.toFixed(1) + '%' : '—'}</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>de los últimos {recientes.length}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>Histórico</div>
          <div style={{ ...mono, fontSize: 17 }}>{rTotal ? rTotal.rinde.toFixed(1) + '%' : '—'}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{validos.length} despostes</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>Procesado</div>
          <div style={{ ...mono, fontSize: 17 }}>{rTotal ? fmtKg(rTotal.entra, { decimales: 0 }) : '—'}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{rTotal ? `${queSale} ${fmtKg(rTotal.sale, { decimales: 0 })}` : ''}</div>
        </div>
      </div>

      {/* Cómo viene mes a mes */}
      {meses.length > 1 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Mes a mes</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {meses.map(([mes, filas]) => {
              const r = pond(filas)
              if (!r) return null
              return (
                <div key={mes} style={{ ...card, minWidth: 92, padding: '8px 12px' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'capitalize' }}>{mes}</div>
                  <div style={{ ...mono, fontSize: 16, color: 'var(--gold)' }}>{r.rinde.toFixed(1)}%</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{filas.length} {filas.length === 1 ? 'vez' : 'veces'}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={th}>Fecha</th>
              <th style={th}>{queEntra}</th>
              <th style={th}>{queSale}</th>
              <th style={th}>Rinde</th>
              <th style={th}>Merma</th>
            </tr>
          </thead>
          <tbody>
            {lista.map(d => {
              const r = rindeDe(d)
              const entra = n(d.kg_media_res), sale = kgSalida(d)
              return (
                <tr key={d.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {String(d.fecha || '').slice(8, 10)}/{String(d.fecha || '').slice(5, 7)}
                    {d.modelo && <span style={{ color: 'var(--muted)', fontSize: 10 }}> · {d.modelo}</span>}
                  </td>
                  <td style={{ ...td, ...mono }}>{fmtKg(entra, { decimales: 1 })}</td>
                  <td style={{ ...td, ...mono }}>{fmtKg(sale, { decimales: 1 })}</td>
                  <td style={{ ...td, ...mono, fontWeight: 700, color: 'var(--gold)' }}>{r.toFixed(1)}%</td>
                  <td style={{ ...td, ...mono, color: 'var(--red-light)' }}>
                    {(100 - r).toFixed(1)}% · {fmtKg(entra - sale, { decimales: 1 })}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {validos.length > 8 && (
        <button onClick={() => setVerTodo(v => !v)}
          style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: 12, marginTop: 8, fontFamily: "'DM Sans',sans-serif" }}>
          {verTodo ? '▾ ver menos' : `▸ ver los últimos ${Math.min(validos.length, 60)}`}
        </button>
      )}
    </div>
  )
}
