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
//
// VISTA POR SUCURSAL: chips "Todas" + una por franquicia, leídas de
// `clientes.es_franquicia` — una franquicia nueva aparece sola, sin tocar
// código. La vista de una sucursal usa el RPC
// `margen_reventa_franquicia_cliente` (mig 129): mismas cuentas, ventas
// filtradas a ese cliente; el costo de compra sigue siendo el global de la
// central (es el mismo costo sea quien sea el que compra).
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
  { id: 'custom',  label: '📅 Elegir fechas' },
]

// `custom` son las fechas que elige a mano; para los demás períodos se ignora.
function rangoDe(id, custom) {
  const hoy = fechaHoyARG()
  if (id === 'custom') return { desde: custom?.desde || hoy, hasta: custom?.hasta || hoy }
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
  // Rango a medida. Arranca en los últimos 30 días para que, al abrirlo, ya
  // tenga algo válido cargado y no haya que tipear las dos fechas de cero.
  const [custom, setCustom] = useState({ desde: fechaRelativaARG(-29), hasta: fechaHoyARG() })
  const [sucursal, setSucursal] = useState('todas') // 'todas' | clientes.nombre exacto
  const [sucursales, setSucursales] = useState([])
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  // Franquicias reales (es_franquicia, NO tipo='carniceria'): las chips salen
  // de acá, así una sucursal nueva aparece sola. Se guarda el nombre EXACTO
  // (algunos tienen espacio al final) porque el RPC filtra por igualdad.
  useEffect(() => {
    let vivo = true
    supabase.from('clientes').select('nombre').eq('es_franquicia', true).order('nombre')
      .then(({ data }) => { if (vivo) setSucursales(data || []) })
    return () => { vivo = false }
  }, [])

  useEffect(() => {
    let vivo = true
    async function cargar() {
      setCargando(true); setError(null)
      const { desde, hasta } = rangoDe(periodo, custom)
      const { data, error: e } = sucursal === 'todas'
        ? await supabase.rpc('margen_reventa_franquicias', { p_desde: desde, p_hasta: hasta })
        : await supabase.rpc('margen_reventa_franquicia_cliente', { p_desde: desde, p_hasta: hasta, p_cliente: sucursal })
      if (!vivo) return
      if (e) {
        setError(/margen_reventa_franquicia_cliente|schema cache/i.test(e.message)
          ? 'Falta aplicar la migración 129 (supabase/129_margen_reventa_por_franquicia.sql) para ver el detalle por sucursal.'
          : e.message)
      } else setFilas(data || [])
      setCargando(false)
    }
    cargar()
    return () => { vivo = false }
  }, [periodo, sucursal, custom.desde, custom.hasta])

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

  // Fechas exactas del período elegido, visibles en pantalla: Fabricio
  // preguntó "¿30 días desde cuándo?" — son ventanas que TERMINAN HOY
  // (no mes calendario), así que se muestra el rango para que no haya duda.
  const rango = rangoDe(periodo, custom)
  // Al revés no devuelve nada y parecería que no hubo ventas.
  const rangoInvertido = periodo === 'custom' && custom.desde > custom.hasta
  const ddmm = f => { const [, m, d] = f.split('-'); return `${d}/${m}` }

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

      {periodo === 'custom' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10,
                      padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Del</span>
          <input type="date" value={custom.desde} max={fechaHoyARG()}
            onChange={e => setCustom(c => ({ ...c, desde: e.target.value }))}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 13 }} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>al</span>
          <input type="date" value={custom.hasta} max={fechaHoyARG()}
            onChange={e => setCustom(c => ({ ...c, hasta: e.target.value }))}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 13 }} />
          {rangoInvertido && (
            <span style={{ fontSize: 12, color: '#ff8b8b', fontWeight: 700 }}>
              ⚠️ La fecha de inicio es posterior a la de fin
            </span>
          )}
        </div>
      )}

      {/* Sub-módulo por franquicia: Todas + una chip por sucursal (es_franquicia). */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {[{ nombre: 'todas' }, ...sucursales].map(s => {
          const activa = sucursal === s.nombre
          return (
            <button key={s.nombre} onClick={() => setSucursal(s.nombre)}
              style={{
                padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                border: `1px solid ${activa ? 'var(--amber)' : 'var(--border)'}`,
                background: activa ? 'var(--amber)' : 'transparent',
                color: activa ? '#000' : 'var(--muted)',
              }}>
              {s.nombre === 'todas' ? '🏪 Todas las sucursales' : `📍 ${s.nombre.trim()}`}
            </button>
          )
        })}
      </div>

      <div style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 12px', lineHeight: 1.5 }}>
        <span style={{ display: 'inline-block', marginRight: 8, padding: '1px 8px', borderRadius: 5,
                       border: '1px solid var(--border)', color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap' }}>
          📅 Del {ddmm(rango.desde)} al {ddmm(rango.hasta)}{rango.hasta === fechaHoyARG() ? ' (hoy)' : ''}
        </span>
        Promedio de compra (lo que paga la central) contra promedio de venta a{' '}
        {sucursal === 'todas' ? 'las sucursales' : <strong style={{ color: 'var(--text)' }}>{sucursal.trim()}</strong>},
        por grupo. En bovino cortes y cerdo el costo es el <strong style={{ color: 'var(--text)' }}>real
        del desposte</strong>: la plata del animal repartida entre los kilos vendibles.
      </div>

      {cargando && <div className="empty">Calculando…</div>}
      {error && <div style={{ color: '#ff8b8b', fontSize: 13 }}>❌ {error}</div>}

      {!cargando && !error && conDatos.length === 0 && (
        <div className="empty">
          {sucursal === 'todas'
            ? 'No hubo ventas a las sucursales en este período.'
            : `No hubo ventas a ${sucursal.trim()} en este período.`}
        </div>
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
                {/* Cada total DEBAJO de su columna: el costo bajo "Prom. compra"
                    y la venta bajo "Prom. venta". Antes el colSpan arrancaba en
                    "Vendido" y los dos números quedaban corridos una columna a la
                    izquierda: se leía la venta bajo compra y el costo bajo venta. */}
                <td />
                <td style={{ padding: '10px 4px', textAlign: 'right', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase' }}>Costo total</div>
                  {$(costoGral)}
                </td>
                <td style={{ padding: '10px 4px', textAlign: 'right', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase' }}>Venta total</div>
                  {$(ventaGral)}
                </td>
                <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 800, color: colorMargen(margenGral), whiteSpace: 'nowrap' }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 400 }}>Ganancia</div>
                  {ganaGral >= 0 ? '+' : ''}{$(ganaGral)}
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
