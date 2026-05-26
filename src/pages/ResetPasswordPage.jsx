// ============================================================
// ResetPasswordPage — Pantalla a la que aterriza el usuario
// desde el link que recibe por mail cuando hace "Olvidé mi
// contraseña" en el login.
//
// Supabase abre esta ruta con un hash en la URL que contiene
// un access_token. El SDK detecta automáticamente el hash y
// crea una sesión temporal (de tipo "recovery"). Mientras
// esa sesión esté activa, el usuario puede llamar a
// updateUser({ password }) sin tener que conocer la contraseña
// anterior. Es el único momento en que se puede saltear ese
// chequeo, que normalmente está activado.
// ============================================================
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import LogoFabricius from '../components/LogoFabricius'

export default function ResetPasswordPage() {
  const [pw, setPw] = useState('')
  const [pwConfirma, setPwConfirma] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(false)
  const [sesionRecovery, setSesionRecovery] = useState(null)
  const navigate = useNavigate()

  // Detectamos el evento PASSWORD_RECOVERY que dispara el SDK
  // cuando el usuario llega con el token de recuperación.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSesionRecovery(session)
      }
    })
    // También chequeamos la sesión actual por si llegamos después del evento
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) setSesionRecovery(data.session)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (pw.length < 8) {
      setError('La contraseña tiene que tener al menos 8 caracteres.')
      return
    }
    if (pw !== pwConfirma) {
      setError('La confirmación no coincide.')
      return
    }

    setLoading(true)
    const { error: errUpdate } = await supabase.auth.updateUser({ password: pw })
    setLoading(false)

    if (errUpdate) {
      setError(errUpdate.message || 'No se pudo actualizar la contraseña.')
      return
    }

    setOk(true)
    setTimeout(() => navigate('/login', { replace: true }), 2200)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 16,
      backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(201,168,76,0.06) 0%, transparent 60%)',
    }}>
      <div style={{ width: '100%', maxWidth: 420 }} className="fade-up">
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <LogoFabricius size="large" />
          <div style={{ fontSize: 11, letterSpacing: 4, textTransform: 'uppercase', color: 'var(--muted)', marginTop: 8 }}>
            Restablecer contraseña
          </div>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 32 }}>
          {ok ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 15, color: 'var(--green)', fontWeight: 600 }}>
                Contraseña actualizada
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
                Te llevamos al login...
              </div>
            </div>
          ) : !sesionRecovery ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>
                ⏳ Validando el link de recuperación...<br />
                Si tarda más de unos segundos, el link puede haber expirado.<br />
                <button
                  onClick={() => navigate('/login')}
                  style={{ marginTop: 16, padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>
                  Volver al login
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Nueva contraseña</label>
                <input type="password" value={pw} onChange={e => setPw(e.target.value)} required autoFocus placeholder="Mín. 8 caracteres" />
              </div>
              <div className="form-group">
                <label>Confirmar contraseña</label>
                <input type="password" value={pwConfirma} onChange={e => setPwConfirma(e.target.value)} required />
              </div>

              {error && <div className="alert alert-error">{error}</div>}

              <button type="submit" disabled={loading} style={{
                width: '100%', padding: 14,
                background: 'linear-gradient(135deg, var(--gold), var(--amber))',
                border: 'none', borderRadius: 10, color: '#000',
                fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 700,
                letterSpacing: 1, textTransform: 'uppercase',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1, marginTop: 8,
              }}>
                {loading ? 'Guardando...' : 'Cambiar contraseña'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
