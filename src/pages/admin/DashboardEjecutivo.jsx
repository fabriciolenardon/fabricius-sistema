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
import { useLocation } from 'react-router-dom'
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
// Mismo día del mes anterior (para comparar período contra período).
// Regla de Fabricio: NO comparar el mes en curso contra el mes anterior
// COMPLETO — eso no es parámetro. Se compara 01→hoy vs 01→mismo día del
// mes pasado. Si el mes anterior es más corto (ej. 31 vs 30), se recorta.
const mismoDiaMesAnterior = () => {
  const hoy = fechaHoyARG()
  const y = Number(hoy.slice(0, 4))
  const m = Number(hoy.slice(5, 7))
  const d = Number(hoy.slice(8, 10))
  const yPrev = m === 1 ? y - 1 : y
  const mPrev = m === 1 ? 12 : m - 1
  const ultimoDiaPrev = new Date(yPrev, mPrev, 0).getDate()
  return `${yPrev}-${String(mPrev).padStart(2, '0')}-${String(Math.min(d, ultimoDiaPrev)).padStart(2, '0')}`
}
// Lunes de la semana en curso (ARG) — las compras a proveedores van por semana
const inicioSemanaARG = () => {
  const d = new Date(fechaHoyARG() + 'T12:00')
  const dow = (d.getDay() + 6) % 7 // 0 = lunes
  d.setDate(d.getDate() - dow)
  return fechaHoyARG(d)
}
// Hora actual en ARG (0-23) — para cortar la curva del día en "ahora"
const horaActualARG = () =>
  Number(new Date().toLocaleString('en-US', { timeZone: TZ_ARG, hour: '2-digit', hour12: false }))
// Curva acumulada de ventas por hora (7 a 22 hs). Cada punto = total
// facturado desde la apertura hasta esa hora inclusive.
function curvaAcumulada(rows) {
  const porHora = {}
  ;(rows || []).forEach(v => {
    const h = v.hora ? Number(String(v.hora).slice(0, 2)) : NaN
    if (isNaN(h)) return
    porHora[h] = (porHora[h] || 0) + (Number(v.total) || 0)
  })
  let acum = 0
  const pts = []
  for (let h = 7; h <= 22; h++) { acum += porHora[h] || 0; pts.push({ h, acum }) }
  return pts
}

// ── Estética compartida: HUD holográfico (estilo laboratorio de Stark) ──
// Cian translúcido dominante, paneles de "cristal" con esquinas marcadas,
// rejilla de fondo, líneas finas brillantes. El dorado queda solo para la
// marca FABRICIUS y el #1 del ranking.
const NEON = {
  oro:    '#ffd17a',
  verde:  '#51ffb0',
  rojo:   '#ff5c6c',
  cian:   '#00d4ff',
  cianHi: '#9beaff',   // cian claro para números grandes
  azul:   '#5fa8ff',
  ambar:  '#ffb35c',
  texto:  '#d9f3ff',
  muted:  'rgba(155,214,255,0.45)',
}
const glass = {
  background: 'linear-gradient(160deg, rgba(0,170,255,0.07) 0%, rgba(0,60,110,0.04) 55%, rgba(0,20,40,0.05) 100%)',
  border: '1px solid rgba(0,212,255,0.22)',
  borderRadius: 6,
  backdropFilter: 'blur(14px)',
  boxShadow: 'inset 0 0 26px rgba(0,212,255,0.05), 0 0 14px rgba(0,212,255,0.06)',
}

// Animaciones + clases HUD (esquinas tipo holograma, rejilla, scanline)
const ESTILOS_GLOBALES = `
@keyframes dejPulso { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.8); } }
@keyframes dejGlow  { 0%,100% { text-shadow: 0 0 16px rgba(0,212,255,0.45); } 50% { text-shadow: 0 0 36px rgba(0,212,255,0.8); } }
@keyframes dejIn    { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes hudScan  { from { top: -10%; } to { top: 110%; } }
@keyframes hudGiro  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
/* Destello cuando entra una venta nueva (Modo TV) */
@keyframes dejFlash {
  0%   { transform: scale(1);    text-shadow: 0 0 16px rgba(0,212,255,0.45); }
  18%  { transform: scale(1.05); text-shadow: 0 0 60px rgba(155,234,255,1), 0 0 24px rgba(255,255,255,0.8); }
  100% { transform: scale(1);    text-shadow: 0 0 16px rgba(0,212,255,0.45); }
}
/* Cinta de últimas ventas (marquee continuo, contenido duplicado) */
@keyframes dejTicker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.dej-ticker-pista { display: inline-flex; white-space: nowrap; animation: dejTicker 45s linear infinite; will-change: transform; }
.dej-in { animation: dejIn .5s ease both; }
/* Esquinas holográficas: dos escuadras cian en TL y BR */
.hud { position: relative; }
.hud::before, .hud::after {
  content: ''; position: absolute; width: 16px; height: 16px; pointer-events: none;
}
.hud::before { top: -1px; left: -1px; border-top: 2px solid rgba(0,212,255,0.8); border-left: 2px solid rgba(0,212,255,0.8); }
.hud::after  { bottom: -1px; right: -1px; border-bottom: 2px solid rgba(0,212,255,0.8); border-right: 2px solid rgba(0,212,255,0.8); }
/* Rejilla de fondo del Modo TV (holograma de mesa de Stark) */
.hud-rejilla {
  position: absolute; inset: 0; pointer-events: none; opacity: 0.5;
  background-image:
    linear-gradient(rgba(0,212,255,0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,212,255,0.05) 1px, transparent 1px);
  background-size: 46px 46px;
  mask-image: radial-gradient(ellipse at 50% 40%, black 0%, transparent 75%);
  -webkit-mask-image: radial-gradient(ellipse at 50% 40%, black 0%, transparent 75%);
}
/* Línea de escaneo que recorre la pantalla de la tele */
.hud-scan {
  position: absolute; left: 0; right: 0; height: 2px; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(0,212,255,0.25), transparent);
  animation: hudScan 9s linear infinite;
}
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
    const mesAntMismoDia = mismoDiaMesAnterior() // período comparable: 01→mismo día
    const hoyDt = new Date(hoy + 'T12:00')
    const anioPasadoMesIni = `${hoyDt.getFullYear() - 1}-${String(hoyDt.getMonth() + 1).padStart(2, '0')}-01`
    const anioPasadoHoy    = `${hoyDt.getFullYear() - 1}-${String(hoyDt.getMonth() + 1).padStart(2, '0')}-${String(hoyDt.getDate()).padStart(2, '0')}`

    const [ventasHoy, ventasAyer, ventasSemana, ventasMes, ventasMesAnt, ventasAnioPasado,
           salidasMes, pedidosMes, cuentas, facturas12m, stock, cheques, clientes,
           gastosMes, sueldosMes, pagosProvMes, movCtacteMes, todasCajas, todosDeudores, promoCfg,
           comprasMesQ, cierresQ, comprasSemQ, remitosHoyQ] = await Promise.all([
      supabase.from('ventas_minoristas').select('total, efectivo, debito, transferencia, items, fecha, hora').eq('origen', 'caja').eq('fecha', hoy),
      // hora incluida: alimenta la curva "hoy vs ayer a esta hora"
      supabase.from('ventas_minoristas').select('total, hora').eq('origen', 'caja').eq('fecha', ayer),
      supabase.from('ventas_minoristas').select('total, fecha').eq('origen', 'caja').gte('fecha', hace7).lte('fecha', hoy),
      supabase.from('ventas_minoristas').select('total').eq('origen', 'caja').gte('fecha', mesIni).lte('fecha', hoy),
      // Mes anterior recortado al MISMO período (01 → mismo día), no el mes completo
      supabase.from('ventas_minoristas').select('total').eq('origen', 'caja').gte('fecha', mesAntIni).lte('fecha', mesAntMismoDia),
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
      // COMPRAS del mes: ingresos de mercadería al depósito con importe real
      // (las entradas generadas por desposte tienen importe 0 y quedan afuera)
      supabase.from('entradas_deposito').select('importe').gte('fecha', mesIni).lte('fecha', hoy).gt('importe', 0).eq('eliminado', false),
      // Últimas 8 semanas CERRADAS (la primera es "la semana anterior";
      // todas juntas alimentan el gráfico de barras de tendencia)
      supabase.from('cierres_semanales').select('*').lt('semana_fin', hoy).order('semana_inicio', { ascending: false }).limit(8),
      // Compras a proveedores de la SEMANA en curso (lunes → hoy)
      supabase.from('compras_proveedores').select('proveedor_nombre, importe').gte('fecha', inicioSemanaARG()).lte('fecha', hoy).not('anulado', 'is', true),
      // Remitos/despachos mayoristas de HOY (para el ticker, sin flujos internos)
      supabase.from('remitos').select('numero, cliente_nombre, total, created_at, cobro').eq('fecha', hoy).eq('eliminado', false).neq('cobro', 'interno'),
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

    // ── CURVA DEL DÍA: acumulado por hora, hoy vs ayer ──
    const curvaHoy  = curvaAcumulada(ventasHoy.data)
    const curvaAyer = curvaAcumulada(ventasAyer.data)

    // ── TICKER: últimas ventas de HOY — caja minorista + despachos
    // mayoristas (remitos), mezclados y ordenados por hora ──
    const ventasCajaTicker = (ventasHoy.data || [])
      .filter(v => v.hora)
      .map(v => ({
        tipo: 'caja',
        hora: String(v.hora).slice(0, 5),
        total: Number(v.total) || 0,
        detalle: `${(v.items || []).length} prod`,
      }))
    const remitosTicker = (remitosHoyQ.data || [])
      .map(r => ({
        tipo: 'mayorista',
        hora: r.created_at
          ? new Date(r.created_at).toLocaleTimeString('es-AR', { timeZone: TZ_ARG, hour: '2-digit', minute: '2-digit' })
          : '—',
        total: Number(r.total) || 0,
        detalle: (r.cliente_nombre || 'cliente').trim(),
      }))
    const ultimasVentas = [...ventasCajaTicker, ...remitosTicker]
      .sort((a, b) => b.hora.localeCompare(a.hora))
      .slice(0, 14)

    // ── COMPRAS DE LA SEMANA POR PROVEEDOR (lunes → hoy) ──
    const accProv = {}
    ;(comprasSemQ.data || []).forEach(c => {
      const k = (c.proveedor_nombre || '—').trim().toUpperCase()
      accProv[k] = (accProv[k] || 0) + (Number(c.importe) || 0)
    })
    const comprasSemanaProv = Object.entries(accProv)
      .map(([nombre, total]) => ({ nombre, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
    const comprasSemanaTotal = Object.values(accProv).reduce((s, v) => s + v, 0)

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

    // ── MENSUAL EN VIVO (regla de Fabricio): VENTAS − COMPRAS − GASTOS ──
    // Los tres parámetros del mes corriente (01 → hoy), actualizados en vivo.
    // COMPRAS = mercadería ingresada al depósito (importe real de cada entrada).
    // GASTOS = gastos operativos + sueldos. Los pagos a proveedores NO van acá:
    // son la cancelación de las compras, sumarían doble.
    const comprasMes = (comprasMesQ.data || []).reduce((s, e) => s + (Number(e.importe) || 0), 0)
    const gastosOperativosMes = gastosFijos + gastosVariables + gastosSocios + sueldosTotalMes
    const mensualVivo = {
      ventas: facturadoMes,
      compras: comprasMes,
      gastos: gastosOperativosMes,
      saldo: facturadoMes - comprasMes - gastosOperativosMes,
    }

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
      mensualVivo,
      curvaHoy, curvaAyer, ultimasVentas,
      comprasSemanaProv, comprasSemanaTotal,
      cierreSemana: (cierresQ?.data || [])[0] || null,
      cierresHistorial: [...(cierresQ?.data || [])].reverse(), // viejas → nuevas (para las barras)
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
      // Despachos mayoristas: cada remito emitido entra al ticker en vivo
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'remitos' }, debounced)
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
  // ?tv=1 en la URL arranca directo en F.A.B.R.I. — lo usa el comando de
  // voz "modo tv"/"fabri" del asistente (sin gesto no hay fullscreen real,
  // pero el overlay se ve igual; el fullscreen se logra con el botón).
  const [modoTV, setModoTV] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('tv') === '1' } catch { return false }
  })
  // Si la URL cambia a ?tv=1 estando ya en esta pantalla (comando de voz),
  // también entra a F.A.B.R.I.
  const location = useLocation()
  useEffect(() => {
    if (new URLSearchParams(location.search).get('tv') === '1') setModoTV(true)
  }, [location.search])

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
        <button onClick={entrarModoTV} className="hud"
          style={{
            padding: '12px 22px', borderRadius: 6, cursor: 'pointer',
            background: 'linear-gradient(135deg, rgba(0,212,255,0.16), rgba(0,212,255,0.04))',
            border: '1px solid rgba(0,212,255,0.5)', color: NEON.cian,
            fontWeight: 800, fontSize: 13, letterSpacing: 1.5,
            fontFamily: "'DM Sans',sans-serif",
            boxShadow: '0 0 24px rgba(0,212,255,0.15)',
          }}>
          🦾 F.A.B.R.I. — EN VIVO
        </button>
      </div>

      {/* Sub-tabs minimalistas */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 16, marginBottom: 18 }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            style={{
              padding: '8px 16px', borderRadius: 999, cursor: 'pointer',
              border: subTab === t.id ? '1px solid rgba(0,212,255,0.55)' : '1px solid rgba(0,212,255,0.1)',
              background: subTab === t.id ? 'rgba(0,212,255,0.12)' : 'rgba(0,212,255,0.02)',
              color: subTab === t.id ? NEON.cian : NEON.muted,
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
      msg += ` (${signo}${data.variacion.toFixed(1)}% vs mismo período del mes anterior)`
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
        <div className="hud" style={{ ...glass, padding: 22, gridColumn: 'span 1', overflow: 'hidden', border: '1px solid rgba(0,212,255,0.4)' }}>
          <div style={{ position: 'absolute', top: -60, right: -60, width: 180, height: 180, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,212,255,0.16), transparent 70%)' }} />
          <Etiqueta texto="FACTURADO HOY" extra={<PuntoVivo />} />
          <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 52, color: NEON.cianHi, lineHeight: 1, animation: 'dejGlow 3s ease-in-out infinite' }}>
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
          sub={data.totalMesAnt > 0
            ? `${flecha(data.variacion)} ${signo(data.variacion)}${data.variacion.toFixed(1)}% vs mismo período mes ant. (01→${fechaHoyARG().slice(8, 10)})`
            : 'Sin datos del mismo período del mes anterior'} />
        {/* MENSUAL EN VIVO — los 3 parámetros que pidió Fabricio: V − C − G */}
        <div className="hud" style={{ ...glass, padding: 18 }}>
          <Etiqueta texto={`MENSUAL EN VIVO · 01→${fechaHoyARG().slice(8, 10)}`} extra={<PuntoVivo />} />
          {[
            { l: 'VENTAS',  v: data.mensualVivo.ventas,  c: NEON.cianHi },
            { l: 'COMPRAS', v: data.mensualVivo.compras, c: NEON.ambar },
            { l: 'GASTOS',  v: data.mensualVivo.gastos,  c: NEON.rojo },
          ].map(x => (
            <div key={x.l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
              <span style={{ fontSize: 10, letterSpacing: 2, color: NEON.muted, fontWeight: 800 }}>{x.l}</span>
              <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 21, color: x.c }}>{fmtArs(x.v)}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid rgba(0,212,255,0.25)', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 10, letterSpacing: 2, color: NEON.muted, fontWeight: 800 }}>SALDO</span>
            <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 26, color: data.mensualVivo.saldo >= 0 ? NEON.verde : NEON.rojo }}>
              {fmtArs(data.mensualVivo.saldo)}
            </span>
          </div>
        </div>
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

      {/* ── Curva del día + compras de la semana ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 12 }}>
        <CurvaDia hoy={data.curvaHoy} ayer={data.curvaAyer} />
        <PanelProveedoresSemana items={data.comprasSemanaProv} total={data.comprasSemanaTotal} />
      </div>

      {/* ── Alertas ── */}
      <CentroAlertas data={data} />

      {/* ── Top productos + Stock + Monos ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginTop: 12 }}>
        <CierreSemanaAnterior cierre={data.cierreSemana} historial={data.cierresHistorial} />

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
      <span style={{ width: size, height: size, borderRadius: '50%', background: NEON.cian, boxShadow: `0 0 10px ${NEON.cian}`, animation: 'dejPulso 1.6s ease-in-out infinite' }} />
      <span style={{ fontSize: 9, color: NEON.cian, letterSpacing: 1.5 }}>EN VIVO</span>
    </span>
  )
}

function CardKPI({ label, valor, sub, color }) {
  return (
    <div className="hud" style={{ ...glass, padding: 22 }}>
      <Etiqueta texto={label} />
      <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 40, color: color || NEON.cianHi, lineHeight: 1 }}>{valor}</div>
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

// Fecha corta DD/MM a partir de un date ISO
const fcCorta = (s) => s ? `${String(s).slice(8, 10)}/${String(s).slice(5, 7)}` : '—'

// ── Cierre de la SEMANA ANTERIOR ────────────────────────────
// Siempre muestra la última semana CERRADA (parámetro real, no parcial).
// Durante la semana en curso se ve el cierre de la semana pasada.
function CierreSemanaAnterior({ cierre, historial }) {
  if (!cierre) {
    return (
      <div className="hud" style={{ ...glass, padding: 18 }}>
        <Etiqueta texto="🗓️ CIERRE SEMANA ANTERIOR" />
        <p style={{ color: NEON.muted, fontSize: 13 }}>Todavía no hay semanas cerradas.</p>
      </div>
    )
  }
  const ganancia = Number(cierre.ganancia) || 0
  const filas = [
    { l: 'VENTAS',  v: cierre.ventas,  c: NEON.cianHi },
    { l: 'COMPRAS', v: cierre.compras, c: NEON.ambar },
    { l: 'GASTOS',  v: cierre.gastos,  c: NEON.rojo },
    { l: 'SUELDOS', v: cierre.sueldos, c: NEON.rojo },
  ]
  return (
    <div className="hud" style={{ ...glass, padding: 18 }}>
      <Etiqueta texto={`🗓️ CIERRE SEMANA ANTERIOR · ${fcCorta(cierre.semana_inicio)} → ${fcCorta(cierre.semana_fin)}`} />
      {filas.map(x => (
        <div key={x.l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
          <span style={{ fontSize: 10, letterSpacing: 2, color: NEON.muted, fontWeight: 800 }}>{x.l}</span>
          <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 19, color: x.c }}>{fmtArs(Number(x.v) || 0)}</span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid rgba(0,212,255,0.25)', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 10, letterSpacing: 2, color: NEON.muted, fontWeight: 800 }}>GANANCIA</span>
        <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 25, color: ganancia >= 0 ? NEON.verde : NEON.rojo }}>{fmtArs(ganancia)}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {[['🥩', cierre.kg_carne], ['🍗', cierre.kg_pollo], ['🐷', cierre.kg_cerdo]].map(([icono, kg], i) => (
          (Number(kg) || 0) > 0 && (
            <span key={i} style={{ fontSize: 10, color: NEON.muted, background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.18)', borderRadius: 4, padding: '2px 7px' }}>
              {icono} {fmtKg(Number(kg) || 0)}
            </span>
          )
        ))}
      </div>
      <BarrasCierres cierres={historial} />
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// 📈 CURVA DEL DÍA — acumulado por hora, hoy vs ayer
// ────────────────────────────────────────────────────────────
// Línea cian = hoy (cortada en la hora actual, con punto brillante).
// Línea punteada = ayer completo. Responde de un vistazo:
// "¿el día viene más fuerte o más flojo que ayer?"
// ════════════════════════════════════════════════════════════
function CurvaDia({ hoy, ayer, tv }) {
  const hAhora = horaActualARG()
  const hoyCortada = (hoy || []).filter(p => p.h <= Math.max(7, hAhora))
  const maxY = Math.max(
    ...(ayer || []).map(p => p.acum), ...(hoyCortada.map(p => p.acum)), 1)
  const X = (h) => ((h - 7) / 15) * 100
  const Y = (v) => 38 - (v / maxY) * 34
  const path = (pts) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.h).toFixed(1)},${Y(p.acum).toFixed(1)}`).join(' ')
  const ultimo = hoyCortada[hoyCortada.length - 1]
  const ayerAEstaHora = (ayer || []).find(p => p.h === (ultimo?.h ?? 0))?.acum || 0
  const fz = (n) => tv ? `${n}vw` : `${n * 13}px`
  return (
    <div className={tv ? 'dej-in hud' : 'hud'} style={{ ...glass, padding: tv ? '1.2vw 1.6vw' : 18, flex: tv ? 1 : undefined, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: tv ? '1vw' : 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: fz(0.85), letterSpacing: 3, color: NEON.cian, fontWeight: 800 }}>📈 CURVA DEL DÍA</span>
        <span style={{ fontSize: fz(0.75), color: NEON.muted }}>
          ayer a esta hora: <strong style={{ color: NEON.texto }}>{fmtArs(ayerAEstaHora)}</strong>
          {ultimo && ayerAEstaHora > 0 && (
            <strong style={{ marginLeft: 8, color: ultimo.acum >= ayerAEstaHora ? NEON.verde : NEON.rojo }}>
              {ultimo.acum >= ayerAEstaHora ? '▲' : '▼'} {Math.abs(((ultimo.acum - ayerAEstaHora) / ayerAEstaHora) * 100).toFixed(0)}%
            </strong>
          )}
        </span>
      </div>
      <svg viewBox="0 0 100 42" preserveAspectRatio="none" style={{ width: '100%', flex: 1, minHeight: tv ? 0 : 110, marginTop: 6 }}>
        {/* guías horizontales */}
        {[0.25, 0.5, 0.75].map(g => (
          <line key={g} x1="0" x2="100" y1={38 - g * 34} y2={38 - g * 34} stroke="rgba(0,212,255,0.08)" strokeWidth="0.3" />
        ))}
        {/* ayer: punteada apagada */}
        {(ayer || []).length > 0 && (
          <path d={path(ayer)} fill="none" stroke="rgba(155,214,255,0.35)" strokeWidth="0.7" strokeDasharray="2 2" />
        )}
        {/* hoy: cian con relleno suave y glow */}
        {hoyCortada.length > 1 && (
          <>
            <path d={`${path(hoyCortada)} L${X(ultimo.h).toFixed(1)},38 L0,38 Z`} fill="rgba(0,212,255,0.08)" stroke="none" />
            <path d={path(hoyCortada)} fill="none" stroke={NEON.cian} strokeWidth="1.1"
              style={{ filter: 'drop-shadow(0 0 3px rgba(0,212,255,0.9))' }} />
          </>
        )}
        {ultimo && (
          <circle cx={X(ultimo.h)} cy={Y(ultimo.acum)} r="1.6" fill={NEON.cianHi}
            style={{ filter: 'drop-shadow(0 0 4px rgba(155,234,255,1))' }}>
            <animate attributeName="r" values="1.3;2;1.3" dur="2s" repeatCount="indefinite" />
          </circle>
        )}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: fz(0.65), color: NEON.muted }}>
        <span>7 hs</span><span>12 hs</span><span>17 hs</span><span>22 hs</span>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// 📊 BARRAS DE CIERRES — ganancia de las últimas 8 semanas
// ════════════════════════════════════════════════════════════
function BarrasCierres({ cierres, tv }) {
  if (!cierres || cierres.length === 0) return null
  const maxAbs = Math.max(...cierres.map(c => Math.abs(Number(c.ganancia) || 0)), 1)
  const fz = (n) => tv ? `${n}vw` : `${n * 13}px`
  return (
    <div style={{ marginTop: tv ? '0.7vw' : 10 }}>
      <div style={{ fontSize: fz(0.6), letterSpacing: 2, color: NEON.muted, fontWeight: 700, marginBottom: tv ? '0.3vw' : 4 }}>
        GANANCIA ÚLTIMAS {cierres.length} SEMANAS
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: tv ? '0.45vw' : 5, height: tv ? '3.4vw' : 44 }}>
        {cierres.map((c, i) => {
          const g = Number(c.ganancia) || 0
          const hPct = Math.max(8, (Math.abs(g) / maxAbs) * 100)
          const esUltima = i === cierres.length - 1
          return (
            <div key={c.id || i} title={`${fcCorta(c.semana_inicio)}: ${fmtArs(g)}`}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
              <div style={{
                height: `${hPct}%`, borderRadius: 2,
                background: g >= 0
                  ? `linear-gradient(180deg, ${NEON.verde}${esUltima ? '' : '99'}, rgba(81,255,176,0.25))`
                  : `linear-gradient(180deg, ${NEON.rojo}${esUltima ? '' : '99'}, rgba(255,92,108,0.25))`,
                boxShadow: esUltima ? `0 0 8px ${g >= 0 ? 'rgba(81,255,176,0.5)' : 'rgba(255,92,108,0.5)'}` : 'none',
              }} />
              <div style={{ fontSize: fz(0.5), color: NEON.muted, textAlign: 'center', marginTop: 2 }}>{fcCorta(c.semana_inicio)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// 🏭 COMPRAS DE LA SEMANA POR PROVEEDOR (lunes → hoy)
// ════════════════════════════════════════════════════════════
function PanelProveedoresSemana({ items, total, tv }) {
  const fz = (n) => tv ? `${n}vw` : `${n * 13}px`
  const max = items && items.length > 0 ? items[0].total : 1
  return (
    <div className={tv ? 'dej-in hud' : 'hud'} style={{ ...glass, padding: tv ? '1.1vw 1.6vw' : 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: fz(0.85), letterSpacing: 3, color: NEON.cian, fontWeight: 800 }}>🏭 COMPRADO ESTA SEMANA</span>
        <span style={{ marginLeft: 'auto', fontFamily: "'Bebas Neue',cursive", fontSize: fz(1.2), color: NEON.ambar }}>{fmtArs(total || 0)}</span>
      </div>
      {(!items || items.length === 0) ? (
        <div style={{ color: NEON.muted, fontSize: fz(0.8), marginTop: 6 }}>Sin compras esta semana todavía.</div>
      ) : (
        <div style={{ marginTop: tv ? '0.5vw' : 8 }}>
          {items.map((p, i) => (
            <div key={p.nombre} style={{ marginBottom: tv ? '0.4vw' : 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: fz(0.78), marginBottom: 2 }}>
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</span>
                <span style={{ color: NEON.ambar, fontWeight: 700, marginLeft: 8 }}>{fmtArs(p.total)}</span>
              </div>
              <Barra pct={(p.total / max) * 100} color={i === 0 ? NEON.ambar : NEON.cian} alto={tv ? 3 : 4} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// 🎬 TICKER DE ÚLTIMAS VENTAS (Modo TV) — cinta tipo bolsa
// ════════════════════════════════════════════════════════════
function TickerVentas({ ventas }) {
  if (!ventas || ventas.length === 0) return null
  const items = ventas.map((v, i) => (
    <span key={i} style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.5vw', marginRight: '3.2vw' }}>
      <span style={{ color: NEON.muted, fontSize: '0.85vw' }}>{v.tipo === 'mayorista' ? '🚚' : '🕐'} {v.hora}</span>
      {v.tipo === 'mayorista' && (
        <span style={{ fontSize: '0.7vw', fontWeight: 800, letterSpacing: 1.5, color: NEON.ambar, border: '1px solid rgba(255,179,92,0.4)', borderRadius: 3, padding: '0 0.35vw' }}>
          MAYORISTA
        </span>
      )}
      <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: '1.25vw', color: v.tipo === 'mayorista' ? NEON.ambar : NEON.cianHi }}>{fmtArs(v.total)}</span>
      <span style={{ color: NEON.muted, fontSize: '0.8vw', maxWidth: '12vw', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.detalle}</span>
      <span style={{ color: 'rgba(0,212,255,0.3)', fontSize: '1vw' }}>◆</span>
    </span>
  ))
  return (
    <div style={{ overflow: 'hidden', marginTop: '0.8vw', padding: '0.35vw 0', borderTop: '1px solid rgba(0,212,255,0.15)', borderBottom: '1px solid rgba(0,212,255,0.15)' }}>
      {/* contenido duplicado para el loop infinito sin salto */}
      <div className="dej-ticker-pista">
        <span>{items}</span>
        <span aria-hidden="true">{items}</span>
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
  if (data.mensualVivo && data.mensualVivo.saldo < 0) {
    alertas.push({
      tipo: 'danger', icono: '⚠️',
      titulo: 'Saldo del mes NEGATIVO (Ventas − Compras − Gastos)',
      detalle: `El mes va ${fmtArs(data.mensualVivo.saldo)} · V ${fmtArs(data.mensualVivo.ventas)} − C ${fmtArs(data.mensualVivo.compras)} − G ${fmtArs(data.mensualVivo.gastos)}`,
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

  // 🔔 Destello cuando entra una venta: si el facturado de hoy SUBE entre
  // recargas, replay de la animación dejFlash (la key fuerza el remount).
  const [flashVenta, setFlashVenta] = useState(0)
  const prevTotalRef = useRef(null)
  useEffect(() => {
    const t = data?.totalHoy
    if (t == null) return
    if (prevTotalRef.current != null && t > prevTotalRef.current) setFlashVenta(f => f + 1)
    prevTotalRef.current = t
  }, [data?.totalHoy])

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
      background: 'radial-gradient(ellipse at 50% 0%, #07182a 0%, #04101d 50%, #010509 100%)',
      color: NEON.texto, fontFamily: "'DM Sans',sans-serif",
      display: 'flex', flexDirection: 'column', padding: '1.6vw 2.2vw',
    }}>
      <style>{ESTILOS_GLOBALES}</style>
      {/* Capa holográfica: rejilla + línea de escaneo (decorativas) */}
      <div className="hud-rejilla" />
      <div className="hud-scan" />

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.4vw' }}>
        <div>
          <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: '2.6vw', letterSpacing: 6, color: NEON.oro, lineHeight: 1, textShadow: '0 0 18px rgba(255,209,122,0.35)' }}>
            F.A.B.R.I.
          </span>
          <div style={{ fontSize: '0.58vw', letterSpacing: 2.5, color: NEON.muted, fontWeight: 700, marginTop: '0.1vw' }}>
            FACTURACIÓN · ALERTAS · BALANCE · RESULTADOS INSTANTÁNEOS — CARNICERÍAS FABRICIUS
          </div>
        </div>
        <PuntoVivo size={10} />
        {data?.promoMundial?.activa && (
          <span style={{ padding: '0.4vw 1vw', borderRadius: 999, background: 'rgba(107,229,255,0.1)', border: '1px solid rgba(107,229,255,0.4)', color: NEON.cian, fontSize: '0.95vw', fontWeight: 800, letterSpacing: 1 }}>
            ⚽ PROMO MUNDIAL −{data.promoMundial.descuento_pct || 10}%
          </span>
        )}
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: '2.6vw', lineHeight: 1, color: NEON.cianHi, textShadow: '0 0 14px rgba(0,212,255,0.5)' }}>
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
          🦾 F.A.B.R.I. iniciando sistemas…
        </div>
      ) : (
        <>
          {/* ── CUERPO ── */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.45fr 1fr', gap: '1.2vw', marginTop: '1.2vw', minHeight: 0 }}>
            {/* Columna izquierda */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2vw', minHeight: 0 }}>
              {/* Hero del día */}
              <div className="dej-in hud" style={{ ...glass, border: '1px solid rgba(0,212,255,0.45)', padding: '1.8vw 2.2vw', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: '-8vw', right: '-8vw', width: '22vw', height: '22vw', borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,212,255,0.15), transparent 70%)' }} />
                <div style={{ fontSize: '0.95vw', letterSpacing: 4, color: NEON.cian, fontWeight: 800 }}>FACTURADO HOY</div>
                <div key={flashVenta}
                  style={{ fontFamily: "'Bebas Neue',cursive", fontSize: '7.2vw', lineHeight: 1, color: NEON.cianHi,
                    animation: flashVenta > 0 ? 'dejFlash 2.2s ease, dejGlow 3s ease-in-out 2.2s infinite' : 'dejGlow 3s ease-in-out infinite' }}>
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
                  sub={data.totalMesAnt > 0 ? `${flecha(data.variacion)} ${signo(data.variacion)}${data.variacion.toFixed(0)}% vs mismo período mes ant.` : '—'}
                  color={colorVar(data.variacion)} />
                <TvKPI label={`VS ${new Date().getFullYear() - 1}`}
                  valor={data.panelControl.variacionAnioPasado != null ? `${signo(data.panelControl.variacionAnioPasado)}${data.panelControl.variacionAnioPasado.toFixed(0)}%` : '—'}
                  sub="mismo período" color={colorVar(data.panelControl.variacionAnioPasado)} />
              </div>

              {/* Curva del día en vivo: hoy vs ayer */}
              <CurvaDia hoy={data.curvaHoy} ayer={data.curvaAyer} tv />
            </div>

            {/* Columna derecha */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2vw', minHeight: 0 }}>
              {/* MES EN VIVO — VENTAS − COMPRAS − GASTOS (01 → hoy) + medidores */}
              <div className="dej-in hud" style={{ ...glass, padding: '1.4vw 1.8vw' }}>
                <div style={{ fontSize: '0.95vw', letterSpacing: 4, color: NEON.cian, fontWeight: 800, marginBottom: '0.9vw' }}>
                  💼 MES EN VIVO · 01→{fechaHoyARG().slice(8, 10)}
                </div>
                <div style={{ display: 'flex', gap: '1.4vw', alignItems: 'center' }}>
                  <HudGauge pct={data.panelControl.pctCobrado} label="COBRADO"
                    color={data.panelControl.pctCobrado < 50 ? NEON.rojo : data.panelControl.pctCobrado < 75 ? NEON.ambar : NEON.verde} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.55vw', minWidth: 0 }}>
                    <TvMini label="VENTAS" valor={fmtArs(data.mensualVivo.ventas)} color={NEON.cianHi} />
                    <TvMini label="COMPRAS" valor={fmtArs(data.mensualVivo.compras)} color={NEON.ambar} />
                    <TvMini label="GASTOS (incl. sueldos)" valor={fmtArs(data.mensualVivo.gastos)} color={NEON.rojo} />
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.7vw', letterSpacing: 2, color: NEON.muted, fontWeight: 700 }}>SALDO</div>
                    <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: '2.6vw', lineHeight: 1, color: data.mensualVivo.saldo >= 0 ? NEON.verde : NEON.rojo, textShadow: `0 0 12px ${data.mensualVivo.saldo >= 0 ? 'rgba(81,255,176,0.4)' : 'rgba(255,92,108,0.4)'}` }}>
                      {fmtArs(data.mensualVivo.saldo)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Cierre semana anterior — compacto, con tendencia de 8 semanas */}
              <div className="dej-in hud" style={{ ...glass, padding: '1.1vw 1.6vw' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.8vw', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.85vw', letterSpacing: 3, color: NEON.cian, fontWeight: 800 }}>
                    🗓️ SEMANA ANT.{data.cierreSemana ? ` ${fcCorta(data.cierreSemana.semana_inicio)}→${fcCorta(data.cierreSemana.semana_fin)}` : ''}
                  </span>
                  {data.cierreSemana && (
                    <>
                      <span style={{ fontSize: '0.75vw', color: NEON.muted }}>
                        V {fmtArs(Number(data.cierreSemana.ventas) || 0)} · C {fmtArs(Number(data.cierreSemana.compras) || 0)} · G {fmtArs((Number(data.cierreSemana.gastos) || 0) + (Number(data.cierreSemana.sueldos) || 0))}
                      </span>
                      <span style={{ marginLeft: 'auto', fontFamily: "'Bebas Neue',cursive", fontSize: '1.8vw', lineHeight: 1,
                        color: (Number(data.cierreSemana.ganancia) || 0) >= 0 ? NEON.verde : NEON.rojo,
                        textShadow: `0 0 12px ${(Number(data.cierreSemana.ganancia) || 0) >= 0 ? 'rgba(81,255,176,0.4)' : 'rgba(255,92,108,0.4)'}` }}>
                        {fmtArs(Number(data.cierreSemana.ganancia) || 0)}
                      </span>
                    </>
                  )}
                  {!data.cierreSemana && <span style={{ color: NEON.muted, fontSize: '0.85vw' }}>Sin semanas cerradas aún</span>}
                </div>
                <BarrasCierres cierres={data.cierresHistorial} tv />
              </div>

              {/* Alertas */}
              <div className="dej-in hud" style={{ ...glass, padding: '1.4vw 1.8vw', flex: 1, minHeight: 0, overflow: 'hidden',
                borderColor: alertas.some(a => a.tipo === 'danger') ? 'rgba(255,92,108,0.4)' : alertas.length ? 'rgba(255,179,92,0.35)' : 'rgba(81,255,176,0.3)' }}>
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

              {/* Compras de la semana por proveedor */}
              <PanelProveedoresSemana items={data.comprasSemanaProv} total={data.comprasSemanaTotal} tv />
            </div>
          </div>

          {/* 🎬 Ticker de últimas ventas */}
          <TickerVentas ventas={data.ultimasVentas} />

          {/* ── FOOTER ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2.4vw', marginTop: '0.6vw', padding: '0.7vw 1.4vw', borderRadius: 6, background: 'rgba(0,212,255,0.035)', border: '1px solid rgba(0,212,255,0.15)' }}>
            <TvMini label="CAJAS DISP." valor={`${data.panelControl.cajasInfo.total} · ${fmtKg(data.panelControl.cajasInfo.kg)}`}
              color={data.panelControl.cajasInfo.viejasCount > 0 ? NEON.ambar : NEON.cian} chico />
            <TvMini label="CHEQUES 15D" valor={`${data.cheques.length}`} color={NEON.cianHi} chico />
            <TvMini label="PEND. COBRAR" valor={fmtArs(data.panelControl.saldoPendienteTotal)}
              color={data.panelControl.saldoPendienteTotal > 500000 ? NEON.ambar : NEON.cianHi} chico />
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

// Medidor circular holográfico: arco de progreso + anillo punteado giratorio
function HudGauge({ pct, label, color }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0))
  const R = 40
  const C = 2 * Math.PI * R
  return (
    <div style={{ position: 'relative', width: '7vw', height: '7vw', flexShrink: 0 }}>
      <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(0,212,255,0.12)" strokeWidth="5" />
        <circle cx="50" cy="50" r={R} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${(p / 100) * C} ${C}`} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 5px ${color})`, transition: 'stroke-dasharray 1s ease' }} />
      </svg>
      <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, animation: 'hudGiro 16s linear infinite' }}>
        <circle cx="50" cy="50" r="47" fill="none" stroke="rgba(0,212,255,0.3)" strokeWidth="0.8" strokeDasharray="3 9" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: '1.7vw', color, lineHeight: 1 }}>{p.toFixed(0)}%</div>
        <div style={{ fontSize: '0.55vw', letterSpacing: 2, color: NEON.muted, fontWeight: 700, textAlign: 'center' }}>{label}</div>
      </div>
    </div>
  )
}

function TvKPI({ label, valor, sub, color }) {
  return (
    <div className="dej-in" style={{ ...glass, padding: '1.2vw 1.5vw' }}>
      <div style={{ fontSize: '0.8vw', letterSpacing: 3, color: NEON.muted, fontWeight: 800 }}>{label}</div>
      <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: '2.6vw', lineHeight: 1.05, color: color || NEON.cianHi }}>{valor}</div>
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
