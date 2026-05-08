import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from 'recharts'

function fmt(n) {
  const abs = Math.abs(Math.round(n || 0))
  if (abs >= 1000000) return '$' + (abs / 1000000).toFixed(1) + 'M'
  if (abs >= 1000) return '$' + (abs / 1000).toFixed(0) + 'K'
  return '$' + abs.toLocaleString('es-AR')
}
function fmtFull(n) { return '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR') }

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text2)' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, marginBottom: 2 }}>{p.name}: {fmt(p.value)}</div>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [cierres, setCierres] = useState([])
  const [clientes, setClientes] = useState([])
  const [entradas, setEntradas] = useState([])
  const [salidas, setSalidas] = useState([])
  const [remitos, setRemitos] = useState([])
  const [gastos, setGastos] = useState([])
  const [cheques, setCheques] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const [c, cl, e, s, r, g, ch] = await Promise.all([
      supabase.from('cierres_semanales').select('*').order('semana_inicio', { ascending: false }).limit(8),
      supabase.from('clientes').select('*').order('saldo', { ascending: false }),
      supabase.from('entradas_deposito').select('*').order('fecha', { ascending: false }).limit(100),
      supabase.from('salidas_deposito').select('*').order('fecha', { ascending: false }).limit(100),
      supabase.from('remitos').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('gastos').select('*').order('fecha', { ascending: false }).limit(5),
      supabase.from('cheques').select('*').order('fecha_pago', { ascending: true }).limit(20),
    ])
    setCierres(c.data || [])
    setClientes(cl.data || [])
    setEntradas(e.data || [])
    setSalidas(s.data || [])
    setRemitos(r.data || [])
    setGastos(g.data || [])
    setCheques(ch.data || [])
    setLoading(false)
  }

  const hora = new Date().getHours()
  const saludo = hora < 12 ? 'Buen día' : hora < 18 ? 'Buenas tardes' : 'Buenas noches'
  const nombre = profile?.nombre?.split(' ')[0] || 'Admin'

  const ultimo = cierres[0]
  const mesActual = cierres.filter(c => c.mes === ultimo?.mes)
  const totMesVentas = mesActual.reduce((s, c) => s + c.ventas, 0)
  const totMesGanancia = mesActual.reduce((s, c) => s + c.ganancia, 0)
  const totMesCompras = mesActual.reduce((s, c) => s + c.compras, 0)
  const totMesGastos = mesActual.reduce((s, c) => s + c.gastos, 0)

  const stockBovino = Math.max(0, entradas.filter(e => e.tipo === 'bovino_mr').reduce((s, e) => s + (e.kg_real || 0), 0) - salidas.filter(s => s.tipo === 'bovino_mr').reduce((s, e) => s + (e.kg || 0), 0))
  const stockPollo = Math.max(0, entradas.filter(e => e.tipo === 'pollo').reduce((s, e) => s + (e.kg || 0), 0) - salidas.filter(s => s.tipo === 'pollo').reduce((s, e) => s + (e.kg || 0), 0))
  const stockCerdo = Math.max(0, entradas.filter(e => e.tipo === 'cerdo').reduce((s, e) => s + (e.kg || 0), 0) - salidas.filter(s => s.tipo === 'cerdo').reduce((s, e) => s + (e.kg || 0), 0))

  const clientesDeuda = clientes.filter(c => c.saldo > 0).sort((a, b) => b.saldo - a.saldo)
  const totalDeuda = clientesDeuda.reduce((s, c) => s + c.saldo, 0)

  const hoy = new Date()
  const en15 = new Date(); en15.setDate(hoy.getDate() + 15)
  const chequesPorVencer = cheques.filter(ch => {
    if (!ch.fecha_pago) return false
    const f = new Date(ch.fecha_pago + 'T12:00')
    return f >= hoy && f <= en15
  })

  // Datos para gráficos — últimas 6 semanas ordenadas cronológicamente
  const datosGrafico = [...cierres].reverse().slice(-6).map(c => ({
    semana: new Date(c.semana_inicio + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
    Ventas: c.ventas,
    Compras: c.compras,
    Gastos: c.gastos,
    Ganancia: c.ganancia,
  }))

  if (loading) return <div style={{ padding: 40, color: 'var(--muted)', textAlign: 'center' }}>Cargando dashboard...</div>

  return (
    <div>
      {/* WELCOME */}
      <div style={{ background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface2) 100%)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, marginBottom: 24, backgroundImage: 'radial-gradient(circle at 90% 50%, rgba(201,168,76,0.08), transparent 60%)' }}>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 32, letterSpacing: 2, color: 'var(--gold)' }}>{saludo}, {nombre} 👋</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>Sistema de gestión · Carnicerías Fabricius · Río Primero, Córdoba</div>
      </div>

      {/* ALERTAS */}
      {(chequesPorVencer.length > 0 || totalDeuda > 0) && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
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
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>{clientesDeuda.length} clientes deben un total de <strong style={{ color: 'var(--red-light)' }}>{fmtFull(totalDeuda)}</strong></div>
            </div>
          )}
        </div>
      )}

      {/* STATS MES */}
      <div className="grid4" style={{ marginBottom: 20 }}>
        {[
          { label: 'Ventas del mes', value: fmt(totMesVentas), sub: mesActual.length + ' semanas cerradas', color: 'var(--green)', icon: '💰' },
          { label: 'Compras del mes', value: fmt(totMesCompras), sub: 'proveedores', color: 'var(--red-light)', icon: '🛒' },
          { label: 'Gastos del mes', value: fmt(totMesGastos), sub: 'operativos + socios', color: 'var(--amber)', icon: '💸' },
          { label: 'Ganancia del mes', value: fmt(totMesGanancia), sub: totMesGanancia >= 0 ? '✅ Positivo' : '⚠️ Negativo', color: totMesGanancia >= 0 ? 'var(--gold)' : 'var(--red-light)', icon: '📈' },
        ].map(s => (
          <div key={s.label} className="stat" onMouseOver={e => e.currentTarget.style.borderColor = 'var(--gold)'} onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{s.icon}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* GRÁFICOS */}
      {datosGrafico.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          {/* BARRAS: Ventas vs Compras vs Gastos */}
          <div className="card">
            <div className="card-title">📊 Ventas vs Egresos — últimas semanas</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={datosGrafico} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="semana" tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                <YAxis tickFormatter={v => fmt(v)} tick={{ fontSize: 9, fill: 'var(--muted)' }} width={48} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Ventas" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Compras" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Gastos" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* LÍNEA: Tendencia de Ganancia */}
          <div className="card">
            <div className="card-title">📈 Tendencia de ganancia semanal</div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={datosGrafico} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="semana" tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                <YAxis tickFormatter={v => fmt(v)} tick={{ fontSize: 9, fill: 'var(--muted)' }} width={48} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="Ganancia" stroke="#c9a84c" strokeWidth={2.5} dot={{ fill: '#c9a84c', r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="Ventas" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* STOCK */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div className="card-title" style={{ margin: 0 }}>📦 Stock actual del depósito</div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/admin/deposito')}>Ver depósito →</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {[
            { label: '🥩 Bovino (Media Res)', kg: stockBovino, color: 'var(--gold)', aprox: Math.round(stockBovino / 105) + ' medias aprox' },
            { label: '🍗 Pollo', kg: stockPollo, color: 'var(--blue)', aprox: Math.round(stockPollo / 20) + ' cajones aprox' },
            { label: '🐷 Cerdo', kg: stockCerdo, color: 'var(--amber)', aprox: Math.round(stockCerdo / 107) + ' capones aprox' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--surface2)', borderRadius: 10, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>{s.label}</div>
              <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 32, color: s.kg < 100 ? 'var(--red-light)' : s.color }}>{s.kg.toFixed(1)} kg</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{s.aprox}</div>
              {s.kg < 100 && <div style={{ fontSize: 11, color: 'var(--red-light)', marginTop: 4, fontWeight: 700 }}>⚠️ Stock bajo</div>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
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
                <button key={a.label} className="btn btn-ghost"
                  style={{ textAlign: 'left', padding: '10px 12px', width: '100%', fontSize: 12 }}
                  onClick={() => navigate(a.path)}>
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
    </div>
  )
}
