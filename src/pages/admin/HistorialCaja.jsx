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
import { fechaHoyARG, fechaRelativaARG } from '../../lib/fechas'
import { kgPorUnidadDeProducto } from '../../lib/stockHelpers'
import { useAuth } from '../../context/AuthContext'
import Paginador, { usePaginacion } from '../../components/Paginador'

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

// Mapeo categoría → tipo en stock_actual (igual al de Caja.jsx para mantener coherencia).
// Recibe stock_origen opcional para revertir contra el cut específico si la
// venta original lo guardó (ej. cerdo_bondiola). Sino usa fallback por categoría.
function mapearStockTipo(cat, stockOrigen) {
  if (!cat) return null
  if (stockOrigen) return stockOrigen
  if (cat === 'bovino_mr')        return 'bovino_mr'
  if (cat === 'bovino_corte')     return 'bovino_corte'
  if (cat === 'bovino_pieza')     return 'bovino_pieza'
  if (cat === 'bovino_brosa')     return 'bovino_brosa'
  if (cat === 'cerdo')            return 'cerdo'        // capón
  if (cat === 'cerdo_corte')      return 'cerdo_pieza'  // bucket genérico de piezas
  if (cat === 'cerdo_pieza')      return 'cerdo_pieza'
  if (cat === 'pollo')            return 'pollo'
  if (cat === 'pollo_cajon')      return 'pollo'      // se revierte kg×cajón
  if (cat === 'rebozado')         return 'rebozado'
  if (cat === 'rebozado_cajon')   return 'rebozado'   // se revierte kg×cajón
  if (cat === 'embutido')         return 'embutido'
  if (cat === 'almacen')          return 'almacen'
  if (cat === 'bebidas')          return 'bebidas'
  if (cat === 'bovino_caja_cb')   return 'caja_cb'
  if (cat === 'bovino_caja_pt')   return 'caja_pt'
  return null
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
  // Hora local Argentina, NO UTC. Antes "hoy" después de las 21hs ARG
  // se calculaba como el día siguiente y los filtros mostraban mal.
  const hoy = fechaHoyARG()
  if (modo === 'hoy')   { return { desde: hoy, hasta: hoy } }
  if (modo === 'ayer')  {
    const ayer = fechaRelativaARG(-1)
    return { desde: ayer, hasta: ayer }
  }
  if (modo === '7dias') {
    return { desde: fechaRelativaARG(-6), hasta: hoy }
  }
  if (modo === 'mes')   {
    // Primer día del mes en ARG = simplemente cambiar día a 01
    return { desde: hoy.slice(0, 8) + '01', hasta: hoy }
  }
  return { desde: hoy, hasta: hoy }
}

export default function HistorialCaja() {
  const { isAdmin } = useAuth()
  const [ventas, setVentas] = useState([])
  const [loading, setLoading] = useState(true)
  const [modo, setModo] = useState('hoy')
  const [rango, setRango] = useState(() => rangoFechas('hoy'))
  const [expandido, setExpandido] = useState(null)

  useEffect(() => { cargar() }, [rango.desde, rango.hasta])

  // Realtime: recargar cuando cambian las ventas (inserts/deletes/updates)
  useEffect(() => {
    const canal = supabase
      .channel('historial-caja-realtime')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'ventas_minoristas' },
        () => cargar())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [rango.desde, rango.hasta])

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

  // === Anular venta: revertir stock + borrar de ventas_minoristas ===
  async function anularVenta(venta) {
    if (!isAdmin) {
      alert('Solo los administradores pueden anular ventas.')
      return
    }
    const total = Number(venta.total) || 0
    const cantItems = Array.isArray(venta.items) ? venta.items.length : 0
    if (!confirm(
      `⚠️ ANULAR VENTA — ACCIÓN IRREVERSIBLE\n\n` +
      `Venta #${venta.id} del ${venta.fecha}\n` +
      `Total: $${Math.round(total).toLocaleString('es-AR')}\n` +
      `Items: ${cantItems}\n\n` +
      `Se va a:\n` +
      `  1. Devolver al stock cada item vendido\n` +
      `  2. Borrar la venta del historial\n\n` +
      `¿Confirmar?`
    )) return
    const conf2 = prompt('Para confirmar, escribí ANULAR en mayúsculas:')
    if (conf2 !== 'ANULAR') {
      alert('Cancelado. Texto incorrecto.')
      return
    }

    // 1) Reponer stock por cada item
    // Para cajones (pollo_cajon, rebozado_cajon) hay que multiplicar
    // las unidades vendidas por los kg que pesa cada cajón para
    // devolver al stock kg del producto base — mismo cálculo invertido
    // que hace Caja.jsx al vender.
    const items = Array.isArray(venta.items) ? venta.items : []
    const errores = []
    for (const item of items) {
      const tipoStock = mapearStockTipo(item.categoria, item.stock_origen)
      if (!tipoStock) continue
      try {
        const esCajonAConvertir = item.categoria === 'pollo_cajon' || item.categoria === 'rebozado_cajon'
        const cantidad = esCajonAConvertir
          ? (Number(item.kg) || 0) * (kgPorUnidadDeProducto(item) || 1)
          : (Number(item.kg) || 0)
        const { data: stock } = await supabase.from('stock_actual').select('*').eq('tipo', tipoStock).maybeSingle()
        if (stock) {
          await supabase.from('stock_actual')
            .update({ kg_disponible: (Number(stock.kg_disponible) || 0) + cantidad })
            .eq('tipo', tipoStock)
        }
      } catch (e) {
        errores.push(`${item.descripcion}: ${e.message}`)
      }
    }

    // 2) Borrar la venta
    const { error } = await supabase.from('ventas_minoristas').delete().eq('id', venta.id)
    if (error) {
      alert(`❌ Stock revertido pero NO se pudo borrar la venta:\n${error.message}`)
      await cargar()
      return
    }

    let msg = `✅ Venta #${venta.id} anulada — stock devuelto`
    if (errores.length > 0) msg += `\n\n⚠️ Algunos items tuvieron error al revertir stock:\n${errores.join('\n')}`
    alert(msg)
    await cargar()
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

  // === Top productos del rango ===
  const productosRanking = useMemo(() => {
    const map = new Map() // descripcion → { kg, plata, count }
    for (const v of ventas) {
      const items = Array.isArray(v.items) ? v.items : []
      for (const it of items) {
        const key = it.descripcion || '(sin nombre)'
        if (!map.has(key)) map.set(key, { descripcion: key, categoria: it.categoria, kg: 0, plata: 0, count: 0 })
        const r = map.get(key)
        r.kg    += Number(it.kg) || 0
        r.plata += Number(it.importe) || 0
        r.count += 1
      }
    }
    const arr = Array.from(map.values())
    return {
      masPlata: [...arr].sort((a, b) => b.plata - a.plata).slice(0, 10),
      menosPlata: [...arr].sort((a, b) => a.plata - b.plata).slice(0, 10),
      masKg: [...arr].sort((a, b) => b.kg - a.kg).slice(0, 10),
    }
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

          {/* TOP PRODUCTOS */}
          {productosRanking.masPlata.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              {/* Más vendidos */}
              <div className="card" style={{ margin: 0 }}>
                <div className="card-title" style={{ color: '#7dff7d' }}>🏆 Top 10 más vendidos (por plata)</div>
                <table style={{ width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
                      <th style={{ width: 24, textAlign: 'center' }}>#</th>
                      <th style={{ textAlign: 'left' }}>Producto</th>
                      <th style={{ textAlign: 'right' }}>Veces</th>
                      <th style={{ textAlign: 'right' }}>Kg/Unid.</th>
                      <th style={{ textAlign: 'right' }}>Facturado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productosRanking.masPlata.map((p, i) => (
                      <tr key={p.descripcion} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700, color: i === 0 ? '#ffd17a' : 'var(--muted)' }}>{i + 1}</td>
                        <td style={{ padding: '6px 4px', fontWeight: 500 }}>{p.descripcion}</td>
                        <td style={{ textAlign: 'right', padding: '6px 4px', color: 'var(--muted)' }}>{p.count}</td>
                        <td style={{ textAlign: 'right', padding: '6px 4px' }}>{fmtKg(p.kg)}</td>
                        <td style={{ textAlign: 'right', padding: '6px 4px', color: '#7dff7d', fontWeight: 700 }}>{fmt$(p.plata)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Menos vendidos */}
              <div className="card" style={{ margin: 0 }}>
                <div className="card-title" style={{ color: '#ff8b8b' }}>🐌 Top 10 menos vendidos (que igual se vendieron)</div>
                <table style={{ width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
                      <th style={{ width: 24, textAlign: 'center' }}>#</th>
                      <th style={{ textAlign: 'left' }}>Producto</th>
                      <th style={{ textAlign: 'right' }}>Veces</th>
                      <th style={{ textAlign: 'right' }}>Kg/Unid.</th>
                      <th style={{ textAlign: 'right' }}>Facturado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productosRanking.menosPlata.map((p, i) => (
                      <tr key={p.descripcion} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 700, color: 'var(--muted)' }}>{i + 1}</td>
                        <td style={{ padding: '6px 4px', fontWeight: 500 }}>{p.descripcion}</td>
                        <td style={{ textAlign: 'right', padding: '6px 4px', color: 'var(--muted)' }}>{p.count}</td>
                        <td style={{ textAlign: 'right', padding: '6px 4px' }}>{fmtKg(p.kg)}</td>
                        <td style={{ textAlign: 'right', padding: '6px 4px', color: '#ff8b8b', fontWeight: 700 }}>{fmt$(p.plata)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, fontStyle: 'italic' }}>
                  Tip: los productos del sistema que NO aparecen acá es porque no se vendieron en el rango. Revisalos desde Precios.
                </div>
              </div>
            </div>
          )}

          {/* TABLA POR DÍA — paginada */}
          <DiasPaginados
            ventasPorDia={ventasPorDia}
            expandido={expandido}
            setExpandido={setExpandido}
            anularVenta={anularVenta}
            isAdmin={isAdmin}
          />
        </>
      )}
    </div>
  )
}

// Sub-componente: pagina la lista de días para evitar filas interminables.
// Cada día queda colapsable; al expandir muestra todas las ventas del día.
function DiasPaginados({ ventasPorDia, expandido, setExpandido, anularVenta, isAdmin }) {
  const pag = usePaginacion(ventasPorDia, 20)
  return (
    <div className="card">
      <div className="card-title">📅 Ventas por día</div>
      {ventasPorDia.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin ventas en el rango.</p>
      ) : (
        <>
          {pag.items.map(dia => (
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
                      <th style={{ width: 80 }}></th>
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
                        <td style={{ textAlign: 'right', padding: 4 }}>
                          {isAdmin ? (
                            <button onClick={() => anularVenta(v)}
                              title="Anular venta y devolver stock"
                              style={{ padding: '3px 10px', background: 'transparent', border: '1px solid #5a2a2a', color: '#ff8b8b', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                              🗑️ Anular
                            </button>
                          ) : (
                            <span style={{ fontSize: 10, color: 'var(--muted)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
          <Paginador {...pag.controles} label="días" />
        </>
      )}
    </div>
  )
}
