// ============================================================
// PRODUCTIVIDAD (Dirección) — rendimiento medido con números
//   - Por Hora: tickets y kg de Caja por franja horaria (picos vs muertas)
//   - Depósito: kg despostados y elaborados por día
//   - Semana a Semana: comparativa apoyada en los cierres existentes
//   - Franquicias: kg despachados, mix, evolución, saldo y pagos
// Todo es SOLO LECTURA: esta pantalla no modifica ninguna tabla.
// ============================================================
import { useState, useEffect } from 'react'
import { supabase, fetchAllRows } from '../../lib/supabase'
import { fmtPrecio, fmtKg, fmtNumero } from '../../lib/formatos'
import { fechaHoyARG, fechaRelativaARG, horaNumARG } from '../../lib/fechas'
import { lunesDeLaSemana } from '../../lib/cierreAuto'
import { kgPorUnidadDeProducto } from '../../lib/stockHelpers'
import { nombreTipo } from '../../lib/controlSemanal'
import { useEsMovil } from '../../lib/useEsMovil'

const n = v => Number(v) || 0
const fmt = v => fmtPrecio(n(v), { decimales: 0 })

// Mismo criterio que controlSemanal: almacén/bebidas/insumos van por unidad,
// no suman kilos; en cajones el campo kg guarda unidades (cajones).
const SIN_KG = new Set(['almacen', 'bebidas', 'insumos'])
const CAJON = new Set(['pollo_cajon', 'rebozado_cajon'])
const kgItem = it => {
  const cat = it?.categoria || it?.tipo || ''
  if (SIN_KG.has(cat)) return 0
  return CAJON.has(cat) ? n(it.kg) * (kgPorUnidadDeProducto(it) || 1) : n(it.kg)
}
const kgVenta = v => (Array.isArray(v.items) ? v.items : []).reduce((s, it) => s + kgItem(it), 0)

const sumarDias = (fecha, dias) => {
  const d = new Date(fecha + 'T12:00:00')
  d.setDate(d.getDate() + dias)
  return fechaHoyARG(d)
}
const ddmm = f => { const p = String(f || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : f }
const lunesDe = f => lunesDeLaSemana(new Date(f + 'T12:00:00'))

const RANGOS = [
  { id: 'esta', label: 'Esta semana' },
  { id: 'pasada', label: 'Semana pasada' },
  { id: '30', label: 'Últimos 30 días' },
]
function rangoFechas(modo) {
  const hoy = fechaHoyARG()
  if (modo === 'esta') return { desde: lunesDeLaSemana(), hasta: hoy }
  if (modo === 'pasada') { const lun = lunesDeLaSemana(); return { desde: sumarDias(lun, -7), hasta: sumarDias(lun, -1) } }
  return { desde: fechaRelativaARG(-29), hasta: hoy }
}

const horaDeVenta = v => {
  if (v.hora) { const h = parseInt(String(v.hora).slice(0, 2), 10); if (!Number.isNaN(h)) return h }
  return v.created_at ? horaNumARG(new Date(v.created_at)) : null
}

function Delta({ pct }) {
  if (pct === null || !isFinite(pct)) return <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
  const pos = pct >= 0
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: pos ? 'var(--green)' : 'var(--red-light)' }}>
      {pos ? '▲' : '▼'} {fmtNumero(Math.abs(pct), 1)}%
    </span>
  )
}

function BarraH({ valor, max, color }) {
  const pct = max > 0 ? Math.max(2, (valor / max) * 100) : 0
  return (
    <div style={{ flex: 1, height: 14, background: 'var(--surface2)', borderRadius: 7, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 7 }} />
    </div>
  )
}

const thStyle = { textAlign: 'right', padding: '6px 8px', fontSize: 11, color: 'var(--muted)', fontWeight: 700, letterSpacing: 0.5, whiteSpace: 'nowrap' }
const tdStyle = { textAlign: 'right', padding: '6px 8px', fontSize: 13, whiteSpace: 'nowrap' }

// ──────────────────────────────────────────────────────────
// TAB 1: POR HORA (Caja)
// ──────────────────────────────────────────────────────────
function TabPorHora({ rango, esMovil }) {
  const [cargando, setCargando] = useState(true)
  const [ventas, setVentas] = useState([])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    const { desde, hasta } = rangoFechas(rango)
    fetchAllRows(() => supabase.from('ventas_minoristas')
      .select('fecha, hora, created_at, total, items')
      .eq('origen', 'caja').gte('fecha', desde).lte('fecha', hasta))
      .then(({ data }) => { if (vivo) { setVentas(data || []); setCargando(false) } })
    return () => { vivo = false }
  }, [rango])

  if (cargando) return <div className="empty">Cargando ventas…</div>
  if (!ventas.length) return <div className="empty">No hay ventas de caja en el período.</div>

  // Días con actividad (para promediar) y agregado por hora
  const dias = new Set(ventas.map(v => v.fecha))
  const porHora = new Map() // hora → { tickets, kg, plata }
  const turnos = { manana: { tickets: 0, kg: 0, plata: 0 }, tarde: { tickets: 0, kg: 0, plata: 0 } }
  for (const v of ventas) {
    const h = horaDeVenta(v)
    if (h === null) continue
    const kg = kgVenta(v)
    const acc = porHora.get(h) || { tickets: 0, kg: 0, plata: 0 }
    acc.tickets += 1; acc.kg += kg; acc.plata += n(v.total)
    porHora.set(h, acc)
    const t = h < 14 ? turnos.manana : turnos.tarde
    t.tickets += 1; t.kg += kg; t.plata += n(v.total)
  }
  const horas = [...porHora.keys()]
  if (!horas.length) return <div className="empty">Las ventas del período no tienen hora registrada.</div>
  const hMin = Math.min(...horas), hMax = Math.max(...horas)
  const filas = []
  for (let h = hMin; h <= hMax; h++) filas.push({ hora: h, ...(porHora.get(h) || { tickets: 0, kg: 0, plata: 0 }) })
  const maxTickets = Math.max(...filas.map(f => f.tickets), 1)
  const pico = filas.reduce((a, b) => (b.tickets > a.tickets ? b : a), filas[0])
  const muertas = filas.filter(f => f.tickets > 0 && f.tickets <= maxTickets * 0.25)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {[['🌅 Turno mañana (hasta 14 hs)', turnos.manana], ['🌇 Turno tarde (desde 14 hs)', turnos.tarde]].map(([lbl, t]) => (
          <div key={lbl} className="card" style={{ padding: 14 }}>
            <div className="card-title" style={{ marginBottom: 8 }}>{lbl}</div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Tickets</div><div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 26 }}>{t.tickets}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Kg</div><div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 26 }}>{fmtNumero(t.kg, 0)}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Facturado</div><div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 26 }}>{fmt(t.plata)}</div></div>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div className="card-title" style={{ marginBottom: 4 }}>⏰ Actividad por hora ({dias.size} {dias.size === 1 ? 'día' : 'días'} con ventas)</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          Pico: <b style={{ color: 'var(--gold)' }}>{pico.hora}:00 hs</b> ({pico.tickets} tickets)
          {muertas.length > 0 && <> · Franjas flojas: <b>{muertas.map(f => `${f.hora}hs`).join(', ')}</b></>}
        </div>
        {filas.map(f => (
          <div key={f.hora} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 44, fontSize: 12, color: 'var(--text2)', fontWeight: 700, textAlign: 'right' }}>{f.hora}:00</div>
            <BarraH valor={f.tickets} max={maxTickets} color={f.hora === pico.hora ? 'var(--gold)' : 'var(--amber)'} />
            <div style={{ width: esMovil ? 110 : 220, fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
              {f.tickets} tks · {fmtNumero(f.kg, 0)} kg{!esMovil && <> · {fmt(f.plata)}</>}
            </div>
          </div>
        ))}
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
          Los kg excluyen almacén/bebidas/insumos (se venden por unidad). Cajones convertidos a kg reales.
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// TAB 2: DEPÓSITO (desposte + elaboración por día)
// ──────────────────────────────────────────────────────────
function TabDeposito({ rango, esMovil }) {
  const [cargando, setCargando] = useState(true)
  const [entradas, setEntradas] = useState([])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    const { desde, hasta } = rangoFechas(rango)
    fetchAllRows(() => supabase.from('entradas_deposito')
      .select('fecha, tipo, kg, kg_real, destino')
      .eq('eliminado', false).in('destino', ['desposte', 'elaboracion'])
      .gte('fecha', desde).lte('fecha', hasta))
      .then(({ data }) => { if (vivo) { setEntradas(data || []); setCargando(false) } })
    return () => { vivo = false }
  }, [rango])

  if (cargando) return <div className="empty">Cargando producción…</div>
  if (!entradas.length) return <div className="empty">No hubo desposte ni elaboración en el período.</div>

  const kgDe = e => n(e.kg_real ?? e.kg)
  const porDia = new Map() // fecha → { desposte, elaboracion }
  const porTipoElab = new Map()
  let totDesposte = 0, totElab = 0
  for (const e of entradas) {
    const d = porDia.get(e.fecha) || { desposte: 0, elaboracion: 0 }
    if (e.destino === 'desposte') { d.desposte += kgDe(e); totDesposte += kgDe(e) }
    else { d.elaboracion += kgDe(e); totElab += kgDe(e); porTipoElab.set(e.tipo, (porTipoElab.get(e.tipo) || 0) + kgDe(e)) }
    porDia.set(e.fecha, d)
  }
  const filas = [...porDia.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  const maxDia = Math.max(...filas.map(([, d]) => d.desposte + d.elaboracion), 1)
  const mixElab = [...porTipoElab.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>🔪 Despostado (piezas obtenidas)</div>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 30, color: 'var(--gold)' }}>{fmtKg(totDesposte, { decimales: 0 })}</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>🥩 Elaborado (embutidos/hamburguesas)</div>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 30, color: 'var(--amber)' }}>{fmtKg(totElab, { decimales: 0 })}</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>📅 Días con producción</div>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 30 }}>{filas.length}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Promedio: {fmtKg((totDesposte + totElab) / (filas.length || 1), { decimales: 0 })}/día</div>
        </div>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 10 }}>Producción por día</div>
        {filas.map(([fecha, d]) => (
          <div key={fecha} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 48, fontSize: 12, color: 'var(--text2)', fontWeight: 700, textAlign: 'right' }}>{ddmm(fecha)}</div>
            <div style={{ flex: 1, height: 14, background: 'var(--surface2)', borderRadius: 7, overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: `${(d.desposte / maxDia) * 100}%`, background: 'var(--gold)' }} />
              <div style={{ width: `${(d.elaboracion / maxDia) * 100}%`, background: 'var(--amber)' }} />
            </div>
            <div style={{ width: esMovil ? 120 : 210, fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
              🔪 {fmtNumero(d.desposte, 0)} kg · 🥩 {fmtNumero(d.elaboracion, 0)} kg
            </div>
          </div>
        ))}
      </div>

      {mixElab.length > 0 && (
        <div className="card" style={{ padding: 14 }}>
          <div className="card-title" style={{ marginBottom: 10 }}>Qué se elaboró</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {mixElab.map(([tipo, kg]) => (
              <span key={tipo} style={{ fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px' }}>
                {nombreTipo(tipo)}: <b>{fmtKg(kg, { decimales: 0 })}</b>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// TAB 3: SEMANA A SEMANA (desde cierres_semanales)
// ──────────────────────────────────────────────────────────
function TabSemanas({ esMovil }) {
  const [cargando, setCargando] = useState(true)
  const [cierres, setCierres] = useState([])

  useEffect(() => {
    let vivo = true
    supabase.from('cierres_semanales').select('*')
      .order('semana_inicio', { ascending: false }).limit(13)
      .then(({ data }) => { if (vivo) { setCierres(data || []); setCargando(false) } })
    return () => { vivo = false }
  }, [])

  if (cargando) return <div className="empty">Cargando cierres…</div>
  if (!cierres.length) return <div className="empty">Todavía no hay cierres semanales guardados.</div>

  // En orden descendente, la "semana anterior" de la fila i es la fila i+1
  const filas = cierres.map((c, i) => {
    const ant = cierres[i + 1]
    const deltaPct = (act, prev) => (prev && n(prev) !== 0 ? ((n(act) - n(prev)) / Math.abs(n(prev))) * 100 : null)
    const ing = c.ingresos || {}
    return {
      ...c,
      caja: n(ing.ventas_caja), mayorista: n(ing.ventas_mayorista),
      kgTotal: n(c.kg_carne) + n(c.kg_pollo) + n(c.kg_cerdo),
      dVentas: ant ? deltaPct(c.ventas, ant.ventas) : null,
      dGanancia: ant ? deltaPct(c.ganancia, ant.ganancia) : null,
      dKg: ant ? deltaPct(n(c.kg_carne) + n(c.kg_pollo) + n(c.kg_cerdo), n(ant.kg_carne) + n(ant.kg_pollo) + n(ant.kg_cerdo)) : null,
    }
  }).slice(0, 12)

  const maxVentas = Math.max(...filas.map(f => n(f.ventas)), 1)

  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="card-title" style={{ marginBottom: 4 }}>📅 Últimas {filas.length} semanas cerradas</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Variación contra la semana anterior. Fuente: cierres semanales (snapshot inmutable).</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ ...thStyle, textAlign: 'left' }}>Semana</th>
              <th style={thStyle}>Ventas</th>
              <th style={thStyle}>vs ant.</th>
              {!esMovil && <th style={thStyle}>Caja</th>}
              {!esMovil && <th style={thStyle}>Mayorista</th>}
              <th style={thStyle}>Kg</th>
              <th style={thStyle}>vs ant.</th>
              <th style={thStyle}>Ganancia</th>
              <th style={thStyle}>vs ant.</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 700, color: 'var(--text2)' }}>{ddmm(f.semana_inicio)} → {ddmm(f.semana_fin)}</td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                    {!esMovil && <div style={{ width: 90 }}><BarraH valor={n(f.ventas)} max={maxVentas} color="var(--gold)" /></div>}
                    <span>{fmt(f.ventas)}</span>
                  </div>
                </td>
                <td style={tdStyle}><Delta pct={f.dVentas} /></td>
                {!esMovil && <td style={{ ...tdStyle, color: 'var(--muted)' }}>{fmt(f.caja)}</td>}
                {!esMovil && <td style={{ ...tdStyle, color: 'var(--muted)' }}>{fmt(f.mayorista)}</td>}
                <td style={tdStyle}>{fmtNumero(f.kgTotal, 0)}</td>
                <td style={tdStyle}><Delta pct={f.dKg} /></td>
                <td style={{ ...tdStyle, fontWeight: 700, color: n(f.ganancia) >= 0 ? 'var(--green)' : 'var(--red-light)' }}>{fmt(f.ganancia)}</td>
                <td style={tdStyle}><Delta pct={f.dGanancia} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// TAB 4: FRANQUICIAS (despachos, mix, evolución, cta cte solo lectura)
// ──────────────────────────────────────────────────────────
const SEMANAS_FRQ = 12

function TabFranquicias({ esMovil }) {
  const [cargando, setCargando] = useState(true)
  const [datos, setDatos] = useState([])

  useEffect(() => {
    let vivo = true
    async function cargar() {
      const { data: frs } = await supabase.from('clientes')
        .select('id, nombre, nombre_fantasia, localidad, saldo')
        .eq('es_franquicia', true).order('nombre')
      if (!frs?.length) { if (vivo) { setDatos([]); setCargando(false) }; return }
      const desde = sumarDias(lunesDeLaSemana(), -7 * (SEMANAS_FRQ - 1))
      const res = await Promise.all(frs.map(async fr => {
        const [{ data: rems }, { data: pagos }] = await Promise.all([
          fetchAllRows(() => supabase.from('remitos')
            .select('fecha, total, items')
            .eq('eliminado', false).eq('cliente_id', fr.id).neq('cobro', 'interno')
            .gte('fecha', desde)),
          // Cta cte: SOLO lectura (últimos pagos registrados)
          supabase.from('movimientos_ctacte')
            .select('fecha, tipo, haber, descripcion')
            .eq('cliente_id', fr.id).gt('haber', 0)
            .order('fecha', { ascending: false }).limit(5),
        ])
        return { fr, remitos: rems || [], pagos: pagos || [] }
      }))
      if (vivo) { setDatos(res); setCargando(false) }
    }
    cargar()
    return () => { vivo = false }
  }, [])

  if (cargando) return <div className="empty">Cargando franquicias…</div>
  if (!datos.length) return <div className="empty">No hay clientes marcados como franquicia. Marcá el tilde 🏪 FRANQUICIA en el legajo del cliente (módulo Clientes).</div>

  // Ejes de semanas: los últimos 12 lunes, del más viejo al más nuevo
  const lunActual = lunesDeLaSemana()
  const semanas = []
  for (let i = SEMANAS_FRQ - 1; i >= 0; i--) semanas.push(sumarDias(lunActual, -7 * i))

  return (
    <div>
      {datos.map(({ fr, remitos, pagos }) => {
        const porSemana = new Map(semanas.map(s => [s, { kg: 0, plata: 0, remitos: 0 }]))
        const mix = new Map()
        for (const r of remitos) {
          const sem = lunesDe(r.fecha)
          const acc = porSemana.get(sem)
          const items = Array.isArray(r.items) ? r.items : []
          const kg = items.reduce((s, it) => s + kgItem(it), 0)
          if (acc) { acc.kg += kg; acc.plata += n(r.total); acc.remitos += 1 }
          for (const it of items) {
            const d = (it.descripcion || '(sin descripción)').trim().toUpperCase()
            mix.set(d, (mix.get(d) || 0) + kgItem(it))
          }
        }
        const serie = semanas.map(s => ({ semana: s, ...porSemana.get(s) }))
        const maxKg = Math.max(...serie.map(x => x.kg), 1)
        // Tendencia: últimas 4 semanas completas vs las 4 anteriores
        const ult4 = serie.slice(-5, -1).reduce((s, x) => s + x.kg, 0)
        const prev4 = serie.slice(-9, -5).reduce((s, x) => s + x.kg, 0)
        const tendencia = prev4 > 0 ? ((ult4 - prev4) / prev4) * 100 : null
        const topMix = [...mix.entries()].filter(([, kg]) => kg > 0.01).sort((a, b) => b[1] - a[1]).slice(0, 8)
        const maxMix = Math.max(...topMix.map(([, kg]) => kg), 1)
        const totKg = serie.reduce((s, x) => s + x.kg, 0)
        const totPlata = serie.reduce((s, x) => s + x.plata, 0)
        const saldo = n(fr.saldo)

        return (
          <div key={fr.id} className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <div>
                <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, letterSpacing: 1 }}>🏪 {fr.nombre_fantasia || fr.nombre}</div>
                {fr.localidad && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{fr.localidad}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Saldo cta cte</div>
                <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: saldo > 0 ? 'var(--red-light)' : 'var(--green)' }}>{fmt(saldo)}</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 14 }}>
              <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Kg despachados ({SEMANAS_FRQ} sem)</div><div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24 }}>{fmtNumero(totKg, 0)} kg</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Facturado</div><div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24 }}>{fmt(totPlata)}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Remitos</div><div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24 }}>{remitos.length}</div></div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Tendencia (4 sem vs 4 ant.)</div>
                <div style={{ fontSize: 20, paddingTop: 3 }}><Delta pct={tendencia} /></div>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, marginBottom: 6 }}>KG DESPACHADOS POR SEMANA</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 90 }}>
                {serie.map(x => (
                  <div key={x.semana} title={`Semana del ${ddmm(x.semana)}: ${fmtNumero(x.kg, 0)} kg · ${x.remitos} remitos`}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                    <div style={{ height: `${Math.max(x.kg > 0 ? 4 : 0, (x.kg / maxKg) * 100)}%`, background: x.semana === lunActual ? 'var(--gold)' : 'var(--amber)', borderRadius: '3px 3px 0 0' }} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {serie.map((x, i) => (
                  <div key={x.semana} style={{ flex: 1, fontSize: 9, color: 'var(--muted)', textAlign: 'center' }}>
                    {(esMovil ? i % 3 === 0 : i % 2 === 0) || x.semana === lunActual ? ddmm(x.semana) : ''}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, marginBottom: 6 }}>MIX DE PRODUCTOS (kg, {SEMANAS_FRQ} sem)</div>
                {topMix.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sin despachos con kg en el período.</div>}
                {topMix.map(([desc, kg]) => (
                  <div key={desc} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                    <div style={{ width: esMovil ? 120 : 150, fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={desc}>{desc}</div>
                    <BarraH valor={kg} max={maxMix} color="var(--amber)" />
                    <div style={{ width: 62, fontSize: 11, textAlign: 'right', color: 'var(--text2)' }}>{fmtNumero(kg, 0)} kg</div>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, marginBottom: 6 }}>ÚLTIMOS PAGOS RECIBIDOS</div>
                {pagos.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sin pagos registrados.</div>}
                {pagos.map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text2)' }}>{ddmm(p.fecha)} · {p.tipo === 'cheque' ? '📄 cheque' : '💵 pago'}</span>
                    <span style={{ fontWeight: 700, color: 'var(--green)' }}>{fmt(p.haber)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// PÁGINA
// ──────────────────────────────────────────────────────────
export default function Productividad() {
  const esMovil = useEsMovil()
  const [tab, setTab] = useState('hora')
  const [rango, setRango] = useState('esta')

  const TABS = [
    { id: 'hora', label: '⏰ Por Hora' },
    { id: 'deposito', label: '🏭 Depósito' },
    { id: 'semanas', label: '📅 Semana a Semana' },
    { id: 'franquicias', label: '🏪 Franquicias' },
  ]
  const usaRango = tab === 'hora' || tab === 'deposito'

  return (
    <div>
      <div className="page-title">PRODUCTIVIDAD</div>
      <div className="page-sub">Rendimiento por números: franjas horarias de Caja, producción de Depósito, comparativa semanal y despachos a franquicias.</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--border)', background: tab === t.id ? 'var(--green)' : 'transparent', color: tab === t.id ? '#fff' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13 }}>
            {t.label}
          </button>
        ))}
        {usaRango && (
          <div style={{ display: 'flex', gap: 6, marginLeft: esMovil ? 0 : 'auto' }}>
            {RANGOS.map(r => (
              <button key={r.id} onClick={() => setRango(r.id)}
                style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid var(--border)', background: rango === r.id ? 'var(--gold)' : 'transparent', color: rango === r.id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 12 }}>
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'hora' && <TabPorHora rango={rango} esMovil={esMovil} />}
      {tab === 'deposito' && <TabDeposito rango={rango} esMovil={esMovil} />}
      {tab === 'semanas' && <TabSemanas esMovil={esMovil} />}
      {tab === 'franquicias' && <TabFranquicias esMovil={esMovil} />}
    </div>
  )
}
