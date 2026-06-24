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
//
// Además carga datos de COSTO en una ventana fija de 180 días (despostes,
// cajas_stock y entradas) — sirven para calcular el costo promedio
// ponderado de cada producto en ReporteProducto. Se usa una ventana
// fija (no del período) porque el "costo promedio" tiene sentido
// estable en el tiempo, no se calcula sólo con lo del período actual.
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
      // Ventana para calcular costos: últimos 180 días (o el período si es mayor)
      const desdeCosto = desde < fechaRelativaARG(-180) ? desde : fechaRelativaARG(-180)

      const [entradas, salidas, ventasCaja, pedidos, clientes,
             despostesCosto, cajasCosto, preciosLookup, entradasCosto,
             gastos, sueldos, pagosProveedores, movimientosCtacte] = await Promise.all([
        supabase.from('entradas_deposito').select('*').eq('eliminado', false).gte('fecha', desde).lte('fecha', hoy),
        supabase.from('salidas_deposito').select('*').gte('fecha', desde).lte('fecha', hoy),
        supabase.from('ventas_minoristas').select('*').eq('origen', 'caja').gte('fecha', desde).lte('fecha', hoy),
        supabase.from('pedidos').select('*').gte('dia_entrega', desde).lte('dia_entrega', hoy).eq('estado', 'confirmado'),
        supabase.from('clientes').select('id, nombre, tipo, lista_precios, saldo'),
        // Cost data (ventana 180d)
        supabase.from('despostes').select('piezas, fecha').gte('fecha', desdeCosto).lte('fecha', hoy),
        supabase.from('cajas_stock').select('producto_id, precio_costo_kg, kg, fecha_ingreso').gte('fecha_ingreso', desdeCosto),
        supabase.from('precios').select('id, nombre, categoria, kg_por_unidad, precio_minorista, precio_mayorista, precio_carniceria'),
        supabase.from('entradas_deposito').select('descripcion, tipo, kg, precio_kg, fecha').eq('eliminado', false).gte('fecha', desdeCosto).lte('fecha', hoy),
        // Finanzas (Flujo / Gastos)
        supabase.from('gastos').select('*').gte('fecha', desde).lte('fecha', hoy),
        supabase.from('liquidaciones_sueldos').select('*').gte('semana_inicio', desde).lte('semana_fin', hoy),
        supabase.from('pagos_proveedores').select('*').gte('fecha', desde).lte('fecha', hoy),
        supabase.from('movimientos_ctacte').select('*').gte('fecha', desde).lte('fecha', hoy),
      ])

      if (cancelado) return

      // Filtrar movimientos internos del depósito (NO son ventas reales):
      //   - cobro === 'interno' → conversiones de pieza a cortes (CONVERSIÓN A CORTES)
      //   - lista === 'desposte' → backstop por si quedaron registros viejos sin cobro
      //   - cliente_id === null + cliente_nombre matchea patrones internos
      // Si no se filtra, aparece "CONVERSIÓN A CORTES" como cliente #1 mayorista
      // y los reportes de Margen y Minorista-vs-Mayorista quedan inflados.
      const esFlujoInterno = (s) => {
        if (s.cobro === 'interno') return true
        if (s.lista === 'desposte') return true
        if (!s.cliente_id) {
          const n = (s.cliente_nombre || '').toUpperCase()
          if (n.includes('CONVERSI') || n.includes('AJUSTE') || n.includes('MERMA') || n.includes('FLUJO')) return true
        }
        return false
      }
      const salidasReales = (salidas.data || []).filter(s => !esFlujoInterno(s))

      setData({
        // Excluir movimientos internos del depósito (no son compras a proveedor):
        // 'desposte' = piezas de despostar una media res ya comprada (importe 0),
        // 'elaboracion' = embutidos elaborados. Si no, inflan los KG comprados.
        entradas: (entradas.data || []).filter(e => e.destino !== 'desposte' && e.destino !== 'elaboracion'),
        salidas: salidasReales,
        ventasCaja: ventasCaja.data || [],
        pedidos: pedidos.data || [],
        clientes: clientes.data || [],
        // Cost data (180d window) — usado por ReporteProducto para margen real
        costoFuentes: {
          despostes: despostesCosto.data || [],
          cajas: cajasCosto.data || [],
          precios: preciosLookup.data || [],
          entradas: entradasCosto.data || [],
        },
        // Finanzas (Flujo, Gastos). Los "solo balance" (facturas a nombre de la
        // SAS que paga un tercero, ej: luz Alvear) no son gastos nuestros.
        gastos: (gastos.data || []).filter(g => !g.solo_balance),
        sueldos: sueldos.data || [],
        pagosProveedores: pagosProveedores.data || [],
        movimientosCtacte: movimientosCtacte.data || [],
        desde, hasta: hoy,
      })
      setLoading(false)
    }
    cargar()
    return () => { cancelado = true }
  }, [periodo])

  return { loading, data }
}

// ───────────────────────────────────────────────────────────────
// Construye un mapa { NOMBRE_PRODUCTO_UPPER → costoKg ponderado }
// a partir de las 3 fuentes de costo (180d):
//   - despostes.piezas[]   → cada pieza tiene nombre + kg + precio_costo_kg
//   - cajas_stock          → producto_id se resuelve via precios.nombre
//   - entradas_deposito    → matching por descripcion exacta
//
// Cada fuente aporta (kg, costoTotal). El promedio final es ponderado por kg.
// Si un producto vendido no aparece en ninguna fuente → costoKg = null
// (la UI muestra "—" y no calcula margen para ese item).
// ───────────────────────────────────────────────────────────────
export function construirCostoPorProducto(costoFuentes) {
  if (!costoFuentes) return {}
  const acc = {}  // key → { kgTotal, costoTotal }
  const agregar = (nombre, kg, precioCostoKg) => {
    const n = (nombre || '').toString().toUpperCase().trim()
    const k = Number(kg) || 0
    const c = Number(precioCostoKg) || 0
    if (!n || k <= 0 || c <= 0) return
    if (!acc[n]) acc[n] = { kgTotal: 0, costoTotal: 0 }
    acc[n].kgTotal   += k
    acc[n].costoTotal += k * c
  }

  // 1) despostes → piezas individuales
  ;(costoFuentes.despostes || []).forEach(d => {
    ;(d.piezas || []).forEach(p => agregar(p.nombre, p.kg, p.precio_costo_kg))
  })

  // 2) cajas_stock → resolver producto_id a nombre via precios
  const precioById = {}
  ;(costoFuentes.precios || []).forEach(p => { precioById[p.id] = p })
  ;(costoFuentes.cajas || []).forEach(c => {
    if (!c.producto_id) return
    const prod = precioById[c.producto_id]
    if (prod) agregar(prod.nombre, c.kg, c.precio_costo_kg)
  })

  // 3) entradas_deposito → matching por descripcion exacta
  ;(costoFuentes.entradas || []).forEach(e => {
    agregar(e.descripcion, e.kg, e.precio_kg)
  })

  // Calcular promedio ponderado
  const result = {}
  Object.entries(acc).forEach(([k, v]) => {
    result[k] = v.kgTotal > 0 ? v.costoTotal / v.kgTotal : null
  })
  return result
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
// 📦 CAJAS — dashboard de tracking individual de cajas CB/PT
// ═══════════════════════════════════════════════════════════════
// Snapshot del estado actual de cajas_stock + ventas en el período.
// Carga su propia data (no usa useReportesData) porque el stock
// disponible es estado actual, no histórico.
//
// Recibe `periodo` para mostrar ventas de cajas dentro de ese rango.
export function ReporteCajas({ periodo }) {
  const [loading, setLoading] = useState(true)
  const [cajas, setCajas] = useState([])
  const [productos, setProductos] = useState([])

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setLoading(true)
      const [{ data: cjs }, { data: prods }] = await Promise.all([
        supabase.from('cajas_stock').select('*'),
        supabase.from('precios').select('id, nombre, categoria')
          .in('categoria', ['bovino_caja_cb', 'bovino_caja_pt']),
      ])
      if (cancelado) return
      setCajas(cjs || [])
      setProductos(prods || [])
      setLoading(false)
    }
    cargar()
    return () => { cancelado = true }
  }, [])

  const productoNombre = (id) => productos.find(p => p.id === id)?.nombre || null

  const disp = useMemo(() => cajas.filter(c => c.estado === 'disponible'), [cajas])

  const stats = useMemo(() => {
    const cb = disp.filter(c => c.tipo_caja === 'CB')
    const pt = disp.filter(c => c.tipo_caja === 'PT')
    const kgCB = cb.reduce((s, c) => s + Number(c.kg || 0), 0)
    const kgPT = pt.reduce((s, c) => s + Number(c.kg || 0), 0)
    const sinAsignar = disp.filter(c => !c.producto_id).length
    return {
      cantTotal: disp.length,
      cantCB: cb.length, cantPT: pt.length,
      kgCB, kgPT, kgTotal: kgCB + kgPT,
      promCB: cb.length > 0 ? kgCB / cb.length : 0,
      promPT: pt.length > 0 ? kgPT / pt.length : 0,
      sinAsignar,
    }
  }, [disp])

  // Desglose por producto: cant, kg total, peso prom, min, max, antigüedad prom
  const porProducto = useMemo(() => {
    const acc = {}  // producto_id → { ... }
    const hoy = new Date()
    disp.forEach(c => {
      const key = c.producto_id || `__sin__${c.tipo_caja}`
      if (!acc[key]) acc[key] = {
        productoId: c.producto_id,
        nombre: c.producto_id ? (productoNombre(c.producto_id) || `Producto borrado (${c.tipo_caja})`) : `⚠️ Sin asignar (${c.tipo_caja})`,
        tipo: c.tipo_caja,
        cant: 0, kgTotal: 0, kgMin: Infinity, kgMax: 0, edades: [],
      }
      const kg = Number(c.kg || 0)
      acc[key].cant += 1
      acc[key].kgTotal += kg
      if (kg < acc[key].kgMin) acc[key].kgMin = kg
      if (kg > acc[key].kgMax) acc[key].kgMax = kg
      if (c.fecha_ingreso) {
        const dias = Math.floor((hoy - new Date(c.fecha_ingreso + 'T12:00')) / (1000 * 60 * 60 * 24))
        acc[key].edades.push(dias)
      }
    })
    return Object.values(acc).map(p => ({
      ...p,
      promKg: p.cant > 0 ? p.kgTotal / p.cant : 0,
      promEdad: p.edades.length > 0 ? p.edades.reduce((a, b) => a + b, 0) / p.edades.length : 0,
      kgMin: p.kgMin === Infinity ? 0 : p.kgMin,
    })).sort((a, b) => b.cant - a.cant)
  }, [disp, productos])

  // Alertas: viejas, sin asignar, productos configurados con stock CERO
  const alertas = useMemo(() => {
    const hoy = new Date()
    const viejas = disp.filter(c => {
      if (!c.fecha_ingreso) return false
      const dias = Math.floor((hoy - new Date(c.fecha_ingreso + 'T12:00')) / (1000 * 60 * 60 * 24))
      return dias > 15
    })
    const productosConStock = new Set(disp.map(c => c.producto_id).filter(Boolean))
    const sinStock = productos.filter(p => !productosConStock.has(p.id))
    return { viejas, sinStock }
  }, [disp, productos])

  // Outliers: top 5 más pesadas y top 5 más livianas (para detectar errores de carga)
  const outliers = useMemo(() => {
    const ordenadas = [...disp].sort((a, b) => Number(b.kg || 0) - Number(a.kg || 0))
    return {
      pesadas: ordenadas.slice(0, 5),
      livianas: ordenadas.slice(-5).reverse(),
    }
  }, [disp])

  // Cajas vendidas en el período (para la sección de ventas)
  const ventasPeriodo = useMemo(() => {
    const hoy = fechaHoyARG()
    let desde
    if (periodo === 'anio') desde = hoy.slice(0, 4) + '-01-01'
    else desde = fechaRelativaARG(-PERIODOS[periodo].dias + 1)
    return cajas.filter(c => c.estado === 'vendida' && c.fecha_salida && c.fecha_salida >= desde && c.fecha_salida <= hoy)
  }, [cajas, periodo])

  const ventasStats = useMemo(() => {
    const total = ventasPeriodo.reduce((s, c) => s + (Number(c.total_venta) || 0), 0)
    const kg    = ventasPeriodo.reduce((s, c) => s + (Number(c.kg) || 0), 0)
    const costo = ventasPeriodo.reduce((s, c) =>
      s + (Number(c.precio_costo_kg) || 0) * (Number(c.kg) || 0), 0)
    const ganancia = total - costo
    const margen   = total > 0 ? (ganancia / total) * 100 : 0
    return { cant: ventasPeriodo.length, total, kg, costo, ganancia, margen }
  }, [ventasPeriodo])

  // Ventas por producto en el período
  const ventasPorProducto = useMemo(() => {
    const acc = {}
    ventasPeriodo.forEach(c => {
      const nombre = c.producto_id ? (productoNombre(c.producto_id) || 'Sin asignar') : `Sin asignar (${c.tipo_caja})`
      if (!acc[nombre]) acc[nombre] = { nombre, cant: 0, kg: 0, total: 0 }
      acc[nombre].cant  += 1
      acc[nombre].kg    += Number(c.kg) || 0
      acc[nombre].total += Number(c.total_venta) || 0
    })
    return Object.values(acc).sort((a, b) => b.total - a.total)
  }, [ventasPeriodo, productos])

  if (loading) return <p style={{ color: 'var(--muted)' }}>Cargando cajas...</p>

  return (
    <>
      {/* KPIs principales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KPI label="📦 TOTAL DISPONIBLES" valor={stats.cantTotal} sub={`${fmtK(stats.kgTotal)} en stock`} color="var(--gold)" />
        <KPI label="🐄 CAJAS CB" valor={stats.cantCB} sub={`${fmtK(stats.kgCB)} · prom ${fmtK(stats.promCB)}`} color="#7db5ff" />
        <KPI label="🥩 CAJAS PT" valor={stats.cantPT} sub={`${fmtK(stats.kgPT)} · prom ${fmtK(stats.promPT)}`} color="#ffd17a" />
        <KPI label={stats.sinAsignar > 0 ? '⚠️ SIN PRODUCTO' : '✅ TODAS ASIGNADAS'}
             valor={stats.sinAsignar}
             sub={stats.sinAsignar > 0 ? 'Asignalas en Depósito > Cajas' : 'Todo en orden'}
             color={stats.sinAsignar > 0 ? '#ff8b8b' : '#7dff7d'} />
      </div>

      {/* Alertas */}
      {(alertas.viejas.length > 0 || alertas.sinStock.length > 0) && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid #ffd17a' }}>
          <div className="card-title" style={{ color: '#ffd17a' }}>🚨 Alertas</div>
          {alertas.viejas.length > 0 && (
            <div style={{ marginBottom: 8, fontSize: 13 }}>
              <strong style={{ color: '#ff8b8b' }}>⏳ {alertas.viejas.length} caja{alertas.viejas.length === 1 ? '' : 's'} con más de 15 días en stock</strong>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {alertas.viejas.slice(0, 5).map(c => (
                  <span key={c.id} style={{ marginRight: 12 }}>
                    #{c.id} ({c.tipo_caja}, {fmtK(c.kg)}) — ingreso {c.fecha_ingreso}
                  </span>
                ))}
                {alertas.viejas.length > 5 && ` ... y ${alertas.viejas.length - 5} más`}
              </div>
            </div>
          )}
          {alertas.sinStock.length > 0 && (
            <div style={{ fontSize: 13 }}>
              <strong style={{ color: '#ffd17a' }}>📭 {alertas.sinStock.length} producto{alertas.sinStock.length === 1 ? '' : 's'} sin stock</strong>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {alertas.sinStock.slice(0, 10).map(p => p.nombre).join(' · ')}
                {alertas.sinStock.length > 10 && ` ... y ${alertas.sinStock.length - 10} más`}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Desglose por producto */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">📊 Stock disponible por producto</div>
        {porProducto.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>No hay cajas disponibles en stock.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, minWidth: 700 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Producto</th>
                  <th style={{ textAlign: 'center' }}>Tipo</th>
                  <th style={{ textAlign: 'right' }}>Cajas</th>
                  <th style={{ textAlign: 'right' }}>Kg total</th>
                  <th style={{ textAlign: 'right' }}>Peso prom</th>
                  <th style={{ textAlign: 'right' }}>Min — Max</th>
                  <th style={{ textAlign: 'right' }}>Antigüedad prom</th>
                </tr>
              </thead>
              <tbody>
                {porProducto.map(p => (
                  <tr key={p.nombre} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px', fontWeight: 600 }}>{p.nombre}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                      <span style={{ background: p.tipo === 'CB' ? '#1a2a3a' : '#2a2010', color: p.tipo === 'CB' ? '#7db5ff' : '#ffd17a', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>{p.tipo}</span>
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 700, color: 'var(--gold)' }}>{p.cant}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtK(p.kgTotal)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtK(p.promKg)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>{fmtK(p.kgMin)} — {fmtK(p.kgMax)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: p.promEdad > 15 ? '#ff8b8b' : p.promEdad > 7 ? '#ffd17a' : 'var(--muted)' }}>
                      {p.promEdad.toFixed(0)} d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ventas de cajas en el período */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">💰 Ventas de cajas — {PERIODOS[periodo].label}</div>
        {ventasPeriodo.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin cajas vendidas en este período.</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
              <Mini label="Cajas vendidas" valor={ventasStats.cant} />
              <Mini label="Kg" valor={fmtK(ventasStats.kg)} />
              <Mini label="Facturado" valor={fmt(ventasStats.total)} />
              <Mini label="Costo (estim.)" valor={fmt(ventasStats.costo)} />
              <Mini label="Ganancia" valor={fmt(ventasStats.ganancia)} />
              <Mini label="Margen" valor={fmtPct(ventasStats.margen)} />
            </div>
            <table style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Producto</th>
                  <th style={{ textAlign: 'right' }}>Cajas vend.</th>
                  <th style={{ textAlign: 'right' }}>Kg</th>
                  <th style={{ textAlign: 'right', color: 'var(--gold)' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {ventasPorProducto.map(p => (
                  <tr key={p.nombre} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px', fontWeight: 600 }}>{p.nombre}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted)' }}>{p.cant}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtK(p.kg)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--gold)', fontWeight: 700 }}>{fmt(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* Outliers: top pesadas y livianas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <div className="card">
          <div className="card-title">⚖️ Top 5 más pesadas</div>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: -8, marginBottom: 10 }}>
            Útil para detectar errores de carga (peso típico CB/PT: 5-30 kg).
          </p>
          {outliers.pesadas.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin cajas disponibles.</p>
          ) : (
            <table style={{ width: '100%', fontSize: 12 }}>
              <tbody>
                {outliers.pesadas.map(c => (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px', fontFamily: 'monospace', color: 'var(--muted)' }}>#{c.id}</td>
                    <td style={{ padding: '6px 4px' }}>{c.tipo_caja}</td>
                    <td style={{ padding: '6px 4px', fontSize: 11, color: 'var(--muted)' }}>{productoNombre(c.producto_id) || '⚠️ sin asignar'}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: Number(c.kg) > 30 ? '#ff8b8b' : 'var(--gold)', fontWeight: 700 }}>
                      {fmtK(c.kg)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-title">🪶 Top 5 más livianas</div>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: -8, marginBottom: 10 }}>
            Sospechosas si están por debajo de 5 kg (típico mínimo CB/PT).
          </p>
          {outliers.livianas.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin cajas disponibles.</p>
          ) : (
            <table style={{ width: '100%', fontSize: 12 }}>
              <tbody>
                {outliers.livianas.map(c => (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px', fontFamily: 'monospace', color: 'var(--muted)' }}>#{c.id}</td>
                    <td style={{ padding: '6px 4px' }}>{c.tipo_caja}</td>
                    <td style={{ padding: '6px 4px', fontSize: 11, color: 'var(--muted)' }}>{productoNombre(c.producto_id) || '⚠️ sin asignar'}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: Number(c.kg) < 5 ? '#ff8b8b' : 'var(--gold)', fontWeight: 700 }}>
                      {fmtK(c.kg)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
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
  // Mapa { 'NOMBRE_PRODUCTO_UPPER' → costoKg ponderado } construido a partir
  // de despostes + cajas_stock + entradas_deposito de los últimos 180 días.
  const costoPorProducto = useMemo(() => construirCostoPorProducto(data.costoFuentes), [data.costoFuentes])

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

    // Enriquecer con costo, ganancia, margen
    return Object.values(acc).map(p => {
      const costoKg = costoPorProducto[p.nombre.toUpperCase().trim()] ?? null
      const precioPromVenta = p.kg > 0 ? p.importe / p.kg : 0
      const costoTotal = costoKg != null ? costoKg * p.kg : null
      const ganancia   = costoTotal != null ? p.importe - costoTotal : null
      const margenPct  = (ganancia != null && p.importe > 0) ? (ganancia / p.importe) * 100 : null
      return { ...p, costoKg, precioPromVenta, costoTotal, ganancia, margenPct }
    }).sort((a, b) => b.importe - a.importe)
  }, [data, costoPorProducto])

  const porCategoria = useMemo(() => {
    const acc = {}
    ranking.forEach(r => {
      const c = r.categoria
      if (!acc[c]) acc[c] = { categoria: c, importe: 0, kg: 0, productos: 0, costoTotal: 0, conCosto: 0, sinCosto: 0 }
      acc[c].importe   += r.importe
      acc[c].kg        += r.kg
      acc[c].productos += 1
      if (r.costoTotal != null) {
        acc[c].costoTotal += r.costoTotal
        acc[c].conCosto   += 1
      } else {
        acc[c].sinCosto += 1
      }
    })
    return Object.values(acc).map(c => {
      const ganancia  = c.costoTotal > 0 ? c.importe - c.costoTotal : null
      const margenPct = (ganancia != null && c.importe > 0) ? (ganancia / c.importe) * 100 : null
      return { ...c, ganancia, margenPct }
    }).sort((a, b) => b.importe - a.importe)
  }, [ranking])

  // Stats globales: cuántos productos tienen / no tienen costo
  const cobertura = useMemo(() => {
    const conCosto    = ranking.filter(r => r.costoKg != null).length
    const sinCosto    = ranking.length - conCosto
    const importeCon  = ranking.filter(r => r.costoKg != null).reduce((s, r) => s + r.importe, 0)
    const importeTot  = ranking.reduce((s, r) => s + r.importe, 0)
    const pctImporte  = importeTot > 0 ? (importeCon / importeTot) * 100 : 0
    return { conCosto, sinCosto, pctImporte, totalProductos: ranking.length }
  }, [ranking])

  const colorMargen = (pct) => {
    if (pct == null) return 'var(--muted)'
    if (pct < 0)   return '#ff8b8b'
    if (pct < 15)  return '#ffd17a'
    if (pct < 30)  return '#7dff7d'
    return 'var(--gold)'
  }

  return (
    <>
      {/* Banner de cobertura de costos */}
      <div className="card" style={{ marginBottom: 16, padding: 12, borderLeft: `3px solid ${cobertura.pctImporte >= 70 ? '#7dff7d' : cobertura.pctImporte >= 40 ? '#ffd17a' : '#ff8b8b'}` }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
          📊 <strong style={{ color: 'var(--text)' }}>Cobertura de costos:</strong> {cobertura.conCosto} de {cobertura.totalProductos} productos tienen costo conocido
          {cobertura.sinCosto > 0 && <span style={{ color: '#ff8b8b' }}> · {cobertura.sinCosto} sin datos</span>}
          <span> · cubre <strong>{fmtPct(cobertura.pctImporte)}</strong> del facturado</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
          ℹ️ Costo = promedio ponderado de las últimas compras/despostes (ventana 180 días).
          Los productos sin datos (Costo: —) son los que no aparecen en entradas, despostes ni cajas en esa ventana —
          cargá una compra/desposte y aparecen.
        </div>
      </div>

      {/* Resumen por categoría con margen */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">📂 Resumen por categoría</div>
        {porCategoria.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin ventas en el período.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Categoría</th>
                  <th style={{ textAlign: 'right' }}>Productos</th>
                  <th style={{ textAlign: 'right' }}>Kg</th>
                  <th style={{ textAlign: 'right', color: 'var(--gold)' }}>Facturado</th>
                  <th style={{ textAlign: 'right', color: '#ff8b8b' }}>Costo est.</th>
                  <th style={{ textAlign: 'right' }}>Ganancia</th>
                  <th style={{ textAlign: 'right' }}>Margen %</th>
                </tr>
              </thead>
              <tbody>
                {porCategoria.map(c => (
                  <tr key={c.categoria} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px', fontWeight: 600 }}>{c.categoria}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted)' }}>
                      {c.productos}
                      {c.sinCosto > 0 && <span style={{ color: '#ff8b8b', fontSize: 10 }}> ({c.sinCosto} s/costo)</span>}
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtK(c.kg)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--gold)', fontWeight: 700 }}>{fmt(c.importe)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: '#ff8b8b' }}>{c.costoTotal > 0 ? fmt(c.costoTotal) : '—'}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: colorMargen(c.margenPct), fontWeight: 700 }}>
                      {c.ganancia != null ? fmt(c.ganancia) : '—'}
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: colorMargen(c.margenPct), fontWeight: 700 }}>
                      {c.margenPct != null ? fmtPct(c.margenPct) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Top productos con margen */}
      <div className="card">
        <div className="card-title">🏆 Top productos del período</div>
        {ranking.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin ventas en el período.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, minWidth: 880 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', width: 30 }}>#</th>
                  <th style={{ textAlign: 'left' }}>Producto</th>
                  <th style={{ textAlign: 'left' }}>Categoría</th>
                  <th style={{ textAlign: 'right' }}>Ops</th>
                  <th style={{ textAlign: 'right' }}>Kg</th>
                  <th style={{ textAlign: 'right' }}>Venta $/kg</th>
                  <th style={{ textAlign: 'right', color: '#ff8b8b' }}>Costo $/kg</th>
                  <th style={{ textAlign: 'right', color: 'var(--gold)' }}>Facturado</th>
                  <th style={{ textAlign: 'right' }}>Ganancia</th>
                  <th style={{ textAlign: 'right' }}>Margen %</th>
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
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmt(p.precioPromVenta)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: '#ff8b8b' }}>
                      {p.costoKg != null ? fmt(p.costoKg) : '—'}
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--gold)', fontWeight: 700 }}>{fmt(p.importe)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: colorMargen(p.margenPct), fontWeight: 700 }}>
                      {p.ganancia != null ? fmt(p.ganancia) : '—'}
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: colorMargen(p.margenPct), fontWeight: 700 }}>
                      {p.margenPct != null ? fmtPct(p.margenPct) : '—'}
                    </td>
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

      {/* Top productos por MARGEN (más rentables) y los problemáticos */}
      {ranking.filter(r => r.margenPct != null).length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 16 }}>
          <div className="card">
            <div className="card-title">🏅 Top 10 más rentables (por % margen)</div>
            <table style={{ width: '100%', fontSize: 12 }}>
              <tbody>
                {ranking.filter(r => r.margenPct != null)
                  .sort((a, b) => b.margenPct - a.margenPct)
                  .slice(0, 10)
                  .map((p, i) => (
                    <tr key={p.nombre} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 4px', color: 'var(--muted)', width: 24 }}>{i + 1}.</td>
                      <td style={{ padding: '6px 4px', fontWeight: 600 }}>{p.nombre}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>{fmt(p.importe)}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: colorMargen(p.margenPct), fontWeight: 700 }}>{fmtPct(p.margenPct)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-title" style={{ color: '#ff8b8b' }}>⚠️ Productos con margen bajo o negativo</div>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: -8, marginBottom: 10 }}>
              Margen menor al 15% — revisar precio o costo de compra.
            </p>
            {(() => {
              const problemas = ranking.filter(r => r.margenPct != null && r.margenPct < 15)
                .sort((a, b) => a.margenPct - b.margenPct)
                .slice(0, 10)
              return problemas.length === 0 ? (
                <p style={{ color: '#7dff7d', fontSize: 13 }}>✅ Ningún producto con margen bajo.</p>
              ) : (
                <table style={{ width: '100%', fontSize: 12 }}>
                  <tbody>
                    {problemas.map((p, i) => (
                      <tr key={p.nombre} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 4px', color: 'var(--muted)', width: 24 }}>{i + 1}.</td>
                        <td style={{ padding: '6px 4px', fontWeight: 600 }}>{p.nombre}</td>
                        <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>
                          Costo {fmt(p.costoKg)}/kg
                        </td>
                        <td style={{ padding: '6px 4px', textAlign: 'right', color: colorMargen(p.margenPct), fontWeight: 700 }}>{fmtPct(p.margenPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            })()}
          </div>
        </div>
      )}
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
// 💵 FLUJO DE CAJA — ingresos vs egresos + facturación vs cobranzas
// ═══════════════════════════════════════════════════════════════
export function ReporteFlujo({ data }) {
  // INGRESOS reales del período = cobros efectivos (no facturación)
  //   - ventas caja (efectivo + débito + transferencia)
  //   - pagos recibidos de clientes (movimientos_ctacte tipo='pago')
  //   - ingresos extras cargados como gastos.tipo='ingreso'
  const ingresos = useMemo(() => {
    // Usa el TOTAL de la venta (no el desglose por medio de pago): es el importe
    // real vendido y es inmune a un typo en efectivo/débito/transferencia.
    const caja = data.ventasCaja.reduce((s, v) => s + (Number(v.total) || 0), 0)
    // Cheques NO cuentan como ingreso: se endosan a proveedores, no se cobran.
    const cobranzasCtacte = data.movimientosCtacte
      .filter(m => m.tipo === 'pago')
      .reduce((s, m) => s + (Number(m.haber) || 0), 0)
    const extras = data.gastos.filter(g => g.tipo === 'ingreso').reduce((s, g) => s + (Number(g.monto) || 0), 0)
    return { caja, cobranzasCtacte, extras, total: caja + cobranzasCtacte + extras }
  }, [data])

  // EGRESOS reales del período
  //   - pagos a proveedores (pagos_proveedores)
  //   - gastos.tipo IN ('variable', 'fijo', 'socio')
  //   - sueldos liquidados (liquidaciones_sueldos.neto)
  const egresos = useMemo(() => {
    const proveedores = data.pagosProveedores.reduce((s, p) =>
      s + (Number(p.importe) || 0) + (Number(p.percepcion) || 0), 0)
    const gastosFijos     = data.gastos.filter(g => g.tipo === 'fijo').reduce((s, g) => s + (Number(g.monto) || 0), 0)
    const gastosVariables = data.gastos.filter(g => g.tipo === 'variable').reduce((s, g) => s + (Number(g.monto) || 0), 0)
    const retirosSocios   = data.gastos.filter(g => g.tipo === 'socio').reduce((s, g) => s + (Number(g.monto) || 0), 0)
    const sueldos = data.sueldos.reduce((s, l) => s + (Number(l.neto) || 0), 0)
    return { proveedores, gastosFijos, gastosVariables, retirosSocios, sueldos,
             total: proveedores + gastosFijos + gastosVariables + retirosSocios + sueldos }
  }, [data])

  const saldoNeto = ingresos.total - egresos.total

  // FACTURACIÓN vs COBRANZAS
  const facturacion = useMemo(() => {
    const facturado = sumarVentasMonto(data)  // ventas caja + salidas + pedidos
    const cobrado   = ingresos.total
    const pendiente = data.clientes.filter(c => Number(c.saldo) > 0).reduce((s, c) => s + Number(c.saldo), 0)
    const pctCobro  = facturado > 0 ? (cobrado / facturado) * 100 : 0
    return { facturado, cobrado, pendiente, pctCobro }
  }, [data, ingresos])

  // Flujo por DÍA en el período (para tabla y mini-chart)
  const porDia = useMemo(() => {
    const acc = {}
    const sumar = (fecha, key, monto) => {
      if (!fecha || !monto) return
      if (!acc[fecha]) acc[fecha] = { fecha, ingresos: 0, egresos: 0 }
      acc[fecha][key] += Number(monto) || 0
    }
    data.ventasCaja.forEach(v => sumar(v.fecha, 'ingresos', Number(v.total) || 0))
    data.movimientosCtacte.filter(m => m.tipo === 'pago')
      .forEach(m => sumar(m.fecha, 'ingresos', Number(m.haber) || 0))
    data.gastos.filter(g => g.tipo === 'ingreso').forEach(g => sumar(g.fecha, 'ingresos', g.monto))
    data.pagosProveedores.forEach(p => sumar(p.fecha, 'egresos', (Number(p.importe) || 0) + (Number(p.percepcion) || 0)))
    data.gastos.filter(g => g.tipo !== 'ingreso').forEach(g => sumar(g.fecha, 'egresos', g.monto))
    data.sueldos.forEach(l => sumar(l.semana_fin, 'egresos', l.neto))
    return Object.values(acc).map(d => ({ ...d, saldo: d.ingresos - d.egresos }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
  }, [data])

  // Top 10 deudores
  const topDeudores = useMemo(() =>
    data.clientes.filter(c => Number(c.saldo) > 0)
      .sort((a, b) => Number(b.saldo) - Number(a.saldo))
      .slice(0, 10), [data])

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KPI label="💰 INGRESOS"
             valor={fmt(ingresos.total)}
             sub={`Caja ${fmt(ingresos.caja)} · Cobranzas ${fmt(ingresos.cobranzasCtacte)}`}
             color="#7dff7d" />
        <KPI label="💸 EGRESOS"
             valor={fmt(egresos.total)}
             sub={`Prov. ${fmt(egresos.proveedores)} · Gastos ${fmt(egresos.gastosFijos + egresos.gastosVariables)} · Sueldos ${fmt(egresos.sueldos)}`}
             color="#ff8b8b" />
        <KPI label={saldoNeto >= 0 ? '✅ SALDO NETO' : '⚠️ SALDO NETO'}
             valor={fmt(saldoNeto)}
             sub={saldoNeto >= 0 ? 'Período en positivo' : 'Período en negativo'}
             color={saldoNeto >= 0 ? '#7dff7d' : '#ff8b8b'} />
      </div>

      {/* Facturación vs cobranzas */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">📑 Facturación vs Cobranzas</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 8 }}>
          <Mini label="Facturado" valor={fmt(facturacion.facturado)} />
          <Mini label="Cobrado" valor={fmt(facturacion.cobrado)} />
          <Mini label="% cobrado" valor={fmtPct(facturacion.pctCobro)} />
          <Mini label="Saldo pendiente clientes" valor={fmt(facturacion.pendiente)} />
        </div>
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
          ℹ️ Facturado = ventas + despachos + pedidos del período. Cobrado = ingresos reales en caja + pagos en cuenta corriente.
          La diferencia se va acumulando como saldo en cuenta corriente de clientes.
        </p>
      </div>

      {/* Desglose de egresos */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">💸 Desglose de egresos</div>
        <table style={{ width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Concepto</th>
              <th style={{ textAlign: 'right' }}>Monto</th>
              <th style={{ textAlign: 'right' }}>% del total</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: '🥩 Pagos a proveedores', monto: egresos.proveedores },
              { label: '🧾 Gastos fijos',         monto: egresos.gastosFijos },
              { label: '📦 Gastos variables',     monto: egresos.gastosVariables },
              { label: '👥 Sueldos',              monto: egresos.sueldos },
              { label: '💼 Retiros socios',       monto: egresos.retirosSocios },
            ].filter(r => r.monto > 0).sort((a, b) => b.monto - a.monto).map(r => {
              const pct = egresos.total > 0 ? (r.monto / egresos.total) * 100 : 0
              return (
                <tr key={r.label} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 4px', fontWeight: 600 }}>{r.label}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: '#ff8b8b', fontWeight: 700 }}>{fmt(r.monto)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted)' }}>{fmtPct(pct)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Flujo por día */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">📅 Flujo por día (últimos 30 con movimientos)</div>
        {porDia.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin movimientos en el período.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, minWidth: 480 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Fecha</th>
                  <th style={{ textAlign: 'right', color: '#7dff7d' }}>Ingresos</th>
                  <th style={{ textAlign: 'right', color: '#ff8b8b' }}>Egresos</th>
                  <th style={{ textAlign: 'right' }}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {porDia.slice(0, 30).map(d => (
                  <tr key={d.fecha} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px', fontWeight: 600 }}>{d.fecha}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: '#7dff7d' }}>{fmt(d.ingresos)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: '#ff8b8b' }}>{fmt(d.egresos)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: d.saldo >= 0 ? '#7dff7d' : '#ff8b8b', fontWeight: 700 }}>{fmt(d.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Top deudores */}
      <div className="card">
        <div className="card-title">💳 Top 10 clientes con saldo pendiente</div>
        {topDeudores.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>✅ No hay clientes con deuda.</p>
        ) : (
          <table style={{ width: '100%', fontSize: 12 }}>
            <tbody>
              {topDeudores.map((c, i) => (
                <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 4px', color: 'var(--muted)', width: 24 }}>{i + 1}.</td>
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
// 💸 GASTOS — desglose por categoría + sueldos vs facturación
// ═══════════════════════════════════════════════════════════════
export function ReporteGastos({ data }) {
  const totales = useMemo(() => {
    const fijos     = data.gastos.filter(g => g.tipo === 'fijo').reduce((s, g) => s + (Number(g.monto) || 0), 0)
    const variables = data.gastos.filter(g => g.tipo === 'variable').reduce((s, g) => s + (Number(g.monto) || 0), 0)
    const socios    = data.gastos.filter(g => g.tipo === 'socio').reduce((s, g) => s + (Number(g.monto) || 0), 0)
    const sueldos   = data.sueldos.reduce((s, l) => s + (Number(l.neto) || 0), 0)
    const facturado = sumarVentasMonto(data)
    return { fijos, variables, socios, sueldos, total: fijos + variables + socios + sueldos, facturado,
             pctSueldos: facturado > 0 ? (sueldos / facturado) * 100 : 0,
             pctTotal:   facturado > 0 ? ((fijos + variables + socios + sueldos) / facturado) * 100 : 0 }
  }, [data])

  // Por categoría (excluye 'ingreso')
  const porCategoria = useMemo(() => {
    const acc = {}
    data.gastos.filter(g => g.tipo !== 'ingreso').forEach(g => {
      const k = g.categoria || `(${g.tipo})`
      if (!acc[k]) acc[k] = { categoria: k, monto: 0, cant: 0, tipo: g.tipo }
      acc[k].monto += Number(g.monto) || 0
      acc[k].cant  += 1
    })
    return Object.values(acc).sort((a, b) => b.monto - a.monto)
  }, [data])

  // Tendencia mensual (gastos + sueldos por mes)
  const porMes = useMemo(() => {
    const acc = {}
    const sumar = (fecha, key, monto) => {
      if (!fecha) return
      const mes = fecha.slice(0, 7)
      if (!acc[mes]) acc[mes] = { mes, gastos: 0, sueldos: 0 }
      acc[mes][key] += Number(monto) || 0
    }
    data.gastos.filter(g => g.tipo !== 'ingreso').forEach(g => sumar(g.fecha, 'gastos', g.monto))
    data.sueldos.forEach(l => sumar(l.semana_fin, 'sueldos', l.neto))
    return Object.values(acc).sort((a, b) => a.mes.localeCompare(b.mes))
  }, [data])

  const maxMes = Math.max(1, ...porMes.map(m => m.gastos + m.sueldos))
  const colorPct = (pct) => pct > 60 ? '#ff8b8b' : pct > 40 ? '#ffd17a' : '#7dff7d'

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KPI label="💸 GASTOS TOTAL"  valor={fmt(totales.total)}    sub={`${fmtPct(totales.pctTotal)} sobre facturación`} color="#ff8b8b" />
        <KPI label="🧾 FIJOS"         valor={fmt(totales.fijos)}     sub="Alquileres, servicios, etc." color="#ffd17a" />
        <KPI label="📦 VARIABLES"     valor={fmt(totales.variables)} sub="Gastos no recurrentes" color="#7a9dff" />
        <KPI label="👥 SUELDOS"       valor={fmt(totales.sueldos)}   sub={`${fmtPct(totales.pctSueldos)} de facturación`} color={colorPct(totales.pctSueldos)} />
      </div>

      {/* Por categoría */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">📂 Gastos por categoría</div>
        {porCategoria.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin gastos en el período.</p>
        ) : (
          <table style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Categoría</th>
                <th style={{ textAlign: 'left' }}>Tipo</th>
                <th style={{ textAlign: 'right' }}>Cant.</th>
                <th style={{ textAlign: 'right' }}>Monto</th>
                <th style={{ textAlign: 'right' }}>% s/total</th>
              </tr>
            </thead>
            <tbody>
              {porCategoria.map(c => {
                const pct = totales.total > 0 ? (c.monto / totales.total) * 100 : 0
                return (
                  <tr key={c.categoria} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px', fontWeight: 600 }}>{c.categoria}</td>
                    <td style={{ padding: '6px 4px', color: 'var(--muted)', fontSize: 11 }}>{c.tipo}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--muted)' }}>{c.cant}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: '#ff8b8b', fontWeight: 700 }}>{fmt(c.monto)}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtPct(pct)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Tendencia mensual */}
      <div className="card">
        <div className="card-title">📅 Tendencia mensual (gastos + sueldos)</div>
        {porMes.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin datos mensuales.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {porMes.map(m => {
              const tot = m.gastos + m.sueldos
              const pctGastos  = tot > 0 ? (m.gastos / maxMes) * 100 : 0
              const pctSueldos = tot > 0 ? (m.sueldos / maxMes) * 100 : 0
              return (
                <div key={m.mes}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ fontWeight: 600 }}>{m.mes}</span>
                    <span style={{ color: 'var(--muted)' }}>
                      <span style={{ color: '#ff8b8b' }}>{fmt(m.gastos)}</span>
                      {' + '}
                      <span style={{ color: '#ffd17a' }}>{fmt(m.sueldos)}</span>
                      {' = '}
                      <strong>{fmt(tot)}</strong>
                    </span>
                  </div>
                  <div style={{ display: 'flex', height: 10, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pctGastos}%`,  background: '#ff8b8b' }} />
                    <div style={{ width: `${pctSueldos}%`, background: '#ffd17a' }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
// 📅 INTERANUAL — este período vs mismo del año pasado
// ═══════════════════════════════════════════════════════════════
// Carga su propia data (24 meses) — no usa data del hook común porque
// necesita un rango distinto (años, no período seleccionado).
export function ReporteInteranual() {
  const [loading, setLoading] = useState(true)
  const [mesesData, setMesesData] = useState({ esteAnio: {}, anioAnt: {} })

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setLoading(true)
      const hoy = fechaHoyARG()
      const anioActual = parseInt(hoy.slice(0, 4))
      const anioAnt    = anioActual - 1
      const desdeEste  = `${anioActual}-01-01`
      const hastaEste  = hoy
      const desdeAnt   = `${anioAnt}-01-01`
      const hastaAnt   = `${anioAnt}-12-31`

      // Cargamos ventas + salidas + pedidos para los 2 años
      const [vc1, vc2, sa1, sa2, pe1, pe2] = await Promise.all([
        supabase.from('ventas_minoristas').select('total, fecha').eq('origen', 'caja').gte('fecha', desdeEste).lte('fecha', hastaEste),
        supabase.from('ventas_minoristas').select('total, fecha').eq('origen', 'caja').gte('fecha', desdeAnt).lte('fecha', hastaAnt),
        supabase.from('salidas_deposito').select('total, fecha, cobro').gte('fecha', desdeEste).lte('fecha', hastaEste),
        supabase.from('salidas_deposito').select('total, fecha, cobro').gte('fecha', desdeAnt).lte('fecha', hastaAnt),
        supabase.from('pedidos').select('total_estimado, dia_entrega').eq('estado', 'confirmado').gte('dia_entrega', desdeEste).lte('dia_entrega', hastaEste),
        supabase.from('pedidos').select('total_estimado, dia_entrega').eq('estado', 'confirmado').gte('dia_entrega', desdeAnt).lte('dia_entrega', hastaAnt),
      ])

      if (cancelado) return

      const agregar = (acc, fecha, monto) => {
        if (!fecha) return
        const mes = fecha.slice(5, 7)
        acc[mes] = (acc[mes] || 0) + (Number(monto) || 0)
      }

      const esteAnio = {}, anioAntH = {}
      ;(vc1.data || []).forEach(v => agregar(esteAnio, v.fecha, v.total))
      ;(sa1.data || []).filter(s => s.cobro !== 'interno').forEach(s => agregar(esteAnio, s.fecha, s.total))
      ;(pe1.data || []).forEach(p => agregar(esteAnio, p.dia_entrega, p.total_estimado))
      ;(vc2.data || []).forEach(v => agregar(anioAntH, v.fecha, v.total))
      ;(sa2.data || []).filter(s => s.cobro !== 'interno').forEach(s => agregar(anioAntH, s.fecha, s.total))
      ;(pe2.data || []).forEach(p => agregar(anioAntH, p.dia_entrega, p.total_estimado))

      setMesesData({ esteAnio, anioAnt: anioAntH, anioActual, anioAnterior: anioAnt })
      setLoading(false)
    }
    cargar()
    return () => { cancelado = true }
  }, [])

  if (loading) return <p style={{ color: 'var(--muted)' }}>Cargando datos interanuales...</p>

  const MESES = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
  const NOMBRES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

  const filas = MESES.map((m, i) => {
    const este = mesesData.esteAnio[m] || 0
    const ant  = mesesData.anioAnt[m]  || 0
    const diff = este - ant
    const pct  = ant > 0 ? ((este - ant) / ant) * 100 : (este > 0 ? null : 0)
    return { mes: m, nombre: NOMBRES[i], este, ant, diff, pct }
  })

  const totalEste = filas.reduce((s, f) => s + f.este, 0)
  const totalAnt  = filas.reduce((s, f) => s + f.ant, 0)
  const diffTotal = totalEste - totalAnt
  const pctTotal  = totalAnt > 0 ? ((totalEste - totalAnt) / totalAnt) * 100 : 0

  const maxMonto = Math.max(1, ...filas.flatMap(f => [f.este, f.ant]))

  const mesActual = parseInt(fechaHoyARG().slice(5, 7))
  const mesActFila = filas[mesActual - 1]

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KPI label={`${mesesData.anioActual} (acum)`}   valor={fmt(totalEste)} sub={`Año en curso`} color="var(--gold)" />
        <KPI label={`${mesesData.anioAnterior} (acum)`} valor={fmt(totalAnt)}  sub={`Mismo período año pasado`} color="#7a9dff" />
        <KPI label="↗️ DIFERENCIA"
             valor={fmt(diffTotal)}
             sub={pctTotal !== 0 ? `${diffTotal >= 0 ? '+' : ''}${pctTotal.toFixed(1)}% vs año pasado` : 'Sin datos comparables'}
             color={diffTotal >= 0 ? '#7dff7d' : '#ff8b8b'} />
        {mesActFila && (
          <KPI label={`📅 ${mesActFila.nombre} ${mesesData.anioActual}`}
               valor={fmt(mesActFila.este)}
               sub={mesActFila.ant > 0
                 ? `vs ${fmt(mesActFila.ant)} (${mesActFila.pct >= 0 ? '+' : ''}${mesActFila.pct?.toFixed(1)}%)`
                 : `Sin comparativa año pasado`}
               color={mesActFila.diff >= 0 ? '#7dff7d' : '#ff8b8b'} />
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">📊 Mes a mes — {mesesData.anioActual} vs {mesesData.anioAnterior}</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, minWidth: 500 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Mes</th>
                <th style={{ textAlign: 'right', color: 'var(--gold)' }}>{mesesData.anioActual}</th>
                <th style={{ textAlign: 'right', color: '#7a9dff' }}>{mesesData.anioAnterior}</th>
                <th style={{ textAlign: 'right' }}>Diferencia</th>
                <th style={{ textAlign: 'right' }}>%</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.mes} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 4px', fontWeight: 600 }}>{f.nombre}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--gold)' }}>{f.este > 0 ? fmt(f.este) : '—'}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: '#7a9dff' }}>{f.ant > 0 ? fmt(f.ant) : '—'}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: f.diff >= 0 ? '#7dff7d' : '#ff8b8b', fontWeight: 700 }}>
                    {f.este === 0 && f.ant === 0 ? '—' : (f.diff >= 0 ? '+' : '') + fmt(f.diff)}
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: f.diff >= 0 ? '#7dff7d' : '#ff8b8b' }}>
                    {f.pct == null || (f.este === 0 && f.ant === 0) ? '—' : `${f.pct >= 0 ? '+' : ''}${f.pct.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td style={{ padding: '8px 4px', fontWeight: 700 }}>TOTAL</td>
                <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--gold)', fontWeight: 700 }}>{fmt(totalEste)}</td>
                <td style={{ padding: '8px 4px', textAlign: 'right', color: '#7a9dff', fontWeight: 700 }}>{fmt(totalAnt)}</td>
                <td style={{ padding: '8px 4px', textAlign: 'right', color: diffTotal >= 0 ? '#7dff7d' : '#ff8b8b', fontWeight: 700 }}>
                  {(diffTotal >= 0 ? '+' : '') + fmt(diffTotal)}
                </td>
                <td style={{ padding: '8px 4px', textAlign: 'right', color: diffTotal >= 0 ? '#7dff7d' : '#ff8b8b', fontWeight: 700 }}>
                  {pctTotal >= 0 ? '+' : ''}{pctTotal.toFixed(1)}%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Gráfico de barras lado a lado */}
      <div className="card">
        <div className="card-title">📈 Visualización mes a mes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filas.map(f => (
            <div key={f.mes}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                {f.nombre} · <span style={{ color: 'var(--gold)' }}>{mesesData.anioActual}</span> vs <span style={{ color: '#7a9dff' }}>{mesesData.anioAnterior}</span>
              </div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ height: 8, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${(f.este / maxMonto) * 100}%`, height: '100%', background: 'var(--gold)' }} />
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ height: 8, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${(f.ant / maxMonto) * 100}%`, height: '100%', background: '#7a9dff' }} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
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
