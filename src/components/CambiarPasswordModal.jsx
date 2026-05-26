// ============================================================
// CambiarPasswordModal — Modal para cambiar la contraseña del
// usuario logueado. Se invoca desde el dropdown del usuario en
// cada layout (Admin, Cajero, Cliente, Desposte, Franquicia).
//
// Valida que la nueva contraseña cumpla las reglas que están
// configuradas en Supabase Auth (mínimo 8 caracteres, mezcla de
// mayúsculas / minúsculas / dígitos / símbolos). Si Supabase
// rechaza el cambio, muestra el error tal como vino del backend
// para que el usuario sepa qué le faltó.
// ============================================================
import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function CambiarPasswordModal({ onClose }) {
  const [pwActual, setPwActual] = useState('')
  const [pwNueva, setPwNueva] = useState('')
  const [pwConfirma, setPwConfirma] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (pwNueva.length < 8) {
      setError('La nueva contraseña tiene que tener al menos 8 caracteres.')
      return
    }
    if (pwNueva !== pwConfirma) {
      setError('La confirmación no coincide con la nueva contraseña.')
      return
    }
    if (pwNueva === pwActual) {
      setError('La nueva contraseña tiene que ser distinta a la actual.')
      return
    }

    setLoading(true)

    // Supabase tiene activado "Require current password when updating"
    // → primero reautenticamos con la contraseña actual para verificarla
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      setError('No se pudo obtener tu email. Volvé a loguearte.')
      setLoading(false)
      return
    }

    const { error: errSignIn } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: pwActual,
    })
    if (errSignIn) {
      setError('La contraseña actual es incorrecta.')
      setLoading(false)
      return
    }

    // Actualizamos la contraseña
    const { error: errUpdate } = await supabase.auth.updateUser({ password: pwNueva })
    if (errUpdate) {
      setError(errUpdate.message || 'No se pudo cambiar la contraseña.')
      setLoading(false)
      return
    }

    setOk(true)
    setLoading(false)
    setTimeout(() => { onClose() }, 1800)
  }

  const inp = {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', borderRadius: 8, padding: '10px 12px',
    fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none',
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(2px)', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--surface)', border: '1px solid var(--gold)',
        borderRadius: 14, padding: 24, width: '100%', maxWidth: 420,
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, color: 'var(--gold)', letterSpacing: 2 }}>
            🔑 CAMBIAR CONTRASEÑA
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        {ok ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--green)', fontSize: 15 }}>
            ✅ Contraseña cambiada con éxito.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4, letterSpacing: 0.5 }}>
                Contraseña actual
              </label>
              <input type="password" value={pwActual} onChange={e => setPwActual(e.target.value)} required autoFocus style={inp} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4, letterSpacing: 0.5 }}>
                Contraseña nueva
              </label>
              <input type="password" value={pwNueva} onChange={e => setPwNueva(e.target.value)} required style={inp} placeholder="Mín. 8 caracteres, mayús + minús + dígito + símbolo" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4, letterSpacing: 0.5 }}>
                Confirmar contraseña nueva
              </label>
              <input type="password" value={pwConfirma} onChange={e => setPwConfirma(e.target.value)} required style={inp} />
            </div>

            {error && (
              <div style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', color: 'var(--red-light)', borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>
                ❌ {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button type="button" onClick={onClose} disabled={loading}
                style={{ flex: 1, padding: '10px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                Cancelar
              </button>
              <button type="submit" disabled={loading}
                style={{ flex: 1, padding: '10px', background: 'var(--gold)', border: 'none', color: '#000', borderRadius: 8, cursor: loading ? 'wait' : 'pointer', fontSize: 14, fontWeight: 700 }}>
                {loading ? 'Guardando...' : 'Cambiar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
