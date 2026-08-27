// ============================================================
// VERSION WATCHER — mata las pestañas viejas
// ============================================================
// Un deploy de Vercel NO llega a un navegador que no recarga: la pestaña
// sigue corriendo el bundle con el que se abrió, con todos sus bugs. El
// 27/08/2026 la caja de Monte Cristo escribió débitos inflados un día entero
// con un bug YA ARREGLADO — la pestaña era de dos días antes.
//
// Cómo funciona: el build embebe __BUILD_ID__ en el bundle y publica el mismo
// id en /version.json (vite.config.js). Esto compara los dos cada 5 minutos y
// al volver el foco a la pestaña:
//   · Pestaña ESCONDIDA hace más de 30 min (la caja que quedó abierta a la
//     noche): se recarga sola. No hay nadie tipeando, no se pierde nada.
//   · Pestaña A LA VISTA: banner fijo arriba con botón "Actualizar". No se
//     recarga sola — podría haber un carrito cargado o un formulario a
//     medias, y perder eso es peor que el banner.
//
// En dev no hay /version.json: el fetch falla y no pasa nada (catch vacío).
// ============================================================
import { useEffect, useState } from 'react'

const INTERVALO_MS = 5 * 60 * 1000        // chequeo cada 5 minutos
const RECARGA_OCULTA_MS = 30 * 60 * 1000  // auto-recarga si está oculta > 30 min

export default function VersionWatcher() {
  const [desactualizada, setDesactualizada] = useState(false)

  useEffect(() => {
    let ocultaDesde = document.visibilityState === 'hidden' ? Date.now() : null

    async function chequear() {
      try {
        // no-store: sin esto el navegador podría devolver el version.json
        // cacheado del deploy viejo y el chequeo mentiría siempre.
        const res = await fetch('/version.json', { cache: 'no-store' })
        if (!res.ok) return
        const { v } = await res.json()
        if (!v || v === __BUILD_ID__) return
        // Hay versión nueva. Si la pestaña está escondida hace rato (la caja
        // que quedó abierta a la noche), recargar solo: no hay nadie tipeando.
        if (document.visibilityState === 'hidden'
            && ocultaDesde && Date.now() - ocultaDesde > RECARGA_OCULTA_MS) {
          window.location.reload()
          return
        }
        setDesactualizada(true)
      } catch {
        // dev, sin red, o Vercel en medio de un deploy: probar de nuevo después
      }
    }

    function onVisibilidad() {
      if (document.visibilityState === 'hidden') {
        ocultaDesde = Date.now()
      } else {
        ocultaDesde = null
        chequear() // al volver a la pestaña, chequear al toque
      }
    }

    const timer = setInterval(chequear, INTERVALO_MS)
    document.addEventListener('visibilitychange', onVisibilidad)
    chequear()
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisibilidad) }
  }, [])

  if (!desactualizada) return null

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: 'linear-gradient(90deg, #2a1a0a, #1a1408)',
      borderBottom: '2px solid var(--gold)',
      padding: '10px 16px', display: 'flex', alignItems: 'center',
      justifyContent: 'center', gap: 14, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>
        🔄 Hay una versión nueva del sistema. Esta pestaña está corriendo una versión vieja.
      </span>
      <button onClick={() => window.location.reload()}
        style={{
          background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8,
          padding: '8px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13,
        }}>
        Actualizar ahora
      </button>
    </div>
  )
}
