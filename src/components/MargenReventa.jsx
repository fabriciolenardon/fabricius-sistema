// ============================================================
// MARGEN DE REVENTA — cuánto se le gana a las sucursales
// ============================================================
// Dirección → Productividad → Franquicias. Compara, por grupo, el promedio
// de COMPRA (lo que la central paga) contra el promedio de VENTA a las
// franquicias (Alvear y Monte Cristo — `clientes.es_franquicia`, NO
// tipo='carniceria': ese tipo incluye 13 clientes que no son sucursales).
//
// El cálculo vive en la base (RPC `margen_reventa_franquicias`, mig 128):
// una sola llamada, sin límite de 1000 filas, y el costo de los grupos
// transformados sale de lo que REALMENTE se pagó:
//   · Bovino cortes → media res pagada ÷ kg netos del desposte a kilo.
//   · Cerdo → capón pagado ÷ kg VENDIBLES (hueso/grasa/tocino/cuero afuera,
//     la misma regla que el historial de mermas).
//   · Piezas bovinas → compras directas + despostes a piezas del período.
//   · La media res se revende tal cual: compra contra venta, directo.
//   · Cajones de pollo se comparan POR CAJÓN (kg de la venta = cajones).
//
// EL MARGEN GENERAL ES PONDERADO POR PLATA (ganancia total ÷ venta total),
// no un promedio de los %: promediar porcentajes entre categorías da un
// número que no es de nadie (regla de la casa).
// ============================================================
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fechaHoyARG, fechaRelativaARG } from '../lib/fechas'
import { lunesDeLaSemana } from '../lib/cierreAuto'

const GRUPOS = {
  media_res:      { label: '🐄 Media res', nota: 'Se compra y se revende tal cual.' },
  piezas_bovinas: { label: '🍖 Piezas bovinas', nota: 'Compradas directas + las del desposte a piezas.' },
  bovino_corte:   { label: '🥩 Bovino cortes', nota: 'Costo real: media res pagada ÷ kg netos del desposte.' },
  cerdo:          { label: '🐷 Cortes y piezas de cerdo', nota: 'Costo real: capón pagado ÷ kg vendibles (sin hueso, grasa, tocino ni cuero).' },
  pollo_cajon:    { label: '🍗 Cajones de pollo', nota: 'Comparado por cajón.' },
  rebozados:      { label: '🍤 Rebozados', nota: 'El cajón GRANGYS cuenta como 5 kg.' },
  brosas:         { label: '🫀 Brosas', nota: null },
  embutidos:      { label: '🌭 Embutidos', nota: 'El promedio de compra es de los comprados; los de elaboración propia no tienen costo directo acá.' },
}

const PERIODOS = [
  { id: 'semana',  label: 'Esta semana' },
  { id: 'pasada',  label: 'Semana pasada' },
  { id: '30',      label: '30 días' },
  { id: '90',      label: '90 días' },
]

function rangoDe(id) {
  const hoy = fechaHoyARG()
  if (id === 'semana') return { desde: lunesDeLaSemana(), hasta: hoy }
  if (id === 'pasada') {
    const lun = new Date(lunesDeLaSemana() + 'T12:00:00')
    const desde = new Date(lun); desde.setDate(desde.getDate() - 7)
    const hasta = new Date(lun); hasta.setDate(hasta.getDate() - 1)
    const iso = d => d.toISOString().slice(0, 10)
    return { desde: iso(desde), hasta: iso(hasta) }
  }
  if (id === '30') return { desde: fechaRelativaARG(-29), hasta: hoy }
  return { desde: fechaRelativaARG(-89), hasta: hoy }
}

const $ = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR')
const n1 = n => (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 1 })

export default function MargenReventa({ esMovil = false }) {
  const [periodo, setPeriodo] = useState('30')
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vivo = true
    async function cargar() {
      setCargando(true); setError(null)
      const { desde, hasta } = rangoDe(periodo)
      const { data, error: e } = await supabase.rpc('margen_reventa_franquicias', {
        p_desde: desde, p_hasta: hasta,
      })
      if (!vivo) return
      if (e) setError(e.message)
      else setFilas(data || [])
      setCargando(false)
    }
    cargar()
    return () => { vivo = false }
  }, [periodo])

  // Derivados por grupo. Sólo entran al general los grupos con las DOS puntas
  // (venta y compra): un grupo sin costo conocido no puede aportar ganancia.
  const conDatos = filas
    .map(f => {
      const vendCant = Number(f.vend_cant) || 0
      const vendTotal = Number(f.vend_total) || 0
      const compCant = Number(f.comp_cant) || 0
      const compTotal = Number(f.comp_total) || 0
      const promVenta = vendCant > 0 ? vendTotal / vendCant : 0
      const promCompra = compCant > 0 ? compTotal / compCant : 0
      const gana = promVenta && promCompra ? promVenta - promCompra : 0
      const margen = promVenta && promCompra ? (1 - promCompra / promVenta) * 100 : null
      return { ...f, vendCant, vendTotal, promVenta, promCompra, gana, margen }
    })
    .filter(f => f.vendCant > 0)

  // GENERAL: ponderado por plata — ganancia total ÷ venta total, sobre los
  // grupos con costo conocido. NO es el promedio de los % (regla de la casa:
  // promediar entre categorías da un número que no es de nadie).
  const comparables = conDatos.filter(f => f.margen != null)
  const ventaGral = comparables.reduce((s, f) => s + f.vendTotal, 0)
  const costoGral = comparables.reduce((s, f) => s + f.vendCant * f.promCompra, 0)
  const ganaGral = ventaGral - costoGral
  const margenGral = ventaGral > 0 ? (ganaGral / ventaGral) * 100 : 0

  const colorMargen = m => (m == null ? 'var(--muted)' : m < 0 ? '#ff8b8b' : m < 10 ? '#ffd17a' : 'var(--green)')

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div className="card-title" style={{ margin: 0 }}>💹 Margen de reventa a sucursales</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {PERIODOS.map(p => (
            <button key={p.id} onClick={() => setPeriodo(p.id)}
              style={{
                padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                border: `1px solid ${periodo === p.id ? 'var(--gold)' : 'var(--border)'}`,
                background: periodo === p.id ? 'var(--gold)' : 'transparent',
                color: periodo === p.id ? '#000' : 'var(--muted)',
              }}>{p.label}</button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 12px', lineHeight: 1.5 }}>
        Promedio de compra (lo que paga la central) contra promedio de venta a Alvear y Monte Cristo,
        por grupo. En bovino cortes y cerdo el costo es el <strong style={{ color: 'var(--text)' }}>real
        del desposte</strong>: la plata del animal repartida entre los kilos vendibles.
      </div>

      {cargando && <div className="empty">Calculando…</div>}
      {error && <div style={{ color: '#ff8b8b', fontSize: 13 }}>❌ {error}</div>}

      {!cargando && !error && conDatos.length === 0 && (
        <div className="empty">No hubo ventas a las sucursales en este período.</div>
      )}

      {!cargando && !error && conDatos.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: esMovil ? 640 : 0 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Grupo</th>
                <th style={{ textAlign: 'right', padding: '6px 4px' }}>Vendido</th>
                <th style={{ textAlign: 'right', padding: '6px 4px' }}>Prom. compra</th>
                <th style={{ textAlign: 'right', padding: '6px 4px' }}>Prom. venta</th>
                <th style={{ textAlign: 'right', padding: '6px 4px' }}>Ganancia</th>
                <th style={{ textAlign: 'right', padding: '6px 4px' }}>Margen</th>
              </tr>
            </thead>
            <tbody>
              {conDatos.map(f => {
                const g = GRUPOS[f.grupo] || { label: f.grupo }
                return (
                  <tr key={f.grupo} style={{ borderTop: '1px solid var(--border)' }} title={g.nota || ''}>
                    <td style={{ padding: '8px 4px', fontWeight: 600 }}>
                      {g.label}
                      {g.nota && <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>{g.nota}</div>}
                    </td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {n1(f.vendCant)} {f.unidad}
                    </td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                      {f.promCompra > 0 ? `${$(f.promCompra)}/${f.unidad}` : '—'}
                    </td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {$(f.promVenta)}/{f.unidad}
                    </td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, color: colorMargen(f.margen) }}>
                      {f.margen != null ? `${f.gana >= 0 ? '+' : ''}${$(f.gana)}/${f.unidad}` : '—'}
                    </td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: colorMargen(f.margen) }}>
                      {f.margen != null ? `${f.margen.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--gold)' }}>
                <td style={{ padding: '10px 4px', fontWeight: 800 }}>
                  MARGEN GENERAL
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>
                    Ponderado por plata (ganancia ÷ venta), no promedio de los %.
                  </div>
                </td>
                <td style={{ padding: '10px 4px', textAlign: 'right', color: 'var(--muted)', fontSize: 12 }} colSpan={2}>
                  Venta {$(ventaGral)}
                </td>
                <td style={{ padding: '10px 4px', textAlign: 'right', color: 'var(--muted)', fontSize: 12 }}>
                  Costo {$(costoGral)}
                </td>
                <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 800, color: colorMargen(margenGral), whiteSpace: 'nowrap' }}>
                  +{$(ganaGral)}
                </td>
                <td style={{ padding: '10px 4px', textAlign: 'right', fontFamily: "'Bebas Neue',cursive", fontSize: 26, color: colorMargen(margenGral) }}>
                  {margenGral.toFixed(1)}%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
