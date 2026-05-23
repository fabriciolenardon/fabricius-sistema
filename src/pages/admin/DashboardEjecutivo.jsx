// ============================================================
// DASHBOARD EJECUTIVO — Vista "1 pantalla" para el dueño
// ============================================================
// Resumen panorámico con todos los KPIs importantes a la vez.
// Pensado para revisar el negocio en 30 segundos.
//
// Incluye:
//   - Facturado hoy / semana / mes con comparativa
//   - Top 3 alertas
//   - Stock crítico
//   - % consumido de topes de cada monotributo
//   - Botón "📊 Mi reporte de hoy" → arma y abre WhatsApp
// ============================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { enviarWhatsapp, fmtArs } from '../../lib/whatsapp'

const TOPE_K = 108357084.05 // tope monotributo cat K 2026

const hoyISO = () => new Date().toISOString().split('T')[0]
const fechaHaceDias = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}
const inicioMes = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
}
const inicioMesAnterior = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().split('T')[0]
}
const finMesAnterior = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 0).toISOString().split('T')[0]
}

export default function DashboardEjecutivo() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [whatsappDestino, setWhatsappDestino] = useState(() => localStorage.getItem('reporte_whatsapp') || '')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const hoy = hoyISO()
    const hace7 = fechaHaceDias(6)
    const mesIni = inicioMes()
    const mesAntIni = inicioMesAnterior()
    const mesAntFin = finMesAnterior()

    const [ventasHoy, ventasSemana, ventasMes, ventasMesAnt, cuentas, facturas12m, stock, cheques, clientes] = await Promise.all([
      supabase.from('ventas_minoristas').select('total, efectivo, debito, transferencia, items, fecha').eq('origen', 'caja').eq('fecha', hoy),
      supabase.from('ventas_minoristas').select('total, fecha').eq('origen', 'caja').gte('fecha', hace7).lte('fecha', hoy),
      supabase.from('ventas_minoristas').select('total').eq('origen', 'caja').gte('fecha', mesIni).lte('fecha', hoy),
      supabase.from('ventas_minoristas').select('total').eq('origen', 'caja').gte('fecha', mesAntIni).lte('fecha', mesAntFin),
      supabase.from('cuentas_fiscales').select('*').eq('activa', true).then(r => r).catch(() => ({ data: null })),
      supabase.from('facturas').select('cuenta_id, monto_total, fecha').eq('tipo', 'emitida').gte('fecha', fechaHaceDias(365)).then(r => r).catch(() => ({ data: null })),
      supabase.from('stock_actual').select('*'),
      supabase.from('cheques').select('*').gte('fecha_pago', hoy).lte('fecha_pago', fechaHaceDias(-15)),
      supabase.from('clientes').select('nombre, saldo').gt('saldo', 100000).order('saldo', { ascending: false }).limit(5),
    ])

    const totalHoy = (ventasHoy.data || []).reduce((s, v) => s + (Number(v.total) || 0), 0)
    const cantHoy  = (ventasHoy.data || []).length
    const totalSemana = (ventasSemana.data || []).reduce((s, v) => s + (Number(v.total) || 0), 0)
    const totalMes    = (ventasMes.data || []).reduce((s, v) => s + (Number(v.total) || 0), 0)
    const totalMesAnt = (ventasMesAnt.data || []).reduce((s, v) => s + (Number(v.total) || 0), 0)
    const variacion   = totalMesAnt > 0 ? ((totalMes - totalMesAnt) / totalMesAnt) * 100 : 0
    const ticketProm  = cantHoy > 0 ? totalHoy / cantHoy : 0

    // Top productos hoy
    const acc = {}
    ;(ventasHoy.data || []).forEach(v => (v.items || []).forEach(i => {
      const k = i.descripcion || '—'
      if (!acc[k]) acc[k] = { kg: 0, importe: 0 }
      acc[k].kg += Number(i.kg) || 0
      acc[k].importe += Number(i.importe) || 0
    }))
    const topProductosHoy = Object.entries(acc)
      .map(([nombre, d]) => ({ nombre, ...d }))
      .sort((a, b) => b.importe - a.importe)
      .slice(0, 5)

    // Cuentas mono con % de consumo
    const cuentasConPct = (cuentas.data || [])
      .filter(c => c.tipo === 'monotributo')
      .map(c => {
        const fact = (facturas12m.data || []).filter(f => f.cuenta_id === c.id).reduce((s, f) => s + (Number(f.monto_total) || 0), 0)
        return { ...c, facturado12m: fact, pctConsumo: (fact / TOPE_K) * 100 }
      })
      .sort((a, b) => b.pctConsumo - a.pctConsumo)

    // Stock crítico
    const stockMap = {}
    ;(stock.data || []).forEach(r => stockMap[r.tipo] = r.kg_disponible || 0)
    const stockCritico = [
      { tipo: 'bovino_mr',    label: '🐄 Bovino M.R.',   minimo: 100, kg: stockMap.bovino_mr || 0 },
      { tipo: 'bovino_corte', label: '🥩 Bovino Cortes', minimo: 50,  kg: stockMap.bovino_corte || 0 },
      { tipo: 'pollo',        label: '🍗 Pollo',         minimo: 100, kg: stockMap.pollo || 0 },
      { tipo: 'cerdo',        label: '🐷 Cerdo',         minimo: 50,  kg: stockMap.cerdo || 0 },
      { tipo: 'embutido',     label: '🌭 Embutidos',     minimo: 30,  kg: stockMap.embutido || 0 },
    ].filter(s => s.kg < s.minimo)

    setData({
      totalHoy, cantHoy, ticketProm, totalSemana, totalMes, totalMesAnt, variacion,
      topProductosHoy, cuentasConPct, stockCritico,
      cheques: cheques.data || [],
      clientesDeudores: clientes.data || [],
    })
    setLoading(false)
  }

  function guardarNumeroWhatsapp(n) {
    setWhatsappDestino(n)
    localStorage.setItem('reporte_whatsapp', n)
  }

  function enviarReporteWhatsapp() {
    if (!data) return
    const fechaTxt = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
    let msg = `🥩 *Carnicerías Fabricius — Reporte del día*\n`
    msg += `📅 ${fechaTxt.charAt(0).toUpperCase() + fechaTxt.slice(1)}\n\n`
    msg += `*💵 Facturado hoy:* ${fmtArs(data.totalHoy)}\n`
    msg += `· ${data.cantHoy} venta${data.cantHoy === 1 ? '' : 's'}\n`
    msg += `· Ticket promedio: ${fmtArs(data.ticketProm)}\n\n`
    msg += `*📊 Semana:* ${fmtArs(data.totalSemana)}\n`
    msg += `*📅 Mes:* ${fmtArs(data.totalMes)}`
    if (data.totalMesAnt > 0) {
      const signo = data.variacion >= 0 ? '+' : ''
      msg += ` (${signo}${data.variacion.toFixed(1)}% vs mes anterior)`
    }
    msg += `\n\n`

    if (data.topProductosHoy.length > 0) {
      msg += `*🏆 Top productos de hoy:*\n`
      data.topProductosHoy.slice(0, 3).forEach((p, i) => {
        msg += `${i + 1}. ${p.nombre} · ${p.kg.toFixed(1)} kg · ${fmtArs(p.importe)}\n`
      })
      msg += `\n`
    }

    if (data.stockCritico.length > 0) {
      msg += `*⚠️ Stock bajo:*\n`
      data.stockCritico.forEach(s => {
        msg += `· ${s.label}: ${s.kg.toFixed(0)} kg (mínimo ${s.minimo})\n`
      })
      msg += `\n`
    }

    const monosAtRisk = data.cuentasConPct.filter(c => c.pctConsumo >= 70)
    if (monosAtRisk.length > 0) {
      msg += `*🚨 Monotributos en alerta:*\n`
      monosAtRisk.forEach(c => {
        msg += `· ${c.nombre}: ${c.pctConsumo.toFixed(1)}% del tope K\n`
      })
      msg += `\n`
    }

    if (data.clientesDeudores.length > 0) {
      msg += `*💳 Clientes con deuda > $100k:*\n`
      data.clientesDeudores.slice(0, 3).forEach(c => {
        msg += `· ${c.nombre}: ${fmtArs(c.saldo)}\n`
      })
    }

    enviarWhatsapp(whatsappDestino, msg)
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>Cargando dashboard ejecutivo...</p>
  if (!data) return null

  return (
    <div>
      <div className="page-title">⚡ DASHBOARD EJECUTIVO</div>
      <div className="page-sub">Resumen panorámico del negocio · Una pantalla, toda la info</div>

      {/* Acción rápida: enviar reporte */}
      <div className="card" style={{ marginTop: 14, padding: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>📊 Reporte del día por WhatsApp</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Te abre WhatsApp con el resumen armado al número que pongas</div>
        </div>
        <input value={whatsappDestino} onChange={e => guardarNumeroWhatsapp(e.target.value)}
          placeholder="Tu WhatsApp (ej: 3515551234)"
          style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontSize: 13, minWidth: 200 }} />
        <button onClick={enviarReporteWhatsapp}
          style={{ padding: '10px 18px', background: '#25D366', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
          📱 Enviar a WhatsApp
        </button>
      </div>

      {/* KPIs principales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 16 }}>
        <KPI label="💵 FACTURADO HOY" valor={fmtArs(data.totalHoy)} sub={`${data.cantHoy} venta${data.cantHoy === 1 ? '' : 's'} · ticket ${fmtArs(data.ticketProm)}`} color="var(--gold)" />
        <KPI label="📊 ÚLTIMOS 7 DÍAS" valor={fmtArs(data.totalSemana)} sub={`Promedio ${fmtArs(data.totalSemana / 7)}/día`} color="#7a9dff" />
        <KPI label="📅 ESTE MES" valor={fmtArs(data.totalMes)}
          sub={data.totalMesAnt > 0
            ? `${data.variacion >= 0 ? '↗' : '↘'} ${data.variacion >= 0 ? '+' : ''}${data.variacion.toFixed(1)}% vs mes anterior (${fmtArs(data.totalMesAnt)})`
            : 'Sin datos del mes anterior'}
          color={data.variacion >= 0 ? '#7dff7d' : '#ff8b8b'} />
      </div>

      {/* Bloque 2: top + stock + monos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 16 }}>
        {/* Top productos hoy */}
        <div className="card">
          <div className="card-title">🏆 Top productos hoy</div>
          {data.topProductosHoy.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin ventas hoy todavía.</p>
          ) : (
            <table style={{ width: '100%', fontSize: 12 }}>
              <tbody>
                {data.topProductosHoy.map((p, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px', width: 24, color: 'var(--muted)' }}>{i + 1}.</td>
                    <td style={{ padding: '6px 4px', fontWeight: 600 }}>{p.nombre}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted)' }}>{p.kg.toFixed(1)} kg</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--gold)', fontWeight: 700 }}>{fmtArs(p.importe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Stock crítico */}
        <div className="card">
          <div className="card-title" style={{ color: data.stockCritico.length > 0 ? '#ff8b8b' : '#7dff7d' }}>
            {data.stockCritico.length > 0 ? '⚠️ Stock crítico' : '✅ Stock OK'}
          </div>
          {data.stockCritico.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Todos los stocks por encima del mínimo.</p>
          ) : (
            data.stockCritico.map(s => (
              <div key={s.tipo} style={{ padding: '8px 12px', background: '#3a1a1a', borderRadius: 6, marginBottom: 6, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                <span>{s.label}</span>
                <strong style={{ color: '#ff8b8b' }}>{s.kg.toFixed(0)} kg <span style={{ color: 'var(--muted)', fontSize: 10 }}>(mín {s.minimo})</span></strong>
              </div>
            ))
          )}
        </div>

        {/* Monos al borde */}
        <div className="card">
          <div className="card-title">📑 Monotributos — % consumido</div>
          {data.cuentasConPct.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin cuentas de monotributo cargadas.</p>
          ) : (
            data.cuentasConPct.map(c => {
              const color = c.pctConsumo >= 95 ? '#ff8b8b' : c.pctConsumo >= 85 ? '#ffd17a' : c.pctConsumo >= 70 ? '#ffd17a' : '#7dff7d'
              return (
                <div key={c.id} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ fontWeight: 600 }}>{c.nombre}</span>
                    <strong style={{ color }}>{c.pctConsumo.toFixed(1)}%</strong>
                  </div>
                  <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, c.pctConsumo)}%`, height: '100%', background: color, transition: 'width .3s' }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                    Facturado: {fmtArs(c.facturado12m)} / {fmtArs(TOPE_K)}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Cheques + deudores */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 16 }}>
        <div className="card">
          <div className="card-title">📄 Próximos cheques a cobrar (15 días)</div>
          {data.cheques.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin cheques próximos.</p>
          ) : (
            data.cheques.slice(0, 5).map(c => {
              const dias = Math.ceil((new Date(c.fecha_pago + 'T12:00') - new Date()) / (1000 * 60 * 60 * 24))
              return (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                  <span>#{c.numero} · {c.cliente_nombre || '—'}</span>
                  <span>
                    <strong style={{ color: dias <= 3 ? '#ff8b8b' : dias <= 7 ? '#ffd17a' : 'var(--text)' }}>
                      en {dias}d
                    </strong>
                    <span style={{ marginLeft: 8, color: 'var(--gold)', fontWeight: 700 }}>{fmtArs(c.monto)}</span>
                  </span>
                </div>
              )
            })
          )}
        </div>

        <div className="card">
          <div className="card-title">💳 Clientes con deuda alta</div>
          {data.clientesDeudores.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin clientes con deuda mayor a $100k.</p>
          ) : (
            data.clientesDeudores.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                <span>{c.nombre}</span>
                <strong style={{ color: '#ff8b8b' }}>{fmtArs(c.saldo)}</strong>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function KPI({ label, valor, sub, color }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 36, color: color || 'var(--gold)', lineHeight: 1.1 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
