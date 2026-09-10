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
// 2) Qué le compran las franquicias a la central, en kilos y en plata.
//    Acá SÍ está Alvear: todavía no tiene el sistema instalado (no hay
//    ventas suyas), pero los remitos que le mandamos son nuestros y los
//    tenemos completos.
//
// El período es el MES OPERATIVO de la central (meses_operativos), que es
// el mismo con el que se mira el resto del sistema. Ojo: cada sucursal
// tiene sus propios meses y no coinciden (la central abre el 31/08 y Monte
// Cristo el 01/09); acá manda el de la central para que las columnas sean
// comparables entre sí.
// ============================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { fmtPrecio, fmtKg } from '../lib/formatos'

const NEON = {
  oro: '#ffd17a', verde: '#51ffb0', rojo: '#ff5c6c', cian: '#00d4ff',
  cianHi: '#9beaff', azul: '#5fa8ff', ambar: '#ffb35c',
  texto: '#d9f3ff', muted: 'rgba(155,214,255,0.45)',
}

const SUCURSAL_CENTRAL = 1

const num = v => Number(v) || 0
const fmt$ = v => fmtPrecio(num(v))

// Somos carniceria: acá solo entra la CARNE. El almacén y las bebidas
// quedan afuera de la plata y de los kilos.
//
// En los kilos no es un detalle de gusto, es que el número sale mal: en
// almacén y bebidas el campo kg guarda UNIDADES, así que una gaseosa suma
// "1 kg" y ensucia el $/kg de toda la boca.
//
// Las ventas del mostrador marcan el rubro en `categoria` y los remitos en
// `tipo`, por eso se miran los dos.
const NO_CARNE = new Set(['almacen', 'bebidas', 'insumo', 'insumos'])
const esCarne = i => !NO_CARNE.has(String(i.categoria || i.tipo || '').toLowerCase())

// Los cajones vienen en unidades y hay que abrirlos por su kg_por_unidad
// (un cajón de pechuga son 20 kg, no 1).
const kgDeItem = i => {
  const kg = num(i.kg)
  return String(i.unidad) === 'u' && num(i.kg_por_unidad) > 0
    ? kg * num(i.kg_por_unidad)
    : kg
}
const itemsCarne = items => (Array.isArray(items) ? items : []).filter(esCarne)
const kgDeItems = items => itemsCarne(items).reduce((s, i) => s + kgDeItem(i), 0)
// La plata sale de sumar los items de carne, NO del total del comprobante:
// el total incluiría el almacén. Diferencia conocida: un descuento de
// convenio (Blangino) vive en el total y no en el item, así que por ese
// lado esto queda apenas por encima — es menos del 0,3%.
const platoDeItems = items => itemsCarne(items).reduce((s, i) => s + num(i.importe), 0)

// ── Caja de número ──────────────────────────────────────────────────────
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
  const [meses, setMeses] = useState([])
  const [mesKey, setMesKey] = useState('')
  const [sucursales, setSucursales] = useState([])
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)

  // Los meses operativos de TODAS las bocas. Cada una abre y cierra el suyo
  // cuando quiere (la central arranca septiembre el 31/08 y Monte Cristo el
  // 01/09), asi que cada boca se mide con SU mes: es el numero que el
  // encargado ve en su propio sistema.
  useEffect(() => {
    (async () => {
      const [{ data: ms }, { data: sc }] = await Promise.all([
        supabase.from('meses_operativos').select('id, sucursal_id, etiqueta, mes, fecha_inicio, fecha_cierre')
          .order('fecha_inicio', { ascending: false }),
        supabase.from('sucursales').select('id, nombre, direccion, tipo').order('id'),
      ])
      setMeses(ms || [])
      setSucursales(sc || [])
      const claves = [...new Set((ms || []).map(m => m.mes))].sort().reverse()
      if (claves.length) setMesKey(claves[0])
    })()
  }, [])

  // El selector lista la UNION de los meses: hay meses que solo tiene una
  // boca (octubre lo abrio Monte Cristo y la central todavia no).
  const opcionesMes = useMemo(() => {
    const porClave = new Map()
    meses.forEach(m => {
      const prev = porClave.get(m.mes)
      // La etiqueta que se muestra es la de la central si la hay: es la que
      // Fabricio reconoce ("Septiembre 2026" y no "septiembre").
      if (!prev || m.sucursal_id === SUCURSAL_CENTRAL) porClave.set(m.mes, m)
    })
    return [...porClave.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([mes, fila]) => ({ mes, etiqueta: fila.etiqueta }))
  }, [meses])

  // El mes de UNA boca. Si esa boca todavia no abrio ese mes, se usa el de
  // la central como referencia y la fila lo avisa.
  const rangoDe = useMemo(() => {
    const idx = new Map()
    meses.forEach(m => idx.set(`${m.sucursal_id}|${m.mes}`, m))
    return sucursalId => {
      const propio = idx.get(`${sucursalId}|${mesKey}`)
      if (propio) return { desde: propio.fecha_inicio, hasta: propio.fecha_cierre, propio: true, etiqueta: propio.etiqueta }
      const central = idx.get(`${SUCURSAL_CENTRAL}|${mesKey}`)
      return central
        ? { desde: central.fecha_inicio, hasta: central.fecha_cierre, propio: false, etiqueta: central.etiqueta }
        : null
    }
  }, [meses, mesKey])

  useEffect(() => {
    if (!mesKey || !sucursales.length) return
    let vivo = true
    ;(async () => {
      setCargando(true)
      // Cada boca tiene su propio mes, asi que se traen los dias que cubren
      // a TODAS (la union) y despues cada venta se cuenta solo si cae dentro
      // del mes de SU boca.
      const rangos = new Map(sucursales.map(x => [x.id, rangoDe(x.id)]).filter(([, r]) => r))
      const todos = [...rangos.values()]
      if (!todos.length) { setDatos({ bocas: [], franquicias: [] }); setCargando(false); return }
      const desde = todos.map(r => r.desde).sort()[0]
      const hasta = todos.map(r => r.hasta).sort().slice(-1)[0]
      const enSuMes = (sucursalId, fecha) => {
        const r = rangos.get(sucursalId)
        return !!r && fecha >= r.desde && fecha <= r.hasta
      }
      // Paginado: un mes de mostrador pasa las 1000 filas sin despeinarse y
      // Supabase corta ahí en silencio.
      const [ventasR, remitosR, clientesR, histR] = await Promise.all([
        fetchAllRows(() => supabase.from('ventas_minoristas')
          .select('id, fecha, total, items, sucursal_id')
          .gte('fecha', desde).lte('fecha', hasta)),
        fetchAllRows(() => supabase.from('remitos')
          .select('id, fecha, total, items, cliente_id, sucursal_id, eliminado, es_cobranza_terceros')
          .gte('fecha', desde).lte('fecha', hasta)),
        supabase.from('clientes').select('id, nombre, es_franquicia'),
        // El acumulado de siempre: "cuántos kilos LLEVA comprado". Sin filtro
        // de fecha, paginado, y sin los items (solo hacen falta los kilos, que
        // igual hay que abrir del JSON) — es la consulta más pesada de acá.
        fetchAllRows(() => supabase.from('remitos')
          .select('id, total, items, cliente_id, eliminado, es_cobranza_terceros')),
      ])
      if (!vivo) return

      const clientes = clientesR.data || []
      const esFranquicia = new Map(clientes.map(c => [c.id, !!c.es_franquicia]))
      const nombreCli = new Map(clientes.map(c => [c.id, c.nombre]))

      const ventas = (ventasR.data || [])
      const remitos = (remitosR.data || []).filter(r => !r.eliminado && !r.es_cobranza_terceros)

      // ── Por boca ──────────────────────────────────────────────────────
      const porBoca = new Map()
      const boca = id => {
        if (!porBoca.has(id)) porBoca.set(id, { sucursal_id: id, mostrador: 0, kgMostrador: 0, tickets: 0, mayorista: 0, kgMayorista: 0, remitos: 0 })
        return porBoca.get(id)
      }
      ventas.forEach(v => {
        if (!enSuMes(v.sucursal_id, v.fecha)) return
        const b = boca(v.sucursal_id)
        b.mostrador += platoDeItems(v.items)
        b.kgMostrador += kgDeItems(v.items)
        b.tickets++
      })
      remitos.forEach(r => {
        // La venta a una franquicia NO es venta de la boca: es mercadería
        // que sale para adentro del grupo. Va en el cuadro de abajo.
        if (esFranquicia.get(r.cliente_id)) return
        if (!enSuMes(r.sucursal_id, r.fecha)) return
        const b = boca(r.sucursal_id)
        b.mayorista += platoDeItems(r.items)
        b.kgMayorista += kgDeItems(r.items)
        b.remitos++
      })

      // ── Lo que las franquicias le compran a la central ────────────────
      const porFranquicia = new Map()
      remitos.forEach(r => {
        if (!esFranquicia.get(r.cliente_id)) return
        // Estos remitos los emite la CENTRAL, asi que se miden con el mes de
        // la central aunque la franquicia tenga el suyo.
        if (!enSuMes(SUCURSAL_CENTRAL, r.fecha)) return
        const k = r.cliente_id
        if (!porFranquicia.has(k)) porFranquicia.set(k, { id: k, nombre: nombreCli.get(k) || 'Franquicia', remitos: 0, kilos: 0, plata: 0 })
        const f = porFranquicia.get(k)
        f.remitos++
        f.kilos += kgDeItems(r.items)
        f.plata += platoDeItems(r.items)
      })

      // Acumulado historico por franquicia (toda la relacion, no el mes)
      const hist = new Map()
      ;(histR.data || []).forEach(r => {
        if (r.eliminado || r.es_cobranza_terceros) return
        if (!esFranquicia.get(r.cliente_id)) return
        const h = hist.get(r.cliente_id) || { kilos: 0, plata: 0, remitos: 0 }
        h.kilos += kgDeItems(r.items)
        h.plata += platoDeItems(r.items)
        h.remitos++
        hist.set(r.cliente_id, h)
      })
      hist.forEach((h, k) => {
        if (!porFranquicia.has(k)) porFranquicia.set(k, { id: k, nombre: nombreCli.get(k) || 'Franquicia', remitos: 0, kilos: 0, plata: 0 })
      })
      porFranquicia.forEach((f, k) => {
        const h = hist.get(k) || { kilos: 0, plata: 0, remitos: 0 }
        f.histKilos = h.kilos; f.histPlata = h.plata; f.histRemitos = h.remitos
      })

      setDatos({
        bocas: [...porBoca.values()],
        franquicias: [...porFranquicia.values()].sort((a, b) => (b.plata - a.plata) || (num(b.histPlata) - num(a.histPlata))),
      })
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [mesKey, sucursales, rangoDe])

  const bocas = useMemo(() => {
    if (!datos) return []
    return sucursales
      .map(s => {
        const d = datos.bocas.find(b => b.sucursal_id === s.id) || { mostrador: 0, kgMostrador: 0, tickets: 0, mayorista: 0, kgMayorista: 0, remitos: 0 }
        return { ...s, ...d, total: d.mostrador + d.mayorista, rango: rangoDe(s.id) }
      })
      // Una boca sin una sola venta no ocupa una fila con ceros: se nombra
      // abajo, con el motivo. Hoy es Alvear, que no tiene el sistema.
      .filter(b => b.total > 0 || b.tickets > 0)
      .sort((a, b) => b.total - a.total)
  }, [datos, sucursales, rangoDe])

  const sinDatos = useMemo(() => {
    if (!datos) return []
    return sucursales.filter(s => !bocas.some(b => b.id === s.id))
  }, [datos, sucursales, bocas])

  const totalGrupo = bocas.reduce((s, b) => s + b.total, 0)
  const totalTickets = bocas.reduce((s, b) => s + b.tickets, 0)
  const lider = bocas[0]
  const totFranq = (datos?.franquicias || []).reduce((a, f) => ({
    remitos: a.remitos + f.remitos, kilos: a.kilos + f.kilos, plata: a.plata + f.plata,
    histKilos: a.histKilos + num(f.histKilos), histPlata: a.histPlata + num(f.histPlata),
  }), { remitos: 0, kilos: 0, plata: 0, histKilos: 0, histPlata: 0 })

  const fechaCorta = f => f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : ''

  return (
    <div>
      {/* Selector de mes operativo */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={{ fontSize: 11, color: NEON.muted, textTransform: 'uppercase', letterSpacing: 1 }}>Mes operativo</span>
        <select value={mesKey} onChange={e => setMesKey(e.target.value)}
          style={{ background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.3)', color: NEON.texto, borderRadius: 8, padding: '7px 12px', fontSize: 13, fontFamily: "'DM Sans',sans-serif", width: 'auto' }}>
          {opcionesMes.map(o => <option key={o.mes} value={o.mes} style={{ background: '#06121c' }}>{o.etiqueta}</option>)}
        </select>
        <span style={{ fontSize: 11, color: NEON.muted }}>
          cada boca con las fechas de SU mes operativo
        </span>
      </div>

      {cargando ? (
        <p style={{ color: NEON.muted }}>Cargando sucursales…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 20 }}>
            <Kpi label="Venta del grupo" valor={fmt$(totalGrupo)} sub={`${bocas.length} boca${bocas.length === 1 ? '' : 's'} con sistema`} color={NEON.oro} />
            <Kpi label="Tickets" valor={totalTickets.toLocaleString('es-AR')} sub="mostrador" />
            <Kpi label="A las franquicias" valor={fmt$(totFranq.plata)} sub={`${fmtKg(totFranq.kilos)} despachados`} color={NEON.ambar} />
            {lider && <Kpi label="La que más vende" valor={lider.nombre} sub={fmt$(lider.total)} color={NEON.verde} />}
          </div>

          {/* ── Comparativa de bocas ─────────────────────────────────── */}
          <div style={{ background: 'rgba(0,212,255,0.02)', border: '1px solid rgba(0,212,255,0.15)', borderRadius: 12, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: NEON.cian, letterSpacing: 1, marginBottom: 4 }}>🏪 LO QUE VENDE CADA BOCA</div>
            <div style={{ fontSize: 11, color: NEON.muted, marginBottom: 12 }}>
              Solo CARNE: el almacén y las bebidas no suman ni en plata ni en kilos. Venta propia = mostrador + sus mayoristas, y la casa central va <b>sin</b> lo que le vende a las franquicias — eso no es venta a la calle y se mira en el cuadro de abajo. Cada boca se mide con las fechas de su propio mes operativo.
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
                  {bocas.map(b => (
                    <tr key={b.id}>
                      <td style={td}>
                        <div style={{ fontWeight: 700, color: NEON.texto }}>{b.nombre}</div>
                        <div style={{ fontSize: 10, color: NEON.muted }}>{b.tipo === 'central' ? 'Casa central' : 'Franquicia'} · {b.direccion}</div>
                        {b.rango && (
                          <div style={{ fontSize: 10, color: b.rango.propio ? NEON.muted : NEON.ambar, marginTop: 2 }}>
                            📅 {fechaCorta(b.rango.desde)} → {fechaCorta(b.rango.hasta)}
                            {!b.rango.propio && ' · todavía no abrió su mes, va con el de la central'}
                          </div>
                        )}
                      </td>
                      <td style={{ ...tdN, color: NEON.cianHi }}>{fmt$(b.mostrador)}</td>
                      <td style={{ ...tdN, color: NEON.muted }}>{b.tickets.toLocaleString('es-AR')}</td>
                      <td style={{ ...tdN, color: NEON.muted }}>{b.tickets > 0 ? fmt$(b.mostrador / b.tickets) : '—'}</td>
                      <td style={{ ...tdN, color: NEON.azul }}>{b.mayorista > 0 ? fmt$(b.mayorista) : '—'}</td>
                      <td style={{ ...tdN, color: NEON.oro, fontWeight: 700 }}>{fmt$(b.total)}</td>
                    </tr>
                  ))}
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
              Los remitos de CARNE que salen de la central para las bocas, en kilos y en plata. Están todas, tengan el sistema instalado o no. Van con el mes operativo de la central, que es la que los emite.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
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
                  {(datos?.franquicias || []).map(f => (
                    <tr key={f.id}>
                      <td style={{ ...td, fontWeight: 700, color: NEON.texto }}>{f.nombre}</td>
                      <td style={{ ...tdN, color: NEON.muted }}>{f.remitos}</td>
                      <td style={{ ...tdN, color: NEON.cianHi }}>{fmtKg(f.kilos)}</td>
                      <td style={{ ...tdN, color: NEON.oro, fontWeight: 700 }}>{fmt$(f.plata)}</td>
                      <td style={{ ...tdN, color: NEON.muted }}>{f.kilos > 0 ? fmt$(f.plata / f.kilos) : '—'}</td>
                      <td style={{ ...tdN, color: NEON.cianHi, borderLeft: '1px solid rgba(255,179,92,0.25)' }}>{fmtKg(f.histKilos)}</td>
                      <td style={{ ...tdN, color: NEON.ambar, fontWeight: 700 }}>{fmt$(f.histPlata)}</td>
                    </tr>
                  ))}
                  {(datos?.franquicias || []).length === 0 && (
                    <tr><td style={{ ...td, color: NEON.muted, fontStyle: 'italic' }} colSpan={7}>Ningún remito a franquicias en este mes operativo.</td></tr>
                  )}
                  {(datos?.franquicias || []).length > 1 && (
                    <tr>
                      <td style={{ ...td, fontWeight: 700, color: NEON.muted, textTransform: 'uppercase', fontSize: 11 }}>Total</td>
                      <td style={{ ...tdN, color: NEON.muted }}>{totFranq.remitos}</td>
                      <td style={{ ...tdN, color: NEON.cianHi, fontWeight: 700 }}>{fmtKg(totFranq.kilos)}</td>
                      <td style={{ ...tdN, color: NEON.oro, fontWeight: 700 }}>{fmt$(totFranq.plata)}</td>
                      <td style={{ ...tdN, color: NEON.muted }}>{totFranq.kilos > 0 ? fmt$(totFranq.plata / totFranq.kilos) : '—'}</td>
                      <td style={{ ...tdN, color: NEON.cianHi, fontWeight: 700, borderLeft: '1px solid rgba(255,179,92,0.25)' }}>{fmtKg(totFranq.histKilos)}</td>
                      <td style={{ ...tdN, color: NEON.ambar, fontWeight: 700 }}>{fmt$(totFranq.histPlata)}</td>
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
