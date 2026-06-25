// ClienteLayout.jsx - Portal del cliente mayorista
// Responsive: en desktop, nav arriba; en celular, barra de pestañas abajo
// (estilo app nativa) con íconos + etiquetas cortas.
import { Outlet, NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
import UserDropdown from '../../components/UserDropdown'

const navItems = [
  { to: '/cliente/dashboard',    icon: '📊', label: 'Mi cuenta',        corto: 'Cuenta' },
  { to: '/cliente/nuevo-pedido', icon: '📥', label: 'Hacer pedido',     corto: 'Pedir' },
  { to: '/cliente/pedidos',      icon: '📋', label: 'Mis pedidos',      corto: 'Pedidos' },
  { to: '/cliente/ctacte',       icon: '💳', label: 'Cuenta corriente', corto: 'Cta cte' },
  { to: '/cliente/remitos',      icon: '🧾', label: 'Mis remitos',      corto: 'Remitos' },
  { to: '/cliente/precios',      icon: '💲', label: 'Lista de precios',  corto: 'Precios' },
]

export default function ClienteLayout() {
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* HEADER */}
      <header style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 56, background: 'rgba(10,10,8,0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--gold)', zIndex: 200, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 14 }}>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 20, color: 'var(--gold)', letterSpacing: 2, whiteSpace: 'nowrap' }}>🥩 FABRICIUS</div>
        {!isMobile && (
          <>
            <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
            <nav style={{ display: 'flex', gap: 2, flex: 1, overflowX: 'auto' }}>
              {navItems.map(item => (
                <NavLink key={item.to} to={item.to}
                  style={({ isActive }) => ({ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', textDecoration: 'none', transition: 'all 0.2s', border: '1px solid transparent', background: isActive ? 'var(--gold)' : 'transparent', color: isActive ? '#000' : 'var(--muted)' })}>
                  <span>{item.icon}</span>{item.label}
                </NavLink>
              ))}
            </nav>
          </>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <UserDropdown rolLabel="📦 Cliente mayorista" />
        </div>
      </header>

      {/* CONTENIDO */}
      <main style={{ paddingTop: 56, paddingBottom: isMobile ? 78 : 0 }}>
        <div style={{ padding: isMobile ? '14px 12px' : 28 }} className="fade-in"><Outlet /></div>
      </main>

      {/* BARRA DE PESTAÑAS ABAJO — solo celular */}
      {isMobile && (
        <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'rgba(10,10,8,0.98)', backdropFilter: 'blur(12px)', borderTop: '1px solid var(--gold)', zIndex: 200, display: 'flex', justifyContent: 'space-around', alignItems: 'stretch', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to}
              style={({ isActive }) => ({ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '8px 2px 7px', textDecoration: 'none', color: isActive ? 'var(--gold)' : 'var(--muted)', fontSize: 10, fontWeight: 700 })}>
              <span style={{ fontSize: 20, lineHeight: 1 }}>{item.icon}</span>
              <span style={{ whiteSpace: 'nowrap' }}>{item.corto}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}
