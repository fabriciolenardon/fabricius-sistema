// ============================================================
// DASHBOARD EJECUTIVO — Panel del dueño
// ============================================================
// Diseño minimalista/futurista. Dos modos:
//   - Pantalla normal: KPIs + alertas + reportes avanzados
//   - 📺 MODO TV: fullscreen para proyectar en una tele y ver
//     el negocio EN VIVO (realtime de Supabase + reloj + refresh)
//
// La pestaña "Por Producto" se eliminó a pedido del dueño
// (estadísticas confusas y poco validadas). El resto de los
// reportes avanzados siguen disponibles.
// ============================================================
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { enviarWhatsapp, fmtArs } from '../../lib/whatsapp'
import { fechaHoyARG, fechaRelativaARG } from '../../lib/fechas'
import { fmtKg } from '../../lib/formatos'
import {
  useReportesData, SelectorPeriodo,
  ReporteMargen, ReporteCliente, ReporteCanal, ReporteTemporal,
  ReporteCajas, ReporteFlujo, ReporteGastos, ReporteInteranual,
} from './Reportes'

const SUB_TABS = [
  { id: 'resumen',    icon: '◈', label: 'Resumen' },
  { id: 'flujo',      icon: '💵', label: 'Flujo Caja' },
  { id: 'margen',     icon: '💰', label: 'Margen' },
  { id: 'cliente',    icon: '👥', label: 'Por Cliente' },
  { id: 'canal',      icon: '⚖️', label: 'Min vs May' },
  { id: 'cajas',      icon: '📦', label: 'Cajas' },
  { id: 'gastos',     icon: '💸', label: 'Gastos' },
  { id: 'interanual', icon: '📅', label: 'vs Año pasado' },
  { id: 'temporal',   icon: '🕐', label: 'Temporal' },
]

const TOPE_K = 108357084.05 // tope monotributo cat K 2026
const TZ_ARG = 'America/Argentina/Buenos_Aires'

// Helpers de fecha — siempre hora ARG, nunca UTC (ver lib/fechas.js)
const hoyISO = () => fechaHoyARG()
const fechaHaceDias = (n) => fechaRelativaARG(-n)
const inicioMes = () => fechaHoyARG().slice(0, 8) + '01'
const inicioMesAnterior = () => {
  const hoy = fechaHoyARG()
  const y = Number(hoy.slice(0, 4))
  const m = Number(hoy.slice(5, 7))
  const yPrev = m === 1 ? y - 1 : y
  const mPrev = m === 1 ? 12 : m - 1
  return `${yPrev}-${String(mPrev).padStart(2, '0')}-01`
}
const finMesAnterior = () => {
  const inicio = new Date(inicioMes() + 'T12:00:00')
  inicio.setDate(inicio.getDate() - 1)
  return fechaHoyARG(inicio)
}

// ── Estética compartida ─────────────────────────────────────
const NEON = {
  oro:    '#ffd17a',
  verde:  '#5dffa0',
  rojo:   '#ff6b81',
  cian:   '#6be5ff',
  azul:   '#7a9dff',
  ambar:  '#ffb86b',
  texto:  '#e8e6e0',
  muted:  'rgba(232,230,224,0.45)',
}
const glass = {
  background: 'linear-gradient(160deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.015) 100%)',
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 16,
  backdropFilter: 'blur(14px)',
}

// Animaciones globales del dashboard (pulso EN VIVO, glow, entrada suave)
const ESTILOS_GLOBALES = `
@keyframes dejPulso { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.8); } }
@keyframes dejGlow  { 0%,100% { text-shadow: 0 0 18px rgba(255,209,122,0.35); } 50% { text-shadow: 0 0 34px rgba(255,209,122,0.6); } }
@keyframes dejIn    { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.dej-in { animation: dejIn .5s ease both; }
`

// ════════════════════════════════════════════════════════════
// Hook de datos compartido (Resumen + Modo TV)
// ────────────────────────────────────────────────────────────
// - Carga el snapshot completo del negocio
// - Se refresca solo cada `refreshMs`
// - Realtime: cada venta nueva en la caja dispara una recarga
//   (debounce 1.5s) → la tele se actualiza EN VIVO
// ════════════════════════════════════════════════════════════
function useDashboardData(refreshMs = 120000) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [ultimaAct, setUltimaAct] = useState(null)
  const cargandoRef = useRef(false)

  const cargar = useCallback(async () => {
    if (cargandoRef.current) return
    cargandoRef.current = true
    const hoy = hoyISO()
    const ayer = fechaHaceDias(1)
    const hace7 = fechaHaceDias(6)
    const mesIni = inicioMes()
    const mesAntIni = inicioMesAnterior()
    const mesAntFin = finMesAnterior()
    const hoyDt = new Date(hoy + 'T12:00')
    const anioPasadoMesIni = `${hoyDt.getFullYear() - 1}-${String(hoyDt.getMonth() + 1).padStart(2, '0')}-01`
    const anioPasadoHoy    = `${hoyDt.getFullYear() - 1}-${String(hoyDt.getMonth() + 1).padStart(2, '0')}-${String(hoyDt.getDate()).padStart(2, '0')}`

    const [ventasHoy, ventasAyer, ventasSemana, ventasMes, ventasMesAnt, ventasAnioPasado,
           salidasMes, pedidosMes, cuentas, facturas12m, stock, cheques, clientes,
           gastosMes, sueldosMes, pagosProvMes, movCtacteMes, todasCajas, todosDeudores, promoCfg] = await Promise.all([
      supabase.from('ventas_minoristas').select('total, efectivo, debito, transferencia, items, fecha, hora').eq('origen', 'caja').eq('fecha', hoy),
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
      // solo_balance: facturas a nombre de la SAS que paga un tercero — no son gasto nuestro
      supabase.from('gastos').select('tipo, monto, fecha, solo_balance').gte('fecha', mesIni).lte('fecha', hoy),
      supabase.from('liquidaciones_sueldos').select('neto, semana_fin').gte('semana_inicio', mesIni).lte('semana_fin', hoy),
      supabase.from('pagos_proveedores').select('importe, percepcion, fecha').gte('fecha', mesIni).lte('fecha', hoy),
      supabase.from('movimientos_ctacte').select('tipo, haber, fecha').gte('fecha', mesIni).lte('fecha', hoy),
      supabase.from('cajas_stock').select('id, tipo_caja, kg, fecha_ingreso').eq('estado', 'disponible'),
      supabase.from('clientes').select('saldo').gt('saldo', 0),
      supabase.from('config_sistema').select('valor').eq('clave', 'promo_mundial').maybeSingle(),
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

    // Última venta del día (para el "latido" del modo TV)
    const ultimaVentaHora = (ventasHoy.data || [])
      .map(v => v.hora).filter(Boolean).sort().slice(-1)[0] || null

    // ── FACTURADO TOTAL DEL MES (caja + mayorista sin flujos internos) ──
    const salidasMesData = (salidasMes.data || []).filter(s => s.cobro !== 'interno')
    const totalSalidasMes = salidasMesData.reduce((s, x) => s + (Number(x.total) || 0), 0)
    const totalPedidosMes = (pedidosMes.data || []).reduce((s, p) => s + (Number(p.total_estimado) || 0), 0)
    const facturadoMes = totalCajaMes + totalSalidasMes + totalPedidosMes

    // ── INGRESOS REALES DEL MES (cobranzas, no facturación) ──
    const ingresoCajaMes = totalCajaMes
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
      totalHoy, cantHoy, ticketProm, totalSemana,
      totalMes: totalCajaMes,
      totalMesAnt, variacion,
      topProductosHoy, cuentasConPct, stockCritico,
      ultimaVentaHora,
      promoMundial: promoCfg?.data?.valor || { activa: false },
      // Solo recibidos: los emitidos propios son plata que SALE, no que entra
      cheques: (cheques.data || []).filter(c => c.origen !== 'emitido'),
      clientesDeudores: clientes.data || [],
      panelControl: {
        totalAyer, variacionHoyVsAyer,
        facturadoMes,
        ingresosTotalesMes,
        egresosTotalesMes,
        saldoNetoMes,
        pctCobrado,
        pctSueldosFact,
        totalAnioPasado, variacionAnioPasado,
        cajasInfo,
        saldoPendienteTotal,
      },
    })
    setUltimaAct(new Date())
    setLoading(false)
    cargandoRef.current = false
  }, [])

  useEffect(() => {
    cargar()
    // Refresh periódico (la tele queda prendida horas)
    const intervalo = setInterval(cargar, refreshMs)
    // Realtime: una venta nueva en caja → recarga con debounce.
    // También escucha config_sistema (promo mundial on/off en vivo).
    let timer = null
    const debounced = () => { clearTimeout(timer); timer = setTimeout(cargar, 1500) }
    const canal = supabase.channel('dashboard-ejecutivo-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ventas_minoristas' }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'config_sistema' }, debounced)
      .subscribe()
    return () => {
      clearInterval(intervalo)
      clearTimeout(timer)
      supabase.removeChannel(canal)
    }
  }, [cargar, refreshMs])

  return { data, loading, ultimaAct, recargar: cargar }
}

// Reloj vivo (hora ARG, tick por segundo)
function useRelojARG() {
  const [ahora, setAhora] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return {
    hora: ahora.toLocaleTimeString('es-AR', { timeZone: TZ_ARG, hour: '2-digit', minute: '2-digit' }),
    segundos: ahora.toLocaleTimeString('es-AR', { timeZone: TZ_ARG, second: '2-digit' }),
    fecha: ahora.toLocaleDateString('es-AR', { timeZone: TZ_ARG, weekday: 'long', day: 'numeric', month: 'long' }),
  }
}

// ════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════
export default function DashboardEjecutivo() {
  const [subTab, setSubTab] = useState('resumen')
  const [modoTV, setModoTV] = useState(false)

  function entrarModoTV() {
    setModoTV(true)
    // Fullscreen real si el navegador lo permite (gesto del usuario)
    document.documentElement.requestFullscreen?.().catch(() => {})
  }
  function salirModoTV() {
    setModoTV(false)
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }

  if (modoTV) return <ModoTV onSalir={salirModoTV} />

  return (
    <div>
      <style>{ESTILOS_GLOBALES}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="page-title">⚡ DASHBOARD EJECUTIVO</div>
          <div className="page-sub">
            {subTab === 'resumen'
              ? 'El negocio en una mirada · Datos en vivo'
              : 'Reportes avanzados · Solo visible para vos'}
          </div>
        </div>
        <button onClick={entrarModoTV}
          style={{
            padding: '12px 22px', borderRadius: 12, cursor: 'pointer',
            background: 'linear-gradient(135deg, rgba(255,209,122,0.16), rgba(255,209,122,0.05))',
            border: '1px solid rgba(255,209,122,0.45)', color: NEON.oro,
            fontWeight: 800, fontSize: 13, letterSpacing: 1.5,
            fontFamily: "'DM Sans',sans-serif",
            boxShadow: '0 0 24px rgba(255,209,122,0.12)',
          }}>
          📺 MODO TV — EN VIVO
        </button>
      </div>

      {/* Sub-tabs minimalistas */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 16, marginBottom: 18 }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            style={{
              padding: '8px 16px', borderRadius: 999, cursor: 'pointer',
              border: subTab === t.id ? '1px solid rgba(255,209,122,0.5)' : '1px solid rgba(255,255,255,0.08)',
              background: subTab === t.id ? 'rgba(255,209,122,0.12)' : 'rgba(255,255,255,0.02)',
              color: subTab === t.id ? NEON.oro : NEON.muted,
              fontWeight: 700, fontSize: 12, letterSpacing: 0.5,
              fontFamily: "'DM Sans',sans-serif", transition: 'all .2s',
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

  if (tab === 'cajas') {
    return (
      <>
        <SelectorPeriodo periodo={periodo} setPeriodo={setPeriodo} data={null} />
        <ReporteCajas periodo={periodo} />
      </>
    )
  }
  if (tab === 'interanual') return <ReporteInteranual />
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
          {tab === 'canal'    && <ReporteCanal data={data} />}
          {tab === 'flujo'    && <ReporteFlujo data={data} />}
          {tab === 'gastos'   && <ReporteGastos data={data} />}
          {tab === 'temporal' && <ReporteTemporal data={data} />}
        </>
      ) : null}
    </>
  )
}

// ════════════════════════════════════════════════════════════
// RESUMEN EJECUTIVO (pantalla normal, rediseñada)
// ════════════════════════════════════════════════════════════
function ResumenEjecutivo() {
  const { data, loading, ultimaAct } = useDashboardData(120000)
  const [whatsappDestino, setWhatsappDestino] = useState(() => localStorage.getItem('reporte_whatsapp') || '')

  function guardarNumeroWhatsapp(n) {
    setWhatsappDestino(n)
    localStorage.setItem('reporte_whatsapp', n)
  }

  function enviarReporteWhatsapp() {
    if (!data) return
    const fechaTxt = new Date().toLocaleDateString('es-AR', { timeZone: TZ_ARG, weekday: 'long', day: 'numeric', month: 'long' })
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
      data.stockCritico.forEach(s => { msg += `· ${s.label}: ${fmtKg(s.kg)} (mínimo ${s.minimo})\n` })
      msg += `\n`
    }
    const monosAtRisk = data.cuentasConPct.filter(c => c.pctConsumo >= 70)
    if (monosAtRisk.length > 0) {
      msg += `*🚨 Monotributos en alerta:*\n`
      monosAtRisk.forEach(c => { msg += `· ${c.nombre}: ${c.pctConsumo.toFixed(1)}% del tope K\n` })
      msg += `\n`
    }
    if (data.clientesDeudores.length > 0) {
      msg += `*💳 Clientes con deuda > $100k:*\n`
      data.clientesDeudores.slice(0, 3).forEach(c => { msg += `· ${c.nombre}: ${fmtArs(c.saldo)}\n` })
    }
    enviarWhatsapp(whatsappDestino, msg)
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>Cargando resumen...</p>
  if (!data) return null
  const pc = data.panelControl

  const flecha = (v) => v == null ? '' : v >= 0 ? '↗' : '↘'
  const signo  = (v) => v == null ? '' : v >= 0 ? '+' : ''
  const colorVar = (v) => v == null ? NEON.muted : v >= 0 ? NEON.verde : NEON.rojo

  return (
    <div className="dej-in">
      {/* ── HERO: hoy + los 3 números madre ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
        <div style={{ ...glass, padding: 22, gridColumn: 'span 1', position: 'relative', overflow: 'hidden', border: '1px solid rgba(255,209,122,0.35)' }}>
          <div style={{ position: 'absolute', top: -60, right: -60, width: 180, height: 180, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,209,122,0.14), transparent 70%)' }} />
          <Etiqueta texto="FACTURADO HOY" extra={<PuntoVivo />} />
          <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 52, color: NEON.oro, lineHeight: 1, animation: 'dejGlow 3s ease-in-out infinite' }}>
            {fmtArs(data.totalHoy)}
          </div>
          <div style={{ fontSize: 12, color: NEON.muted, marginTop: 6 }}>
            {data.cantHoy} venta{data.cantHoy === 1 ? '' : 's'} · ticket {fmtArs(data.ticketProm)}
            {pc.variacionHoyVsAyer != null && (
              <span style={{ color: colorVar(pc.variacionHoyVsAyer), fontWeight: 700 }}>
                {' '}· {flecha(pc.variacionHoyVsAyer)} {signo(pc.variacionHoyVsAyer)}{pc.variacionHoyVsAyer.toFixed(0)}% vs ayer
              </span>
            )}
          </div>
          {data.promoMundial?.activa && (
            <div style={{ marginTop: 10, display: 'inline-block', padding: '4px 12px', borderRadius: 999, background: 'rgba(107,229,255,0.1)', border: '1px solid rgba(107,229,255,0.4)', color: NEON.cian, fontSize: 11, fontWeight: 800 }}>
              ⚽ PROMO MUNDIAL −{data.promoMundial.descuento_pct || 10}% ACTIVA
            </div>
          )}
        </div>

        <CardKPI label="ÚLTIMOS 7 DÍAS" valor={fmtArs(data.totalSemana)} color={NEON.azul}
          sub={`Promedio ${fmtArs(data.totalSemana / 7)}/día`} />
        <CardKPI label="ESTE MES (CAJA)" valor={fmtArs(data.totalMes)} color={colorVar(data.variacion)}
          sub={data.totalMesAnt > 0 ? `${flecha(data.variacion)} ${signo(data.variacion)}${data.variacion.toFixed(1)}% vs mes anterior` : 'Sin datos del mes anterior'} />
        <CardKPI label="SALDO NETO MES" valor={fmtArs(pc.saldoNetoMes)} color={pc.saldoNetoMes >= 0 ? NEON.verde : NEON.rojo}
          sub={`Ingresos ${fmtArs(pc.ingresosTotalesMes)} − Egresos ${fmtArs(pc.egresosTotalesMes)}`} />
      </div>

      {/* ── Cinta de métricas secundarias ── */}
      <div style={{ ...glass, marginTop: 12, padding: '14px 18px', display: 'flex', flexWrap: 'wrap', gap: '10px 28px', alignItems: 'center' }}>
        <Mini label="FACTURADO MES TOTAL" valor={fmtArs(pc.facturadoMes)} />
        <Mini label="% COBRADO" valor={`${pc.pctCobrado.toFixed(0)}%`} color={pc.pctCobrado < 50 ? NEON.rojo : pc.pctCobrado < 75 ? NEON.ambar : NEON.verde} />
        <Mini label="PEND. COBRAR" valor={fmtArs(pc.saldoPendienteTotal)} color={pc.saldoPendienteTotal > 500000 ? NEON.ambar : NEON.texto} />
        <Mini label={`VS ${new Date().getFullYear() - 1}`} valor={pc.variacionAnioPasado != null ? `${signo(pc.variacionAnioPasado)}${pc.variacionAnioPasado.toFixed(0)}%` : '—'} color={colorVar(pc.variacionAnioPasado)} />
        <Mini label="% SUELDOS" valor={`${pc.pctSueldosFact.toFixed(1)}%`} color={pc.pctSueldosFact > 60 ? NEON.rojo : pc.pctSueldosFact > 40 ? NEON.ambar : NEON.verde} />
        <Mini label="CAJAS DISP." valor={`${pc.cajasInfo.total}`} color={pc.cajasInfo.viejasCount > 0 ? NEON.ambar : NEON.cian}
          sub={pc.cajasInfo.viejasCount > 0 ? `${pc.cajasInfo.viejasCount} viejas` : null} />
        {ultimaAct && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: NEON.muted }}>
            Actualizado {ultimaAct.toLocaleTimeString('es-AR', { timeZone: TZ_ARG, hour: '2-digit', minute: '2-digit' })} · en vivo
          </span>
        )}
      </div>

      {/* ── Alertas ── */}
      <CentroAlertas data={data} />

      {/* ── Top productos + Stock + Monos ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginTop: 12 }}>
        <div style={{ ...glass, padding: 18 }}>
          <Etiqueta texto="🏆 TOP PRODUCTOS HOY" />
          {data.topProductosHoy.length === 0 ? (
            <p style={{ color: NEON.muted, fontSize: 13 }}>Sin ventas hoy todavía.</p>
          ) : (
            data.topProductosHoy.map((p, i) => (
              <FilaRanking key={i} pos={i + 1} nombre={p.nombre} der1={fmtKg(p.kg)} der2={fmtArs(p.importe)}
                pct={data.topProductosHoy[0].importe > 0 ? (p.importe / data.topProductosHoy[0].importe) * 100 : 0} />
            ))
          )}
        </div>

        <div style={{ ...glass, padding: 18 }}>
          <Etiqueta texto={data.stockCritico.length > 0 ? '⚠️ STOCK CRÍTICO' : '✅ STOCK OK'}
            color={data.stockCritico.length > 0 ? NEON.rojo : NEON.verde} />
          {data.stockCritico.length === 0 ? (
            <p style={{ color: NEON.muted, fontSize: 13 }}>Todos los stocks por encima del mínimo.</p>
          ) : (
            data.stockCritico.map(s => (
              <div key={s.tipo} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', background: 'rgba(255,107,129,0.07)', border: '1px solid rgba(255,107,129,0.2)', borderRadius: 10, marginBottom: 6, fontSize: 13 }}>
                <span>{s.label}</span>
                <strong style={{ color: NEON.rojo }}>{fmtKg(s.kg)} <span style={{ color: NEON.muted, fontSize: 10, fontWeight: 400 }}>/ mín {s.minimo}</span></strong>
              </div>
            ))
          )}
        </div>

        <div style={{ ...glass, padding: 18 }}>
          <Etiqueta texto="📑 MONOTRIBUTOS — TOPE K" />
          {data.cuentasConPct.length === 0 ? (
            <p style={{ color: NEON.muted, fontSize: 13 }}>Sin cuentas de monotributo cargadas.</p>
          ) : (
            data.cuentasConPct.map(c => {
              const color = c.pctConsumo >= 95 ? NEON.rojo : c.pctConsumo >= 70 ? NEON.ambar : NEON.verde
              return (
                <div key={c.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{c.nombre}</span>
                    <strong style={{ color }}>{c.pctConsumo.toFixed(1)}%</strong>
                  </div>
                  <Barra pct={c.pctConsumo} color={color} />
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── Cheques + deudores ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginTop: 12 }}>
        <div style={{ ...glass, padding: 18 }}>
          <Etiqueta texto="📄 CHEQUES A COBRAR (15 DÍAS)" />
          {data.cheques.length === 0 ? (
            <p style={{ color: NEON.muted, fontSize: 13 }}>Sin cheques próximos.</p>
          ) : (
            data.cheques.slice(0, 5).map(c => {
              const dias = Math.ceil((new Date(c.fecha_pago + 'T12:00') - new Date()) / (1000 * 60 * 60 * 24))
              return (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 12 }}>
                  <span style={{ color: NEON.texto }}>#{c.numero} · {c.cliente_nombre || '—'}</span>
                  <span>
                    <strong style={{ color: dias <= 3 ? NEON.rojo : dias <= 7 ? NEON.ambar : NEON.texto }}>en {dias}d</strong>
                    <span style={{ marginLeft: 10, color: NEON.oro, fontWeight: 700 }}>{fmtArs(c.monto)}</span>
                  </span>
                </div>
              )
            })
          )}
        </div>

        <div style={{ ...glass, padding: 18 }}>
          <Etiqueta texto="💳 DEUDA ALTA DE CLIENTES" />
          {data.clientesDeudores.length === 0 ? (
            <p style={{ color: NEON.muted, fontSize: 13 }}>Sin clientes con deuda mayor a $100k.</p>
          ) : (
            data.clientesDeudores.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 12 }}>
                <span style={{ color: NEON.texto }}>{c.nombre}</span>
                <strong style={{ color: NEON.rojo }}>{fmtArs(c.saldo)}</strong>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── WhatsApp (discreto, al final) ── */}
      <div style={{ ...glass, marginTop: 12, padding: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>📊 Reporte del día por WhatsApp</div>
          <div style={{ fontSize: 11, color: NEON.muted }}>Te abre WhatsApp con el resumen armado</div>
        </div>
        <input value={whatsappDestino} onChange={e => guardarNumeroWhatsapp(e.target.value)}
          placeholder="Tu WhatsApp (ej: 3515551234)"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text)', borderRadius: 10, padding: '9px 14px', fontSize: 13, minWidth: 200 }} />
        <button onClick={enviarReporteWhatsapp}
          style={{ padding: '10px 18px', background: '#25D366', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>
          📱 Enviar
        </button>
      </div>
    </div>
  )
}

// ── Piezas visuales reutilizables ───────────────────────────
function Etiqueta({ texto, color, extra }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, letterSpacing: 2.5, color: color || NEON.muted, fontWeight: 800, marginBottom: 10, textTransform: 'uppercase' }}>
      {texto}{extra}
    </div>
  )
}

function PuntoVivo({ size = 7 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
      <span style={{ width: size, height: size, borderRadius: '50%', background: NEON.verde, boxShadow: `0 0 10px ${NEON.verde}`, animation: 'dejPulso 1.6s ease-in-out infinite' }} />
      <span style={{ fontSize: 9, color: NEON.verde, letterSpacing: 1.5 }}>EN VIVO</span>
    </span>
  )
}

function CardKPI({ label, valor, sub, color }) {
  return (
    <div style={{ ...glass, padding: 22 }}>
      <Etiqueta texto={label} />
      <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 40, color: color || NEON.oro, lineHeight: 1 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: NEON.muted, marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

function Mini({ label, valor, sub, color }) {
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: 1.5, color: NEON.muted, marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: color || NEON.texto, lineHeight: 1 }}>
        {valor}{sub && <span style={{ fontSize: 10, color: NEON.ambar, marginLeft: 6, fontFamily: "'DM Sans',sans-serif" }}>{sub}</span>}
      </div>
    </div>
  )
}

function Barra({ pct, color, alto = 5 }) {
  return (
    <div style={{ height: alto, background: 'rgba(255,255,255,0.06)', borderRadius: alto, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: `linear-gradient(90deg, ${color}88, ${color})`, borderRadius: alto, transition: 'width .6s ease' }} />
    </div>
  )
}

function FilaRanking({ pos, nombre, der1, der2, pct }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13 }}>
        <span style={{ color: pos === 1 ? NEON.oro : NEON.muted, fontWeight: 800, width: 16 }}>{pos}</span>
        <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre}</span>
        <span style={{ color: NEON.muted, fontSize: 11 }}>{der1}</span>
        <span style={{ color: NEON.oro, fontWeight: 700 }}>{der2}</span>
      </div>
      <div style={{ marginLeft: 24, marginTop: 3 }}>
        <Barra pct={pct} color={pos === 1 ? NEON.oro : NEON.azul} alto={3} />
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// 🚨 CENTRO DE ALERTAS (compacto)
// ════════════════════════════════════════════════════════════
function calcularAlertas(data) {
  const alertas = []
  data.stockCritico.forEach(s => alertas.push({
    tipo: 'danger', icono: '📦',
    titulo: `Stock bajo: ${s.label}`,
    detalle: `Solo ${fmtKg(s.kg)} (mínimo ${s.minimo})`,
  }))
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
  data.clientesDeudores.slice(0, 3).forEach(c => {
    alertas.push({
      tipo: Number(c.saldo) > 500000 ? 'danger' : 'warning', icono: '💳',
      titulo: `${c.nombre} debe ${fmtArs(c.saldo)}`,
      detalle: 'Cobrar cuanto antes',
    })
  })
  data.cuentasConPct.filter(c => c.pctConsumo >= 85).forEach(c => {
    alertas.push({
      tipo: c.pctConsumo >= 95 ? 'danger' : 'warning', icono: '📑',
      titulo: `${c.nombre} al ${c.pctConsumo.toFixed(0)}% del tope mono`,
      detalle: c.pctConsumo >= 95 ? 'RIESGO de exclusión' : 'Atento al cierre del año móvil',
    })
  })
  if (data.panelControl.cajasInfo.viejasCount > 0) {
    alertas.push({
      tipo: 'warning', icono: '📦',
      titulo: `${data.panelControl.cajasInfo.viejasCount} cajas con >15 días en stock`,
      detalle: 'Priorizá su venta',
    })
  }
  if (data.panelControl.saldoNetoMes < 0) {
    alertas.push({
      tipo: 'danger', icono: '⚠️',
      titulo: 'Saldo neto del mes NEGATIVO',
      detalle: `Egresos superan ingresos por ${fmtArs(Math.abs(data.panelControl.saldoNetoMes))}`,
    })
  }
  if (data.panelControl.pctSueldosFact > 60) {
    alertas.push({
      tipo: 'warning', icono: '👥',
      titulo: `Sueldos al ${data.panelControl.pctSueldosFact.toFixed(0)}% de la facturación`,
      detalle: 'Ratio elevado',
    })
  }
  return alertas.sort((a, b) => (a.tipo === 'danger' ? 0 : 1) - (b.tipo === 'danger' ? 0 : 1))
}

function CentroAlertas({ data }) {
  const alertas = useMemo(() => calcularAlertas(data), [data])
  const colores = { danger: NEON.rojo, warning: NEON.ambar }
  const dangerCount = alertas.filter(a => a.tipo === 'danger').length

  if (alertas.length === 0) {
    return (
      <div style={{ ...glass, marginTop: 12, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10, borderColor: 'rgba(93,255,160,0.25)' }}>
        <span style={{ color: NEON.verde, fontWeight: 800, fontSize: 13 }}>✅ Todo en orden</span>
        <span style={{ color: NEON.muted, fontSize: 12 }}>No hay alertas activas — el negocio está marchando bien.</span>
      </div>
    )
  }
  return (
    <div style={{ ...glass, marginTop: 12, padding: 18, borderColor: dangerCount > 0 ? 'rgba(255,107,129,0.3)' : 'rgba(255,184,107,0.3)' }}>
      <Etiqueta texto={`🚨 ALERTAS (${alertas.length})`} color={dangerCount > 0 ? NEON.rojo : NEON.ambar} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
        {alertas.map((a, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px', borderRadius: 10,
            background: a.tipo === 'danger' ? 'rgba(255,107,129,0.07)' : 'rgba(255,184,107,0.06)',
            border: `1px solid ${a.tipo === 'danger' ? 'rgba(255,107,129,0.25)' : 'rgba(255,184,107,0.2)'}`,
          }}>
            <span style={{ fontSize: 15, flexShrink: 0 }}>{a.icono}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: colores[a.tipo] }}>{a.titulo}</div>
              <div style={{ fontSize: 10, color: NEON.muted, marginTop: 1 }}>{a.detalle}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// 📺 MODO TV — pantalla completa para proyectar en una tele
// ────────────────────────────────────────────────────────────
// - Tipografía gigante escalada en vw (se ve bien en cualquier TV)
// - Reloj + fecha en vivo (hora ARG)
// - Realtime: cada venta de la caja actualiza los números
// - ESC o botón para salir
// ════════════════════════════════════════════════════════════
function ModoTV({ onSalir }) {
  const { data, loading, ultimaAct } = useDashboardData(60000)
  const { hora, segundos, fecha } = useRelojARG()

  // ESC sale del modo TV (además del exit nativo de fullscreen)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onSalir() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSalir])

  const alertas = useMemo(() => data ? calcularAlertas(data).slice(0, 4) : [], [data])

  const flecha = (v) => v == null ? '' : v >= 0 ? '▲' : '▼'
  const signo  = (v) => v == null ? '' : v >= 0 ? '+' : ''
  const colorVar = (v) => v == null ? NEON.muted : v >= 0 ? NEON.verde : NEON.rojo

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, overflow: 'hidden',
      background: 'radial-gradient(ellipse at 20% 0%, #14110a 0%, #060606 55%, #030303 100%)',
      color: NEON.texto, fontFamily: "'DM Sans',sans-serif",
      display: 'flex', flexDirection: 'column', padding: '1.6vw 2.2vw',
    }}>
      <style>{ESTILOS_GLOBALES}</style>

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.4vw' }}>
        <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: '2.6vw', letterSpacing: 6, color: NEON.oro }}>
          FABRICIUS
        </span>
        <PuntoVivo size={10} />
        {data?.promoMundial?.activa && (
          <span style={{ padding: '0.4vw 1vw', borderRadius: 999, background: 'rgba(107,229,255,0.1)', border: '1px solid rgba(107,229,255,0.4)', color: NEON.cian, fontSize: '0.95vw', fontWeight: 800, letterSpacing: 1 }}>
            ⚽ PROMO MUNDIAL −{data.promoMundial.descuento_pct || 10}%
          </span>
        )}
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: '2.6vw', lineHeight: 1, color: NEON.texto }}>
            {hora}<span style={{ fontSize: '1.3vw', color: NEON.muted }}>:{segundos}</span>
          </div>
          <div style={{ fontSize: '0.85vw', color: NEON.muted, textTransform: 'capitalize' }}>{fecha}</div>
        </div>
        <button onClick={onSalir} title="Salir (ESC)"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: NEON.muted, borderRadius: 10, padding: '0.5vw 0.9vw', cursor: 'pointer', fontSize: '0.85vw' }}>
          ✕
        </button>
      </div>

      {loading || !data ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: NEON.muted, fontSize: '1.5vw' }}>
          Cargando datos en vivo…
        </div>
      ) : (
        <>
          {/* ── CUERPO ── */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.45fr 1fr', gap: '1.2vw', marginTop: '1.2vw', minHeight: 0 }}>
            {/* Columna izquierda */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2vw', minHeight: 0 }}>
              {/* Hero del día */}
              <div className="dej-in" style={{ ...glass, border: '1px solid rgba(255,209,122,0.35)', padding: '1.8vw 2.2vw', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: '-8vw', right: '-8vw', width: '22vw', height: '22vw', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,209,122,0.13), transparent 70%)' }} />
                <div style={{ fontSize: '0.95vw', letterSpacing: 4, color: NEON.muted, fontWeight: 800 }}>FACTURADO HOY</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: '7.2vw', lineHeight: 1, color: NEON.oro, animation: 'dejGlow 3s ease-in-out infinite' }}>
                  {fmtArs(data.totalHoy)}
                </div>
                <div style={{ display: 'flex', gap: '2.4vw', marginTop: '0.9vw', fontSize: '1.05vw' }}>
                  <span><strong style={{ color: NEON.texto }}>{data.cantHoy}</strong> <span style={{ color: NEON.muted }}>ventas</span></span>
                  <span><span style={{ color: NEON.muted }}>ticket</span> <strong style={{ color: NEON.texto }}>{fmtArs(data.ticketProm)}</strong></span>
                  {data.panelControl.variacionHoyVsAyer != null && (
                    <span style={{ color: colorVar(data.panelControl.variacionHoyVsAyer), fontWeight: 800 }}>
                      {flecha(data.panelControl.variacionHoyVsAyer)} {signo(data.panelControl.variacionHoyVsAyer)}{data.panelControl.variacionHoyVsAyer.toFixed(0)}% vs ayer
                    </span>
                  )}
                  {data.ultimaVentaHora && (
                    <span style={{ marginLeft: 'auto', color: NEON.muted }}>última venta {String(data.ultimaVentaHora).slice(0, 5)}</span>
                  )}
                </div>
              </div>

              {/* Semana / Mes / Año pasado */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.2vw' }}>
                <TvKPI label="7 DÍAS" valor={fmtArs(data.totalSemana)} sub={`${fmtArs(data.totalSemana / 7)}/día`} color={NEON.azul} />
                <TvKPI label="ESTE MES" valor={fmtArs(data.totalMes)}
                  sub={data.totalMesAnt > 0 ? `${flecha(data.variacion)} ${signo(data.variacion)}${data.variacion.toFixed(0)}% vs mes ant.` : '—'}
                  color={colorVar(data.variacion)} />
                <TvKPI label={`VS ${new Date().getFullYear() - 1}`}
                  valor={data.panelControl.variacionAnioPasado != null ? `${signo(data.panelControl.variacionAnioPasado)}${data.panelControl.variacionAnioPasado.toFixed(0)}%` : '—'}
                  sub="mismo período" color={colorVar(data.panelControl.variacionAnioPasado)} />
              </div>

              {/* Top productos */}
              <div className="dej-in" style={{ ...glass, padding: '1.4vw 1.8vw', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <div style={{ fontSize: '0.95vw', letterSpacing: 4, color: NEON.muted, fontWeight: 800, marginBottom: '0.9vw' }}>🏆 TOP PRODUCTOS HOY</div>
                {data.topProductosHoy.length === 0 ? (
                  <div style={{ color: NEON.muted, fontSize: '1.1vw' }}>Sin ventas hoy todavía.</div>
                ) : (
                  data.topProductosHoy.map((p, i) => (
                    <div key={i} style={{ marginBottom: '0.85vw' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.9vw', fontSize: '1.25vw' }}>
                        <span style={{ color: i === 0 ? NEON.oro : NEON.muted, fontWeight: 800, width: '1.4vw' }}>{i + 1}</span>
                        <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</span>
                        <span style={{ color: NEON.muted, fontSize: '0.95vw' }}>{fmtKg(p.kg)}</span>
                        <span style={{ color: NEON.oro, fontWeight: 800 }}>{fmtArs(p.importe)}</span>
                      </div>
                      <div style={{ marginLeft: '2.3vw', marginTop: '0.25vw' }}>
                        <Barra pct={data.topProductosHoy[0].importe > 0 ? (p.importe / data.topProductosHoy[0].importe) * 100 : 0}
                          color={i === 0 ? NEON.oro : NEON.azul} alto={4} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Columna derecha */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2vw', minHeight: 0 }}>
              {/* Salud financiera del mes */}
              <div className="dej-in" style={{ ...glass, padding: '1.4vw 1.8vw' }}>
                <div style={{ fontSize: '0.95vw', letterSpacing: 4, color: NEON.muted, fontWeight: 800, marginBottom: '0.9vw' }}>💼 SALUD DEL MES</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1vw 1.4vw' }}>
                  <TvMini label="SALDO NETO" valor={fmtArs(data.panelControl.saldoNetoMes)} color={data.panelControl.saldoNetoMes >= 0 ? NEON.verde : NEON.rojo} />
                  <TvMini label="FACTURADO TOTAL" valor={fmtArs(data.panelControl.facturadoMes)} color={NEON.texto} />
                  <TvMini label="% COBRADO" valor={`${data.panelControl.pctCobrado.toFixed(0)}%`}
                    color={data.panelControl.pctCobrado < 50 ? NEON.rojo : data.panelControl.pctCobrado < 75 ? NEON.ambar : NEON.verde} />
                  <TvMini label="PEND. COBRAR" valor={fmtArs(data.panelControl.saldoPendienteTotal)}
                    color={data.panelControl.saldoPendienteTotal > 500000 ? NEON.ambar : NEON.texto} />
                </div>
              </div>

              {/* Alertas */}
              <div className="dej-in" style={{ ...glass, padding: '1.4vw 1.8vw', flex: 1, minHeight: 0, overflow: 'hidden',
                borderColor: alertas.some(a => a.tipo === 'danger') ? 'rgba(255,107,129,0.35)' : alertas.length ? 'rgba(255,184,107,0.3)' : 'rgba(93,255,160,0.25)' }}>
                <div style={{ fontSize: '0.95vw', letterSpacing: 4, fontWeight: 800, marginBottom: '0.9vw',
                  color: alertas.some(a => a.tipo === 'danger') ? NEON.rojo : alertas.length ? NEON.ambar : NEON.verde }}>
                  {alertas.length > 0 ? `🚨 ALERTAS (${alertas.length})` : '✅ TODO EN ORDEN'}
                </div>
                {alertas.length === 0 ? (
                  <div style={{ color: NEON.muted, fontSize: '1.05vw' }}>No hay alertas activas. El negocio está marchando bien. 🎉</div>
                ) : (
                  alertas.map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: '0.8vw', alignItems: 'flex-start', padding: '0.6vw 0.9vw', borderRadius: '0.7vw', marginBottom: '0.5vw',
                      background: a.tipo === 'danger' ? 'rgba(255,107,129,0.08)' : 'rgba(255,184,107,0.07)' }}>
                      <span style={{ fontSize: '1.2vw' }}>{a.icono}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '1.05vw', fontWeight: 700, color: a.tipo === 'danger' ? NEON.rojo : NEON.ambar }}>{a.titulo}</div>
                        <div style={{ fontSize: '0.8vw', color: NEON.muted }}>{a.detalle}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Stock crítico compacto */}
              <div className="dej-in" style={{ ...glass, padding: '1.2vw 1.8vw' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1vw', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.95vw', letterSpacing: 4, fontWeight: 800, color: data.stockCritico.length ? NEON.rojo : NEON.verde }}>
                    {data.stockCritico.length ? '⚠️ STOCK' : '✅ STOCK OK'}
                  </span>
                  {data.stockCritico.length === 0 ? (
                    <span style={{ color: NEON.muted, fontSize: '0.9vw' }}>Todo por encima del mínimo</span>
                  ) : (
                    data.stockCritico.map(s => (
                      <span key={s.tipo} style={{ padding: '0.3vw 0.8vw', borderRadius: 999, background: 'rgba(255,107,129,0.1)', border: '1px solid rgba(255,107,129,0.3)', fontSize: '0.9vw', color: NEON.rojo, fontWeight: 700 }}>
                        {s.label} {fmtKg(s.kg)}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── FOOTER ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2.4vw', marginTop: '1.1vw', padding: '0.7vw 1.4vw', borderRadius: '0.9vw', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <TvMini label="CAJAS DISP." valor={`${data.panelControl.cajasInfo.total} · ${fmtKg(data.panelControl.cajasInfo.kg)}`}
              color={data.panelControl.cajasInfo.viejasCount > 0 ? NEON.ambar : NEON.cian} chico />
            <TvMini label="% SUELDOS / FACT." valor={`${data.panelControl.pctSueldosFact.toFixed(1)}%`}
              color={data.panelControl.pctSueldosFact > 60 ? NEON.rojo : data.panelControl.pctSueldosFact > 40 ? NEON.ambar : NEON.verde} chico />
            <TvMini label="CHEQUES 15D" valor={`${data.cheques.length}`} color={NEON.texto} chico />
            {data.cuentasConPct[0] && (
              <TvMini label={`MONO MÁX: ${data.cuentasConPct[0].nombre.trim().split(' ')[0]}`}
                valor={`${data.cuentasConPct[0].pctConsumo.toFixed(0)}% tope K`}
                color={data.cuentasConPct[0].pctConsumo >= 95 ? NEON.rojo : data.cuentasConPct[0].pctConsumo >= 70 ? NEON.ambar : NEON.verde} chico />
            )}
            <span style={{ marginLeft: 'auto', fontSize: '0.75vw', color: NEON.muted }}>
              {ultimaAct && `Actualizado ${ultimaAct.toLocaleTimeString('es-AR', { timeZone: TZ_ARG, hour: '2-digit', minute: '2-digit' })}`} · se refresca solo · ESC para salir
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function TvKPI({ label, valor, sub, color }) {
  return (
    <div className="dej-in" style={{ ...glass, padding: '1.2vw 1.5vw' }}>
      <div style={{ fontSize: '0.8vw', letterSpacing: 3, color: NEON.muted, fontWeight: 800 }}>{label}</div>
      <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: '2.6vw', lineHeight: 1.05, color: color || NEON.oro }}>{valor}</div>
      {sub && <div style={{ fontSize: '0.8vw', color: NEON.muted, marginTop: '0.2vw' }}>{sub}</div>}
    </div>
  )
}

function TvMini({ label, valor, color, chico }) {
  return (
    <div>
      <div style={{ fontSize: chico ? '0.65vw' : '0.75vw', letterSpacing: 2, color: NEON.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: chico ? '1.25vw' : '1.7vw', lineHeight: 1.1, color: color || NEON.texto }}>{valor}</div>
    </div>
  )
}
