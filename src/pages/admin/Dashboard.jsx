import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

function fmt(n) {
  const abs = Math.abs(Math.round(n || 0))
  const str = abs >= 1000000 ? (abs / 1000000).toFixed(1) + 'M' : abs >= 1000 ? (abs / 1000).toFixed(0) + 'K' : abs.toString()
  return '$' + str
}
function fmtFull(n) { return '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR') }

export default function Dashboard() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [cierres, setCierres] = useState([])
  const [alertas, setAlertas] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    // Últimos 5 cierres
    const { data: c } = await supabase
      .from('cierres_semanales')
      .select('*')
      .order('semana_inicio', { ascending: false })
      .limit(5)
    setCierres(c || [])
    setLoading(false)
  }

  const hora = new Date().getHours()
  const saludo = hora < 12 ? 'Buen día' : hora < 18 ? 'Buenas tardes' : 'Buenas noches'
  const nombre = profile?.nombre?.split(' ')[0] || 'Admin'

  // Calcular totales del último cierre
  const ultimo = cierres[0]
  const mesActual = cierres.filter(c => c.mes === ultimo?.mes)
  const totMesVentas = mesActual.reduce((s, c) => s + c.ventas, 0)
  const totMesGanancia = mesActual.reduce((s, c) => s + c.ganancia, 0)
  const totMesKg = mesActual.reduce((s, c) => s + c.kg_carne + c.kg_pollo + c.kg_cerdo, 0)

  return (
    <div>
      {/* WELCOME */}
      <div style={{
        background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface2) 100%)',
        border: '1px solid var(--border)', borderRadius: 16, padding: 28, marginBottom: 24,
        backgroundImage: 'radial-gradient(circle at 90% 50%, rgba(201,168,76,0.06), transparent 60%)'
      }}>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 30, letterSpacing: 2, color: 'var(--gold)' }}>
          {saludo}, {nombre} 👋
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
          {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 10 }}>
          Sistema de gestión · Carnicerias Fabricius · Río Primero, Córdoba
        </div>
      </div>

      {/* STATS */}
      <div className="grid4" style={{ marginBottom: 24 }}>
        {[
          { label: 'Ventas del mes', value: fmt(totMesVentas), sub: mesActual.length + ' semanas', color: 'var(--green)', icon: '💰' },
          { label: 'Ganancia del mes', value: fmt(totMesGanancia), sub: totMesGanancia >= 0 ? '✅ Positivo' : '⚠️ Negativo', color: totMesGanancia >= 0 ? 'var(--gold)' : 'var(--red-light)', icon: '📈' },
          { label: 'Kg movidos', value: (totMesKg / 1000).toFixed(1) + 'K', sub: 'carne + pollo + cerdo', color: 'var(--blue)', icon: '⚖️' },
          { label: 'Semanas cerradas', value: mesActual.length, sub: 'del mes actual', color: 'var(--amber)', icon: '📋' },
        ].map(s => (
          <div key={s.label} className="stat" style={{ transition: 'border 0.2s' }}
            onMouseOver={e => e.currentTarget.style.borderColor = 'var(--gold)'}
            onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>{s.icon}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid2">
        {/* CIERRES */}
        <div className="card">
          <div className="card-title">
            Últimos cierres semanales
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/admin/cierre')}>Ver todos →</button>
          </div>
          {loading ? (
            <div className="empty">Cargando...</div>
          ) : cierres.length === 0 ? (
            <div className="empty">Sin cierres registrados</div>
          ) : (
            <table>
              <thead><tr><th>Semana</th><th>Ventas</th><th>Compras</th><th>Ganancia</th></tr></thead>
              <tbody>
                {cierres.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontSize: 12 }}>
                      {new Date(c.semana_inicio + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                      {' → '}
                      {new Date(c.semana_fin + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                    </td>
                    <td style={{ color: 'var(--green)' }}>{fmt(c.ventas)}</td>
                    <td style={{ color: 'var(--red-light)' }}>{fmt(c.compras)}</td>
                    <td style={{ color: c.ganancia >= 0 ? 'var(--gold)' : 'var(--red-light)', fontWeight: 600 }}>
                      {fmt(c.ganancia)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          {/* SOCIOS */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Distribución socios — mes actual</div>
            {[
              { nombre: 'Fabricio Lenardon', pct: 85, color: 'var(--gold)' },
              { nombre: 'Ariel Garrone', pct: 15, color: 'var(--blue)' },
            ].map(s => (
              <div key={s.nombre} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                  <span>{s.nombre} ({s.pct}%)</span>
                  <span style={{ color: s.color, fontFamily: "'Bebas Neue', cursive", fontSize: 18 }}>
                    {fmt(totMesGanancia * s.pct / 100)}
                  </span>
                </div>
                <div style={{ background: 'var(--border)', borderRadius: 4, height: 8 }}>
                  <div style={{ height: 8, borderRadius: 4, background: s.color, width: s.pct + '%', transition: 'width 0.5s' }} />
                </div>
              </div>
            ))}
          </div>

          {/* ACCESOS RAPIDOS */}
          <div className="card">
            <div className="card-title">Accesos rápidos</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { label: '📋 Nuevo cierre', path: '/admin/cierre' },
                { label: '📥 Entrada depósito', path: '/admin/deposito' },
                { label: '💰 Liquidar sueldos', path: '/admin/sueldos' },
                { label: '📄 Registrar cheque', path: '/admin/cheques' },
                { label: '💳 Cuentas corrientes', path: '/admin/clientes' },
                { label: '💸 Cargar gasto', path: '/admin/gastos' },
              ].map(a => (
                <button
                  key={a.path}
                  className="btn btn-ghost"
                  style={{ textAlign: 'left', padding: 12, width: '100%' }}
                  onClick={() => navigate(a.path)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
