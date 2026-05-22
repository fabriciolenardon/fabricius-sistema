// ============================================================
// HISTORIAL DE CAJA RÁPIDA
// ============================================================
// Vista de ventas minoristas (origen = 'caja') con:
//   - Filtros por rango: hoy, ayer, 7 días, mes, custom
//   - Resumen: total facturado, cantidad de ventas, ticket promedio,
//     kg totales, items totales
//   - Desglose por categoría (bovino, cerdo, pollo, embutido, brosa,
//     almacén, bebida, otros) — kg + plata
//   - Desglose por forma de pago — efectivo, débito, transferencia
//   - Tabla por día con cada venta detallada (expandible)
// ============================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

const fmt$ = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR')
const fmtKg = n => (Number(n) || 0).toFixed(3) + ' kg'

// Mapeo de categoría del producto a un grupo agregado del historial
function grupoDeCategoria(cat) {
  if (!cat) return 'otros'
  if (cat.startsWith('bovino') && cat !== 'bovino_brosa') return 'bovino'
  if (cat === 'bovino_brosa') return 'brosa'
  if (cat.startsWith('cerdo')) return 'cerdo'
  if (cat === 'pollo' || cat === 'pollo_cajon') return 'pollo'
  if (cat === 'embutido') return 'embutido'
  if (cat === 'rebozado' || cat === 'rebozado_cajon') return 'rebozado'
  if (cat === 'almacen') return 'almacen'
  if (cat === 'bebidas') return 'bebidas'
  return 'otros'
}

const GRUPOS = {
  bovino:    { label: '🥩 Bovino',     color: '#ff6b6b' },
  cerdo:     { label: '🐷 Cerdo',      color: '#ffa07a' },
  pollo:     { label: '🍗 Pollo',      color: '#ffd17a' },
  embutido:  { label: '🌭 Embutidos',  color: '#dd9b6c' },
  brosa:     { label: '🫀 Brosas',     color: '#ff9999' },
  rebozado:  { label: '🧊 Rebozados',  color: '#7ad1ff' },
  almacen:   { label: '🛒 Almacén',    color: '#7dff7d' },
  bebidas:   { label: '🥤 Bebidas',    color: '#7a9dff' },
  otros:     { label: '— Otros',       color: '#aaa' },
}

function rangoFechas(modo) {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const iso = d => d.toISOString().split('T')[0]
  if (modo === 'hoy')   { return { desde: iso(hoy), hasta: iso(hoy) } }
  if (modo === 'ayer')  {
    const a = new Date(hoy); a.setDate(a.getDate() - 1)
    return { desde: iso(a), hasta: iso(a) }
  }
  if (modo === '7dias') {
    const d = new Date(hoy); d.setDate(d.getDate() - 6)
    return { desde: iso(d), hasta: iso(hoy) }
  }
  if (modo === 'mes')   {
    const m = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    return { desde: iso(m), hasta: iso(hoy) }
  }
  return { desde: iso(hoy), hasta: iso(hoy) }
}

export default function HistorialCaja() {
  const [ventas, setVentas] = useState([])
  const [loading, setLoading] = useState(true)
  const [modo, setModo] = useState('hoy')
  const [rango, setRango] = useState(() => rangoFechas('hoy'))
  const [expandido, setExpandido] = useState(null)

  useEffect(() => { cargar() }, [rango.desde, rango.hasta])

  async function cargar() {
    setLoading(true)
    const { data, error } = await supabase
      .from('ventas_minoristas')
      .select('*')
      .eq('origen', 'caja')
      .gte('fecha', rango.desde)
      .lte('fecha', rango.hasta)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) console.error(error)
    setVentas(data || [])
    setLoading(false)
  }

  function aplicarModo(m) {
    setModo(m)
    if (m !== 'custom') setRango(rangoFechas(m))
  }

  // === Cálculos agregados ===
  const totales = useMemo(() => {
    let totalPlata = 0
    let totalKg = 0
    let totalItems = 0
    const porPago = { efectivo: 0, debito: 0, transferencia: 0 }
    const porGrupo = {}

    for (const v of ventas) {
      totalPlata += Number(v.total) || 0
      porPago.efectivo      += Number(v.efectivo)      || 0
      porPago.debito        += Number(v.debito)        || 0
      porPago.transferencia += Number(v.transferencia) || 0

      const items = Array.isArray(v.items) ? v.items : []
      for (const it of items) {
        const grupo = grupoDeCategoria(it.categoria)
        if (!porGrupo[grupo]) porGrupo[grupo] = { kg: 0, plata: 0, count: 0 }
        porGrupo[grupo].kg    += Number(it.kg) || 0
        porGrupo[grupo].plata += Number(it.importe) || 0
        porGrupo[grupo].count += 1
        totalKg += Number(it.kg) || 0
        totalItems += 1
      }
    }
    const ticketPromedio = ventas.length > 0 ? totalPlata / ventas.length : 0
    return { totalPlata, totalKg, totalItems, ticketPromedio, porPago, porGrupo }
  }, [ventas])

  // === Agrupar ventas por día ===
  const ventasPorDia = useMemo(() => {
    const map = new Map()
    for (const v of ventas) {
      if (!map.has(v.fecha)) map.set(v.fecha, [])
      map.get(v.fecha).push(v)
    }
    return Array.from(map.entries()).map(([fecha, lista]) => ({
      fecha,
      ventas: lista,
      total: lista.reduce((s, v) => s + (Number(v.total) || 0), 0),
      cant: lista.length,
    }))
  }, [ventas])

  // === Estilos compartidos ===
  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }
  const kpi = (label, value, sub) => (
    <div style={{ ...card, flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "'Bebas Neue',cursive", color: 'var(--gold)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  )
  const btnRango = (k, label) => (
    <button onClick={() => aplicarModo(k)}
      style={{
        padding: '7px 14px', borderRadius: 8,
        border: `1px solid ${modo === k ? 'var(--gold)' : 'var(--border)'}`,
        background: modo === k ? 'var(--gold)' : 'transparent',
        color: modo === k ? '#000' : 'var(--muted)',
        cursor: 'pointer', fontWeight: 700, fontSize: 12, fontFamily: "'DM Sans',sans-serif",
      }}>
      {label}
    </button>
  )

  return (
    <div>
      {/* FILTROS */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        {btnRango('hoy', '📅 Hoy')}
        {btnRango('ayer', '📅 Ayer')}
        {btnRango('7dias', '📅 Últimos 7 días')}
        {btnRango('mes', '📅 Este mes')}
        {btnRango('custom', '📅 Custom')}
        {modo === 'custom' && (
          <>
            <input type="date" value={rango.desde} onChange={e => setRango(r => ({ ...r, desde: e.target.value }))}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 12 }} />
            <span style={{ color: 'var(--muted)' }}>→</span>
            <input type="date" value={rango.hasta} onChange={e => setRango(r => ({ ...r, hasta: e.target.value }))}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 12 }} />
          </>
        )}
        <button onClick={cargar} style={{ padding: '6px 12px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, cursor: 'pointer', fontSize: 12, marginLeft: 'auto' }}>
          🔄 Recargar
        </button>
      </div>

      {loading && <p style={{ color: 'var(--muted)' }}>Cargando ventas...</p>}

      {!loading && (
        <>
          {/* KPIs */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            {kpi('Facturado', fmt$(totales.totalPlata), `${ventas.length} venta${ventas.length === 1 ? '' : 's'}`)}
            {kpi('Ticket promedio', fmt$(totales.ticketPromedio))}
            {kpi('Kg vendidos', fmtKg(totales.totalKg), `${totales.totalItems} items`)}
            {kpi('Días con ventas', String(ventasPorDia.length))}
          </div>

          {/* FORMA DE PAGO */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">💳 Por forma de pago</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 140, padding: 12, background: 'rgba(125,255,125,0.06)', border: '1px solid #2d5a2d', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>💵 EFECTIVO</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#7dff7d', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(totales.porPago.efectivo)}</div>
              </div>
              <div style={{ flex: 1, minWidth: 140, padding: 12, background: 'rgba(122,157,255,0.06)', border: '1px solid #2d3a5a', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>💳 DÉBITO</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#7a9dff', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(totales.porPago.debito)}</div>
              </div>
              <div style={{ flex: 1, minWidth: 140, padding: 12, background: 'rgba(255,209,122,0.06)', border: '1px solid #6a5a2a', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>🔄 TRANSFERENCIA</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#ffd17a', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(totales.porPago.transferencia)}</div>
              </div>
            </div>
          </div>

          {/* CATEGORÍA */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">📊 Por categoría</div>
            {Object.keys(totales.porGrupo).length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin ventas en el rango seleccionado.</p>
            ) : (
              <table style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Grupo</th>
                    <th style={{ textAlign: 'right' }}>Items</th>
                    <th style={{ textAlign: 'right' }}>Kg / Unid.</th>
                    <th style={{ textAlign: 'right' }}>Facturado</th>
                    <th style={{ textAlign: 'right', width: 80 }}>% del total</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(totales.porGrupo)
                    .sort((a, b) => b[1].plata - a[1].plata)
                    .map(([key, g]) => {
                      const info = GRUPOS[key] || GRUPOS.otros
                      const pct = totales.totalPlata > 0 ? (g.plata / totales.totalPlata * 100) : 0
                      return (
                        <tr key={key} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '8px 4px', color: info.color, fontWeight: 600 }}>{info.label}</td>
                          <td style={{ textAlign: 'right', padding: '8px 4px' }}>{g.count}</td>
                          <td style={{ textAlign: 'right', padding: '8px 4px' }}>{fmtKg(g.kg)}</td>
                          <td style={{ textAlign: 'right', padding: '8px 4px', color: info.color, fontWeight: 700 }}>{fmt$(g.plata)}</td>
                          <td style={{ textAlign: 'right', padding: '8px 4px', color: 'var(--muted)' }}>{pct.toFixed(1)}%</td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            )}
          </div>

          {/* TABLA POR DÍA */}
          <div className="card">
            <div className="card-title">📅 Ventas por día</div>
            {ventasPorDia.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin ventas en el rango.</p>
            ) : ventasPorDia.map(dia => (
              <div key={dia.fecha} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
                <div onClick={() => setExpandido(expandido === dia.fecha ? null : dia.fecha)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '4px 0' }}>
                  <div>
                    <span style={{ marginRight: 8 }}>{expandido === dia.fecha ? '▼' : '▶'}</span>
                    <strong>{dia.fecha}</strong>
                    <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted)' }}>· {dia.cant} venta{dia.cant === 1 ? '' : 's'}</span>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(dia.total)}</div>
                </div>
                {expandido === dia.fecha && (
                  <table style={{ width: '100%', marginTop: 8, fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
                        <th style={{ textAlign: 'left', padding: 4 }}>Hora</th>
                        <th style={{ textAlign: 'left', padding: 4 }}>Items</th>
                        <th style={{ textAlign: 'right', padding: 4 }}>Total</th>
                        <th style={{ textAlign: 'right', padding: 4 }}>Efectivo</th>
                        <th style={{ textAlign: 'right', padding: 4 }}>Débito</th>
                        <th style={{ textAlign: 'right', padding: 4 }}>Transf.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dia.ventas.map(v => (
                        <tr key={v.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: 4 }}>{v.hora || '—'}</td>
                          <td style={{ padding: 4, color: 'var(--muted)', fontSize: 11 }}>
                            {Array.isArray(v.items) ? `${v.items.length} item${v.items.length === 1 ? '' : 's'}` : '—'}
                          </td>
                          <td style={{ textAlign: 'right', padding: 4, fontWeight: 600 }}>{fmt$(v.total)}</td>
                          <td style={{ textAlign: 'right', padding: 4, color: v.efectivo > 0 ? '#7dff7d' : 'var(--muted)' }}>{v.efectivo > 0 ? fmt$(v.efectivo) : '—'}</td>
                          <td style={{ textAlign: 'right', padding: 4, color: v.debito > 0 ? '#7a9dff' : 'var(--muted)' }}>{v.debito > 0 ? fmt$(v.debito) : '—'}</td>
                          <td style={{ textAlign: 'right', padding: 4, color: v.transferencia > 0 ? '#ffd17a' : 'var(--muted)' }}>{v.transferencia > 0 ? fmt$(v.transferencia) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
