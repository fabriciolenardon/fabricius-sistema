// ============================================================
// LAYOUT DESPOSTE — Tablet/pantalla del sector desposte
// ============================================================
// Layout simple y grande, pensado para uso en tablet.
// Muestra solo 2 pestañas: Capones y Media Reses.
// El logout vuelve al login común.
// ============================================================
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import LogoFabricius from '../../components/LogoFabricius'

export default function DesposteLayout() {
  const { signOut, profile } = useAuth()
  const navigate = useNavigate()

  async function salir() {
    await signOut()
    navigate('/login', { replace: true })
  }

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
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Carnicerías Fabricius — {profile?.nombre || 'Operario'}
          </div>
        </div>
        <button onClick={salir}
          style={{
            padding: '10px 18px', background: '#3a1a1a', border: '1px solid #5a2a2a',
            color: '#ff8b8b', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700,
          }}>
          🚪 Salir
        </button>
      </header>

      {/* Tabs */}
      <nav style={{ display: 'flex', gap: 4, padding: 12, background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <NavLinkBig to="/desposte/capones" icono="🐷" label="Desposte Capones" />
        <NavLinkBig to="/desposte/media-res" icono="🐄" label="Desposte Media Res" />
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
        flex: 1, padding: '16px 12px', borderRadius: 10, border: 'none',
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
