// ============================================================
// LAYOUT DESPOSTE — Tablet/pantalla del sector desposte
// ============================================================
// Layout simple y grande, pensado para uso en tablet.
// Muestra solo 2 pestañas: Capones y Media Reses.
// El logout vuelve al login común.
// ============================================================
import { Outlet, NavLink } from 'react-router-dom'
import LogoFabricius from '../../components/LogoFabricius'
import UserDropdown from '../../components/UserDropdown'

export default function DesposteLayout() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* Header */}
      <header style={{
        padding: '16px 24px',
        background: 'linear-gradient(135deg, #1a1408, #0f0a04)',
        borderBottom: '2px solid var(--gold)',
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <LogoFabricius variant="full" size="medium" />
            <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 26, color: 'var(--gold)', letterSpacing: 2 }}>
              🔪 SECTOR DESPOSTE
            </div>
          </div>
        </div>
        <UserDropdown rolLabel="🔪 Desposte" />
      </header>

      {/* Tabs (flexWrap: en celular angosto pasan a 2 filas en vez de aplastarse) */}
      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 12, background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <NavLinkBig to="/desposte/pedidos" icono="📥" label="Pedidos" />
        <NavLinkBig to="/desposte/elaborar" icono="🌭" label="Elaborar" />
        <NavLinkBig to="/desposte/capones" icono="🐷" label="Capones" />
        <NavLinkBig to="/desposte/media-res" icono="🐄" label="Media Res" />
        <NavLinkBig to="/desposte/historial" icono="📋" label="Historial" />
      </nav>

      {/* Main */}
      <main style={{ flex: 1, padding: 20, overflow: 'auto' }}>
        <Outlet />
      </main>
    </div>
  )
}

function NavLinkBig({ to, icono, label }) {
  return (
    <NavLink to={to}
      style={({ isActive }) => ({
        flex: 1, minWidth: 130, padding: '16px 12px', borderRadius: 10, border: 'none',
        background: isActive ? 'var(--gold)' : 'var(--surface2)',
        color: isActive ? '#000' : 'var(--text)',
        cursor: 'pointer', fontWeight: 700, fontSize: 16,
        textAlign: 'center', textDecoration: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        fontFamily: "'DM Sans', sans-serif",
      })}>
      <span style={{ fontSize: 22 }}>{icono}</span> {label}
    </NavLink>
  )
}
