// ============================================================
// SUCURSALES — las bocas del grupo, una al lado de la otra
// ============================================================
// Vive en Dirección → Ejecutivo → Sucursales. Contesta dos cosas
// distintas que no hay que mezclar:
//
// 1) Qué vende cada boca POR SU CUENTA (mostrador + mayoristas propios).
//    De la casa central se EXCLUYE lo que le vende a las franquicias: eso
//    no es venta a la calle, es mercadería que sale para adentro del grupo
//    y volvería a contarse cuando la boca la revende.
//
// 2) Qué le compran las franquicias a la central, en kilos y en plata, del
//    mes y acumulado de siempre. Acá SÍ está Alvear: todavía no tiene el
//    sistema instalado, pero los remitos que le mandamos son nuestros.
//
// TODO EL CÁLCULO ESTÁ EN LA BASE (rpc `ejecutivo_sucursales`, migración
// 147). No es un detalle de performance: la primera versión leía las
// ventas de las otras bocas desde acá, y para eso hubo que aflojar la
// policy `sucursal_aislamiento`. Como 30+ consultas del sistema confían en
// que esa policy filtra por ellas, el Cierre de la central pasó a sumar la
// caja de Monte Cristo sin avisar. La RPC devuelve solo TOTALES y las
// policies quedan intactas.
//
// Los criterios (mes operativo propio de cada boca, solo carne, sin los
// remitos a franquicias) viven en la RPC, que es donde están los datos.
// ============================================================
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmtPrecio, fmtKg } from '../lib/formatos'

const NEON = {
  oro: '#ffd17a', verde: '#51ffb0', rojo: '#ff5c6c', cian: '#00d4ff',
  cianHi: '#9beaff', azul: '#5fa8ff', ambar: '#ffb35c',
  texto: '#d9f3ff', muted: 'rgba(155,214,255,0.45)',
}

const num = v => Number(v) || 0
const fmt$ = v => fmtPrecio(num(v))
const fechaCorta = f => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '')

function Kpi({ label, valor, sub, color = NEON.cianHi }) {
  return (
    <div style={{ background: 'rgba(0,212,255,0.03)', border: '1px solid rgba(0,212,255,0.15)', borderRadius: 12, padding: '12px 16px' }}>
      <div style={{ fontSize: 10, color: NEON.muted, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontVariantNumeric: 'tabular-nums', fontSize: 24, color, lineHeight: 1.3 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: NEON.muted }}>{sub}</div>}
    </div>
  )
}

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 10, color: NEON.muted, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, whiteSpace: 'nowrap' }
const thN = { ...th, textAlign: 'right' }
const td = { padding: '10px', fontSize: 13, borderTop: '1px solid rgba(0,212,255,0.08)' }
const tdN = { ...td, textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

export default function SucursalesEjecutivo() {
  const [mesKey, setMesKey] = useState(null)   // null = que la RPC elija el vigente
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setCargando(true); setError(null)
      const { data, error: err } = await supabase.rpc('ejecutivo_sucursales', { p_mes: mesKey })
      if (!vivo) return
      if (err) { setError(err.message || 'No se pudo cargar'); setDatos(null) }
      else setDatos(data)
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [mesKey])

  const meses = datos?.meses || []
  // Las bocas que todavía no cargan ventas se nombran abajo con el motivo,
  // en vez de ocupar una fila llena de ceros que se lee como un error.
  const bocas = (datos?.bocas || []).filter(b => num(b.mostrador) + num(b.mayorista) > 0 || num(b.tickets) > 0)
  const sinDatos = (datos?.bocas || []).filter(b => !bocas.includes(b))
  const franquicias = datos?.franquicias || []

  const totalGrupo = bocas.reduce((s, b) => s + num(b.mostrador) + num(b.mayorista), 0)
  const totalTickets = bocas.reduce((s, b) => s + num(b.tickets), 0)
  const lider = bocas[0]
  const totF = franquicias.reduce((a, f) => ({
    remitos: a.remitos + num(f.remitos), kilos: a.kilos + num(f.kilos), plata: a.plata + num(f.plata),
    histKilos: a.histKilos + num(f.hist_kilos), histPlata: a.histPlata + num(f.hist_plata),
  }), { remitos: 0, kilos: 0, plata: 0, histKilos: 0, histPlata: 0 })

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={{ fontSize: 11, color: NEON.muted, textTransform: 'uppercase', letterSpacing: 1 }}>Mes operativo</span>
        <select value={datos?.mes || ''} onChange={e => setMesKey(e.target.value)}
          style={{ background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.3)', color: NEON.texto, borderRadius: 8, padding: '7px 12px', fontSize: 13, fontFamily: "'DM Sans',sans-serif", width: 'auto' }}>
          {meses.map(m => <option key={m.mes} value={m.mes} style={{ background: '#06121c' }}>{m.etiqueta}</option>)}
        </select>
        <span style={{ fontSize: 11, color: NEON.muted }}>cada boca con las fechas de SU mes operativo</span>
      </div>

      {error && (
        <div style={{ background: 'rgba(255,92,108,0.08)', border: '1px solid rgba(255,92,108,0.4)', color: NEON.rojo, borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
          ⚠️ {error}
        </div>
      )}

      {cargando ? (
        <p style={{ color: NEON.muted }}>Cargando sucursales…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 20 }}>
            <Kpi label="Venta del grupo" valor={fmt$(totalGrupo)} sub={`${bocas.length} boca${bocas.length === 1 ? '' : 's'} con sistema`} color={NEON.oro} />
            <Kpi label="Tickets" valor={totalTickets.toLocaleString('es-AR')} sub="mostrador" />
            <Kpi label="A las franquicias" valor={fmt$(totF.plata)} sub={`${fmtKg(totF.kilos)} despachados`} color={NEON.ambar} />
            {lider && <Kpi label="La que más vende" valor={lider.nombre} sub={fmt$(num(lider.mostrador) + num(lider.mayorista))} color={NEON.verde} />}
          </div>

          {/* ── Comparativa de bocas ─────────────────────────────────── */}
          <div style={{ background: 'rgba(0,212,255,0.02)', border: '1px solid rgba(0,212,255,0.15)', borderRadius: 12, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: NEON.cian, letterSpacing: 1, marginBottom: 4 }}>🏪 LO QUE VENDE CADA BOCA</div>
            <div style={{ fontSize: 11, color: NEON.muted, marginBottom: 12 }}>
              Solo CARNE: el almacén y las bebidas no suman ni en plata ni en kilos. Venta propia = mostrador + sus mayoristas, y la casa central va <b>sin</b> lo que le vende a las franquicias — eso no es venta a la calle y se mira en el cuadro de abajo.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={th}>Boca</th>
                    <th style={thN}>Mostrador</th>
                    <th style={thN}>Tickets</th>
                    <th style={thN}>Ticket prom.</th>
                    <th style={thN}>Mayorista</th>
                    <th style={thN}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {bocas.map(b => {
                    const total = num(b.mostrador) + num(b.mayorista)
                    return (
                      <tr key={b.sucursal_id}>
                        <td style={td}>
                          <div style={{ fontWeight: 700, color: NEON.texto }}>{b.nombre}</div>
                          <div style={{ fontSize: 10, color: NEON.muted }}>{b.tipo === 'central' ? 'Casa central' : 'Franquicia'} · {b.direccion}</div>
                          <div style={{ fontSize: 10, color: b.propio ? NEON.muted : NEON.ambar, marginTop: 2 }}>
                            📅 {fechaCorta(b.desde)} → {fechaCorta(b.hasta)}
                            {!b.propio && ' · todavía no abrió este mes, va con fechas prestadas'}
                          </div>
                        </td>
                        <td style={{ ...tdN, color: NEON.cianHi }}>{fmt$(b.mostrador)}</td>
                        <td style={{ ...tdN, color: NEON.muted }}>{num(b.tickets).toLocaleString('es-AR')}</td>
                        <td style={{ ...tdN, color: NEON.muted }}>{num(b.tickets) > 0 ? fmt$(num(b.mostrador) / num(b.tickets)) : '—'}</td>
                        <td style={{ ...tdN, color: NEON.azul }}>{num(b.mayorista) > 0 ? fmt$(b.mayorista) : '—'}</td>
                        <td style={{ ...tdN, color: NEON.oro, fontWeight: 700 }}>{fmt$(total)}</td>
                      </tr>
                    )
                  })}
                  {bocas.length === 0 && (
                    <tr><td style={{ ...td, color: NEON.muted, fontStyle: 'italic' }} colSpan={6}>Sin ventas registradas en este mes operativo.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {sinDatos.length > 0 && (
              <div style={{ fontSize: 11, color: NEON.muted, marginTop: 10, borderTop: '1px solid rgba(0,212,255,0.08)', paddingTop: 10 }}>
                Sin ventas propias en el sistema: <b style={{ color: NEON.ambar }}>{sinDatos.map(s => s.nombre).join(', ')}</b>.
                {' '}Falta instalarle el equipamiento — lo que compra sí está abajo.
              </div>
            )}
          </div>

          {/* ── Compras de las franquicias a la central ───────────────── */}
          <div style={{ background: 'rgba(255,179,92,0.03)', border: '1px solid rgba(255,179,92,0.25)', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: NEON.ambar, letterSpacing: 1, marginBottom: 4 }}>🚚 LO QUE LAS FRANQUICIAS LE COMPRAN A LA CENTRAL</div>
            <div style={{ fontSize: 11, color: NEON.muted, marginBottom: 12 }}>
              Los remitos de CARNE que salen de la central para las bocas. Están todas, tengan el sistema instalado o no. Van con el mes operativo de la central, que es la que los emite.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
                <thead>
                  <tr>
                    <th style={th}>Franquicia</th>
                    <th style={thN}>Remitos</th>
                    <th style={thN}>Kilos</th>
                    <th style={thN}>Plata</th>
                    <th style={thN}>$/kg</th>
                    <th style={{ ...thN, color: NEON.ambar, borderLeft: '1px solid rgba(255,179,92,0.25)' }}>Kilos de siempre</th>
                    <th style={{ ...thN, color: NEON.ambar }}>Plata de siempre</th>
                  </tr>
                </thead>
                <tbody>
                  {franquicias.map(f => (
                    <tr key={f.id}>
                      <td style={{ ...td, fontWeight: 700, color: NEON.texto }}>{f.nombre}</td>
                      <td style={{ ...tdN, color: NEON.muted }}>{num(f.remitos)}</td>
                      <td style={{ ...tdN, color: NEON.cianHi }}>{fmtKg(f.kilos)}</td>
                      <td style={{ ...tdN, color: NEON.oro, fontWeight: 700 }}>{fmt$(f.plata)}</td>
                      <td style={{ ...tdN, color: NEON.muted }}>{num(f.kilos) > 0 ? fmt$(num(f.plata) / num(f.kilos)) : '—'}</td>
                      <td style={{ ...tdN, color: NEON.cianHi, borderLeft: '1px solid rgba(255,179,92,0.25)' }}>{fmtKg(f.hist_kilos)}</td>
                      <td style={{ ...tdN, color: NEON.ambar, fontWeight: 700 }}>{fmt$(f.hist_plata)}</td>
                    </tr>
                  ))}
                  {franquicias.length === 0 && (
                    <tr><td style={{ ...td, color: NEON.muted, fontStyle: 'italic' }} colSpan={7}>Ningún remito a franquicias en este mes operativo.</td></tr>
                  )}
                  {franquicias.length > 1 && (
                    <tr>
                      <td style={{ ...td, fontWeight: 700, color: NEON.muted, textTransform: 'uppercase', fontSize: 11 }}>Total</td>
                      <td style={{ ...tdN, color: NEON.muted }}>{totF.remitos}</td>
                      <td style={{ ...tdN, color: NEON.cianHi, fontWeight: 700 }}>{fmtKg(totF.kilos)}</td>
                      <td style={{ ...tdN, color: NEON.oro, fontWeight: 700 }}>{fmt$(totF.plata)}</td>
                      <td style={{ ...tdN, color: NEON.muted }}>{totF.kilos > 0 ? fmt$(totF.plata / totF.kilos) : '—'}</td>
                      <td style={{ ...tdN, color: NEON.cianHi, fontWeight: 700, borderLeft: '1px solid rgba(255,179,92,0.25)' }}>{fmtKg(totF.histKilos)}</td>
                      <td style={{ ...tdN, color: NEON.ambar, fontWeight: 700 }}>{fmt$(totF.histPlata)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
