// FranquiciaLayout.jsx
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

export default function FranquiciaLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const navItems = [
    { to: '/franquicia/dashboard', icon: '📊', label: 'Mi cuenta' },
    { to: '/franquicia/ctacte', icon: '💳', label: 'Cuenta corriente' },
    { to: '/franquicia/remitos', icon: '📋', label: 'Mis remitos' },
    { to: '/franquicia/precios', icon: '💲', label: 'Lista de precios' },
  ]
  async function handleLogout() { await signOut(); navigate('/login') }
  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 58, background: 'rgba(10,10,8,0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--gold)', zIndex: 200, display: 'flex', alignItems: 'center', padding: '0 20px', gap: 14 }}>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 20, color: 'var(--gold)', letterSpacing: 2 }}>🥩 FABRICIUS</div>
        <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
        <nav style={{ display: 'flex', gap: 2, flex: 1 }}>
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to}
              style={({ isActive }) => ({ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: 'none', transition: 'all 0.2s', border: '1px solid transparent', background: isActive ? 'var(--teal)' : 'transparent', color: isActive ? '#fff' : 'var(--muted)' })}>
              <span>{item.icon}</span>{item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 8, padding: '4px 12px', fontSize: 12, color: 'var(--gold)' }}>
            🏪 {profile?.sucursales?.nombre || profile?.nombre}
          </div>
          <button onClick={handleLogout} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontSize: 11, cursor: 'pointer' }}>Salir</button>
        </div>
      </header>
      <main style={{ paddingTop: 58 }}>
        <div style={{ padding: 28 }} className="fade-in"><Outlet /></div>
      </main>
    </div>
  )
}
