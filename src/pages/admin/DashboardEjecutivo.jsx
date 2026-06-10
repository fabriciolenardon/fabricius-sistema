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
import { fechaHoyARG, fechaRelativaARG } from '../../lib/fechas'
import { fmtKg } from '../../lib/formatos'
import {
  useReportesData, SelectorPeriodo,
  ReporteMargen, ReporteCliente, ReporteProducto, ReporteCanal, ReporteTemporal,
  ReporteCajas, ReporteFlujo, ReporteGastos, ReporteInteranual,
} from './Reportes'

const SUB_TABS = [
  { id: 'resumen',    icon: '📊', label: 'Resumen' },
  { id: 'flujo',      icon: '💵', label: 'Flujo Caja' },
  { id: 'margen',     icon: '💰', label: 'Margen' },
  { id: 'cliente',    icon: '👥', label: 'Por Cliente' },
  { id: 'producto',   icon: '🥩', label: 'Por Producto' },
  { id: 'canal',      icon: '⚖️', label: 'Min vs May' },
  { id: 'cajas',      icon: '📦', label: 'Cajas' },
  { id: 'gastos',     icon: '💸', label: 'Gastos' },
  { id: 'interanual', icon: '📅', label: 'vs Año pasado' },
  { id: 'temporal',   icon: '🕐', label: 'Temporal' },
]

const TOPE_K = 108357084.05 // tope monotributo cat K 2026

// Antes estas helpers usaban toISOString() (UTC). A partir de las 21hs ARG
// devolvían la fecha del día siguiente → KPIs y comparativas mostraban mal.
// Ahora todo pasa por fechaHoyARG / fechaRelativaARG (zona Córdoba).
const hoyISO = () => fechaHoyARG()
const fechaHaceDias = (n) => fechaRelativaARG(-n)
const inicioMes = () => {
  // Primer día del mes actual en ARG: tomamos hoy_ARG y reemplazamos día por '01'
  return fechaHoyARG().slice(0, 8) + '01'
}
const inicioMesAnterior = () => {
  // Mes anterior: si hoy es YYYY-MM, mes anterior es YYYY-(MM-1) con manejo de enero
  const hoy = fechaHoyARG()
  const y = Number(hoy.slice(0, 4))
  const m = Number(hoy.slice(5, 7))
  const yPrev = m === 1 ? y - 1 : y
  const mPrev = m === 1 ? 12 : m - 1
  return `${yPrev}-${String(mPrev).padStart(2, '0')}-01`
}
const finMesAnterior = () => {
  // Último día del mes anterior = día 0 del mes actual. Calculamos en ARG
  // tomando inicio del mes actual y restando 1 día con fechaRelativaARG.
  const inicio = new Date(inicioMes() + 'T12:00:00') // 12:00 evita salto de día por TZ
  inicio.setDate(inicio.getDate() - 1)
  return fechaHoyARG(inicio)
}

export default function DashboardEjecutivo() {
  const [subTab, setSubTab] = useState('resumen')
  return (
    <div>
      <div className="page-title">⚡ DASHBOARD EJECUTIVO</div>
      <div className="page-sub">
        {subTab === 'resumen'
          ? 'Resumen panorámico del negocio · Una pantalla, toda la info'
          : 'Reportes avanzados · Solo visible para vos'}
      </div>

      {/* Sub-tabs CEO: Resumen + 5 reportes */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 14, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            style={{
              padding: '10px 16px', border: 'none', background: 'transparent',
              color: subTab === t.id ? 'var(--gold)' : 'var(--muted)',
              borderBottom: subTab === t.id ? '2px solid var(--gold)' : '2px solid transparent',
              cursor: 'pointer', fontWeight: 700, fontSize: 13,
              fontFamily: "'DM Sans',sans-serif", marginBottom: -1,
            }}>
            <span style={{ marginRight: 6 }}>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {subTab === 'resumen' ? <ResumenEjecutivo /> : <ReportePanel tab={subTab} />}
    </div>
  )
}

function ReportePanel({ tab }) {
  const [periodo, setPeriodo] = useState('30d')

  // Cajas: carga su propio snapshot de cajas_stock (no usa hook común).
  // El periodo solo afecta la sección de ventas de cajas dentro.
  if (tab === 'cajas') {
    return (
      <>
        <SelectorPeriodo periodo={periodo} setPeriodo={setPeriodo} data={null} />
        <ReporteCajas periodo={periodo} />
      </>
    )
  }

  // Interanual: carga su propia data (24 meses). No usa periodo ni hook común.
  if (tab === 'interanual') {
    return <ReporteInteranual />
  }

  return <ReportePanelData tab={tab} periodo={periodo} setPeriodo={setPeriodo} />
}

function ReportePanelData({ tab, periodo, setPeriodo }) {
  const { loading, data } = useReportesData(periodo)
  return (
    <>
      <SelectorPeriodo periodo={periodo} setPeriodo={setPeriodo} data={data} />
      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Cargando reporte...</p>
      ) : data ? (
        <>
          {tab === 'margen'   && <ReporteMargen data={data} />}
          {tab === 'cliente'  && <ReporteCliente data={data} />}
          {tab === 'producto' && <ReporteProducto data={data} />}
          {tab === 'canal'    && <ReporteCanal data={data} />}
          {tab === 'flujo'    && <ReporteFlujo data={data} />}
          {tab === 'gastos'   && <ReporteGastos data={data} />}
          {tab === 'temporal' && <ReporteTemporal data={data} />}
        </>
      ) : null}
    </>
  )
}

function ResumenEjecutivo() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [whatsappDestino, setWhatsappDestino] = useState(() => localStorage.getItem('reporte_whatsapp') || '')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const hoy = hoyISO()
    const ayer = fechaHaceDias(1)
    const hace7 = fechaHaceDias(6)
    const mesIni = inicioMes()
    const mesAntIni = inicioMesAnterior()
    const mesAntFin = finMesAnterior()
    // Mismo período del año pasado (1° del mes actual del año pasado → hoy del año pasado)
    const hoyDt = new Date(hoy + 'T12:00')
    const anioPasadoMesIni = `${hoyDt.getFullYear() - 1}-${String(hoyDt.getMonth() + 1).padStart(2, '0')}-01`
    const anioPasadoHoy    = `${hoyDt.getFullYear() - 1}-${String(hoyDt.getMonth() + 1).padStart(2, '0')}-${String(hoyDt.getDate()).padStart(2, '0')}`

    const [ventasHoy, ventasAyer, ventasSemana, ventasMes, ventasMesAnt, ventasAnioPasado,
           salidasMes, pedidosMes, cuentas, facturas12m, stock, cheques, clientes,
           gastosMes, sueldosMes, pagosProvMes, movCtacteMes, todasCajas, todosDeudores] = await Promise.all([
      supabase.from('ventas_minoristas').select('total, efectivo, debito, transferencia, items, fecha').eq('origen', 'caja').eq('fecha', hoy),
      supabase.from('ventas_minoristas').select('total').eq('origen', 'caja').eq('fecha', ayer),
      supabase.from('ventas_minoristas').select('total, fecha').eq('origen', 'caja').gte('fecha', hace7).lte('fecha', hoy),
      supabase.from('ventas_minoristas').select('total').eq('origen', 'caja').gte('fecha', mesIni).lte('fecha', hoy),
      supabase.from('ventas_minoristas').select('total').eq('origen', 'caja').gte('fecha', mesAntIni).lte('fecha', mesAntFin),
      supabase.from('ventas_minoristas').select('total').eq('origen', 'caja').gte('fecha', anioPasadoMesIni).lte('fecha', anioPasadoHoy),
      // Mayorista del mes (con filtro de flujos internos)
      supabase.from('salidas_deposito').select('total, cobro').gte('fecha', mesIni).lte('fecha', hoy),
      supabase.from('pedidos').select('total_estimado').eq('estado', 'confirmado').gte('dia_entrega', mesIni).lte('dia_entrega', hoy),
      supabase.from('cuentas_fiscales').select('*').eq('activa', true).then(r => r).catch(() => ({ data: null })),
      supabase.from('facturas').select('cuenta_id, monto_total, fecha').eq('tipo', 'emitida').gte('fecha', fechaHaceDias(365)).then(r => r).catch(() => ({ data: null })),
      supabase.from('stock_actual').select('*'),
      supabase.from('cheques').select('*').gte('fecha_pago', hoy).lte('fecha_pago', fechaHaceDias(-15)),
      supabase.from('clientes').select('nombre, saldo').gt('saldo', 100000).order('saldo', { ascending: false }).limit(5),
      // Egresos del mes
      // solo_balance: facturas a nombre de la SAS que paga un tercero — no son gasto nuestro
      supabase.from('gastos').select('tipo, monto, fecha, solo_balance').gte('fecha', mesIni).lte('fecha', hoy),
      supabase.from('liquidaciones_sueldos').select('neto, semana_fin').gte('semana_inicio', mesIni).lte('semana_fin', hoy),
      supabase.from('pagos_proveedores').select('importe, percepcion, fecha').gte('fecha', mesIni).lte('fecha', hoy),
      // Cobranzas en cta cte
      supabase.from('movimientos_ctacte').select('tipo, haber, fecha').gte('fecha', mesIni).lte('fecha', hoy),
      // Cajas para alerta de envejecidas
      supabase.from('cajas_stock').select('id, tipo_caja, kg, fecha_ingreso').eq('estado', 'disponible'),
      // Total de saldo pendiente todos los clientes (no solo top 5)
      supabase.from('clientes').select('saldo').gt('saldo', 0),
    ])

    const totalHoy  = (ventasHoy.data || []).reduce((s, v) => s + (Number(v.total) || 0), 0)
    const totalAyer = (ventasAyer.data || []).reduce((s, v) => s + (Number(v.total) || 0), 0)
    const variacionHoyVsAyer = totalAyer > 0 ? ((totalHoy - totalAyer) / totalAyer) * 100 : null
    const cantHoy  = (ventasHoy.data || []).length
    const totalSemana = (ventasSemana.data || []).reduce((s, v) => s + (Number(v.total) || 0), 0)
    const totalCajaMes = (ventasMes.data || []).reduce((s, v) => s + (Number(v.total) || 0), 0)
    const totalMesAnt  = (ventasMesAnt.data || []).reduce((s, v) => s + (Number(v.total) || 0), 0)
    const totalAnioPasado = (ventasAnioPasado.data || []).reduce((s, v) => s + (Number(v.total) || 0), 0)
    const variacion   = totalMesAnt > 0 ? ((totalCajaMes - totalMesAnt) / totalMesAnt) * 100 : 0
    const variacionAnioPasado = totalAnioPasado > 0
      ? ((totalCajaMes - totalAnioPasado) / totalAnioPasado) * 100 : null
    const ticketProm  = cantHoy > 0 ? totalHoy / cantHoy : 0

    // ── FACTURADO TOTAL DEL MES (caja + mayorista sin flujos internos) ──
    const salidasMesData = (salidasMes.data || []).filter(s => s.cobro !== 'interno')
    const totalSalidasMes = salidasMesData.reduce((s, x) => s + (Number(x.total) || 0), 0)
    const totalPedidosMes = (pedidosMes.data || []).reduce((s, p) => s + (Number(p.total_estimado) || 0), 0)
    const facturadoMes = totalCajaMes + totalSalidasMes + totalPedidosMes

    // ── INGRESOS REALES DEL MES (cobranzas, no facturación) ──
    const ingresoCaja  = (ventasHoy.data || []).concat(ventasMes.data || []).reduce(() => 0, 0)
    const ingresoCajaMes = (ventasMes.data || []).reduce((s, v) => s + (Number(v.total) || 0), 0)
    const cobranzasCtacte = (movCtacteMes.data || [])
      .filter(m => m.tipo === 'pago' || m.tipo === 'cheque')
      .reduce((s, m) => s + (Number(m.haber) || 0), 0)
    const ingresoExtras = (gastosMes.data || []).filter(g => g.tipo === 'ingreso')
      .reduce((s, g) => s + (Number(g.monto) || 0), 0)
    const ingresosTotalesMes = ingresoCajaMes + cobranzasCtacte + ingresoExtras
    const pctCobrado = facturadoMes > 0 ? (ingresosTotalesMes / facturadoMes) * 100 : 0

    // ── EGRESOS DEL MES ── (excluye "solo balance": los paga un tercero)
    const gastosReales    = (gastosMes.data || []).filter(g => !g.solo_balance)
    const gastosFijos     = gastosReales.filter(g => g.tipo === 'fijo').reduce((s, g) => s + (Number(g.monto) || 0), 0)
    const gastosVariables = gastosReales.filter(g => g.tipo === 'variable').reduce((s, g) => s + (Number(g.monto) || 0), 0)
    const gastosSocios    = gastosReales.filter(g => g.tipo === 'socio').reduce((s, g) => s + (Number(g.monto) || 0), 0)
    const sueldosTotalMes = (sueldosMes.data || []).reduce((s, l) => s + (Number(l.neto) || 0), 0)
    const pagosProvTotal  = (pagosProvMes.data || []).reduce((s, p) =>
      s + (Number(p.importe) || 0) + (Number(p.percepcion) || 0), 0)
    const egresosTotalesMes = gastosFijos + gastosVariables + gastosSocios + sueldosTotalMes + pagosProvTotal
    const saldoNetoMes = ingresosTotalesMes - egresosTotalesMes
    const pctSueldosFact = facturadoMes > 0 ? (sueldosTotalMes / facturadoMes) * 100 : 0

    // ── CAJAS DISPONIBLES (count + envejecidas) ──
    const cajasDisp = todasCajas.data || []
    const hoyDate = new Date(hoy + 'T12:00')
    const cajasViejas = cajasDisp.filter(c => {
      if (!c.fecha_ingreso) return false
      const dias = Math.floor((hoyDate - new Date(c.fecha_ingreso + 'T12:00')) / (1000 * 60 * 60 * 24))
      return dias > 15
    })
    const cajasInfo = {
      total: cajasDisp.length,
      kg: cajasDisp.reduce((s, c) => s + Number(c.kg || 0), 0),
      viejasCount: cajasViejas.length,
    }

    // ── SALDO PENDIENTE TOTAL CLIENTES ──
    const saldoPendienteTotal = (todosDeudores.data || []).reduce((s, c) => s + (Number(c.saldo) || 0), 0)

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
      // KPIs históricos (Resumen original)
      totalHoy, cantHoy, ticketProm, totalSemana,
      totalMes: totalCajaMes,   // legacy: el card "Este mes" sigue mostrando solo caja
      totalMesAnt, variacion,
      topProductosHoy, cuentasConPct, stockCritico,
      // Solo recibidos: los emitidos propios son plata que SALE, no que entra
      cheques: (cheques.data || []).filter(c => c.origen !== 'emitido'),
      clientesDeudores: clientes.data || [],
      // NUEVO: Panel de Control
      panelControl: {
        totalAyer, variacionHoyVsAyer,
        facturadoMes,            // caja + mayorista + pedidos
        ingresosTotalesMes,      // cobranzas reales
        egresosTotalesMes,
        saldoNetoMes,
        pctCobrado,
        pctSueldosFact,
        totalAnioPasado, variacionAnioPasado,
        cajasInfo,
        saldoPendienteTotal,
      },
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
        msg += `${i + 1}. ${p.nombre} · ${fmtKg(p.kg)} · ${fmtArs(p.importe)}\n`
      })
      msg += `\n`
    }

    if (data.stockCritico.length > 0) {
      msg += `*⚠️ Stock bajo:*\n`
      data.stockCritico.forEach(s => {
        msg += `· ${s.label}: ${fmtKg(s.kg)} (mínimo ${s.minimo})\n`
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

  if (loading) return <p style={{ color: 'var(--muted)' }}>Cargando resumen...</p>
  if (!data) return null

  return (
    <>
      <PanelControl data={data} />
      <CentroAlertas data={data} />

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
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted)' }}>{fmtKg(p.kg)}</td>
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
                <strong style={{ color: '#ff8b8b' }}>{fmtKg(s.kg)} <span style={{ color: 'var(--muted)', fontSize: 10 }}>(mín {s.minimo})</span></strong>
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
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
// 🎯 PANEL DE CONTROL — los 6 KPIs que tenés que mirar todos los días
// ═══════════════════════════════════════════════════════════════
function PanelControl({ data }) {
  const pc = data.panelControl
  const flecha = (v) => v == null ? '' : v >= 0 ? '↗' : '↘'
  const signo  = (v) => v == null ? '' : v >= 0 ? '+' : ''
  const color  = (v) => v == null ? 'var(--muted)' : v >= 0 ? '#7dff7d' : '#ff8b8b'
  const colorPctSueldos = (pct) =>
    pct > 60 ? '#ff8b8b' : pct > 40 ? '#ffd17a' : '#7dff7d'
  const colorPctCobro = (pct) =>
    pct < 50 ? '#ff8b8b' : pct < 75 ? '#ffd17a' : '#7dff7d'

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1a1408 0%, #0a0a08 100%)',
      border: '1px solid var(--gold)',
      borderRadius: 14, padding: 18, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 18 }}>🎯</span>
        <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--gold)', letterSpacing: 2 }}>
          PANEL DE CONTROL
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)' }}>
          Los KPIs críticos del negocio en una mirada
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        {/* 1) Facturado HOY con vs ayer */}
        <KPICompacto
          label="💵 FACTURADO HOY"
          valor={fmtArs(data.totalHoy)}
          sub={pc.variacionHoyVsAyer != null
            ? `${flecha(pc.variacionHoyVsAyer)} ${signo(pc.variacionHoyVsAyer)}${pc.variacionHoyVsAyer.toFixed(0)}% vs ayer (${fmtArs(pc.totalAyer)})`
            : `${data.cantHoy} ventas · sin datos ayer`}
          color={color(pc.variacionHoyVsAyer)} />

        {/* 2) Saldo neto del mes (Ingresos − Egresos) */}
        <KPICompacto
          label={pc.saldoNetoMes >= 0 ? '✅ SALDO NETO MES' : '⚠️ SALDO NETO MES'}
          valor={fmtArs(pc.saldoNetoMes)}
          sub={`Ing ${fmtArs(pc.ingresosTotalesMes)} − Egr ${fmtArs(pc.egresosTotalesMes)}`}
          color={pc.saldoNetoMes >= 0 ? '#7dff7d' : '#ff8b8b'} />

        {/* 3) % cobrado del mes */}
        <KPICompacto
          label="💳 % COBRADO MES"
          valor={`${pc.pctCobrado.toFixed(0)}%`}
          sub={`De ${fmtArs(pc.facturadoMes)} facturado`}
          color={colorPctCobro(pc.pctCobrado)} />

        {/* 4) Saldo pendiente clientes */}
        <KPICompacto
          label="💼 PEND. COBRAR"
          valor={fmtArs(pc.saldoPendienteTotal)}
          sub="Total cuenta corriente clientes"
          color={pc.saldoPendienteTotal > 500000 ? '#ffd17a' : 'var(--text)'} />

        {/* 5) vs Año pasado */}
        <KPICompacto
          label={`📅 VS ${new Date().getFullYear() - 1}`}
          valor={pc.variacionAnioPasado != null
            ? `${signo(pc.variacionAnioPasado)}${pc.variacionAnioPasado.toFixed(0)}%`
            : '—'}
          sub={pc.totalAnioPasado > 0
            ? `vs ${fmtArs(pc.totalAnioPasado)} mismo período`
            : 'Sin datos del año pasado'}
          color={color(pc.variacionAnioPasado)} />

        {/* 6) Cajas + alerta envejecidas */}
        <KPICompacto
          label="📦 CAJAS DISP."
          valor={pc.cajasInfo.total}
          sub={pc.cajasInfo.viejasCount > 0
            ? `⚠️ ${pc.cajasInfo.viejasCount} con >15 días · ${fmtKg(pc.cajasInfo.kg)}`
            : `${fmtKg(pc.cajasInfo.kg)} · todas frescas`}
          color={pc.cajasInfo.viejasCount > 0 ? '#ffd17a' : '#7db5ff'} />

        {/* 7) % sueldos sobre facturación */}
        <KPICompacto
          label="👥 % SUELDOS"
          valor={`${pc.pctSueldosFact.toFixed(1)}%`}
          sub="Sobre facturación del mes"
          color={colorPctSueldos(pc.pctSueldosFact)} />

        {/* 8) Mes vs mes anterior (legacy del Resumen viejo, en chico) */}
        <KPICompacto
          label="📊 VS MES ANT."
          valor={data.totalMesAnt > 0
            ? `${data.variacion >= 0 ? '+' : ''}${data.variacion.toFixed(0)}%`
            : '—'}
          sub={data.totalMesAnt > 0
            ? `vs ${fmtArs(data.totalMesAnt)}`
            : 'Sin datos mes anterior'}
          color={color(data.variacion)} />
      </div>
    </div>
  )
}

// KPI compacto para el panel de control (más chico que el KPI normal)
function KPICompacto({ label, valor, sub, color }) {
  return (
    <div style={{ background: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 8, border: '1px solid rgba(255,209,122,0.15)' }}>
      <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: 1, marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 26, color: color || 'var(--gold)', lineHeight: 1.05 }}>{valor}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, lineHeight: 1.3 }}>{sub}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 🚨 CENTRO DE ALERTAS — todo lo que necesita tu atención, junto
// ═══════════════════════════════════════════════════════════════
function CentroAlertas({ data }) {
  const alertas = []

  // Stock crítico
  if (data.stockCritico.length > 0) {
    data.stockCritico.forEach(s => alertas.push({
      tipo: 'danger', icono: '📦',
      titulo: `Stock bajo: ${s.label}`,
      detalle: `Solo ${fmtKg(s.kg)} (mínimo ${s.minimo}) — pedí mercadería`,
    }))
  }

  // Cheques próximos (próximos 7 días)
  const cheques7d = (data.cheques || []).filter(ch => {
    if (!ch.fecha_pago) return false
    const dias = Math.ceil((new Date(ch.fecha_pago + 'T12:00') - new Date()) / (1000 * 60 * 60 * 24))
    return dias <= 7 && dias >= 0
  })
  cheques7d.forEach(ch => {
    const dias = Math.ceil((new Date(ch.fecha_pago + 'T12:00') - new Date()) / (1000 * 60 * 60 * 24))
    alertas.push({
      tipo: dias <= 2 ? 'danger' : 'warning', icono: '📄',
      titulo: `Cheque #${ch.numero} en ${dias}d`,
      detalle: `${ch.cliente_nombre || 'sin cliente'} · ${fmtArs(ch.monto)}`,
    })
  })

  // Clientes con deuda alta (>100k)
  data.clientesDeudores.slice(0, 3).forEach(c => {
    alertas.push({
      tipo: Number(c.saldo) > 500000 ? 'danger' : 'warning', icono: '💳',
      titulo: `${c.nombre} debe ${fmtArs(c.saldo)}`,
      detalle: 'Cobrar cuanto antes',
    })
  })

  // Monos al borde del tope
  data.cuentasConPct.filter(c => c.pctConsumo >= 85).forEach(c => {
    alertas.push({
      tipo: c.pctConsumo >= 95 ? 'danger' : 'warning', icono: '📑',
      titulo: `${c.nombre} al ${c.pctConsumo.toFixed(0)}% del tope mono`,
      detalle: c.pctConsumo >= 95 ? 'RIESGO de exclusión' : 'Atento al cierre del año móvil',
    })
  })

  // Cajas envejecidas
  if (data.panelControl.cajasInfo.viejasCount > 0) {
    alertas.push({
      tipo: 'warning', icono: '📦',
      titulo: `${data.panelControl.cajasInfo.viejasCount} cajas con >15 días en stock`,
      detalle: 'Priorizá su venta — ver tab Cajas para detalle',
    })
  }

  // Saldo neto negativo
  if (data.panelControl.saldoNetoMes < 0) {
    alertas.push({
      tipo: 'danger', icono: '⚠️',
      titulo: 'Saldo neto del mes NEGATIVO',
      detalle: `Egresos superan ingresos por ${fmtArs(Math.abs(data.panelControl.saldoNetoMes))}`,
    })
  }

  // % sueldos alto
  if (data.panelControl.pctSueldosFact > 60) {
    alertas.push({
      tipo: 'warning', icono: '👥',
      titulo: `Sueldos al ${data.panelControl.pctSueldosFact.toFixed(0)}% de la facturación`,
      detalle: 'Ratio elevado — revisar planta de personal o impulsar ventas',
    })
  }

  const colores = { danger: '#ff8b8b', warning: '#ffd17a', info: '#7db5ff' }
  const dangerCount  = alertas.filter(a => a.tipo === 'danger').length
  const warningCount = alertas.filter(a => a.tipo === 'warning').length

  return (
    <div className="card" style={{ marginBottom: 16, borderLeft: `3px solid ${alertas.length > 0 ? (dangerCount > 0 ? '#ff8b8b' : '#ffd17a') : '#7dff7d'}` }}>
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        🚨 Centro de alertas
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, fontSize: 11 }}>
          {dangerCount > 0 && (
            <span style={{ background: '#3a1a1a', color: '#ff8b8b', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
              {dangerCount} críticas
            </span>
          )}
          {warningCount > 0 && (
            <span style={{ background: '#2a2010', color: '#ffd17a', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
              {warningCount} avisos
            </span>
          )}
          {alertas.length === 0 && (
            <span style={{ background: '#0a2a0a', color: '#7dff7d', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
              ✅ Todo en orden
            </span>
          )}
        </span>
      </div>
      {alertas.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, padding: '8px 0' }}>
          🎉 No hay alertas activas. El negocio está marchando bien.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {alertas
            .sort((a, b) => (a.tipo === 'danger' ? 0 : 1) - (b.tipo === 'danger' ? 0 : 1))
            .map((a, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '8px 10px', borderRadius: 6,
                background: a.tipo === 'danger' ? 'rgba(255, 139, 139, 0.08)' : 'rgba(255, 209, 122, 0.06)',
                borderLeft: `3px solid ${colores[a.tipo]}`,
              }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{a.icono}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: colores[a.tipo] }}>{a.titulo}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{a.detalle}</div>
                </div>
              </div>
            ))}
        </div>
      )}
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
