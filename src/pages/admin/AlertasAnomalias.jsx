// ============================================================
// ALERTAS DE ANOMALÍAS — detección de posibles robos/errores
// ============================================================
// Detecta y muestra alertas en el Dashboard cuando hay señales de
// posibles problemas en la operación:
//
//   🔴 ALTA — Acción urgente
//     - Arqueo del día con faltante > $5.000
//     - Stock con saldo NEGATIVO (alguien vendió sin entrada registrada)
//
//   🟡 MEDIA — Revisar
//     - 3+ ventas anuladas en el día (puede ser legítimo o no)
//     - Faltante acumulado de la semana > $20.000
//     - Ventas fuera de horario habitual (antes 6am o después 23pm)
//
//   🔵 INFO — Solo para conocimiento
//     - Día sin arqueo cerrado (recordatorio)
//     - Sobrante grande en arqueo (>$5.000) — revisar si pagaron de más
// ============================================================
import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fechaHoyARG, fechaRelativaARG } from '../../lib/fechas'
import { fmtKg } from '../../lib/formatos'

const fmt$ = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR')

// Nombres legibles para los tipos de stock (la clave interna no se muestra cruda).
// Ej: 'cerdo_parrillero' → 'Carnaza de cerdo'. Si no está en el mapa, se prettifica
// la clave (reemplaza '_' por espacio y capitaliza).
const NOMBRE_STOCK = {
  cerdo_parrillero: 'Carnaza de cerdo',
  cerdo_pierna: 'Pierna de cerdo',
  cerdo_paleta: 'Paleta de cerdo',
  cerdo_bondiola: 'Bondiola de cerdo',
  cerdo_pechito: 'Pechito de cerdo',
  cerdo_matambre: 'Matambre de cerdo',
  cerdo_carre: 'Carré de cerdo',
  cerdo_tocino: 'Tocino de cerdo',
  cerdo_costilla: 'Costilla de cerdo',
  cerdo: 'Cerdo (capón)',
  bovino_mr: 'Media res bovina',
  bovino_corte: 'Cortes bovinos',
  bovino_pieza: 'Piezas bovinas',
  pollo: 'Pollo',
  hamb_carne: 'Hamburguesas de carne',
  hamb_pollo: 'Hamburguesas de pollo',
  hamb_cerdo: 'Hamburguesas de cerdo',
}
const nombreStock = tipo => NOMBRE_STOCK[tipo] || String(tipo || '')
  .replace(/_/g, ' ')
  .replace(/^\w/, c => c.toUpperCase())
// Wrappers cortos sobre fechaHoyARG/fechaRelativaARG para mantener legibilidad
// del código existente. Antes eran toISOString().split('T')[0] (UTC) → bug
// después de las 21hs ARG (devolvía la fecha del día siguiente).
const hoyISO = () => fechaHoyARG()
const fechaHaceDias = n => fechaRelativaARG(-n)

export default function AlertasAnomalias() {
  const navigate = useNavigate()
  const [arqueosSemana, setArqueosSemana] = useState([])
  const [ventasHoy, setVentasHoy] = useState([])
  const [stockNegativo, setStockNegativo] = useState([])
  const [orfanos, setOrfanos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { cargar() }, [])

  // Realtime: recargar alertas cuando hay ventas o arqueos nuevos
  useEffect(() => {
    const canal = supabase
      .channel('alertas-anomalias-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ventas_minoristas' }, () => cargar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arqueos_caja' }, () => cargar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_actual' }, () => cargar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'precios' }, () => cargar())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [])

  async function cargar() {
    setLoading(true)
    const desde = fechaHaceDias(7)
    const [{ data: arq }, { data: ventas }, { data: stock }, { data: prods }] = await Promise.all([
      supabase.from('arqueos_caja').select('*').gte('fecha', desde),
      supabase.from('ventas_minoristas').select('*').eq('origen', 'caja').eq('fecha', hoyISO()),
      supabase.from('stock_actual').select('*'),
      // Productos "huérfanos": cerdo/embutido sin stock_origen y sin marcar
      // "no descuenta" → se venden pero no descuentan stock.
      supabase.from('precios').select('nombre, categoria, stock_origen, stock_no_aplica')
        .in('categoria', ['cerdo_corte', 'cerdo_pieza', 'embutido']),
    ])
    setArqueosSemana(arq || [])
    setVentasHoy(ventas || [])
    setStockNegativo((stock || []).filter(s => Number(s.kg_disponible) < 0))
    setOrfanos((prods || []).filter(p => !p.stock_origen && !p.stock_no_aplica))
    setLoading(false)
  }

  const alertas = useMemo(() => {
    const list = []
    const hoy = hoyISO()

    // 🔴 Arqueo de hoy con faltante grande
    const arqHoy = arqueosSemana.filter(a => a.fecha === hoy)
    for (const a of arqHoy) {
      const dif = Number(a.diferencia) || 0
      if (dif <= -5000) {
        list.push({
          nivel: 'alta',
          icono: '🚨',
          titulo: `Faltante de ${fmt$(dif)} en arqueo de hoy`,
          detalle: `Arqueo de las ${a.hora} (cajero: ${a.cajero || 'sin nombre'}). ${a.notas ? 'Nota: ' + a.notas : 'Sin nota explicativa.'}`,
        })
      } else if (dif >= 5000) {
        list.push({
          nivel: 'info',
          icono: '💰',
          titulo: `Sobrante de +${fmt$(dif)} en arqueo de hoy`,
          detalle: `Hay más plata de la esperada. Posibles causas: pagos sin registrar, error de vuelto. Cajero: ${a.cajero || 'sin nombre'}`,
        })
      }
    }

    // 🔴 Stock negativo
    for (const s of stockNegativo) {
      list.push({
        nivel: 'alta',
        icono: '⚠️',
        titulo: `Stock NEGATIVO en "${nombreStock(s.tipo)}": ${fmtKg(s.kg_disponible)}`,
        detalle: 'Significa que se vendió más mercadería de la que figura como ingresada. Revisar entradas/salidas.',
      })
    }

    // 🟡 Productos huérfanos: cerdo/embutido sin stock asignado (se venden pero
    // no descuentan stock). Hay que enlazarlos a su bucket en Precios.
    if (orfanos.length > 0) {
      list.push({
        nivel: 'media',
        icono: '📦',
        titulo: `${orfanos.length} producto${orfanos.length === 1 ? '' : 's'} sin stock asignado`,
        detalle: `Se vende${orfanos.length === 1 ? '' : 'n'} pero NO descuenta${orfanos.length === 1 ? '' : 'n'} stock: ${orfanos.map(o => (o.nombre || '').trim()).join(', ')}. Andá a Precios → ✏️ Administrar y enlazá cada uno a su bucket de stock (o marcalo "no descuenta" si es comprado para reventa).`,
        link: '/admin/precios',
      })
    }

    // 🟡 Faltante acumulado de la semana
    const faltanteSemana = arqueosSemana.reduce((s, a) => s + Math.min(0, Number(a.diferencia) || 0), 0)
    if (faltanteSemana < -20000) {
      list.push({
        nivel: 'media',
        icono: '📉',
        titulo: `Faltante acumulado de la semana: ${fmt$(faltanteSemana)}`,
        detalle: `Sumando los arqueos de los últimos 7 días, falta ${fmt$(faltanteSemana)} en total. Revisar patrones.`,
      })
    }

    // 🟡 Sin arqueo cerrado hoy
    if (arqHoy.length === 0 && ventasHoy.length >= 3) {
      list.push({
        nivel: 'info',
        icono: '🧾',
        titulo: 'Falta arqueo del día',
        detalle: `Hubo ${ventasHoy.length} ventas hoy pero todavía no se cerró el arqueo de caja.`,
      })
    }

    // 🟡 Ventas fuera de horario (antes de 6am o después de 23pm)
    const ventasRaras = ventasHoy.filter(v => {
      if (!v.hora) return false
      const h = parseInt(v.hora.split(':')[0])
      return h < 6 || h >= 23
    })
    if (ventasRaras.length > 0) {
      list.push({
        nivel: 'media',
        icono: '🌙',
        titulo: `${ventasRaras.length} venta(s) fuera de horario habitual`,
        detalle: `Hubo ventas registradas antes de las 6am o después de las 23. Horarios: ${ventasRaras.map(v => v.hora).join(', ')}.`,
      })
    }

    return list
  }, [arqueosSemana, ventasHoy, stockNegativo, orfanos])

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ color: 'var(--muted)' }}>Analizando datos...</p>
      </div>
    )
  }

  if (alertas.length === 0) {
    return (
      <div className="card" style={{ marginBottom: 16, background: 'rgba(125,255,125,0.04)', border: '1px solid #2d5a2d' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>✅</span>
          <div>
            <div style={{ fontWeight: 700, color: '#7dff7d' }}>Sin alertas — operación normal</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>No se detectaron anomalías en arqueos, stock ni ventas de hoy.</div>
          </div>
        </div>
      </div>
    )
  }

  const colorNivel = { alta: '#ff6b6b', media: '#ffd17a', info: '#7a9dff' }
  const labelNivel = { alta: '🚨 URGENTE', media: '⚠️ REVISAR', info: 'ℹ️ INFO' }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="card-title" style={{ margin: 0 }}>🚨 Alertas de la operación ({alertas.length})</div>
        <button onClick={cargar} style={{ padding: '4px 10px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
          🔄 Recargar
        </button>
      </div>

      {alertas.map((a, i) => (
        <div key={i} onClick={a.link ? () => navigate(a.link) : undefined} style={{
          padding: '10px 14px', marginBottom: 8,
          background: `${colorNivel[a.nivel]}11`,
          border: `1px solid ${colorNivel[a.nivel]}66`,
          borderLeft: `4px solid ${colorNivel[a.nivel]}`,
          borderRadius: 6,
          cursor: a.link ? 'pointer' : 'default',
        }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ fontSize: 20, marginTop: 2 }}>{a.icono}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 700, color: colorNivel[a.nivel], fontSize: 13 }}>{a.titulo}</div>
                <span style={{ fontSize: 9, color: colorNivel[a.nivel], background: `${colorNivel[a.nivel]}22`, padding: '2px 8px', borderRadius: 4, fontWeight: 700, letterSpacing: 0.5 }}>{labelNivel[a.nivel]}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{a.detalle}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
