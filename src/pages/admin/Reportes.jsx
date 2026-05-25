// ============================================================
// REPORTES CEO — Sub-componentes para Dashboard Ejecutivo
// ============================================================
// Originalmente era una página propia /admin/reportes pero se
// movió como sub-tabs del Dashboard Ejecutivo para reducir
// clutter en el nav principal.
//
// Este archivo exporta:
//   - useReportesData(periodo)  → hook que carga los datos
//   - PERIODOS                  → diccionario de opciones
//   - SelectorPeriodo           → componente de toggle
//   - ReporteMargen / ReporteCliente / ReporteProducto /
//     ReporteCanal / ReporteTemporal → las 5 vistas
//
// Todos los reportes usan fmtPrecio (formato AR uniforme).
// ============================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtPrecio, fmtKg } from '../../lib/formatos'
import { fechaHoyARG, fechaRelativaARG } from '../../lib/fechas'

const fmt = n => fmtPrecio(Number(n) || 0)
const fmtK = n => fmtKg(Number(n) || 0)
const fmtPct = n => `${(Number(n) || 0).toFixed(1)}%`

export const PERIODOS = {
  '30d':  { label: 'Últimos 30 días', dias: 30 },
  '90d':  { label: 'Últimos 90 días', dias: 90 },
  'anio': { label: 'Año en curso',    dias: null },
}

// Hook: carga compras + ventas + pedidos + clientes en el rango pedido.
// El consumer recarga cuando cambia el periodo (clave del PERIODOS).
export function useReportesData(periodo) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setLoading(true)
      const hoy = fechaHoyARG()
      let desde
      if (periodo === 'anio') {
        desde = hoy.slice(0, 4) + '-01-01'
      } else {
        desde = fechaRelativaARG(-PERIODOS[periodo].dias + 1)
      }

      const [entradas, salidas, ventasCaja, pedidos, clientes] = await Promise.all([
        supabase.from('entradas_deposito').select('*').gte('fecha', desde).lte('fecha', hoy),
        supabase.from('salidas_deposito').select('*').gte('fecha', desde).lte('fecha', hoy),
        supabase.from('ventas_minoristas').select('*').eq('origen', 'caja').gte('fecha', desde).lte('fecha', hoy),
        supabase.from('pedidos').select('*').gte('dia_entrega', desde).lte('dia_entrega', hoy).eq('estado', 'confirmado'),
        supabase.from('clientes').select('id, nombre, tipo, lista_precios, saldo'),
      ])

      if (cancelado) return
      setData({
        entradas: entradas.data || [],
        salidas: salidas.data || [],
        ventasCaja: ventasCaja.data || [],
        pedidos: pedidos.data || [],
        clientes: clientes.data || [],
        desde, hasta: hoy,
      })
      setLoading(false)
    }
    cargar()
    return () => { cancelado = true }
  }, [periodo])

  return { loading, data }
}

// Selector de período (toggle 30d / 90d / Año)
export function SelectorPeriodo({ periodo, setPeriodo, data }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      {Object.entries(PERIODOS).map(([id, p]) => (
        <button key={id} onClick={() => setPeriodo(id)}
          style={{
            padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)',
            background: periodo === id ? 'var(--gold)' : 'transparent',
            color: periodo === id ? '#000' : 'var(--muted)',
            cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12
          }}>
          {p.label}
        </button>
      ))}
      {data && (
        <div style={{ display: 'flex', alignItems: 'center', color: 'var(--muted)', fontSize: 11, marginLeft: 'auto' }}>
          📅 {data.desde} → {data.hasta}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 💰 MARGEN — % ganancia por semana
// ═══════════════════════════════════════════════════════════════
export function ReporteMargen({ data }) {
  const semanas = useMemo(() => agruparPorSemana(data), [data])
  const totales = useMemo(() => {
    const comprasMonto = data.entradas.reduce((s, e) => s + (Number(e.importe) || 0), 0)
    const comprasKg    = data.entradas.reduce((s, e) => s + (Number(e.kg) || 0), 0)
    const ventasMonto  = sumarVentasMonto(data)
    const ventasKg     = sumarVentasKg(data)
    const margen       = ventasMonto > 0 ? ((ventasMonto - comprasMonto) / ventasMonto) * 100 : 0
    const margenSobreCosto = comprasMonto > 0 ? ((ventasMonto - comprasMonto) / comprasMonto) * 100 : 0
    return { comprasMonto, comprasKg, ventasMonto, ventasKg, margen, margenSobreCosto }
  }, [data])

  return (
    <>
      {/* KPIs totales del período */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KPI label="🛒 COMPRAS"
             valor={fmt(totales.comprasMonto)}
             sub={`${fmtK(totales.comprasKg)} comprados`}
             color="#ff8b8b" />
        <KPI label="💵 VENTAS"
             valor={fmt(totales.ventasMonto)}
             sub={`${fmtK(totales.ventasKg)} vendidos`}
             color="var(--gold)" />
        <KPI label="📈 GANANCIA BRUTA"
             valor={fmt(totales.ventasMonto - totales.comprasMonto)}
             sub={`${fmtPct(totales.margen)} sobre ventas`}
             color={totales.margen >= 0 ? '#7dff7d' : '#ff8b8b'} />
        <KPI label="🎯 MARKUP SOBRE COSTO"
             valor={fmtPct(totales.margenSobreCosto)}
             sub="(Venta − Costo) / Costo"
             color={totales.margenSobreCosto >= 0 ? '#7dff7d' : '#ff8b8b'} />
      </div>

      {/* Tabla semanal */}
      <div className="card">
        <div className="card-title">📅 Desglose semanal</div>
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: -8, marginBottom: 10 }}>
          ⚠️ Las compras y ventas de una misma semana NO son del mismo lote (algo comprado hace 2 semanas
          se vende esta semana). El % es referencial — sirve para ver tendencia, no es el margen real por producto.
        </p>
        {semanas.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin datos en el período.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Semana</th>
                  <th style={{ textAlign: 'right', color: '#ff8b8b' }}>Compras $</th>
                  <th style={{ textAlign: 'right', color: '#ff8b8b' }}>Compras kg</th>
                  <th style={{ textAlign: 'right', color: 'var(--gold)' }}>Ventas $</th>
                  <th style={{ textAlign: 'right', color: 'var(--gold)' }}>Ventas kg</th>
                  <th style={{ textAlign: 'right' }}>Ganancia $</th>
                  <th style={{ textAlign: 'right' }}>% s/venta</th>
                  <th style={{ textAlign: 'right' }}>% s/costo</th>
                </tr>
              </thead>
              <tbody>
                {semanas.map(s => {
                  const ganancia = s.ventasMonto - s.comprasMonto
                  const pctVenta = s.ventasMonto > 0 ? (ganancia / s.ventasMonto) * 100 : 0
                  const pctCosto = s.comprasMonto > 0 ? (ganancia / s.comprasMonto) * 100 : 0
                  const colorG = ganancia >= 0 ? '#7dff7d' : '#ff8b8b'
                  return (
                    <tr key={s.semanaIni} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 4px', fontWeight: 600 }}>{s.semanaIni} → {s.semanaFin}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: '#ff8b8b' }}>{fmt(s.comprasMonto)}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted)' }}>{fmtK(s.comprasKg)}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--gold)', fontWeight: 700 }}>{fmt(s.ventasMonto)}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted)' }}>{fmtK(s.ventasKg)}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: colorG, fontWeight: 700 }}>{fmt(ganancia)}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: colorG }}>{fmtPct(pctVenta)}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: colorG }}>{fmtPct(pctCosto)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Comparativa kg comprados vs vendidos por categoría */}
      <ComparativaKgCategoria data={data} />
    </>
  )
}

function ComparativaKgCategoria({ data }) {
  const stats = useMemo(() => {
    const compras = {}  // tipo → kg
    const ventas  = {}  // categoria → kg

    data.entradas.forEach(e => {
      const t = e.tipo || 'otros'
      compras[t] = (compras[t] || 0) + (Number(e.kg) || 0)
    })

    const acumularItems = (items) => {
      ;(items || []).forEach(i => {
        const c = i.categoria || 'otros'
        ventas[c] = (ventas[c] || 0) + (Number(i.kg) || 0)
      })
    }
    data.ventasCaja.forEach(v => acumularItems(v.items))
    data.pedidos.forEach(p => acumularItems(p.items))
    // salidas_deposito no tiene categoría, le ponemos genérico bovino_mr por defecto
    data.salidas.forEach(s => {
      const c = s.tipo || 'otros'
      ventas[c] = (ventas[c] || 0) + (Number(s.kg) || 0)
    })

    const claves = new Set([...Object.keys(compras), ...Object.keys(ventas)])
    return Array.from(claves).map(k => ({
      categoria: k,
      kgComprado: compras[k] || 0,
      kgVendido: ventas[k] || 0,
      diff: (compras[k] || 0) - (ventas[k] || 0),
    })).sort((a, b) => b.kgComprado - a.kgComprado)
  }, [data])

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title">⚖️ Kg comprados vs vendidos por categoría</div>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: -8, marginBottom: 10 }}>
        Diferencia = stock que quedó (positivo) o merma/sobreventa (negativo).
        Las categorías de venta usan los nombres internos del sistema.
      </p>
      {stats.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin movimientos.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, minWidth: 500 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Categoría / Tipo</th>
                <th style={{ textAlign: 'right', color: '#ff8b8b' }}>Comprado</th>
                <th style={{ textAlign: 'right', color: 'var(--gold)' }}>Vendido</th>
                <th style={{ textAlign: 'right' }}>Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(s => (
                <tr key={s.categoria} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 4px', fontWeight: 600 }}>{s.categoria}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: '#ff8b8b' }}>{fmtK(s.kgComprado)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--gold)' }}>{fmtK(s.kgVendido)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 700,
                               color: Math.abs(s.diff) < 0.01 ? 'var(--muted)' : s.diff > 0 ? '#7dff7d' : '#ff8b8b' }}>
                    {s.diff > 0 ? '+' : ''}{fmtK(s.diff)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 👥 POR CLIENTE — ranking
// ═══════════════════════════════════════════════════════════════
export function ReporteCliente({ data }) {
  const ranking = useMemo(() => {
    // Mayoristas: salidas_deposito + pedidos confirmados
    const acc = {}  // cliente_nombre → { compras, total, kg, ultimaCompra }
    const sumar = (nombre, total, kg, fecha) => {
      if (!nombre) return
      if (!acc[nombre]) acc[nombre] = { nombre, compras: 0, total: 0, kg: 0, ultimaCompra: '' }
      acc[nombre].compras += 1
      acc[nombre].total += total
      acc[nombre].kg += kg
      if (!acc[nombre].ultimaCompra || fecha > acc[nombre].ultimaCompra) acc[nombre].ultimaCompra = fecha
    }
    data.salidas.forEach(s => sumar(s.cliente_nombre, Number(s.total) || 0, Number(s.kg) || 0, s.fecha))
    data.pedidos.forEach(p => {
      const kgPed = (p.items || []).reduce((a, i) => a + (Number(i.kg) || 0), 0)
      sumar(p.cliente_nombre, Number(p.total_estimado) || 0, kgPed, p.dia_entrega || p.fecha)
    })
    return Object.values(acc).sort((a, b) => b.total - a.total)
  }, [data])

  const totalMayorista = ranking.reduce((s, r) => s + r.total, 0)
  const totalCaja      = sumarVentasMontoSoloCaja(data)

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KPI label="👥 CLIENTES MAYORISTAS ACTIVOS" valor={ranking.length} sub={`En el período`} color="var(--gold)" />
        <KPI label="💰 FACTURADO MAYORISTA" valor={fmt(totalMayorista)} sub={`Total clientes`} color="#7a9dff" />
        <KPI label="🏪 FACTURADO CAJA (sin cliente)" valor={fmt(totalCaja)} sub={`Venta minorista directa`} color="#7dff7d" />
      </div>

      <div className="card">
        <div className="card-title">🏆 Ranking de clientes mayoristas</div>
        {ranking.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin operaciones de clientes en el período.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', width: 30 }}>#</th>
                  <th style={{ textAlign: 'left' }}>Cliente</th>
                  <th style={{ textAlign: 'right' }}>Operaciones</th>
                  <th style={{ textAlign: 'right' }}>Kg</th>
                  <th style={{ textAlign: 'right' }}>Ticket prom.</th>
                  <th style={{ textAlign: 'right', color: 'var(--gold)' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Última compra</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((c, i) => {
                  const ticket = c.compras > 0 ? c.total / c.compras : 0
                  return (
                    <tr key={c.nombre} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 4px', color: 'var(--muted)' }}>{i + 1}</td>
                      <td style={{ padding: '6px 4px', fontWeight: 600 }}>{c.nombre}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted)' }}>{c.compras}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted)' }}>{fmtK(c.kg)}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmt(ticket)}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--gold)', fontWeight: 700 }}>{fmt(c.total)}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>{c.ultimaCompra}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Clientes con deuda */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">💳 Clientes con saldo pendiente</div>
        {data.clientes.filter(c => Number(c.saldo) > 0).length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin clientes con deuda.</p>
        ) : (
          <table style={{ width: '100%', fontSize: 12 }}>
            <tbody>
              {data.clientes
                .filter(c => Number(c.saldo) > 0)
                .sort((a, b) => Number(b.saldo) - Number(a.saldo))
                .slice(0, 15)
                .map(c => (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px', fontWeight: 600 }}>{c.nombre}</td>
                    <td style={{ padding: '6px 4px', color: 'var(--muted)', fontSize: 11 }}>{c.tipo || '—'}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: '#ff8b8b', fontWeight: 700 }}>{fmt(c.saldo)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
// 🥩 POR PRODUCTO — ranking
// ═══════════════════════════════════════════════════════════════
export function ReporteProducto({ data }) {
  const ranking = useMemo(() => {
    const acc = {}
    const agregar = (items) => {
      ;(items || []).forEach(i => {
        const k = i.descripcion || '—'
        if (!acc[k]) acc[k] = { nombre: k, categoria: i.categoria || '—', kg: 0, importe: 0, ops: 0 }
        acc[k].kg      += Number(i.kg) || 0
        acc[k].importe += Number(i.importe) || Number(i.subtotal) || 0
        acc[k].ops     += 1
      })
    }
    data.ventasCaja.forEach(v => agregar(v.items))
    data.pedidos.forEach(p => agregar(p.items))
    return Object.values(acc).sort((a, b) => b.importe - a.importe)
  }, [data])

  const porCategoria = useMemo(() => {
    const acc = {}
    ranking.forEach(r => {
      const c = r.categoria
      if (!acc[c]) acc[c] = { categoria: c, importe: 0, kg: 0, productos: 0 }
      acc[c].importe   += r.importe
      acc[c].kg        += r.kg
      acc[c].productos += 1
    })
    return Object.values(acc).sort((a, b) => b.importe - a.importe)
  }, [ranking])

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">📂 Resumen por categoría</div>
        {porCategoria.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin ventas en el período.</p>
        ) : (
          <table style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Categoría</th>
                <th style={{ textAlign: 'right' }}>Productos distintos</th>
                <th style={{ textAlign: 'right' }}>Kg vendidos</th>
                <th style={{ textAlign: 'right', color: 'var(--gold)' }}>Facturado</th>
              </tr>
            </thead>
            <tbody>
              {porCategoria.map(c => (
                <tr key={c.categoria} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 4px', fontWeight: 600 }}>{c.categoria}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted)' }}>{c.productos}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtK(c.kg)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--gold)', fontWeight: 700 }}>{fmt(c.importe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-title">🏆 Top productos del período</div>
        {ranking.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin ventas en el período.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', width: 30 }}>#</th>
                  <th style={{ textAlign: 'left' }}>Producto</th>
                  <th style={{ textAlign: 'left' }}>Categoría</th>
                  <th style={{ textAlign: 'right' }}>Ops</th>
                  <th style={{ textAlign: 'right' }}>Kg</th>
                  <th style={{ textAlign: 'right', color: 'var(--gold)' }}>Facturado</th>
                </tr>
              </thead>
              <tbody>
                {ranking.slice(0, 50).map((p, i) => (
                  <tr key={p.nombre} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px', color: 'var(--muted)' }}>{i + 1}</td>
                    <td style={{ padding: '6px 4px', fontWeight: 600 }}>{p.nombre}</td>
                    <td style={{ padding: '6px 4px', color: 'var(--muted)', fontSize: 11 }}>{p.categoria}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted)' }}>{p.ops}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtK(p.kg)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--gold)', fontWeight: 700 }}>{fmt(p.importe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ranking.length > 50 && (
              <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 8 }}>
                Mostrando top 50 de {ranking.length} productos.
              </p>
            )}
          </div>
        )}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
// ⚖️ MINORISTA VS MAYORISTA — comparativa
// ═══════════════════════════════════════════════════════════════
export function ReporteCanal({ data }) {
  const stats = useMemo(() => {
    const caja = {
      total: data.ventasCaja.reduce((s, v) => s + (Number(v.total) || 0), 0),
      kg:    data.ventasCaja.reduce((s, v) => s + (v.items || []).reduce((a, i) => a + (Number(i.kg) || 0), 0), 0),
      ops:   data.ventasCaja.length,
    }
    const mayorista = {
      total: data.salidas.reduce((s, x) => s + (Number(x.total) || 0), 0)
           + data.pedidos.reduce((s, p) => s + (Number(p.total_estimado) || 0), 0),
      kg:    data.salidas.reduce((s, x) => s + (Number(x.kg) || 0), 0)
           + data.pedidos.reduce((s, p) => s + (p.items || []).reduce((a, i) => a + (Number(i.kg) || 0), 0), 0),
      ops:   data.salidas.length + data.pedidos.length,
    }
    const ticketCaja      = caja.ops > 0 ? caja.total / caja.ops : 0
    const ticketMayorista = mayorista.ops > 0 ? mayorista.total / mayorista.ops : 0
    const totalGral       = caja.total + mayorista.total
    const pctCaja         = totalGral > 0 ? (caja.total / totalGral) * 100 : 0
    const pctMayorista    = totalGral > 0 ? (mayorista.total / totalGral) * 100 : 0
    const precioPromCaja      = caja.kg > 0 ? caja.total / caja.kg : 0
    const precioPromMayorista = mayorista.kg > 0 ? mayorista.total / mayorista.kg : 0
    return { caja, mayorista, ticketCaja, ticketMayorista, pctCaja, pctMayorista, totalGral, precioPromCaja, precioPromMayorista }
  }, [data])

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
        <CanalCard
          titulo="🏪 MINORISTA (Caja)"
          color="var(--gold)"
          total={stats.caja.total}
          kg={stats.caja.kg}
          ops={stats.caja.ops}
          ticket={stats.ticketCaja}
          precioProm={stats.precioPromCaja}
          pct={stats.pctCaja}
        />
        <CanalCard
          titulo="📦 MAYORISTA (Despachos + Pedidos)"
          color="#7a9dff"
          total={stats.mayorista.total}
          kg={stats.mayorista.kg}
          ops={stats.mayorista.ops}
          ticket={stats.ticketMayorista}
          precioProm={stats.precioPromMayorista}
          pct={stats.pctMayorista}
        />
      </div>

      <div className="card">
        <div className="card-title">📊 Comparativa lado a lado</div>
        <table style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Métrica</th>
              <th style={{ textAlign: 'right', color: 'var(--gold)' }}>Minorista</th>
              <th style={{ textAlign: 'right', color: '#7a9dff' }}>Mayorista</th>
              <th style={{ textAlign: 'right' }}>Diferencia</th>
            </tr>
          </thead>
          <tbody>
            <FilaComp label="Facturación total"    a={stats.caja.total}      b={stats.mayorista.total}      fmtFn={fmt} />
            <FilaComp label="Kilos vendidos"       a={stats.caja.kg}         b={stats.mayorista.kg}         fmtFn={fmtK} />
            <FilaComp label="Operaciones"          a={stats.caja.ops}        b={stats.mayorista.ops}        fmtFn={n => Math.round(n).toString()} />
            <FilaComp label="Ticket promedio"      a={stats.ticketCaja}      b={stats.ticketMayorista}      fmtFn={fmt} />
            <FilaComp label="Precio promedio / kg" a={stats.precioPromCaja}  b={stats.precioPromMayorista}  fmtFn={fmt} />
          </tbody>
        </table>
      </div>
    </>
  )
}

function CanalCard({ titulo, color, total, kg, ops, ticket, precioProm, pct }) {
  return (
    <div className="card" style={{ padding: 16, borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1, marginBottom: 6 }}>{titulo}</div>
      <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 36, color, lineHeight: 1.1 }}>{fmt(total)}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
        <strong style={{ color }}>{fmtPct(pct)}</strong> del total
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
        <Mini label="Kg" valor={fmtK(kg)} />
        <Mini label="Ops" valor={ops.toLocaleString('es-AR')} />
        <Mini label="Ticket" valor={fmt(ticket)} />
        <Mini label="$/kg" valor={fmt(precioProm)} />
      </div>
    </div>
  )
}

function Mini({ label, valor }) {
  return (
    <div style={{ background: 'var(--surface2)', padding: '6px 10px', borderRadius: 6 }}>
      <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{valor}</div>
    </div>
  )
}

function FilaComp({ label, a, b, fmtFn }) {
  const diff = a - b
  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '8px 4px', fontWeight: 600 }}>{label}</td>
      <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--gold)' }}>{fmtFn(a)}</td>
      <td style={{ padding: '8px 4px', textAlign: 'right', color: '#7a9dff' }}>{fmtFn(b)}</td>
      <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--muted)' }}>
        {Math.abs(diff) < 0.01 ? '—' : `${diff > 0 ? '+' : ''}${fmtFn(Math.abs(diff))}`}
      </td>
    </tr>
  )
}

// ═══════════════════════════════════════════════════════════════
// 🕐 TEMPORAL — día de semana / hora del día
// ═══════════════════════════════════════════════════════════════
export function ReporteTemporal({ data }) {
  const porDia = useMemo(() => {
    const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
    const acc = dias.map(d => ({ dia: d, total: 0, ops: 0 }))
    data.ventasCaja.forEach(v => {
      const d = new Date(v.fecha + 'T12:00').getDay()
      acc[d].total += Number(v.total) || 0
      acc[d].ops   += 1
    })
    return acc
  }, [data])

  const porHora = useMemo(() => {
    const acc = Array.from({ length: 24 }, (_, h) => ({ hora: h, total: 0, ops: 0 }))
    data.ventasCaja.forEach(v => {
      if (!v.hora) return
      const h = parseInt(String(v.hora).slice(0, 2), 10)
      if (h >= 0 && h < 24) {
        acc[h].total += Number(v.total) || 0
        acc[h].ops   += 1
      }
    })
    return acc
  }, [data])

  const maxDia  = Math.max(1, ...porDia.map(d => d.total))
  const maxHora = Math.max(1, ...porHora.map(h => h.total))

  const mejorDia  = porDia.reduce((a, b) => b.total > a.total ? b : a, porDia[0])
  const peorDia   = porDia.filter(d => d.ops > 0).reduce((a, b) => b.total < a.total ? b : a, { total: Infinity })
  const horaPico  = porHora.reduce((a, b) => b.total > a.total ? b : a, porHora[0])

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KPI label="🏆 MEJOR DÍA"     valor={mejorDia.dia} sub={fmt(mejorDia.total)} color="#7dff7d" />
        <KPI label="📉 PEOR DÍA"      valor={peorDia.dia || '—'} sub={peorDia.total !== Infinity ? fmt(peorDia.total) : 'Sin datos'} color="#ff8b8b" />
        <KPI label="⏰ HORA PICO"     valor={`${String(horaPico.hora).padStart(2, '0')}:00`} sub={fmt(horaPico.total)} color="var(--gold)" />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">📅 Facturación por día de semana</div>
        {porDia.every(d => d.ops === 0) ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin ventas en el período.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {porDia.map(d => (
              <div key={d.dia}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ fontWeight: 600 }}>{d.dia}</span>
                  <span style={{ color: 'var(--muted)' }}>{d.ops} ops · <strong style={{ color: 'var(--gold)' }}>{fmt(d.total)}</strong></span>
                </div>
                <div style={{ height: 10, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${(d.total / maxDia) * 100}%`, height: '100%', background: 'var(--gold)' }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">⏰ Facturación por hora del día</div>
        {porHora.every(h => h.ops === 0) ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin datos de hora en las ventas.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {porHora.filter(h => h.ops > 0).map(h => (
              <div key={h.hora}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                  <span style={{ fontWeight: 600, minWidth: 50 }}>{String(h.hora).padStart(2, '0')}:00</span>
                  <span style={{ color: 'var(--muted)' }}>{h.ops} ops · <strong style={{ color: 'var(--gold)' }}>{fmt(h.total)}</strong></span>
                </div>
                <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${(h.total / maxHora) * 100}%`, height: '100%', background: '#7a9dff' }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function KPI({ label, valor, sub, color }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 32, color: color || 'var(--gold)', lineHeight: 1.1 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function sumarVentasMonto(data) {
  return data.ventasCaja.reduce((s, v) => s + (Number(v.total) || 0), 0)
       + data.salidas.reduce((s, x) => s + (Number(x.total) || 0), 0)
       + data.pedidos.reduce((s, p) => s + (Number(p.total_estimado) || 0), 0)
}
function sumarVentasMontoSoloCaja(data) {
  return data.ventasCaja.reduce((s, v) => s + (Number(v.total) || 0), 0)
}
function sumarVentasKg(data) {
  const kgCaja = data.ventasCaja.reduce((s, v) =>
    s + (v.items || []).reduce((a, i) => a + (Number(i.kg) || 0), 0), 0)
  const kgSal  = data.salidas.reduce((s, x) => s + (Number(x.kg) || 0), 0)
  const kgPed  = data.pedidos.reduce((s, p) =>
    s + (p.items || []).reduce((a, i) => a + (Number(i.kg) || 0), 0), 0)
  return kgCaja + kgSal + kgPed
}

function agruparPorSemana(data) {
  // Agrupamos por semana ISO (lunes a domingo)
  const semanas = {}  // 'YYYY-WW' → { semanaIni, semanaFin, comprasMonto, comprasKg, ventasMonto, ventasKg }
  const keyDe = (fechaStr) => {
    const d = new Date(fechaStr + 'T12:00')
    const dia = d.getDay()
    const offsetALunes = dia === 0 ? -6 : 1 - dia
    const lunes = new Date(d)
    lunes.setDate(d.getDate() + offsetALunes)
    const domingo = new Date(lunes)
    domingo.setDate(lunes.getDate() + 6)
    const fmtDate = (x) => x.toISOString().slice(0, 10)
    return { key: fmtDate(lunes), ini: fmtDate(lunes), fin: fmtDate(domingo) }
  }
  const inicializar = (k, ini, fin) => {
    if (!semanas[k]) semanas[k] = { semanaIni: ini, semanaFin: fin, comprasMonto: 0, comprasKg: 0, ventasMonto: 0, ventasKg: 0 }
  }

  data.entradas.forEach(e => {
    if (!e.fecha) return
    const { key, ini, fin } = keyDe(e.fecha)
    inicializar(key, ini, fin)
    semanas[key].comprasMonto += Number(e.importe) || 0
    semanas[key].comprasKg    += Number(e.kg) || 0
  })

  data.ventasCaja.forEach(v => {
    if (!v.fecha) return
    const { key, ini, fin } = keyDe(v.fecha)
    inicializar(key, ini, fin)
    semanas[key].ventasMonto += Number(v.total) || 0
    semanas[key].ventasKg    += (v.items || []).reduce((a, i) => a + (Number(i.kg) || 0), 0)
  })

  data.salidas.forEach(x => {
    if (!x.fecha) return
    const { key, ini, fin } = keyDe(x.fecha)
    inicializar(key, ini, fin)
    semanas[key].ventasMonto += Number(x.total) || 0
    semanas[key].ventasKg    += Number(x.kg) || 0
  })

  data.pedidos.forEach(p => {
    const fecha = p.dia_entrega || p.fecha
    if (!fecha) return
    const { key, ini, fin } = keyDe(fecha)
    inicializar(key, ini, fin)
    semanas[key].ventasMonto += Number(p.total_estimado) || 0
    semanas[key].ventasKg    += (p.items || []).reduce((a, i) => a + (Number(i.kg) || 0), 0)
  })

  return Object.values(semanas).sort((a, b) => b.semanaIni.localeCompare(a.semanaIni))
}
