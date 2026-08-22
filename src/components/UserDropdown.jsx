// ============================================================
// UserDropdown — Componente compartido para mostrar el bloque
// del usuario en la esquina superior derecha de cada layout.
//
// Click sobre el bloque (avatar + nombre + rol) → dropdown con:
//   - 🔑 Contraseñas (la del sistema y la clave de caja)
//   - 🚪 Cerrar sesión
//
// Diseñado para reemplazar el bloque que hoy está copiado en
// AdminLayout, CajeroLayout, ClienteLayout, DesposteLayout y
// FranquiciaLayout — todos repetían el avatar + nombre + botón
// "Salir" con estilos similares pero ligeramente distintos.
//
// La etiqueta de rol que aparece debajo del nombre se pasa como
// prop (rolLabel) para respetar el copy específico de cada layout
// (ej. "💵 Caja minorista" en CajeroLayout, "👑 CEO" en Admin
// cuando es Fabricio).
// ============================================================
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ClavesModal from './ClavesModal'

export default function UserDropdown({ rolLabel, accentColor }) {
  const { profile, signOut, user } = useAuth()
  const navigate = useNavigate()
  const [abierto, setAbierto] = useState(false)
  const [modalAbierto, setModalAbierto] = useState(false)
  const ref = useRef(null)

  // Cerrar el dropdown al clickear afuera
  useEffect(() => {
    function onClickFuera(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false)
    }
    document.addEventListener('mousedown', onClickFuera)
    return () => document.removeEventListener('mousedown', onClickFuera)
  }, [])

  async function handleLogout() {
    setAbierto(false)
    await signOut()
    navigate('/login', { replace: true })
  }

  const iniciales = profile?.nombre?.split(' ').map(n => n[0]).slice(0, 2).join('') || 'U'
  // Si no se pasa rolLabel explícito, derivar del rol del profile
  const labelMostrada = rolLabel || derivarLabel(profile?.rol, user?.email)
  const colorRol = accentColor || (user?.email === 'fabriciolenardon@gmail.com' ? 'var(--gold)' : 'var(--muted)')

  return (
    <>
      <div ref={ref} style={{ position: 'relative' }}>
        <button
          onClick={() => setAbierto(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 20, padding: '5px 14px 5px 8px', cursor: 'pointer',
            fontFamily: "'DM Sans', sans-serif",
          }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', background: 'var(--gold)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#000',
          }}>{iniciales}</div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', lineHeight: 1.2 }}>
              {profile?.nombre || 'Usuario'}
            </div>
            <div style={{
              fontSize: 10, color: colorRol,
              fontWeight: colorRol === 'var(--gold)' ? 700 : 400,
              letterSpacing: colorRol === 'var(--gold)' ? 1 : 0,
            }}>{labelMostrada}</div>
          </div>
          <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 2 }}>▾</span>
        </button>

        {abierto && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            minWidth: 220, background: 'var(--surface)',
            border: '1px solid var(--border)', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 600,
            overflow: 'hidden',
          }}>
            <button
              onClick={() => { setAbierto(false); setModalAbierto(true) }}
              style={btnItem}
              onMouseOver={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
              🔑 Contraseñas
            </button>
            <div style={{ height: 1, background: 'var(--border)' }} />
            <button
              onClick={handleLogout}
              style={{ ...btnItem, color: 'var(--red-light)' }}
              onMouseOver={e => e.currentTarget.style.background = '#3a1a1a'}
              onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
              🚪 Cerrar sesión
            </button>
          </div>
        )}
      </div>

      {modalAbierto && <ClavesModal onClose={() => setModalAbierto(false)} />}
    </>
  )
}

const btnItem = {
  width: '100%', textAlign: 'left', background: 'transparent',
  border: 'none', color: 'var(--text2)', padding: '11px 14px',
  cursor: 'pointer', fontSize: 13, fontWeight: 600,
  fontFamily: "'DM Sans', sans-serif",
  display: 'flex', alignItems: 'center', gap: 8,
}

function derivarLabel(rol, email) {
  if (email === 'fabriciolenardon@gmail.com') return '👑 CEO'
  if (rol === 'admin') return 'Administrador'
  if (rol === 'cajero') return '💵 Cajero/a'
  if (rol === 'desposte') return '🔪 Desposte'
  if (rol === 'franquicia') return '🏪 Franquicia'
  if (rol === 'cliente_mayorista') return '📦 Cliente mayorista'
  return 'Usuario'
}
