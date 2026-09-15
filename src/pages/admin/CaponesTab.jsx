// ============================================================
// 🐖 CAPONES — qué hay en la cámara y qué se hizo con cada uno
// ============================================================
// El espejo de la solapa Media Reses, para el cerdo. Pedido de Fabricio
// (15/09/2026): el stock de cerdo mostraba los kilos por pieza pero no los
// capones enteros, así que no había forma de ver cuántos quedaban ni en qué
// se fue cada uno.
//
// ⚠️ El capón NO tiene ficha propia como la media res: `medias_stock` guarda
// una fila por media con su código MR-XXX, pero el capón es simplemente una
// fila de `entradas_deposito` con tipo='cerdo'. Por eso:
//   - el código CAP-XXX se numera acá por orden de ingreso (el capón N° que
//     entró), no sale de la base;
//   - lo que se hizo con él se resuelve por `despostes.entrada_id`.
//
// Estados posibles (verificado contra la base el 15/09/2026: de 207 capones
// históricos, 205 despostados y 2 anulados — NINGUNO se vendió entero, no hay
// una sola salida de tipo 'cerdo'):
//   en cámara · despostado · anulado
// Si algún día se vende un capón entero hay que sumar ese estado acá.
// ============================================================
import { useState, useEffect } from 'react'
import { supabase, fetchAllRows } from '../../lib/supabase'
import { fmtKg, fmtPrecio } from '../../lib/formatos'
import { fmtFechaARG } from '../../lib/fechas'
import Paginador, { usePaginacion } from '../../components/Paginador'

const n = v => Number(v) || 0
// El peso con el que se despostó es el real si se pesó al entrar; si no, el
// declarado. Mismo criterio que usa el desposte (caponSeleccionado en Deposito).
const kgDeCapon = c => n(c.kg_real) || n(c.kg)
// Lo que se pago por el animal entero. Si la entrada no trae importe se calcula
// con el precio por kilo (algunas viejas quedaron con importe 0).
const pagadoPorCapon = c => n(c.importe) || (kgDeCapon(c) * n(c.precio_kg))
// -- EL COSTO REAL DEL KILO -------------------------------------------
// No se paga por kilo de carne, se paga por kilo de ANIMAL: los kilos que no
// se venden (hueso, cuero, lo que no se pesa) hay que pagarlos igual, asi que
// su costo se reparte entre los que si se venden.
//     costo real = lo que pagaste / kilos vendibles
// `kg_neto` del desposte de capon YA es el vendible: excluye hueso, grasa,
// tocino y cuero (ver esMermaDeCerdo en lib/mermas.js).
// Es el numero CONSERVADOR: no descuenta lo que se recupera vendiendo el
// tocino (Fabricio, 15/09/2026: el tocino se recupera a ~$2.000/kg y el cuero
// y el hueso se tiran o se regalan).
function costoRealCapon(c, desposte) {
  const pagado = pagadoPorCapon(c)
  const vendible = n(desposte?.kg_neto)
  if (!(pagado > 0) || !(vendible > 0)) return null
  return pagado / vendible
}

const ESTADO = {
  camara:     { label: 'EN CÁMARA',  color: 'var(--green)', bg: 'rgba(60,180,75,0.12)' },
  despostado: { label: 'DESPOSTADO', color: 'var(--blue)',  bg: 'rgba(41,128,185,0.12)' },
  anulado:    { label: 'ANULADO',    color: 'var(--muted)', bg: 'rgba(127,127,127,0.10)' },
}
const estadoDe = c => c.eliminado ? 'anulado' : (c.despostada ? 'despostado' : 'camara')

export default function CaponesTab() {
  const [capones, setCapones] = useState([])
  const [despPorEntrada, setDespPorEntrada] = useState({})
  const [stockCerdo, setStockCerdo] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState('todos')
  const [busqueda, setBusqueda] = useState('')
  const [abierto, setAbierto] = useState(null)   // id del capón con el detalle desplegado

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setCargando(true)
    // fetchAllRows aunque hoy sean ~200 filas: en un año son más de mil y el
    // corte de Supabase subdeclararía el histórico en silencio (regla de oro).
    // fetchAllRows recibe una FUNCION que arma la query (la llama por pagina)
    // y devuelve { data, error }, no el array pelado.
    const [entradas, desps, st] = await Promise.all([
      fetchAllRows(() => supabase.from('entradas_deposito').select('*').eq('tipo', 'cerdo')
        .order('fecha', { ascending: false }).order('created_at', { ascending: false })),
      fetchAllRows(() => supabase.from('despostes').select('*').eq('tipo_desposte', 'cerdo')),
      supabase.from('stock_actual').select('kg_disponible').eq('tipo', 'cerdo').maybeSingle(),
    ])
    if (entradas.error) console.warn('Error cargando capones:', entradas.error.message)
    if (desps.error) console.warn('Error cargando despostes de cerdo:', desps.error.message)
    const filas = entradas.data || []
    const mapa = {}
    for (const d of (desps.data || [])) { if (d.entrada_id) mapa[d.entrada_id] = d }
    // El código CAP-XXX se asigna por orden de INGRESO (el más viejo es el 1),
    // así que se numera sobre la lista ascendente y no cambia al filtrar.
    const nro = {}
    ;[...filas].reverse().forEach((c, i) => { nro[c.id] = i + 1 })
    setCapones(filas.map(c => ({ ...c, codigo: 'CAP-' + String(nro[c.id]).padStart(3, '0') })))
    setDespPorEntrada(mapa)
    // Sin fila en stock_actual el bucket es 0; solo un ERROR deja el chequeo en
    // '—' (no se puede afirmar que cuadra si no se pudo leer).
    setStockCerdo(st.error ? null : n(st.data?.kg_disponible))
    setCargando(false)
  }

  // ── Lo que hay AHORA en la cámara ──
  const enCamara = capones.filter(c => estadoDe(c) === 'camara')
  const kgEnCamara = enCamara.reduce((s, c) => s + kgDeCapon(c), 0)
  const despostados = capones.filter(c => estadoDe(c) === 'despostado')

  // Mismo invariante que en Media Reses: el bucket 'cerdo' tiene que ser la
  // suma de los capones que todavía no se despostaron.
  const descuadre = stockCerdo == null ? 0 : stockCerdo - kgEnCamara
  const hayDescuadre = Math.abs(descuadre) > 0.01

  const kgEntrados = despostados.reduce((s, c) => s + kgDeCapon(c), 0)

  // ⚠️ El rinde se calcula SOLO sobre los últimos 20 despostes, a propósito.
  // Hasta julio/2026 la merma del capón se cargaba en CERO (las piezas sumaban
  // el peso entero del animal: rinde 99%) y desde septiembre se carga de verdad
  // (rinde ~74%). Un promedio de todo el histórico mezcla las dos prácticas y
  // no describe ninguna — la misma trampa de no promediar entre categorías.
  // Los últimos 20 siempre reflejan cómo se está trabajando hoy.
  const RINDE_ULTIMOS = 20
  const ultimosDesp = despostados
    .filter(c => despPorEntrada[c.id])
    .sort((a, b) => String(despPorEntrada[b.id].fecha).localeCompare(String(despPorEntrada[a.id].fecha)))
    .slice(0, RINDE_ULTIMOS)
  // Ponderado por kilo, no promedio de porcentajes: un capón de 120 kg no
  // puede pesar lo mismo que uno de 80 en la cuenta.
  const kgEntradosR = ultimosDesp.reduce((s, c) => s + kgDeCapon(c), 0)
  const kgSalidosR = ultimosDesp.reduce((s, c) => s + n(despPorEntrada[c.id]?.kg_neto), 0)
  const rinde = kgEntradosR > 0 ? (kgSalidosR / kgEntradosR) * 100 : null
  // Costo del kilo de esos mismos despostes: plata total / kilos vendibles
  // totales. Ponderado, no promedio de costos.
  const pagadoR = ultimosDesp.reduce((s, c) => s + pagadoPorCapon(c), 0)
  const costoR = (kgSalidosR > 0 && pagadoR > 0) ? pagadoR / kgSalidosR : null
  const precioR = (kgEntradosR > 0 && pagadoR > 0) ? pagadoR / kgEntradosR : null

  const filtrados = capones.filter(c => {
    if (filtro !== 'todos' && estadoDe(c) !== filtro) return false
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase()
      const blob = [c.codigo, c.descripcion, c.proveedor_nombre, c.fecha].filter(Boolean).join(' ').toLowerCase()
      if (!blob.includes(q)) return false
    }
    return true
  })
  const pag = usePaginacion(filtrados, 20)

  const card = { background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px', border: '1px solid var(--border)' }
  const mono = { fontFamily: "'IBM Plex Mono',monospace", fontVariantNumeric: 'tabular-nums' }
  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid var(--border)' }
  const td = { padding: '8px 10px', fontSize: 13, borderBottom: '1px solid var(--border)' }

  if (cargando) return <div className="empty">Cargando capones...</div>

  return (
    <div>
      {/* ── LO QUE HAY AHORA ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div style={{ ...card, borderColor: enCamara.length > 0 ? 'var(--green)' : 'var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Capones en la cámara</div>
          <div style={{ ...mono, fontSize: 25, color: enCamara.length > 0 ? 'var(--green)' : 'var(--muted)' }}>{enCamara.length}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{fmtKg(kgEnCamara, { decimales: 2 })} enteros</div>
        </div>

        <div style={{ ...card, borderColor: hayDescuadre ? 'var(--red-light)' : 'var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Stock del sistema (cerdo)</div>
          <div style={{ ...mono, fontSize: 25, color: hayDescuadre ? 'var(--red-light)' : 'var(--green)' }}>
            {stockCerdo == null ? '—' : fmtKg(stockCerdo, { decimales: 2 })}
          </div>
          <div style={{ fontSize: 11, color: hayDescuadre ? 'var(--red-light)' : 'var(--green)', marginTop: 2 }}>
            {hayDescuadre
              ? `⚠️ No coincide: ${descuadre > 0 ? 'sobran' : 'faltan'} ${fmtKg(Math.abs(descuadre), { decimales: 2 })}`
              : '✅ Coincide con los capones sin despostar'}
          </div>
        </div>

        <div style={{ ...card }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Despostados</div>
          <div style={{ ...mono, fontSize: 25, color: 'var(--blue)' }}>{despostados.length}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{fmtKg(kgEntrados, { decimales: 1 })} procesados</div>
        </div>

        <div style={{ ...card }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
            Rinde {ultimosDesp.length > 0 ? `(últimos ${ultimosDesp.length})` : ''}
          </div>
          <div style={{ ...mono, fontSize: 25, color: 'var(--gold)' }}>{rinde == null ? '—' : rinde.toFixed(1) + '%'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {rinde == null ? 'sin despostes' : `${fmtKg(kgSalidosR, { decimales: 1 })} vendibles · merma ${(100 - rinde).toFixed(1)}%`}
          </div>
        </div>

        <div style={{ ...card, borderColor: costoR ? 'var(--amber)' : 'var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Te queda a (el kilo)</div>
          <div style={{ ...mono, fontSize: 25, color: 'var(--amber)' }}>{costoR == null ? '—' : fmtPrecio(costoR)}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {costoR == null ? 'sin datos de compra'
              : <>lo pagás {fmtPrecio(precioR)} · <strong style={{ color: 'var(--amber)' }}>+{((costoR / precioR - 1) * 100).toFixed(1)}%</strong></>}
          </div>
        </div>
      </div>

      {/* ── FILTROS ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { id: 'todos', label: `Todos (${capones.length})` },
            { id: 'camara', label: `🟢 En cámara (${enCamara.length})` },
            { id: 'despostado', label: `🔪 Despostados (${despostados.length})` },
            { id: 'anulado', label: `Anulados (${capones.filter(c => estadoDe(c) === 'anulado').length})` },
          ].map(f => (
            <button key={f.id} onClick={() => setFiltro(f.id)}
              style={{ padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                fontFamily: "'DM Sans',sans-serif",
                border: `1px solid ${filtro === f.id ? 'var(--gold)' : 'var(--border)'}`,
                background: filtro === f.id ? 'var(--gold)' : 'transparent',
                color: filtro === f.id ? '#000' : 'var(--muted)' }}>{f.label}</button>
          ))}
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por código, proveedor, fecha..."
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px',
              color: 'var(--text)', fontSize: 12, flex: 1, minWidth: 180, boxSizing: 'border-box' }} />
        </div>
      </div>

      {/* ── CADA CAPÓN Y QUÉ SE HIZO CON ÉL ── */}
      <div className="card">
        <div className="card-title">🐖 {filtrados.length} {filtrados.length === 1 ? 'capón' : 'capones'}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.6 }}>
          <strong>Te queda a</strong> = lo que pagaste dividido los kilos vendibles. El hueso, el
          cuero y lo que no se pesa se pagan igual, asi que su costo se reparte entre los kilos que
          si vendes. Es el numero conservador: <strong>no</strong> descuenta lo que recuperas
          vendiendo el tocino.
        </div>
        {filtrados.length === 0 ? <div className="empty">Sin capones con este filtro</div> : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={th}>Capón</th>
                    <th style={th}>Entró</th>
                    <th style={th}>Peso</th>
                    <th style={th}>Proveedor</th>
                    <th style={th}>Lo pagaste</th>
                    <th style={th}>Te queda a</th>
                    <th style={th}>Estado</th>
                    <th style={th}>Qué se hizo</th>
                  </tr>
                </thead>
                <tbody>
                  {pag.items.map(c => {
                    const est = estadoDe(c)
                    const info = ESTADO[est]
                    const d = despPorEntrada[c.id]
                    const kg = kgDeCapon(c)
                    const neto = n(d?.kg_neto)
                    const rindeC = (d && kg > 0) ? (neto / kg) * 100 : null
                    const piezas = Array.isArray(d?.piezas) ? d.piezas : []
                    const abiertoEste = abierto === c.id
                    return (
                      <tr key={c.id} style={{ opacity: est === 'anulado' ? 0.55 : 1 }}>
                        <td style={{ ...td, ...mono, fontWeight: 700, color: 'var(--gold)', whiteSpace: 'nowrap' }}>{c.codigo}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtFechaARG(c.fecha)}</td>
                        <td style={{ ...td, ...mono, whiteSpace: 'nowrap' }}>{fmtKg(kg, { decimales: 1 })}</td>
                        <td style={{ ...td, fontSize: 12 }}>{c.proveedor_nombre || '—'}</td>
                        <td style={{ ...td, ...mono, fontSize: 12, whiteSpace: 'nowrap' }}>
                          {pagadoPorCapon(c) > 0 ? fmtPrecio(pagadoPorCapon(c)) : '—'}
                          {n(c.precio_kg) > 0 && <div style={{ color: 'var(--muted)', fontSize: 11 }}>{fmtPrecio(c.precio_kg)}/kg</div>}
                        </td>
                        <td style={{ ...td, ...mono, fontSize: 13, whiteSpace: 'nowrap', fontWeight: 700,
                          color: costoRealCapon(c, d) ? 'var(--amber)' : 'var(--muted)' }}>
                          {(() => {
                            const cr = costoRealCapon(c, d)
                            if (cr == null) return '—'
                            const pk = n(c.precio_kg)
                            return (<>
                              {fmtPrecio(cr)}
                              {pk > 0 && <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 400 }}>+{((cr / pk - 1) * 100).toFixed(0)}%</div>}
                            </>)
                          })()}
                        </td>
                        <td style={td}>
                          <span style={{ background: info.bg, color: info.color, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {info.label}
                          </span>
                        </td>
                        <td style={{ ...td, fontSize: 12 }}>
                          {est === 'camara' && <span style={{ color: 'var(--muted)' }}>Entero, sin despostar</span>}
                          {est === 'anulado' && <span style={{ color: 'var(--muted)' }}>Ingreso anulado</span>}
                          {est === 'despostado' && (d ? (
                            <>
                              <div>
                                🔪 Despostado el <strong>{fmtFechaARG(d.fecha)}</strong> — salieron{' '}
                                <span style={{ ...mono, color: 'var(--gold)' }}>{fmtKg(neto, { decimales: 1 })}</span>
                                {rindeC != null && <span style={{ color: 'var(--muted)' }}> · rinde {rindeC.toFixed(1)}% · merma {(100 - rindeC).toFixed(1)}%</span>}
                              </div>
                              {piezas.length > 0 && (
                                <button onClick={() => setAbierto(abiertoEste ? null : c.id)}
                                  style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer',
                                    fontSize: 11, padding: '2px 0', fontFamily: "'DM Sans',sans-serif" }}>
                                  {abiertoEste ? '▾ ocultar las piezas' : `▸ ver las ${piezas.length} piezas que salieron`}
                                </button>
                              )}
                              {abiertoEste && (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                                  {piezas.map((p, i) => (
                                    <span key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)',
                                      borderRadius: 6, padding: '2px 8px', fontSize: 11, color: 'var(--text2)' }}>
                                      {p?.nombre}: {fmtKg(n(p?.kg), { decimales: 2 })}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </>
                          ) : (
                            // despostada=true sin fila en despostes: pasa con los
                            // despostes borrados. Mejor decirlo que mostrar vacío.
                            <span style={{ color: 'var(--amber)' }}>⚠️ Marcado como despostado, sin desposte registrado</span>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Paginador {...pag} />
          </>
        )}
      </div>
    </div>
  )
}
