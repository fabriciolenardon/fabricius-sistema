// ============================================================
// LAYOUT del CAJERO
// ============================================================
// Layout minimalista para usuarios con rol "cajero". Solo muestra:
//   - Header con logo, nombre del cajero y botón salir
//   - Pantalla de Caja Rápida en pleno (Vender / Historial / Arqueo)
//
// No tiene menú lateral ni acceso a otras páginas del sistema.
// ============================================================
import { Outlet } from 'react-router-dom'
import UserDropdown from '../../components/UserDropdown'

export default function CajeroLayout() {
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

        <UserDropdown rolLabel="💵 Caja minorista" />
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
