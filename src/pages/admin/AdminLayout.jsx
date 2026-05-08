import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const navItems = [
  { to: '/admin/dashboard',   icon: '📊', label: 'Dashboard' },
  { to: '/admin/deposito',    icon: '🏭', label: 'Depósito' },
  { to: '/admin/precios',     icon: '💲', label: 'Precios' },
  { to: '/admin/clientes',    icon: '👥', label: 'Clientes' },
  { to: '/admin/franquicias', icon: '🏪', label: 'Franquicias' },
  { to: '/admin/cheques',     icon: '📄', label: 'Cheques' },
  { to: '/admin/sueldos',     icon: '💰', label: 'Sueldos' },
  { to: '/admin/gastos',      icon: '💸', label: 'Gastos' },
  { to: '/admin/cierre',      icon: '📋', label: 'Cierre' },
]

export default function AdminLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await signOut()
    navigate('/login')
  }

  const initiales = profile?.nombre?.split(' ').map(n => n[0]).slice(0, 2).join('') || 'U'

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 58,
        background: 'rgba(10,10,8,0.95)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)', zIndex: 200,
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 14
      }}>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 20, color: 'var(--gold)', letterSpacing: 2, whiteSpace: 'nowrap' }}>
          🥩 FABRICIUS
        </div>
        <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
        <nav style={{ display: 'flex', gap: 2, flex: 1, overflowX: 'auto' }}>
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 8,
                fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                textDecoration: 'none', transition: 'all 0.2s',
                border: '1px solid transparent',
                background: isActive ? 'var(--gold)' : 'transparent',
                color: isActive ? '#000' : 'var(--muted)',
              })}>
              <span>{item.icon}</span>{item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '5px 14px 5px 8px' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#000' }}>
              {initiales}
            </div>
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
      </header>
      <main style={{ paddingTop: 58, minHeight: '100vh' }}>
        <div style={{ padding: 28 }} className="fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
