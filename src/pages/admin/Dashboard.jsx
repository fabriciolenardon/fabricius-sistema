import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

function fmt(n) {
  const abs = Math.abs(Math.round(n || 0))
  if (abs >= 1000000) return '$' + (abs / 1000000).toFixed(1) + 'M'
  if (abs >= 1000) return '$' + (abs / 1000).toFixed(0) + 'K'
  return '$' + abs.toLocaleString('es-AR')
}
function fmtFull(n) { return '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR') }

export default function Dashboard() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [cierres, setCierres] = useState([])
  const [clientes, setClientes] = useState([])
  const [stock, setStock] = useState({})
  const [remitos, setRemitos] = useState([])
  const [gastos, setGastos] = useState([])
  const [cheques, setCheques] = useState([])
  const [precios, setPrecios] = useState([])
  const [loading, setLoading] = useState(true)
  // Estado del modal de detalle de stock (entradas y salidas por categoria)
  const [detalleAbierto, setDetalleAbierto] = useState(null)
  const [detalleEntradas, setDetalleEntradas] = useState([])
  const [detalleSalidas, setDetalleSalidas] = useState([])
  const [loadingDetalle, setLoadingDetalle] = useState(false)
  const [fechaCorte, setFechaCorte] = useState('')

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const [c, cl, st, r, g, ch, pr] = await Promise.all([
      supabase.from('cierres_semanales').select('*').order('semana_inicio', { ascending: false }).limit(8),
      supabase.from('clientes').select('*').order('saldo', { ascending: false }),
      supabase.from('stock_actual').select('*'),
      supabase.from('remitos').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('gastos').select('*').order('fecha', { ascending: false }).limit(5),
      supabase.from('cheques').select('*').order('fecha_pago', { ascending: true }).limit(20),
      supabase.from('precios').select('categoria'),
    ])
    setCierres(c.data || [])
    setClientes(cl.data || [])
    const s = {}
    ;(st.data || []).forEach(r => s[r.tipo] = r.kg_disponible)
    setStock(s)
    setRemitos(r.data || [])
    setGastos(g.data || [])
    setCheques(ch.data || [])
    setPrecios(pr.data || [])
    setLoading(false)
  }

  async function abrirDetalle(cat) {
    setDetalleAbierto(cat)
    setLoadingDetalle(true)
    setDetalleEntradas([])
    setDetalleSalidas([])
    setFechaCorte('')
    // Sin limite - traemos todo el historial
    const [entradasRes, salidasRes] = await Promise.all([
      supabase.from('entradas_deposito').select('*').in('tipo', cat.tiposEntradas).order('fecha', { ascending: false }),
      supabase.from('salidas_deposito').select('*').in('tipo', cat.tiposSalidas).order('fecha', { ascending: false })
    ])
    setDetalleEntradas(entradasRes.data || [])
    setDetalleSalidas(salidasRes.data || [])
    setLoadingDetalle(false)
  }

  async function borrarHistorialAnterior() {
    if (!isAdmin) { alert('Solo el administrador puede borrar historial'); return }
    if (!detalleAbierto) return
    if (!fechaCorte) { alert('Seleccioná una fecha de corte primero'); return }
    const cat = detalleAbierto
    // Contar cuantos registros serian afectados
    const entradasAfectadas = detalleEntradas.filter(e => e.fecha < fechaCorte).length
    const salidasAfectadas = detalleSalidas.filter(s => s.fecha < fechaCorte).length
    if (entradasAfectadas === 0 && salidasAfectadas === 0) {
      alert('No hay registros anteriores a esa fecha')
      return
    }
    const conf1 = confirm(
      `⚠️ ATENCIÓN — Acción IRREVERSIBLE

` +
      `Vas a borrar permanentemente de la categoría "${cat.label}":
` +
      `• ${entradasAfectadas} entradas anteriores al ${fechaCorte}
` +
      `• ${salidasAfectadas} salidas anteriores al ${fechaCorte}

` +
      `El stock actual NO se modifica. Solo se elimina el historial.

` +
      `¿Continuar?`
    )
    if (!conf1) return
    const conf2 = prompt(`Para confirmar, escribí BORRAR en mayúsculas:`)
    if (conf2 !== 'BORRAR') { alert('Cancelado. Texto de confirmación incorrecto.'); return }
    setLoadingDetalle(true)
    const [delE, delS] = await Promise.all([
      supabase.from('entradas_deposito').delete().in('tipo', cat.tiposEntradas).lt('fecha', fechaCorte),
      supabase.from('salidas_deposito').delete().in('tipo', cat.tiposSalidas).lt('fecha', fechaCorte)
    ])
    if (delE.error || delS.error) {
      alert('❌ Error al borrar: ' + (delE.error?.message || delS.error?.message))
      setLoadingDetalle(false)
      return
    }
    alert(`✅ Historial limpiado: ${entradasAfectadas} entradas y ${salidasAfectadas} salidas eliminadas`)
    // Recargar el modal
    await abrirDetalle(cat)
  }

  function cerrarDetalle() {
    setDetalleAbierto(null)
    setDetalleEntradas([])
    setDetalleSalidas([])
  }

  const hora = new Date().getHours()
  const saludo = hora < 12 ? 'Buen día' : hora < 18 ? 'Buenas tardes' : 'Buenas noches'
  const nombre = profile?.nombre?.split(' ')[0] || 'Admin'

  const ultimo = cierres[0]
  const mesActual = cierres.filter(c => c.mes === ultimo?.mes)
  const totMesVentas = mesActual.reduce((s, c) => s + (c.ventas || 0), 0)
  const totMesGanancia = mesActual.reduce((s, c) => s + (c.ganancia || 0), 0)
  const totMesCompras = mesActual.reduce((s, c) => s + (c.compras || 0), 0)
  const totMesGastos = mesActual.reduce((s, c) => s + (c.gastos || 0), 0)

  const stockBovino = Math.max(0, stock.bovino_mr || 0)
  const stockPiezas = Math.max(0, (stock.pieza_pierna || 0) + (stock.pieza_cuarto_pistola || 0) + (stock.pieza_costillar || 0) + (stock.pieza_cortito || 0) + (stock.pieza_carre || 0) + (stock.pieza_paleta || 0) + (stock.pieza_parrillero || 0))
  const stockCajas = Math.max(0, (stock.caja_cb || 0) + (stock.caja_pt || 0))
  const stockCortes = Math.max(0, stock.bovino_corte || 0)
  const stockCerdo = Math.max(0, stock.cerdo || 0)
  const stockCerdoPiezas = Math.max(0,
    (stock.cerdo_pierna || 0) +
    (stock.cerdo_carre || 0) +
    (stock.cerdo_pechito || 0) +
    (stock.cerdo_matambre || 0) +
    (stock.cerdo_paleta || 0) +
    (stock.cerdo_parrillero || 0) +
    (stock.cerdo_bondiola || 0) +
    (stock.cerdo_tocino || 0) +
    (stock.cerdo_cuero || 0) +
    (stock.cerdo_cabeza || 0)
  )
  const stockPollo = Math.max(0, stock.pollo || 0)
  const stockBrosas = Math.max(0, stock.bovino_brosa || 0)
  const stockEmbutido = Math.max(0, stock.embutido || 0)
  const stockRebozado = Math.max(0, stock.rebozado || 0)

  // Cantidad de productos por categoría (almacén y bebidas son por unidad, no por kg)
  const cantAlmacen = precios.filter(p => p.categoria === 'almacen').length
  const cantBebidas = precios.filter(p => p.categoria === 'bebidas').length

  const clientesDeuda = clientes.filter(c => c.saldo > 0).sort((a, b) => b.saldo - a.saldo)
  const totalDeuda = clientesDeuda.reduce((s, c) => s + c.saldo, 0)

  const hoy = new Date()
  const en15 = new Date(); en15.setDate(hoy.getDate() + 15)
  const chequesPorVencer = cheques.filter(ch => {
    if (!ch.fecha_pago) return false
    const f = new Date(ch.fecha_pago + 'T12:00')
    return f >= hoy && f <= en15
  })

  const datosGrafico = [...cierres].reverse().slice(-6).map(c => ({
    semana: new Date(c.semana_inicio + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
    Ventas: c.ventas || 0,
    Compras: c.compras || 0,
    Gastos: c.gastos || 0,
    Ganancia: c.ganancia || 0,
  }))

  if (loading) return <div style={{ padding: 40, color: 'var(--muted)', textAlign: 'center' }}>Cargando...</div>

  return (
    <div>
      {/* WELCOME */}
      <div style={{ background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface2) 100%)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, marginBottom: 20, backgroundImage: 'radial-gradient(circle at 90% 50%, rgba(201,168,76,0.08), transparent 60%)' }}>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 30, letterSpacing: 2, color: 'var(--gold)' }}>{saludo}, {nombre} 👋</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Sistema de gestión · Carnicerías Fabricius · Río Primero, Córdoba</div>
      </div>

      {/* ALERTAS */}
      {(chequesPorVencer.length > 0 || totalDeuda > 0) && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {chequesPorVencer.length > 0 && (
            <div style={{ background: '#2a1a0a', border: '1px solid var(--amber)', borderRadius: 10, padding: '10px 16px', flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber)', marginBottom: 4 }}>⚠️ Cheques por vencer</div>
              {chequesPorVencer.map(ch => (
                <div key={ch.id} style={{ fontSize: 12, color: 'var(--text2)' }}>#{ch.numero} — {ch.cliente_nombre} — {fmtFull(ch.monto)} — vence {ch.fecha_pago}</div>
              ))}
            </div>
          )}
          {totalDeuda > 0 && (
            <div style={{ background: '#1a0a0a', border: '1px solid var(--red-light)', borderRadius: 10, padding: '10px 16px', flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red-light)', marginBottom: 4 }}>📋 Cuentas corrientes pendientes</div>
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>{clientesDeuda.length} clientes deben <strong style={{ color: 'var(--red-light)' }}>{fmtFull(totalDeuda)}</strong></div>
            </div>
          )}
        </div>
      )}

      {/* STATS MES */}
      <div className="grid4" style={{ marginBottom: 16 }}>
        {[
          { label: 'Ventas del mes', value: fmt(totMesVentas), sub: mesActual.length + ' semanas cerradas', color: 'var(--green)', icon: '💰' },
          { label: 'Compras del mes', value: fmt(totMesCompras), sub: 'proveedores', color: 'var(--red-light)', icon: '🛒' },
          { label: 'Gastos del mes', value: fmt(totMesGastos), sub: 'operativos + socios', color: 'var(--amber)', icon: '💸' },
          { label: 'Ganancia del mes', value: fmt(totMesGanancia), sub: totMesGanancia >= 0 ? '✅ Positivo' : '⚠️ Negativo', color: totMesGanancia >= 0 ? 'var(--gold)' : 'var(--red-light)', icon: '📈' },
        ].map(s => (
          <div key={s.label} className="stat" onMouseOver={e => e.currentTarget.style.borderColor = 'var(--gold)'} onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* GRÁFICOS */}
      {datosGrafico.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="card">
            <div className="card-title">📊 Ventas vs Egresos — últimas semanas</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160, padding: '0 4px', marginBottom: 8 }}>
              {datosGrafico.map((d, i) => {
                const maxVal = Math.max(...datosGrafico.flatMap(x => [x.Ventas, x.Compras, x.Gastos]), 1)
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <div style={{ width: '100%', display: 'flex', gap: 2, alignItems: 'flex-end', height: 140 }}>
                      <div title={`Ventas: ${fmt(d.Ventas)}`} style={{ flex: 1, background: '#22c55e', borderRadius: '3px 3px 0 0', height: Math.max(2, d.Ventas / maxVal * 135) + 'px', cursor: 'pointer' }} />
                      <div title={`Compras: ${fmt(d.Compras)}`} style={{ flex: 1, background: '#ef4444', borderRadius: '3px 3px 0 0', height: Math.max(2, d.Compras / maxVal * 135) + 'px', cursor: 'pointer' }} />
                      <div title={`Gastos: ${fmt(d.Gastos)}`} style={{ flex: 1, background: '#f59e0b', borderRadius: '3px 3px 0 0', height: Math.max(2, d.Gastos / maxVal * 135) + 'px', cursor: 'pointer' }} />
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center', whiteSpace: 'nowrap' }}>{d.semana}</div>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              {[['#22c55e', 'Ventas'], ['#ef4444', 'Compras'], ['#f59e0b', 'Gastos']].map(([color, label]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
                  <div style={{ width: 10, height: 10, background: color, borderRadius: 2 }} />{label}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-title">📈 Tendencia de ganancia semanal</div>
            <div style={{ position: 'relative', height: 160, marginBottom: 8 }}>
              <svg viewBox="0 0 400 140" width="100%" height="140" style={{ overflow: 'visible' }}>
                {(() => {
                  const vals = datosGrafico.map(d => d.Ganancia)
                  const minV = Math.min(...vals, 0)
                  const maxV = Math.max(...vals, 1)
                  const range = maxV - minV || 1
                  const W = 380; const H = 120; const padX = 10
                  const points = datosGrafico.map((d, i) => ({
                    x: padX + (i / Math.max(datosGrafico.length - 1, 1)) * W,
                    y: H - ((d.Ganancia - minV) / range) * H,
                    d
                  }))
                  const zeroY = H - ((0 - minV) / range) * H
                  const polyline = points.map(p => `${p.x},${p.y}`).join(' ')
                  const areaPath = `M${points[0].x},${zeroY} ` + points.map(p => `L${p.x},${p.y}`).join(' ') + ` L${points[points.length - 1].x},${zeroY} Z`
                  return (
                    <>
                      <defs>
                        <linearGradient id="gradGanancia" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#c9a84c" stopOpacity="0.3" />
                          <stop offset="100%" stopColor="#c9a84c" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <line x1={padX} y1={zeroY} x2={padX + W} y2={zeroY} stroke="#444" strokeDasharray="4" strokeWidth="1" />
                      <path d={areaPath} fill="url(#gradGanancia)" />
                      <polyline points={polyline} fill="none" stroke="#c9a84c" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                      {points.map((p, i) => (
                        <g key={i}>
                          <circle cx={p.x} cy={p.y} r="5" fill="#c9a84c" stroke="var(--surface)" strokeWidth="2" />
                          <title>{p.d.semana}: {fmt(p.d.Ganancia)}</title>
                        </g>
                      ))}
                    </>
                  )
                })()}
              </svg>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px solid var(--border)' }}>
              {datosGrafico.map((d, i) => (
                <div key={i} style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center', flex: 1 }}>
                  <div>{d.semana}</div>
                  <div style={{ color: d.Ganancia >= 0 ? '#c9a84c' : '#ef4444', fontWeight: 600, fontSize: 10 }}>{fmt(d.Ganancia)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* STOCK DESDE stock_actual */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div className="card-title" style={{ margin: 0 }}>📦 Stock actual del depósito</div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/admin/deposito')}>Ver depósito →</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[
            { label: '🐄 Bovino Media Res', valor: stockBovino.toFixed(1) + ' kg', color: 'var(--gold)', aprox: Math.round(stockBovino / 105) + ' medias', bajo: stockBovino < 100, stockKg: stockBovino, tiposEntradas: ['bovino_mr'], tiposSalidas: ['bovino_mr'] },
            { label: '🍖 Piezas Bovinas', valor: stockPiezas.toFixed(1) + ' kg', color: 'var(--gold)', aprox: 'al peso', bajo: stockPiezas < 30, stockKg: stockPiezas, tiposEntradas: ['pieza_pierna','pieza_cuarto_pistola','pieza_costillar','pieza_cortito','pieza_carre','pieza_paleta','pieza_parrillero'], tiposSalidas: ['bovino_pieza','pieza_pierna','pieza_cuarto_pistola','pieza_costillar','pieza_cortito','pieza_carre','pieza_paleta','pieza_parrillero'] },
            { label: '📦 Cajas Bovinas', valor: stockCajas.toFixed(1) + ' kg', color: 'var(--gold)', aprox: 'al peso', bajo: stockCajas < 20, stockKg: stockCajas, tiposEntradas: ['caja_cb','caja_pt'], tiposSalidas: ['bovino_caja_cb','bovino_caja_pt','caja_cb','caja_pt'] },
            { label: '🥩 Bovino Cortes', valor: stockCortes.toFixed(1) + ' kg', color: 'var(--gold)', aprox: 'al peso', bajo: stockCortes < 50, stockKg: stockCortes, tiposEntradas: ['bovino_corte'], tiposSalidas: ['bovino_corte'] },
            { label: '🐷 Cerdo Capones', valor: stockCerdo.toFixed(1) + ' kg', color: 'var(--amber)', aprox: Math.round(stockCerdo / 107) + ' capones', bajo: stockCerdo < 50, stockKg: stockCerdo, tiposEntradas: ['cerdo'], tiposSalidas: ['cerdo','cerdo_corte'] },
            { label: '🐷 Cerdo Piezas', valor: stockCerdoPiezas.toFixed(1) + ' kg', color: 'var(--amber)', aprox: 'al peso', bajo: stockCerdoPiezas < 20, stockKg: stockCerdoPiezas, tiposEntradas: ['cerdo_pierna','cerdo_carre','cerdo_pechito','cerdo_matambre','cerdo_paleta','cerdo_parrillero','cerdo_bondiola','cerdo_tocino','cerdo_cuero','cerdo_cabeza'], tiposSalidas: ['cerdo_pieza','cerdo_pierna','cerdo_carre','cerdo_pechito','cerdo_matambre','cerdo_paleta','cerdo_parrillero','cerdo_bondiola','cerdo_tocino','cerdo_cuero','cerdo_cabeza'] },
            { label: '🍗 Pollo', valor: stockPollo.toFixed(1) + ' kg', color: 'var(--blue)', aprox: Math.round(stockPollo / 20) + ' cajones', bajo: stockPollo < 50, stockKg: stockPollo, tiposEntradas: ['pollo'], tiposSalidas: ['pollo'] },
            { label: '🫀 Brosas', valor: stockBrosas.toFixed(1) + ' kg', color: 'var(--amber)', aprox: 'al peso', bajo: stockBrosas < 20, stockKg: stockBrosas, tiposEntradas: ['bovino_brosa'], tiposSalidas: ['bovino_brosa'] },
            { label: '🌭 Embutidos', valor: stockEmbutido.toFixed(1) + ' kg', color: 'var(--purple)', aprox: 'al peso', bajo: stockEmbutido < 20, stockKg: stockEmbutido, tiposEntradas: ['embutido'], tiposSalidas: ['embutido'] },
            { label: '🧊 Rebozados/Congelados', valor: stockRebozado.toFixed(1) + ' kg', color: 'var(--blue)', aprox: 'al peso', bajo: stockRebozado < 20, stockKg: stockRebozado, tiposEntradas: ['rebozado'], tiposSalidas: ['rebozado'] },
            { label: '🛒 Almacén', valor: cantAlmacen + ' productos', color: 'var(--gold)', aprox: 'cargados en sistema', bajo: false, esConteo: true },
            { label: '🥤 Bebidas', valor: cantBebidas + ' productos', color: 'var(--blue)', aprox: 'cargados en sistema', bajo: false, esConteo: true },
          ].map(s => (
            <div key={s.label} style={{ background: s.bajo ? '#3a1a1a' : 'var(--surface2)', border: `1px solid ${s.bajo ? 'var(--red-light)' : 'var(--border)'}`, borderRadius: 10, padding: '12px 14px', textAlign: 'center', cursor: 'pointer', transition: 'transform 0.1s, border-color 0.1s' }} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--gold)'} onMouseLeave={e => e.currentTarget.style.borderColor = s.bajo ? 'var(--red-light)' : 'var(--border)'} onClick={() => { if (s.esConteo) navigate('/admin/precios'); else if (s.tiposEntradas) abrirDetalle(s) }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 26, color: s.bajo ? 'var(--red-light)' : s.color }}>{s.valor}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.aprox}</div>
              {s.bajo && <div style={{ fontSize: 10, color: 'var(--red-light)', fontWeight: 700, marginTop: 4 }}>⚠️ Stock bajo</div>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* CLIENTES CON DEUDA */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="card-title" style={{ margin: 0 }}>💳 Clientes con saldo pendiente</div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/admin/clientes')}>Ver todos →</button>
          </div>
          {clientesDeuda.length === 0 ? (
            <div className="empty">✅ Sin deudas pendientes</div>
          ) : (
            clientesDeuda.slice(0, 6).map(c => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{c.nombre}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.tipo}</div>
                </div>
                <span style={{ color: 'var(--red-light)', fontWeight: 700, fontSize: 13 }}>{fmtFull(c.saldo)}</span>
              </div>
            ))
          )}
          {clientesDeuda.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Total adeudado</span>
              <span style={{ color: 'var(--red-light)', fontWeight: 700 }}>{fmtFull(totalDeuda)}</span>
            </div>
          )}
        </div>

        {/* ÚLTIMOS REMITOS */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="card-title" style={{ margin: 0 }}>🧾 Últimos remitos</div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/admin/deposito')}>Ver todos →</button>
          </div>
          {remitos.length === 0 ? (
            <div className="empty">Sin remitos recientes</div>
          ) : (
            remitos.map(r => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>N° {String(r.numero).padStart(5, '0')} — {r.cliente_nombre}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.fecha}</div>
                </div>
                <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 13 }}>{fmtFull(r.total)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* CIERRES */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="card-title" style={{ margin: 0 }}>📋 Últimos cierres semanales</div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/admin/cierre')}>Ver todos →</button>
          </div>
          <table>
            <thead><tr><th>Semana</th><th>Ventas</th><th>Ganancia</th></tr></thead>
            <tbody>
              {cierres.slice(0, 5).map(c => (
                <tr key={c.id}>
                  <td style={{ fontSize: 11 }}>
                    {new Date(c.semana_inicio + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                    {' → '}
                    {new Date(c.semana_fin + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                  </td>
                  <td style={{ color: 'var(--green)' }}>{fmt(c.ventas)}</td>
                  <td style={{ color: c.ganancia >= 0 ? 'var(--gold)' : 'var(--red-light)', fontWeight: 600 }}>{fmt(c.ganancia)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          {/* ÚLTIMOS GASTOS */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title" style={{ margin: 0 }}>💸 Últimos gastos</div>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/admin/gastos')}>Ver todos →</button>
            </div>
            {gastos.slice(0, 4).map(g => (
              <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{g.descripcion}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{g.fecha} · {g.tipo}</div>
                </div>
                <span style={{ color: g.tipo === 'ingreso' ? 'var(--green)' : 'var(--red-light)', fontWeight: 700, fontSize: 13 }}>
                  {g.tipo === 'ingreso' ? '+' : '−'}{fmtFull(g.monto)}
                </span>
              </div>
            ))}
            {gastos.length === 0 && <div className="empty">Sin gastos recientes</div>}
          </div>

          {/* ACCESOS RÁPIDOS */}
          <div className="card">
            <div className="card-title">⚡ Accesos rápidos</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { label: '📋 Nuevo cierre', path: '/admin/cierre' },
                { label: '📥 Entrada depósito', path: '/admin/deposito' },
                { label: '📤 Despacho', path: '/admin/deposito' },
                { label: '📄 Registrar cheque', path: '/admin/cheques' },
                { label: '💳 Cuentas corrientes', path: '/admin/clientes' },
                { label: '💸 Cargar gasto', path: '/admin/gastos' },
              ].map(a => (
                <button key={a.label} className="btn btn-ghost" style={{ textAlign: 'left', padding: '10px 12px', width: '100%', fontSize: 12 }} onClick={() => navigate(a.path)}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* DISTRIBUCIÓN SOCIOS */}
      <div className="card">
        <div className="card-title">👥 Distribución socios — mes actual</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {[
            { nombre: 'Fabricio Lenardon', pct: 85, color: 'var(--gold)' },
            { nombre: 'Ariel Garrone', pct: 15, color: 'var(--blue)' },
          ].map(s => (
            <div key={s.nombre}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                <span style={{ fontWeight: 600 }}>{s.nombre} ({s.pct}%)</span>
                <span style={{ color: s.color, fontFamily: "'Bebas Neue', cursive", fontSize: 20 }}>{fmt(totMesGanancia * s.pct / 100)}</span>
              </div>
              <div style={{ background: 'var(--border)', borderRadius: 8, height: 10 }}>
                <div style={{ height: 10, borderRadius: 8, background: s.color, width: s.pct + '%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* MODAL DE DETALLE DE STOCK */}
      {detalleAbierto && (
        <div onClick={cerrarDetalle} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 16, padding: 24, maxWidth: 1100, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 28, color: 'var(--gold)', letterSpacing: 1 }}>{detalleAbierto.label}</div>
              <button onClick={cerrarDetalle} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 14, color: 'var(--text)' }}>✕ Cerrar</button>
            </div>

            {/* Tarjeta de stock disponible */}
            <div style={{ background: detalleAbierto.bajo ? '#3a1a1a' : 'linear-gradient(135deg, var(--surface2) 0%, var(--surface) 100%)', border: `2px solid ${detalleAbierto.bajo ? 'var(--red-light)' : 'var(--gold)'}`, borderRadius: 12, padding: '18px 22px', marginBottom: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Stock disponible</div>
              <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 48, color: detalleAbierto.bajo ? 'var(--red-light)' : 'var(--gold)' }}>{(detalleAbierto.stockKg || 0).toFixed(1)} kg</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{detalleAbierto.aprox}</div>
              {detalleAbierto.bajo && <div style={{ fontSize: 12, color: 'var(--red-light)', fontWeight: 700, marginTop: 6 }}>⚠️ Stock bajo</div>}
            </div>

            {loadingDetalle ? (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>Cargando movimientos...</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* ENTRADAS */}
                <div className="card" style={{ margin: 0 }}>
                  <div className="card-title" style={{ color: 'var(--green)' }}>📥 Entradas registradas ({detalleEntradas.length})</div>
                  {detalleEntradas.length === 0 ? (
                    <div className="empty">Sin entradas registradas</div>
                  ) : (
                    <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                      <table style={{ fontSize: 12 }}>
                        <thead><tr><th>Fecha</th><th>Descripción</th><th>Proveedor</th><th style={{ textAlign: 'right' }}>Kg</th></tr></thead>
                        <tbody>
                          {detalleEntradas.map(e => (
                            <tr key={e.id}>
                              <td style={{ whiteSpace: 'nowrap' }}>{e.fecha}</td>
                              <td>{e.descripcion}</td>
                              <td style={{ color: 'var(--muted)' }}>{e.proveedor_nombre || '—'}</td>
                              <td style={{ textAlign: 'right', color: 'var(--green)', fontWeight: 600 }}>{(e.kg_real || e.kg || 0).toFixed(1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* SALIDAS */}
                <div className="card" style={{ margin: 0 }}>
                  <div className="card-title" style={{ color: 'var(--red-light)' }}>📤 Salidas registradas ({detalleSalidas.length})</div>
                  {detalleSalidas.length === 0 ? (
                    <div className="empty">Sin salidas registradas</div>
                  ) : (
                    <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                      <table style={{ fontSize: 12 }}>
                        <thead><tr><th>Fecha</th><th>Descripción</th><th>Cliente</th><th style={{ textAlign: 'right' }}>Kg</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                        <tbody>
                          {detalleSalidas.map(s => (
                            <tr key={s.id}>
                              <td style={{ whiteSpace: 'nowrap' }}>{s.fecha}</td>
                              <td>{s.descripcion}</td>
                              <td style={{ color: 'var(--muted)' }}>{s.cliente_nombre || '—'}</td>
                              <td style={{ textAlign: 'right', color: 'var(--red-light)', fontWeight: 600 }}>{(s.kg || 0).toFixed(1)}</td>
                              <td style={{ textAlign: 'right', color: 'var(--gold)' }}>${Math.round(s.total || 0).toLocaleString('es-AR')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SECCION DE ADMIN: borrado de historial anterior a una fecha */}
            {isAdmin && (
              <div style={{ marginTop: 20, padding: '14px 18px', background: '#2a1a1a', border: '1px solid #5a2a2a', borderRadius: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red-light)', marginBottom: 8 }}>🗑️ Limpieza de historial (solo administrador)</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
                  Borra entradas y salidas de esta categoría anteriores a la fecha que elijas. Acción IRREVERSIBLE. El stock actual no se altera.
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)' }}>Borrar registros anteriores a:</label>
                  <input type="date" value={fechaCorte} onChange={e => setFechaCorte(e.target.value)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 13 }} />
                  <button onClick={borrarHistorialAnterior} disabled={!fechaCorte || loadingDetalle} style={{ background: fechaCorte ? 'var(--red-light)' : 'var(--surface2)', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: fechaCorte ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 700, color: '#fff', opacity: fechaCorte ? 1 : 0.5 }}>🗑️ Borrar historial anterior</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}