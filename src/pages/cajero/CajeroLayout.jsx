// ============================================================
// LAYOUT del CAJERO
// ============================================================
// Layout minimalista para usuarios con rol "cajero". Solo muestra:
//   - Header con logo, nombre del cajero y botón salir
//   - Pantalla de Caja Rápida en pleno (Vender / Historial / Arqueo)
//
// No tiene menú lateral ni acceso a otras páginas del sistema.
// ============================================================
import { Outlet, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

export default function CajeroLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* HEADER fijo */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        height: 56, display: 'flex', alignItems: 'center', padding: '0 20px',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22 }}>🥩</span>
          <span style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, color: 'var(--gold)', letterSpacing: 2 }}>
            FABRICIUS · CAJA
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{profile?.nombre || 'Cajero/a'}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>💵 Caja minorista</div>
          </div>
          <button onClick={handleSignOut}
            style={{
              padding: '6px 14px', background: 'transparent',
              border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--muted)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>
            🚪 Salir
          </button>
        </div>
      </header>

      {/* CONTENIDO */}
      <main style={{ paddingTop: 56, minHeight: '100vh' }}>
        <div style={{ padding: '20px 24px' }} className="fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
