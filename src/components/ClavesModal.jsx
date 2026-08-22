// ============================================================
// ClavesModal — "🔑 Contraseñas" del menú del usuario
// ============================================================
// Un solo lugar con las dos claves que maneja una persona:
//
//   1) La CONTRASEÑA DEL SISTEMA — con la que se entra. La cambia cada uno
//      para sí mismo (Supabase Auth) → abre el CambiarPasswordModal de siempre.
//   2) La CLAVE DE CAJA — la que autoriza eliminar una compra. Es UNA POR
//      NEGOCIO (no por persona) y sólo la cambia el dueño: el CEO en la
//      central, el usuario de la sucursal en su boca. Ver mig 102 y
//      lib/clavesOperativas.js.
//
// Al resto del personal la opción 2 le aparece explicada pero deshabilitada:
// que sepan que existe y a quién pedírsela, en vez de un botón que da error.
// ============================================================
import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { esCEO, esSucursal } from '../lib/permisos'
import { hayClaveCaja, setClaveCaja } from '../lib/clavesOperativas'
import CambiarPasswordModal from './CambiarPasswordModal'

export default function ClavesModal({ onClose }) {
  const { profile, user } = useAuth()
  const puedeCambiarCaja = esCEO(profile, user) || esSucursal(profile)

  const [vista, setVista] = useState('menu')   // menu | sistema | caja
  const [hayClave, setHayClave] = useState(null)

  useEffect(() => { hayClaveCaja().then(setHayClave) }, [])

  if (vista === 'sistema') return <CambiarPasswordModal onClose={onClose} />

  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(2px)', padding: 16,
  }
  const caja = {
    background: 'var(--surface)', border: '1px solid var(--gold)',
    borderRadius: 14, padding: 24, width: '100%', maxWidth: 460,
    boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={caja}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, color: 'var(--gold)', letterSpacing: 2 }}>
            🔑 CONTRASEÑAS
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        {vista === 'menu' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Opcion
              icono="👤"
              titulo="Contraseña del sistema"
              detalle="Con la que entrás a Fabricius. Es tuya: no la ve nadie más."
              onClick={() => setVista('sistema')}
            />
            <Opcion
              icono="🧾"
              titulo="Clave de caja"
              detalle={
                puedeCambiarCaja
                  ? (hayClave === false
                      ? '⚠️ Todavía no está configurada. Es la que se pide para eliminar una compra.'
                      : 'La que se pide para eliminar una compra. Es una sola para todo el negocio.')
                  : 'La que se pide para eliminar una compra. La define el dueño del negocio.'
              }
              onClick={puedeCambiarCaja ? () => setVista('caja') : null}
              alerta={puedeCambiarCaja && hayClave === false}
            />
          </div>
        ) : (
          <FormClaveCaja
            hayClave={hayClave}
            quien={profile?.nombre || user?.email || null}
            onListo={() => { setHayClave(true); setVista('menu') }}
            onVolver={() => setVista('menu')}
          />
        )}
      </div>
    </div>
  )
}

function Opcion({ icono, titulo, detalle, onClick, alerta }) {
  const clickeable = typeof onClick === 'function'
  return (
    <button
      onClick={onClick || undefined}
      disabled={!clickeable}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12, textAlign: 'left',
        background: 'var(--surface2)',
        border: `1px solid ${alerta ? 'var(--amber)' : 'var(--border)'}`,
        borderRadius: 10, padding: '14px 16px',
        cursor: clickeable ? 'pointer' : 'default',
        opacity: clickeable ? 1 : 0.6,
        fontFamily: "'DM Sans', sans-serif", width: '100%',
      }}>
      <span style={{ fontSize: 20, lineHeight: 1.2 }}>{icono}</span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>{titulo}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>{detalle}</span>
      </span>
      {clickeable && <span style={{ color: 'var(--muted)', fontSize: 18 }}>›</span>}
    </button>
  )
}

// Formulario de la clave de caja. No pide la clave anterior: el que llega acá
// ya es el dueño (y si la olvidó, justamente necesita poder reemplazarla).
function FormClaveCaja({ hayClave, quien, onListo, onVolver }) {
  const [clave, setClave] = useState('')
  const [confirma, setConfirma] = useState('')
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(false)

  const inp = {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', borderRadius: 8, padding: '10px 12px',
    fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none',
  }

  async function guardar(e) {
    e.preventDefault()
    setError(null)
    if (clave.trim().length < 4) { setError('La clave tiene que tener al menos 4 caracteres.'); return }
    if (clave !== confirma) { setError('La confirmación no coincide.'); return }
    setLoading(true)
    const { error: err } = await setClaveCaja(clave, quien)
    setLoading(false)
    if (err) { setError(err.message || 'No se pudo guardar la clave.'); return }
    setOk(true)
    setTimeout(onListo, 1500)
  }

  if (ok) {
    return <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--green)', fontSize: 15 }}>✅ Clave de caja guardada.</div>
  }

  return (
    <form onSubmit={guardar} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
        Es la clave que el sistema pide para <strong style={{ color: 'var(--text)' }}>eliminar una compra</strong>.
        Vale para todo el negocio y la sabe quien vos quieras: no es la contraseña con la que entra cada uno.
        {hayClave && <><br /><span style={{ color: 'var(--amber)' }}>Ya hay una configurada — al guardar, la reemplazás.</span></>}
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Clave nueva</label>
        <input type="password" value={clave} onChange={e => setClave(e.target.value)} required autoFocus style={inp} placeholder="Mín. 4 caracteres" />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Repetir la clave</label>
        <input type="password" value={confirma} onChange={e => setConfirma(e.target.value)} required style={inp} />
      </div>
      {error && (
        <div style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', color: 'var(--red-light)', borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>
          ❌ {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button type="button" onClick={onVolver} disabled={loading}
          style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '10px 14px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: 14 }}>
          ← Volver
        </button>
        <button type="submit" disabled={loading}
          style={{ flex: 1, background: 'var(--gold)', border: 'none', color: '#000', borderRadius: 8, padding: '10px 14px', cursor: loading ? 'wait' : 'pointer', fontWeight: 700, fontFamily: "'DM Sans', sans-serif", fontSize: 14 }}>
          {loading ? 'Guardando…' : 'Guardar clave'}
        </button>
      </div>
    </form>
  )
}
