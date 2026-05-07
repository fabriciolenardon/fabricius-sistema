import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) { setError('Email o contraseña incorrectos'); return }
    navigate('/')
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg)', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(201,168,76,0.06) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(192,57,43,0.05) 0%, transparent 50%)'
    }}>
      <div style={{ width: 420 }} className="fade-up">
        {/* BRAND */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 48, color: 'var(--gold)', letterSpacing: 4, lineHeight: 1, textShadow: '0 0 40px rgba(201,168,76,0.3)' }}>
            CARNICERIAS<br />FABRICIUS
          </div>
          <div style={{ width: 60, height: 2, background: 'linear-gradient(90deg,transparent,var(--gold),transparent)', margin: '16px auto' }} />
          <div style={{ fontSize: 11, letterSpacing: 4, textTransform: 'uppercase', color: 'var(--muted)' }}>
            Sistema de gestión · Río Primero, Córdoba
          </div>
        </div>

        {/* CARD */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 36, boxShadow: '0 0 60px rgba(0,0,0,0.5)' }}>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, letterSpacing: 2, color: 'var(--text2)', marginBottom: 24 }}>
            Iniciar sesión
          </div>

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu@email.com"
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: 14,
                background: 'linear-gradient(135deg, var(--gold), var(--amber))',
                border: 'none', borderRadius: 10, color: '#000',
                fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 700,
                letterSpacing: 1, textTransform: 'uppercase', cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1, marginTop: 8,
                transition: 'all 0.2s'
              }}
            >
              {loading ? 'Ingresando...' : 'Ingresar al sistema'}
            </button>
          </form>

          {/* USUARIOS HINT */}
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>
              Usuarios del sistema
            </div>
            {[
              { nombre: 'Fabricio Lenardon', email: 'fabricio@fabricius.com.ar', rol: 'Admin' },
              { nombre: 'Ariel Garrone', email: 'ariel@fabricius.com.ar', rol: 'Admin' },
              { nombre: 'Giuliana Frontera', email: 'giuliana@fabricius.com.ar', rol: 'Admin' },
              { nombre: 'Sucursal Alvear', email: 'alvear@fabricius.com.ar', rol: 'Franquicia' },
              { nombre: 'Sucursal Monte Cristo', email: 'montecRisto@fabricius.com.ar', rol: 'Franquicia' },
            ].map(u => (
              <div key={u.email} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', color: 'var(--muted2)' }}>
                <span style={{ color: 'var(--text2)' }}>{u.nombre}</span>
                <span className={`badge ${u.rol === 'Admin' ? 'badge-gold' : 'badge-teal'}`}>{u.rol}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
