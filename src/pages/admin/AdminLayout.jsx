import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

const navItems = [
  { to: '/admin/dashboard',   icon: '📊', label: 'Dashboard' },
  { to: '/admin/ventas', icon: '🛒', label: 'Ventas' },
  { to: '/admin/deposito',    icon: '🏭', label: 'Depósito' },
  { to: '/admin/precios',     icon: '💲', label: 'Precios' },
  { to: '/admin/clientes',    icon: '👥', label: 'Clientes' },
  { to: '/admin/pedidos',     icon: '📥', label: 'Pedidos' },
  { to: '/admin/franquicias', icon: '🏪', label: 'Franquicias' },
  { to: '/admin/cheques',     icon: '📄', label: 'Cheques' },
  { to: '/admin/sueldos',     icon: '💰', label: 'Sueldos' },
  { to: '/admin/gastos',      icon: '💸', label: 'Gastos' },
  { to: '/admin/cierre',      icon: '📋', label: 'Cierre' },
]

function useNotificaciones() {
  const [notifs, setNotifs] = useState([])
  useEffect(() => {
    async function cargar() {
      const hoy = new Date()
      const en15 = new Date(); en15.setDate(hoy.getDate() + 15)
      const hoyStr = hoy.toISOString().split('T')[0]
      const en15Str = en15.toISOString().split('T')[0]

      const [{ data: cheques }, { data: clientes }, { data: cierres }, { data: stockData }] = await Promise.all([
        supabase.from('cheques').select('*').gte('fecha_pago', hoyStr).lte('fecha_pago', en15Str),
        supabase.from('clientes').select('*').gt('saldo', 0).order('saldo', { ascending: false }),
        supabase.from('cierres_semanales').select('*').order('semana_inicio', { ascending: false }).limit(1),
        supabase.from('stock_actual').select('*'),
      ])

      const nuevas = []

      if (cheques?.length > 0) {
        cheques.forEach(ch => {
          const dias = Math.ceil((new Date(ch.fecha_pago + 'T12:00') - hoy) / (1000 * 60 * 60 * 24))
          nuevas.push({ tipo: 'warning', icono: '📄', titulo: `Cheque #${ch.numero} vence en ${dias} día${dias !== 1 ? 's' : ''}`, sub: `${ch.cliente_nombre} — $${Math.round(ch.monto).toLocaleString('es-AR')}`, link: '/admin/cheques' })
        })
      }

      if (clientes?.length > 0) {
        clientes.slice(0, 3).forEach(c => {
          if (c.saldo > 100000) nuevas.push({ tipo: 'danger', icono: '💳', titulo: `${c.nombre} debe $${Math.round(c.saldo).toLocaleString('es-AR')}`, sub: 'Saldo pendiente', link: '/admin/clientes' })
        })
      }

      if (cierres?.length > 0) {
        const diasSinCierre = Math.floor((hoy - new Date(cierres[0].semana_fin + 'T12:00')) / (1000 * 60 * 60 * 24))
        if (diasSinCierre > 8) nuevas.push({ tipo: 'info', icono: '📋', titulo: `Hace ${diasSinCierre} días sin cierre`, sub: 'Registrá el cierre de la semana', link: '/admin/cierre' })
      }

      if (stockData) {
        const s = {}
        stockData.forEach(r => s[r.tipo] = r.kg_disponible)
        if ((s.bovino_mr || 0) < 100) nuevas.push({ tipo: 'danger', icono: '📦', titulo: `Stock bovino bajo: ${(s.bovino_mr || 0).toFixed(0)} kg`, sub: 'Pedí más mercadería', link: '/admin/deposito' })
        if ((s.pollo || 0) < 100) nuevas.push({ tipo: 'warning', icono: '📦', titulo: `Stock pollo bajo: ${(s.pollo || 0).toFixed(0)} kg`, sub: 'Pedí más mercadería', link: '/admin/deposito' })
        if ((s.cerdo || 0) < 50) nuevas.push({ tipo: 'warning', icono: '📦', titulo: `Stock cerdo bajo: ${(s.cerdo || 0).toFixed(0)} kg`, sub: 'Pedí más mercadería', link: '/admin/deposito' })
      }

      setNotifs(nuevas)
    }
    cargar()
  }, [])
  return notifs
}

function usePedidosPendientes() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    async function cargar() {
      const { count: c } = await supabase.from('pedidos').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente')
      setCount(c || 0)
    }
    cargar()
    const canal = supabase.channel('pedidos-count-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => cargar())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [])
  return count
}

function CampanaNotificaciones({ notifs }) {
  const [abierto, setAbierto] = useState(false)
  const navigate = useNavigate()
  const ref = useRef()

  useEffect(() => {
    function cerrar(e) { if (ref.current && !ref.current.contains(e.target)) setAbierto(false) }
    document.addEventListener('mousedown', cerrar)
    return () => document.removeEventListener('mousedown', cerrar)
  }, [])

  const colores = { warning: '#f59e0b', danger: '#ef4444', info: '#3b82f6' }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setAbierto(!abierto)}
        style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, minHeight: 36 }}>
        <span style={{ fontSize: 16 }}>🔔</span>
        {notifs.length > 0 && (
          <div style={{ position: 'absolute', top: -4, right: -4, background: '#ef4444', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {notifs.length}
          </div>
        )}
      </button>
      {abierto && (
        <div style={{ position: 'fixed', top: 58, right: 8, width: 'min(340px, calc(100vw - 16px))', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, zIndex: 500, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>🔔 Notificaciones</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{notifs.length} alertas</span>
          </div>
          {notifs.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>✅ Sin alertas</div>
          ) : (
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {notifs.map((n, i) => (
                <div key={i} onClick={() => { navigate(n.link); setAbierto(false) }}
                  style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start' }}
                  onMouseOver={e => e.currentTarget.style.background = 'var(--surface2)'}
                  onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: colores[n.tipo] + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{n.icono}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: colores[n.tipo], marginBottom: 2 }}>{n.titulo}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{n.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ChatbotFlotante() {
  const [abierto, setAbierto] = useState(false)
  const [msgs, setMsgs] = useState([{ rol: 'ia', texto: '¡Hola Fabricio! 🥩 Soy tu asistente con acceso a todo el sistema. Preguntame sobre clientes, saldos, stock, precios o lo que necesites.' }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  async function enviar() {
    if (!input.trim() || loading) return
    const pregunta = input.trim()
    setInput('')
    setMsgs(m => [...m, { rol: 'user', texto: pregunta }])
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        setMsgs(m => [...m, { rol: 'ia', texto: '❌ Sesión expirada. Volvé a iniciar sesión.' }])
        setLoading(false)
        return
      }
      const res = await fetch('/api/chat-sistema', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: [
            ...msgs.filter((_, i) => i > 0).map(m => ({ role: m.rol === 'user' ? 'user' : 'assistant', content: m.texto })),
            { role: 'user', content: pregunta }
          ]
        })
      })
      const data = await res.json()
      const respuesta = (data.choices?.[0]?.message?.content || 'No pude procesar tu consulta.').replace(/\*\*/g, '').replace(/\*/g, '').replace(/#/g, '').trim()
      setMsgs(m => [...m, { rol: 'ia', texto: respuesta }])
    } catch (err) {
      setMsgs(m => [...m, { rol: 'ia', texto: '❌ Error: ' + err.message }])
    }
    setLoading(false)
  }

  return (
    <>
      {abierto && (
        <div style={{ position: 'fixed', bottom: 90, right: 16, width: 'min(360px, calc(100vw - 32px))', height: 'min(480px, calc(100vh - 140px))', background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 16, zIndex: 1000, display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface2)', borderRadius: '16px 16px 0 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🤖</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)' }}>Asistente Fabricius</div>
                <div style={{ fontSize: 10, color: 'var(--green)' }}>● Acceso total al sistema</div>
              </div>
            </div>
            <button onClick={() => setAbierto(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, padding: 4 }}>✕</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.rol === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '85%', padding: '8px 12px', borderRadius: 10, background: m.rol === 'user' ? 'var(--gold)' : 'var(--surface2)', color: m.rol === 'user' ? '#000' : 'var(--text)', fontSize: 13, lineHeight: 1.5, border: m.rol === 'ia' ? '1px solid var(--border)' : 'none', whiteSpace: 'pre-wrap' }}>
                  {m.texto}
                </div>
              </div>
            ))}
            {loading && <div style={{ display: 'flex', justifyContent: 'flex-start' }}><div style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: 13 }}>Pensando... ⏳</div></div>}
          </div>
          <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 6 }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && enviar()} placeholder="Preguntame sobre el sistema..."
              style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none' }} />
            <button onClick={enviar} disabled={loading} style={{ padding: '8px 12px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13, minWidth: 40 }}>➤</button>
          </div>
        </div>
      )}
      <button onClick={() => setAbierto(!abierto)}
        style={{ position: 'fixed', bottom: 24, right: 16, width: 52, height: 52, borderRadius: '50%', background: abierto ? 'var(--surface2)' : 'var(--gold)', border: `2px solid ${abierto ? 'var(--gold)' : 'transparent'}`, cursor: 'pointer', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', transition: 'all 0.2s' }}>
        {abierto ? '✕' : '🤖'}
      </button>
    </>
  )
}

// MENÚ MOBILE CON HAMBURGUESA
function MenuMobile({ onClose }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, signOut } = useAuth()

  async function handleLogout() {
    await signOut()
    navigate('/login')
    onClose()
  }

  return (
    <>
      {/* Overlay */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, backdropFilter: 'blur(2px)' }} />
      {/* Drawer */}
      <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: 280, background: 'var(--surface)', zIndex: 301, display: 'flex', flexDirection: 'column', boxShadow: '4px 0 24px rgba(0,0,0,0.5)' }}>
        {/* Header del menú */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, color: 'var(--gold)', letterSpacing: 2 }}>🥩 FABRICIUS</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, padding: 4 }}>✕</button>
        </div>

        {/* Perfil */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#000', flexShrink: 0 }}>
            {profile?.nombre?.split(' ').map(n => n[0]).slice(0, 2).join('') || 'U'}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>{profile?.nombre}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Administrador</div>
          </div>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
          {navItems.map(item => {
            const isActive = location.pathname === item.to
            return (
              <NavLink key={item.to} to={item.to} onClick={onClose}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, marginBottom: 4, fontSize: 14, fontWeight: 600, textDecoration: 'none', background: isActive ? 'var(--gold)' : 'transparent', color: isActive ? '#000' : 'var(--text2)', transition: 'all 0.15s' }}>
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* Logout */}
        <div style={{ padding: '14px 12px', borderTop: '1px solid var(--border)' }}>
          <button onClick={handleLogout} style={{ width: '100%', padding: '12px', background: '#3a1a1a', color: 'var(--red-light)', border: '1px solid #5a2a2a', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            🚪 Cerrar sesión
          </button>
        </div>
      </div>
    </>
  )
}

export default function AdminLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const notifs = useNotificaciones()
  const pedidosPendientes = usePedidosPendientes()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 900)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 900)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  async function handleLogout() { await signOut(); navigate('/login') }

  const initiales = profile?.nombre?.split(' ').map(n => n[0]).slice(0, 2).join('') || 'U'

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* HEADER */}
      <header style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 56, background: 'rgba(10,10,8,0.97)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)', zIndex: 200, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12 }}>

        {/* MOBILE: Hamburguesa + Logo */}
        {isMobile ? (
          <>
            <button onClick={() => setMenuAbierto(true)}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 36 }}>
              <div style={{ width: 18, height: 2, background: 'var(--gold)', borderRadius: 2 }} />
              <div style={{ width: 18, height: 2, background: 'var(--gold)', borderRadius: 2 }} />
              <div style={{ width: 18, height: 2, background: 'var(--gold)', borderRadius: 2 }} />
            </button>
            <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 20, color: 'var(--gold)', letterSpacing: 2, flex: 1 }}>
              🥩 FABRICIUS
            </div>
            <CampanaNotificaciones notifs={notifs} />
          </>
        ) : (
          /* DESKTOP: Nav completo */
          <>
            <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 20, color: 'var(--gold)', letterSpacing: 2, whiteSpace: 'nowrap' }}>
              🥩 FABRICIUS
            </div>
            <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
            <nav style={{ display: 'flex', gap: 2, flex: 1, overflowX: 'auto' }}>
              {navItems.map(item => (
                <NavLink key={item.to} to={item.to}
                  style={({ isActive }) => ({ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 8, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', textDecoration: 'none', transition: 'all 0.2s', border: '1px solid transparent', background: isActive ? 'var(--gold)' : 'transparent', color: isActive ? '#000' : 'var(--muted)', position: 'relative' })}>
                  <span>{item.icon}</span>{item.label}
                  {item.to === '/admin/pedidos' && pedidosPendientes > 0 && (
                    <span style={{ background: 'var(--red-light)', color: '#fff', borderRadius: '50%', minWidth: 18, height: 18, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{pedidosPendientes}</span>
                  )}
                </NavLink>
              ))}
            </nav>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
              <CampanaNotificaciones notifs={notifs} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '5px 14px 5px 8px' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#000' }}>{initiales}</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', lineHeight: 1.2 }}>{profile?.nombre}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>Administrador</div>
                </div>
              </div>
              <button onClick={handleLogout}
                style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontSize: 11, cursor: 'pointer' }}
                onMouseOver={e => { e.target.style.borderColor = 'var(--red-light)'; e.target.style.color = 'var(--red-light)' }}
                onMouseOut={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--muted)' }}>
                Salir
              </button>
            </div>
          </>
        )}
      </header>

      {/* MENÚ MOBILE DRAWER */}
      {menuAbierto && <MenuMobile onClose={() => setMenuAbierto(false)} />}

      {/* CONTENIDO */}
      <main style={{ paddingTop: 56, minHeight: '100vh' }}>
        <div style={{ padding: isMobile ? '16px 12px' : '24px 28px' }} className="fade-in">
          <Outlet />
        </div>
      </main>

      <ChatbotFlotante />
    </div>
  )
}
