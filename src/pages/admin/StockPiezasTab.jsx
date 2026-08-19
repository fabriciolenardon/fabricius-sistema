// ============================================================
// STOCK POR PIEZA — cuánto queda de cada una y qué pasó con ella
// ============================================================
// Una sola pantalla para dos familias (ver lib/stockPiezas.js):
//   🐷 cerdo     la sucursal no recibe capones sino piezas ya despostadas,
//                así que sin esto carga una pierna y no tiene dónde ver
//                cuánto le queda ni en qué se fue.
//   🌭 embutido  la central los elabora, la sucursal se los compra; los dos
//                casos entran al mismo bucket.
//
// Sirve para las dos bocas: la central también compra piezas sueltas además
// de despostar, y esos kilos hasta ahora solo se veían en el total.
// ============================================================
import { useState, useEffect } from 'react'
import { fmtKg } from '../../lib/formatos'
import { fechaHoyARG } from '../../lib/fechas'
import { FAMILIAS, cargarStockFamilia, cargarMovimientos, resumirPorBucket } from '../../lib/stockPiezas'

const CLASES = {
  ingreso:     { label: 'Compra',      color: '#7dff7d', icono: '📥' },
  interna:     { label: 'Producción',  color: '#7dc4ff', icono: '🔪' },
  elaborado:   { label: 'Elaborado',   color: '#7dc4ff', icono: '🌭' },
  venta:       { label: 'Venta',       color: '#ff9b6b', icono: '🛒' },
  remito:      { label: 'Remito',      color: '#ffd17a', icono: '🧾' },
  elaboracion: { label: 'Elaboración', color: '#d0a3ff', icono: '🌭' },
}

// Por defecto los últimos 30 días: traer todo el historial obligaría a leer
// miles de ventas y remitos para armar los movimientos.
function hace(dias) {
  const d = new Date(fechaHoyARG() + 'T12:00')
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

export default function StockPiezasTab() {
  const [familia, setFamilia] = useState('cerdo')
  const [stock, setStock] = useState({})
  const [movs, setMovs] = useState([])
  const [dias, setDias] = useState(30)
  const [bucketSel, setBucketSel] = useState('todos')
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setBucketSel('todos')
    ;(async () => {
      const [s, m] = await Promise.all([
        cargarStockFamilia(familia),
        cargarMovimientos(familia, { desde: hace(dias), hasta: fechaHoyARG() }),
      ])
      if (!vivo) return
      setStock(s); setMovs(m); setCargando(false)
    })()
    return () => { vivo = false }
  }, [familia, dias])

  const cfg = FAMILIAS[familia]
  const resumen = resumirPorBucket(familia, movs)
  const movsFiltrados = bucketSel === 'todos' ? movs : movs.filter(m => m.bucket === bucketSel)
  const totalKg = Object.values(stock).reduce((s, k) => s + k, 0)

  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid var(--border)' }
  const td = { padding: '8px 10px', fontSize: 13, borderBottom: '1px solid var(--border)' }

  return (
    <div>
      {/* Qué familia se está mirando */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[['cerdo', '🐷 Cerdo'], ['embutido', '🌭 Embutidos']].map(([id, label]) => (
          <button key={id} onClick={() => setFamilia(id)}
            style={{ padding: '8px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans',sans-serif", fontWeight: 700,
              border: `1px solid ${familia === id ? 'var(--gold)' : 'var(--border)'}`,
              background: familia === id ? 'var(--gold)' : 'transparent',
              color: familia === id ? '#000' : 'var(--muted)' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── KILOS POR PIEZA ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>{cfg.titulo}</div>
          <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 24, color: 'var(--gold)' }}>
            {fmtKg(totalKg, { decimales: 2 })} en total
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginTop: 14 }}>
          {Object.entries(cfg.buckets).map(([tipo, label]) => {
            const kg = stock[tipo] || 0
            const r = resumen[tipo] || { entro: 0, salio: 0 }
            const activo = bucketSel === tipo
            return (
              <button key={tipo} onClick={() => setBucketSel(activo ? 'todos' : tipo)}
                title="Ver solo los movimientos de esta pieza"
                style={{
                  textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '12px 14px',
                  background: activo ? 'rgba(201,168,76,0.12)' : 'var(--surface2)',
                  border: `1px solid ${activo ? 'var(--gold)' : kg <= 0 ? '#5a2a2a' : 'var(--border)'}`,
                  fontFamily: "'DM Sans',sans-serif",
                }}>
                <div style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600 }}>{label}</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 26, color: kg <= 0 ? 'var(--red-light)' : 'var(--text)', lineHeight: 1.1 }}>
                  {fmtKg(kg, { decimales: 2 })}
                </div>
                {(r.entro > 0 || r.salio > 0) && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                    {r.entro > 0 && <span style={{ color: '#7dff7d' }}>+{fmtKg(r.entro, { decimales: 1 })}</span>}
                    {r.salio > 0 && <span style={{ color: '#ff9b6b', marginLeft: 6 }}>−{fmtKg(r.salio, { decimales: 1 })}</span>}
                    <span style={{ marginLeft: 4 }}>en {dias}d</span>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── MOVIMIENTOS ── */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            📋 Movimientos
            {bucketSel !== 'todos' && <span style={{ color: 'var(--gold)' }}> · {cfg.buckets[bucketSel]}</span>}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[30, 90, 180].map(d => (
              <button key={d} onClick={() => setDias(d)}
                style={{ padding: '5px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontFamily: "'DM Sans',sans-serif", fontWeight: 600,
                  border: `1px solid ${dias === d ? 'var(--gold)' : 'var(--border)'}`,
                  background: dias === d ? 'var(--gold)' : 'transparent',
                  color: dias === d ? '#000' : 'var(--muted)' }}>
                {d} días
              </button>
            ))}
            {bucketSel !== 'todos' && (
              <button onClick={() => setBucketSel('todos')}
                style={{ padding: '5px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 12, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontFamily: "'DM Sans',sans-serif" }}>
                ✕ Ver todas
              </button>
            )}
          </div>
        </div>

        {cargando ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '18px 0' }}>Cargando movimientos…</div>
        ) : movsFiltrados.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '18px 0' }}>{cfg.vacio}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={th}>Fecha</th>
                  <th style={th}>Pieza</th>
                  <th style={th}>Qué pasó</th>
                  <th style={th}>Detalle</th>
                  <th style={{ ...th, textAlign: 'right' }}>Kg</th>
                </tr>
              </thead>
              <tbody>
                {movsFiltrados.slice(0, 300).map(m => {
                  const c = CLASES[m.clase] || CLASES.ingreso
                  return (
                    <tr key={m.id}>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12 }}>
                        {new Date(m.fecha + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{cfg.buckets[m.bucket]}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: c.color, fontWeight: 600, fontSize: 12 }}>
                        {c.icono} {c.label}
                      </td>
                      <td style={{ ...td, color: 'var(--text2)', fontSize: 12 }}>{m.detalle}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: m.kg > 0 ? '#7dff7d' : '#ff9b6b' }}>
                        {m.kg > 0 ? '+' : '−'}{fmtKg(Math.abs(m.kg), { decimales: 2 })}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {movsFiltrados.length > 300 && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
                Mostrando los 300 más recientes de {movsFiltrados.length}. Filtrá por pieza o achicá el período para ver el resto.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
