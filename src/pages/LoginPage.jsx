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
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 48, color: 'var(--gold)', letterSpacing: 4, lineHeight: 1, textShadow: '0 0 40px rgba(201,168,76,0.3)' }}>
            CARNICERIAS<br />FABRICIUS
          </div>
          <div style={{ width: 60, height: 2, background: 'linear-gradient(90deg,transparent,var(--gold),transparent)', margin: '16px auto' }} />
          <div style={{ fontSize: 11, letterSpacing: 4, textTransform: 'uppercase', color: 'var(--muted)' }}>
            Sistema de gestión · Río Primero, Córdoba
          </div>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 36, boxShadow: '0 0 60px rgba(0,0,0,0.5)' }}>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, letterSpacing: 2, color: 'var(--text2)', marginBottom: 24 }}>
            Iniciar sesión
          </div>

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" required autoFocus />
            </div>
            <div className="form-group">
              <label>Contraseña</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <button type="submit" disabled={loading} style={{
              width: '100%', padding: 14,
              background: 'linear-gradient(135deg, var(--gold), var(--amber))',
              border: 'none', borderRadius: 10, color: '#000',
              fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 700,
              letterSpacing: 1, textTransform: 'uppercase', cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1, marginTop: 8, transition: 'all 0.2s'
            }}>
              {loading ? 'Ingresando...' : 'Ingresar al sistema'}
            </button>
          </form>

          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 12 }}>
              ¿No tenés acceso?
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
              Si sos cliente mayorista y querés acceder al portal,<br />contactanos por WhatsApp para activarlo.
            </div>
            <a
              href="https://wa.me/5493574400346?text=Hola%2C%20quisiera%20solicitar%20acceso%20al%20portal%20de%20cliente%20mayorista%20de%20Fabricius."
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '10px 18px', background: '#25D366', color: '#fff',
                borderRadius: 10, textDecoration: 'none', fontSize: 13, fontWeight: 700,
                fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.5,
                boxShadow: '0 0 16px rgba(37,211,102,0.3)',
                transition: 'transform 0.15s'
              }}
              onMouseOver={e => e.currentTarget.style.transform = 'scale(1.04)'}
              onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}>
              💬 Escribinos al 3574 400346
            </a>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 14 }}>
              📍 Av. Mitre 670 — Río Primero, Córdoba
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
