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

// Cada categoría con su color y si su merma se pesa o se calcula
// (dentro de una categoría es siempre lo mismo, ver lib/mermas.js).
const ESTILO_CAT = {
  medias_kilo: { icono: '⚖️', color: 'var(--gold)', medida: false },
  medias_pieza: { icono: '🍖', color: 'var(--green)', medida: true },
  piezas: { icono: '🔄', color: 'var(--blue)', medida: false },
  capones: { icono: '🐷', color: 'var(--amber)', medida: true },
  elaborados: { icono: '🌭', color: 'var(--red-light)', medida: true },
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
          <ResumenPorCategoria categorias={data.categorias} totales={data.totales} esMovil={esMovil} />

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

// ── RESUMEN: UN PANEL POR CATEGORÍA ─────────────────────────
// El promedio de todo junto no es la merma de nada: un 22% de media res
// y un 1,7% de capón dan un 11% que no describe a ninguno de los dos, y
// el kilo de cada uno vale muy distinto. Por eso cada categoría trae sus
// propios kilos, su % y su plata, y el total va abajo, chico y avisado.
function ResumenPorCategoria({ categorias, totales, esMovil }) {
  const conDatos = categorias.filter(c => c.total.n > 0)
  const sinDatos = categorias.filter(c => c.total.n === 0)
  return (
    <div className="card" style={{ marginBottom: 16, borderColor: 'var(--gold)' }}>
      <div className="card-title">Resumen de la semana — cada categoría por separado</div>
      {conDatos.length === 0
        ? <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>Sin movimientos en la semana.</div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            {conDatos.map(c => <PanelCategoria key={c.id} cat={c} />)}
          </div>
        )}

      {sinDatos.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
          Sin movimientos: {sinDatos.map(c => c.label).join(' · ')}
        </div>
      )}

      {/* El total va acá abajo y con la advertencia pegada: es una referencia,
          no la merma de ningún producto. */}
      {conDatos.length > 1 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 13 }}>
            <span style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1, fontWeight: 700 }}>TODAS JUNTAS</span>
            <span>Procesados <strong>{fmtKg(totales.kgEntra, { decimales: 1 })}</strong></span>
            <span>Merma <strong style={{ color: 'var(--red-light)' }}>{fmtKg(totales.kgMerma, { decimales: 1 })}</strong></span>
            <span>Costo <strong style={{ color: 'var(--red-light)' }}>{fmtPrecio(totales.costo, { decimales: 0 })}</strong></span>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
            ⚠️ El total <strong>no lleva %</strong> a propósito: mezclar una media res al 22% con un capón al 1,7%
            da un número que no es la merma de ninguno de los dos. Sirve para saber cuánta plata se fue en la
            semana; para decidir, mirá cada categoría. Y ojo: una media res que va a piezas y después a cortes
            pasa <strong>dos veces</strong> por estos kilos procesados — la merma y el costo, en cambio, se
            cuentan una sola vez, en la etapa donde ocurrieron.
          </div>
        </div>
      )}
    </div>
  )
}

function PanelCategoria({ cat }) {
  const est = ESTILO_CAT[cat.id] || { icono: '•', color: 'var(--muted)' }
  const t = cat.total
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12, borderLeft: `3px solid ${est.color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: est.color, lineHeight: 1.3 }}>{est.icono} {cat.label}</div>
        {est.medida != null && <ChipOrigen medida={est.medida} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 30, color: 'var(--red-light)', lineHeight: 1 }}>
          {fmtKg(t.kgMerma, { decimales: 1 })}
        </div>
        <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--amber)', lineHeight: 1 }}>
          {fmtNumero(t.pct, 2)}%
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>de merma</div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
        <div>Procesados <strong style={{ color: 'var(--text)' }}>{fmtKg(t.kgEntra, { decimales: 1 })}</strong>
          {' → '}vendible <strong style={{ color: 'var(--green)' }}>{fmtKg(t.kgSale, { decimales: 1 })}</strong></div>
        <div>Costo de la merma <strong style={{ color: 'var(--red-light)' }}>{fmtPrecio(t.costo, { decimales: 0 })}</strong></div>
        {t.precioReal > 0 && (
          <div>Kilo vendible <strong style={{ color: 'var(--gold)' }}>{fmtPrecio(t.precioReal, { decimales: 0 })}</strong>
            {t.precioIngreso > 0 && <span> (comprado a {fmtPrecio(t.precioIngreso, { decimales: 0 })})</span>}</div>
        )}
        <div style={{ opacity: 0.8 }}>{t.n} {t.n === 1 ? 'movimiento' : 'movimientos'}</div>
      </div>
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
            <th style={numTh}>Neto vendible</th>
            <th style={numTh}>Merma</th>
            <th style={numTh}>%</th>
            <th style={numTh}>$/kg ingreso</th>
            <th style={numTh}>$/kg real</th>
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
              <td style={{ ...num, color: 'var(--green)' }}>{fmtKg(f.kgSale, { decimales: 1 })}</td>
              <td style={{ ...num, color: f.rinde ? 'var(--green)' : 'var(--red-light)', fontWeight: 700 }}>
                {f.rinde ? `+${fmtKg(-f.kgMerma, { decimales: 1 })}` : fmtKg(f.kgMerma, { decimales: 1 })}
              </td>
              <td style={{ ...num, color: f.rinde ? 'var(--green)' : 'var(--muted)' }}>
                {f.rinde ? `+${fmtNumero(-f.pct, 2)}%` : `${fmtNumero(f.pct, 2)}%`}
              </td>
              <td style={{ ...num, color: 'var(--muted)' }}>{f.precioKg > 0 ? fmtPrecio(f.precioKg, { decimales: 0 }) : '—'}</td>
              <td style={{ ...num, color: 'var(--gold)', fontWeight: 700 }}>{f.precioReal > 0 ? fmtPrecio(f.precioReal, { decimales: 0 }) : '—'}</td>
              <td style={{ ...num, color: f.costo > 0 ? 'var(--red-light)' : 'var(--muted)' }}>{f.costo > 0 ? fmtPrecio(f.costo, { decimales: 0 }) : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: 'var(--surface2)' }}>
            <td style={{ ...td, fontWeight: 800 }} colSpan={2}>TOTAL ({total.n})</td>
            <td style={{ ...num, fontWeight: 800 }}>{fmtKg(total.kgEntra, { decimales: 1 })}</td>
            <td style={{ ...num, fontWeight: 800, color: 'var(--green)' }}>{fmtKg(total.kgSale, { decimales: 1 })}</td>
            <td style={{ ...num, fontWeight: 800, color: 'var(--red-light)' }}>{fmtKg(total.kgMerma, { decimales: 1 })}</td>
            <td style={{ ...num, fontWeight: 800, color: 'var(--amber)' }}>{fmtNumero(total.pct, 2)}%</td>
            <td style={{ ...num, color: 'var(--muted)' }}>{total.precioIngreso > 0 ? fmtPrecio(total.precioIngreso, { decimales: 0 }) : '—'}</td>
            <td style={{ ...num, fontWeight: 800, color: 'var(--gold)' }}>{total.precioReal > 0 ? fmtPrecio(total.precioReal, { decimales: 0 }) : '—'}</td>
            <td style={{ ...num, fontWeight: 800, color: 'var(--red-light)' }}>{fmtPrecio(total.costo, { decimales: 0 })}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// El cierre del informe: de lo que entró, cuánto queda vendible y a qué
// precio termina saliendo ese kilo una vez que la merma se le carga encima.
function TablaRelacion({ categorias, totales, esMovil }) {
  const conDatos = categorias.filter(c => c.total.n > 0)
  if (conDatos.length === 0) return null
  const Fila = ({ c, est, total, esTotal }) => (
    <tr style={esTotal ? { background: 'var(--surface2)' } : undefined}>
      <td style={{ ...td, fontWeight: esTotal ? 800 : 400 }}>
        {esTotal ? 'TOTAL SEMANA' : <strong style={{ color: est.color }}>{est.icono} {c.label}</strong>}
      </td>
      <td style={{ ...num, fontWeight: esTotal ? 800 : 400 }}>{fmtKg(total.kgEntra, { decimales: 1 })}</td>
      <td style={{ ...num, color: 'var(--red-light)', fontWeight: esTotal ? 800 : 400 }}>{fmtKg(total.kgMerma, { decimales: 1 })}</td>
      {/* El % de la fila TOTAL no va: promediar 22% de media res con 1,7% de
          capón da un número que no es la merma de ningún producto. */}
      <td style={{ ...num, color: 'var(--amber)', fontWeight: esTotal ? 800 : 400 }}>
        {esTotal ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>—</span> : `${fmtNumero(total.pct, 2)}%`}
      </td>
      <td style={{ ...num, color: 'var(--green)', fontWeight: 700 }}>{fmtKg(total.kgSale, { decimales: 1 })}</td>
      {/* Tampoco un $/kg total: promediar el kilo de media res ($9.845) con el
          de capón ($3.952) no describe el costo de nada. */}
      <td style={{ ...num, color: 'var(--muted)' }}>{!esTotal && total.precioIngreso > 0 ? fmtPrecio(total.precioIngreso, { decimales: 0 }) : '—'}</td>
      <td style={{ ...num, color: 'var(--gold)', fontWeight: 800 }}>{!esTotal && total.precioReal > 0 ? fmtPrecio(total.precioReal, { decimales: 0 }) : '—'}</td>
    </tr>
  )
  return (
    <div className="card" style={{ borderColor: 'var(--amber)' }}>
      <div className="card-title" style={{ color: 'var(--amber)' }}>💸 Costo real por kilo vendible</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.6 }}>
        De lo que entró, cuántos kilos quedan para vender y a cuánto sale de verdad ese kilo.
        La plata que pagaste no cambia con la merma: <strong style={{ color: 'var(--text)' }}>cambia entre cuántos
        kilos se reparte</strong>. Por eso el costo real es <strong style={{ color: 'var(--text)' }}>precio ÷ (1 − merma)</strong>,
        no precio + merma — con 22% son $12.821 y no $12.200 sobre un kilo de $10.000.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: esMovil ? 620 : 0 }}>
          <thead>
            <tr>
              <th style={th}>Categoría</th>
              <th style={numTh}>Kg procesados</th>
              <th style={numTh}>Kg merma</th>
              <th style={numTh}>% merma</th>
              <th style={numTh}>Neto vendible</th>
              <th style={numTh}>$/kg ingreso</th>
              <th style={numTh}>$/kg REAL</th>
            </tr>
          </thead>
          <tbody>
            {conDatos.map(c => <Fila key={c.id} c={c} est={ESTILO_CAT[c.id] || {}} total={c.total} />)}
          </tbody>
          <tfoot><Fila total={totales} est={{}} esTotal /></tfoot>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
        🐷 Las <strong>piezas de cerdo no llevan merma propia</strong>: se venden como salen del capón.
        Su única merma es la del capón, que ya está contada arriba.
      </div>
    </div>
  )
}
