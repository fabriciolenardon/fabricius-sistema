// BotonAvisos — botón para activar las notificaciones push en este dispositivo.
// Solo lo ve el CEO. Si ya están activadas, no se muestra.
import { useState } from 'react'
import { activarNotificaciones, estadoPush } from '../lib/push'
import { useAuth } from '../context/AuthContext'

export default function BotonAvisos() {
  const { user, profile } = useAuth()
  const [estado, setEstado] = useState(estadoPush())
  const [cargando, setCargando] = useState(false)

  if (user?.email !== 'fabriciolenardon@gmail.com') return null
  if (estado === 'granted') return null

  async function activar() {
    setCargando(true)
    const r = await activarNotificaciones(profile)
    setCargando(false)
    alert(r.msg)
    setEstado(estadoPush())
  }

  return (
    <button onClick={activar} disabled={cargando} title="Activar avisos en este dispositivo"
      style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', minHeight: 36, fontSize: 15, color: 'var(--gold)' }}>
      {cargando ? '…' : '🔔'}
    </button>
  )
}
