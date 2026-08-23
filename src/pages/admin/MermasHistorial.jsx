// ============================================================
// HISTORIAL DE MERMAS POR SEMANA (Depósito → Desposte → Mermas)
// ============================================================
// Cuántos kilos se perdieron en la semana y cuánta plata son.
// Una tarjeta por categoría, cada fila un desposte/elaboración
// concreto, y el total de la categoría al pie.
//
// La semana es lun → dom, la misma que usa el cierre operativo,
// para que estos kilos se puedan cruzar con los del cierre.
//
// Solo en la central: la sucursal no ve esta pestaña (la solapa
// 'mermas' ya está filtrada en Deposito.jsx).
// ============================================================
import { useState, useEffect } from 'react'
import { fmtKg, fmtPrecio, fmtNumero } from '../../lib/formatos'
import { fechaRelativaARG } from '../../lib/fechas'
import { lunesDeLaSemana, domingoDeLaSemana } from '../../lib/cierreAuto'
import { calcularMermasPeriodo } from '../../lib/mermas'
import { useEsMovil } from '../../lib/useEsMovil'

const th = { textAlign: 'left', fontSize: 10, color: 'var(--muted)', letterSpacing: 0.5, padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td = { fontSize: 12, padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.04)' }
const num = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
const numTh = { ...th, textAlign: 'right' }

// Cada categoría con su color y su cartelito de dónde sale el número.
const ESTILO_CAT = {
  medias_kilo: { icono: '⚖️', color: 'var(--gold)' },
  medias_pieza: { icono: '🍖', color: 'var(--green)' },
  piezas: { icono: '🔄', color: 'var(--blue)' },
  capones: { icono: '🐷', color: 'var(--amber)' },
  elaborados: { icono: '🌭', color: 'var(--red-light)' },
}

function ChipOrigen({ medida }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: 0.5, padding: '2px 7px', borderRadius: 999,
      background: medida ? 'rgba(125,255,125,0.10)' : 'rgba(255,184,107,0.10)',
      border: `1px solid ${medida ? 'rgba(125,255,125,0.35)' : 'rgba(255,184,107,0.35)'}`,
      color: medida ? '#7dff7d' : '#ffb86b',
    }}>
      {medida ? '⚖️ PESADA' : '📐 CALCULADA'}
    </span>
  )
}

export default function MermasHistorial({ mermaConfig }) {
  const esMovil = useEsMovil()
  // Arranca en la semana PASADA: la actual está a medio cargar y el %
  // de una semana incompleta no se puede comparar contra nada.
  const [desde, setDesde] = useState(() => fechaRelativaARG(-7, new Date(lunesDeLaSemana() + 'T12:00')))
  const [hasta, setHasta] = useState(() => fechaRelativaARG(-1, new Date(lunesDeLaSemana() + 'T12:00')))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { cargar() }, [desde, hasta, mermaConfig])

  async function cargar() {
    setLoading(true); setError(null)
    try {
      setData(await calcularMermasPeriodo(desde, hasta, mermaConfig))
    } catch (err) {
      setError(err.message); setData(null)
    }
    setLoading(false)
  }

  function moverSemana(dias) {
    setDesde(fechaRelativaARG(dias, new Date(desde + 'T12:00')))
    setHasta(fechaRelativaARG(dias, new Date(hasta + 'T12:00')))
  }
  function semanaActual() { setDesde(lunesDeLaSemana()); setHasta(domingoDeLaSemana()) }
  function semanaPasada() {
    setDesde(fechaRelativaARG(-7, new Date(lunesDeLaSemana() + 'T12:00')))
    setHasta(fechaRelativaARG(-1, new Date(lunesDeLaSemana() + 'T12:00')))
  }

  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '7px 10px', fontFamily: "'DM Sans',sans-serif", fontSize: 13 }
  const btn = { padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }

  return (
    <div>
      {/* ── Selector de semana ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">📉 Historial de mermas por semana</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.6 }}>
          Los kilos que se pierden en cada transformación de la semana y cuánta plata son.
          La semana va <strong>lunes a domingo</strong>, igual que el cierre operativo.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => moverSemana(-7)} style={btn}>◀ Anterior</button>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={inp} />
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>→</span>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={inp} />
          <button onClick={() => moverSemana(7)} style={btn}>Siguiente ▶</button>
          <button onClick={semanaPasada} style={btn}>Semana pasada</button>
          <button onClick={semanaActual} style={btn}>Semana actual</button>
        </div>
      </div>

      {loading && <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>Calculando mermas…</div>}
      {error && <div style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: '10px 16px', color: '#ff6b6b', fontWeight: 600 }}>❌ {error}</div>}

      {!loading && data && (
        <>
          {/* ── Resumen de la semana ── */}
          <div className="card" style={{ marginBottom: 16, borderColor: 'var(--gold)' }}>
            <div className="card-title">Resumen de la semana</div>
            <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12 }}>
              <Kpi label="KILOS PROCESADOS" valor={fmtKg(data.totales.kgEntra, { decimales: 1 })} color="var(--text)" />
              <Kpi label="SE PERDIÓ EN MERMA" valor={fmtKg(data.totales.kgMerma, { decimales: 1 })} color="var(--red-light)" />
              <Kpi label="% SOBRE LO PROCESADO" valor={`${fmtNumero(data.totales.pct, 2)}%`} color="var(--amber)" />
              <Kpi label="COSTO DE LA MERMA" valor={fmtPrecio(data.totales.costo, { decimales: 0 })} color="var(--red-light)" />
            </div>
            {data.totales.costoPorKg > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
                Cada kilo de merma costó en promedio <strong style={{ color: 'var(--text)' }}>{fmtPrecio(data.totales.costoPorKg, { decimales: 0 })}</strong>.
              </div>
            )}
            {/* Los kilos merman en cascada y hay que decirlo: si no, "kilos
                procesados" se lee como "kilos comprados" y no es lo mismo.
                Los kilos de merma y la plata SÍ son exactos: cada pérdida se
                cuenta una sola vez, en la etapa donde ocurrió. */}
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
              ℹ️ <strong>Kilos procesados</strong> no es lo mismo que kilos comprados: una media res que se desposta
              a piezas y después esas piezas se convierten a cortes pasa dos veces por este tablero.
              Los <strong>kilos de merma y el costo sí son exactos</strong> — cada pérdida se cuenta una sola vez,
              en la etapa donde ocurrió.
            </div>
          </div>

          {/* ── Avisos: lo que el informe no puede dar por sentado ── */}
          {data.avisos.length > 0 && (
            <div style={{ background: '#3a2a1a', border: '1px solid #ffb86b', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#ffb86b' }}>
              {data.avisos.map((a, i) => <div key={i} style={{ marginBottom: i < data.avisos.length - 1 ? 4 : 0 }}>⚠️ {a}</div>)}
            </div>
          )}

          {/* ── Una tarjeta por categoría ── */}
          {data.categorias.map(cat => (
            <TarjetaCategoria key={cat.id} cat={cat} esMovil={esMovil} />
          ))}

          {/* ── Relación costo/merma por categoría ── */}
          <TablaRelacion categorias={data.categorias} totales={data.totales} esMovil={esMovil} />
        </>
      )}
    </div>
  )
}

function Kpi({ label, valor, color }) {
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 26, color, lineHeight: 1 }}>{valor}</div>
    </div>
  )
}

function TarjetaCategoria({ cat, esMovil }) {
  const est = ESTILO_CAT[cat.id] || { icono: '•', color: 'var(--muted)' }
  const vacia = cat.total.n === 0
  return (
    <div className="card" style={{ marginBottom: 16, borderColor: vacia ? 'var(--border)' : est.color }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <div className="card-title" style={{ color: est.color, margin: 0 }}>{est.icono} {cat.label}</div>
        {!vacia && (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {cat.total.n} en la semana · merma <strong style={{ color: 'var(--red-light)' }}>{fmtKg(cat.total.kgMerma, { decimales: 1 })}</strong>
            {' '}({fmtNumero(cat.total.pct, 2)}%) · <strong style={{ color: 'var(--red-light)' }}>{fmtPrecio(cat.total.costo, { decimales: 0 })}</strong>
          </div>
        )}
      </div>

      {vacia
        ? <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>Sin movimientos esta semana.</div>
        : cat.subgrupos
          ? cat.subgrupos.map(g => g.total.n > 0 && (
              <div key={g.id} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1, fontWeight: 700, marginBottom: 6 }}>{g.label.toUpperCase()}</div>
                <TablaFilas filas={g.filas} total={g.total} esMovil={esMovil} />
              </div>
            ))
          : <TablaFilas filas={cat.filas} total={cat.total} esMovil={esMovil} />}
    </div>
  )
}

function TablaFilas({ filas, total, esMovil }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: esMovil ? 620 : 0 }}>
        <thead>
          <tr>
            <th style={th}>Fecha</th>
            <th style={th}>Producto</th>
            <th style={numTh}>Kg entrante</th>
            <th style={numTh}>Kg obtenido</th>
            <th style={numTh}>Merma</th>
            <th style={numTh}>%</th>
            <th style={numTh}>$/kg</th>
            <th style={numTh}>Costo merma</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(f => (
            <tr key={f.id}>
              <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--muted)' }}>{f.fecha?.slice(8, 10)}/{f.fecha?.slice(5, 7)}</td>
              <td style={td}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <strong>{f.etiqueta}</strong>
                  <ChipOrigen medida={f.medida} />
                </div>
                {/* El desglose "22% Nt + 2,5% frío" que pidió Fabricio: sale de lo
                    guardado en la fila, no de la config de hoy. */}
                {f.desglose?.conocido && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                    {fmtNumero(f.desglose.animal, 0)}% animal
                    {f.desglose.frio > 0
                      ? ` + ${fmtNumero(f.desglose.frio, 1)}% frío`
                      : ' · sin merma de frío'}
                  </div>
                )}
                {f.pctConfig != null && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{fmtNumero(f.pctConfig, 0)}% configurado para esta pieza</div>
                )}
                {f.detalle && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{f.detalle}</div>}
              </td>
              <td style={num}>{fmtKg(f.kgEntra, { decimales: 1 })}</td>
              <td style={num}>{fmtKg(f.kgSale, { decimales: 1 })}</td>
              <td style={{ ...num, color: f.rinde ? 'var(--green)' : 'var(--red-light)', fontWeight: 700 }}>
                {f.rinde ? `+${fmtKg(-f.kgMerma, { decimales: 1 })}` : fmtKg(f.kgMerma, { decimales: 1 })}
              </td>
              <td style={{ ...num, color: f.rinde ? 'var(--green)' : 'var(--muted)' }}>
                {f.rinde ? `+${fmtNumero(-f.pct, 2)}%` : `${fmtNumero(f.pct, 2)}%`}
              </td>
              <td style={{ ...num, color: 'var(--muted)' }}>{f.precioKg > 0 ? fmtPrecio(f.precioKg, { decimales: 0 }) : '—'}</td>
              <td style={{ ...num, color: f.costo > 0 ? 'var(--red-light)' : 'var(--muted)' }}>{f.costo > 0 ? fmtPrecio(f.costo, { decimales: 0 }) : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: 'var(--surface2)' }}>
            <td style={{ ...td, fontWeight: 800 }} colSpan={2}>TOTAL ({total.n})</td>
            <td style={{ ...num, fontWeight: 800 }}>{fmtKg(total.kgEntra, { decimales: 1 })}</td>
            <td style={{ ...num, fontWeight: 800 }}>{fmtKg(total.kgSale, { decimales: 1 })}</td>
            <td style={{ ...num, fontWeight: 800, color: 'var(--red-light)' }}>{fmtKg(total.kgMerma, { decimales: 1 })}</td>
            <td style={{ ...num, fontWeight: 800, color: 'var(--amber)' }}>{fmtNumero(total.pct, 2)}%</td>
            <td style={num}></td>
            <td style={{ ...num, fontWeight: 800, color: 'var(--red-light)' }}>{fmtPrecio(total.costo, { decimales: 0 })}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// Dónde duele más la merma: no siempre es la categoría que más kilos pierde.
function TablaRelacion({ categorias, totales, esMovil }) {
  const conDatos = categorias.filter(c => c.total.n > 0)
  if (conDatos.length === 0) return null
  return (
    <div className="card" style={{ borderColor: 'var(--amber)' }}>
      <div className="card-title" style={{ color: 'var(--amber)' }}>💸 Relación costo / merma por categoría</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        Dónde duele más la merma. No es siempre la categoría que más kilos pierde:
        un kilo de media res vale muy distinto que uno de capón.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: esMovil ? 560 : 0 }}>
          <thead>
            <tr>
              <th style={th}>Categoría</th>
              <th style={numTh}>Kg procesados</th>
              <th style={numTh}>Kg merma</th>
              <th style={numTh}>% merma</th>
              <th style={numTh}>$/kg merma</th>
              <th style={numTh}>Costo</th>
              <th style={numTh}>% del costo total</th>
            </tr>
          </thead>
          <tbody>
            {conDatos.map(c => {
              const est = ESTILO_CAT[c.id] || {}
              const share = totales.costo > 0 ? (c.total.costo / totales.costo) * 100 : 0
              return (
                <tr key={c.id}>
                  <td style={td}><strong style={{ color: est.color }}>{est.icono} {c.label}</strong></td>
                  <td style={num}>{fmtKg(c.total.kgEntra, { decimales: 1 })}</td>
                  <td style={{ ...num, color: 'var(--red-light)' }}>{fmtKg(c.total.kgMerma, { decimales: 1 })}</td>
                  <td style={num}>{fmtNumero(c.total.pct, 2)}%</td>
                  <td style={num}>{c.total.costoPorKg > 0 ? fmtPrecio(c.total.costoPorKg, { decimales: 0 }) : '—'}</td>
                  <td style={{ ...num, color: 'var(--red-light)', fontWeight: 700 }}>{fmtPrecio(c.total.costo, { decimales: 0 })}</td>
                  <td style={num}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                      <div style={{ width: 60, height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, share)}%`, height: '100%', background: est.color || 'var(--muted)' }} />
                      </div>
                      {fmtNumero(share, 1)}%
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--surface2)' }}>
              <td style={{ ...td, fontWeight: 800 }}>TOTAL SEMANA</td>
              <td style={{ ...num, fontWeight: 800 }}>{fmtKg(totales.kgEntra, { decimales: 1 })}</td>
              <td style={{ ...num, fontWeight: 800, color: 'var(--red-light)' }}>{fmtKg(totales.kgMerma, { decimales: 1 })}</td>
              <td style={{ ...num, fontWeight: 800, color: 'var(--amber)' }}>{fmtNumero(totales.pct, 2)}%</td>
              <td style={{ ...num, fontWeight: 800 }}>{totales.costoPorKg > 0 ? fmtPrecio(totales.costoPorKg, { decimales: 0 }) : '—'}</td>
              <td style={{ ...num, fontWeight: 800, color: 'var(--red-light)' }}>{fmtPrecio(totales.costo, { decimales: 0 })}</td>
              <td style={{ ...num, fontWeight: 800 }}>100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
