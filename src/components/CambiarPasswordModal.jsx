// ============================================================
// CambiarPasswordModal — Modal para cambiar la contraseña del
// usuario logueado. Se invoca desde el dropdown del usuario en
// cada layout (Admin, Cajero, Cliente, Desposte, Franquicia).
//
// Valida que la nueva contraseña cumpla las reglas que están
// configuradas en Supabase Auth (mínimo 8 caracteres, mezcla de
// mayúsculas / minúsculas / dígitos / símbolos).
//
// CAMBIO SEGURO (Fabricio 29/08): el proyecto tiene activado el "secure
// password change" de Supabase — el PUT /user rebota con "Current password
// required when setting new password" aunque reautentiquemos con
// signInWithPassword. La vía soportada es reauthenticate(): manda un CÓDIGO
// de 6 dígitos al mail y el updateUser va con ese código como `nonce`.
// Es un código que se tipea acá (no un link), así Gmail no lo puede quemar
// como pasaba con el link de recuperación.
// ============================================================
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'

export default function CambiarPasswordModal({ onClose }) {
  const [pwActual, setPwActual] = useState('')
  const [pwNueva, setPwNueva] = useState('')
  const [pwConfirma, setPwConfirma] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(false)
  // Paso 2 del cambio seguro: Supabase mandó el código al mail y acá se tipea.
  const [pideCodigo, setPideCodigo] = useState(false)
  const [codigo, setCodigo] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (pwNueva.length < 8) {
      setError('La nueva contraseña tiene que tener al menos 8 caracteres.')
      return
    }
    // Las reglas de Supabase Auth chequeadas ACÁ y en español (Fabricio
    // 29/08: el rechazo del backend le llegó en inglés y no se entendía).
    const falta = []
    if (!/[a-z]/.test(pwNueva)) falta.push('una minúscula')
    if (!/[A-Z]/.test(pwNueva)) falta.push('una MAYÚSCULA')
    if (!/[0-9]/.test(pwNueva)) falta.push('un número')
    if (!/[^a-zA-Z0-9]/.test(pwNueva)) falta.push('un símbolo (por ej. ! @ # $ % . -)')
    if (falta.length > 0) {
      setError(`A la nueva contraseña le falta ${falta.join(', ')}. Tiene que mezclar minúsculas, MAYÚSCULAS, números y algún símbolo.`)
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
      // El proyecto exige confirmar el cambio con un código por mail
      // (cambio seguro): lo pedimos y pasamos al paso del código.
      if (/current password required|reauthentication/i.test(errUpdate.message || '')) {
        const { error: errRe } = await supabase.auth.reauthenticate()
        if (errRe) {
          setError('No se pudo mandar el código de confirmación al mail: ' + errRe.message)
          setLoading(false)
          return
        }
        setPideCodigo(true)
        setLoading(false)
        return
      }
      // Red de abajo: si igual llega el rechazo del backend, en español.
      setError(/should contain at least one character/i.test(errUpdate.message || '')
        ? 'La contraseña tiene que mezclar minúsculas, MAYÚSCULAS, números y algún símbolo (por ej. ! @ # $ % . -).'
        : (errUpdate.message || 'No se pudo cambiar la contraseña.'))
      setLoading(false)
      return
    }

    setOk(true)
    setLoading(false)
    setTimeout(() => { onClose() }, 1800)
  }

  // Paso 2: el usuario tipea el código de 6 dígitos que llegó al mail y el
  // cambio va con ese código como nonce.
  async function handleConfirmarCodigo(e) {
    e.preventDefault()
    setError(null)
    if (!codigo.trim()) { setError('Poné el código que te llegó al mail.'); return }
    setLoading(true)
    const { error: errUpdate } = await supabase.auth.updateUser({ password: pwNueva, nonce: codigo.trim() })
    setLoading(false)
    if (errUpdate) {
      setError(/nonce|invalid|expired/i.test(errUpdate.message || '')
        ? 'El código no es válido o venció. Fijate el último mail (cada código nuevo anula el anterior) o cerrá y volvé a empezar.'
        : (errUpdate.message || 'No se pudo cambiar la contraseña.'))
      return
    }
    setOk(true)
    setTimeout(() => { onClose() }, 1800)
  }

  const inp = {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', borderRadius: 8, padding: '10px 12px',
    fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none',
  }

  // Portal a <body>: el header del admin tiene `backdrop-filter`, que hace de
  // marco de referencia para los `position: fixed` de sus hijos. Abierto desde
  // el menú del usuario (que vive en el header), el modal quedaba encajado en
  // esa franja de 56px en vez de ocupar la pantalla.
  return createPortal((
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
        ) : pideCodigo ? (
          <form onSubmit={handleConfirmarCodigo} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: '#1a2a0a', border: '1px solid #4a8a2a', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#7dff7d', lineHeight: 1.5 }}>
              📧 Te mandamos un <strong>código</strong> al mail para confirmar que sos vos.
              Ponelo acá abajo y la contraseña nueva queda guardada.
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4, letterSpacing: 0.5 }}>
                Código del mail
              </label>
              <input type="text" inputMode="numeric" autoComplete="one-time-code" value={codigo}
                onChange={e => setCodigo(e.target.value)} required autoFocus style={{ ...inp, letterSpacing: 4, fontSize: 18, textAlign: 'center' }} placeholder="000000" />
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
                {loading ? 'Confirmando...' : 'Confirmar cambio'}
              </button>
            </div>
          </form>
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
  ), document.body)
}
