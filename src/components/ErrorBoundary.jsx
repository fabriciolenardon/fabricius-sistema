// ============================================================
// ERROR BOUNDARY — que nunca más quede la pantalla gris muda
// ============================================================
// El 29/08/2026 Fabricio abrió el sistema y vio una ventana gris vacía
// ("no me anda"): hubo 3 deploys seguidos esa tarde y su ventana (PWA) pedía
// chunks lazy del deploy ANTERIOR, que Vercel ya había purgado. El import()
// falla, React desmonta TODO el árbol y no queda ni el LoadingScreen ni el
// banner del VersionWatcher (viven adentro del árbol que se desmontó).
//
// Esto ataja cualquier error de render/carga:
//   · Error de chunk (deploy nuevo purgó los assets viejos): recarga sola
//     UNA vez — la recarga trae el index.html nuevo con los hashes nuevos.
//     Guard en sessionStorage para no entrar en loop si sigue fallando.
//   · Cualquier otro error (o chunk que sigue fallando tras recargar):
//     pantalla con branding y botón "Recargar el sistema" — nunca el gris mudo.
import { Component } from 'react'

const GUARD_KEY = 'fabricius_chunk_reload'
const GUARD_MS = 60 * 1000 // a lo sumo una auto-recarga por minuto

function esErrorDeChunk(error) {
  const msg = String(error?.message || error || '')
  // Chrome/Edge, Firefox y Safari lo dicen distinto.
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|dynamically imported module|loading chunk|css chunk/i.test(msg)
}

function puedeAutoRecargar() {
  try {
    const ultima = Number(sessionStorage.getItem(GUARD_KEY) || 0)
    if (Date.now() - ultima < GUARD_MS) return false
    sessionStorage.setItem(GUARD_KEY, String(Date.now()))
    return true
  } catch {
    // sessionStorage bloqueado (modo raro del navegador): mejor no auto-recargar
    // para no arriesgar un loop; el usuario ve la pantalla con el botón.
    return false
  }
}

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    if (esErrorDeChunk(error) && puedeAutoRecargar()) {
      window.location.reload()
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    const chunk = esErrorDeChunk(this.state.error)
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#131310', flexDirection: 'column',
        gap: 16, padding: 24, textAlign: 'center',
      }}>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 32, color: '#d4a017', letterSpacing: 3 }}>
          CARNICERIAS FABRICIUS
        </div>
        <div style={{ color: '#e8e6e0', fontSize: 15, maxWidth: 420, lineHeight: 1.5 }}>
          {chunk
            ? 'Hay una versión nueva del sistema y esta ventana quedó con la anterior.'
            : 'El sistema tuvo un error al cargar esta pantalla.'}
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: '#d4a017', color: '#000', border: 'none', borderRadius: 8,
            padding: '12px 28px', cursor: 'pointer', fontWeight: 800, fontSize: 15,
          }}>
          🔄 Recargar el sistema
        </button>
        {!chunk && (
          <div style={{ color: '#8a877e', fontSize: 12, maxWidth: 420, wordBreak: 'break-word' }}>
            {String(this.state.error?.message || this.state.error)}
          </div>
        )}
      </div>
    )
  }
}
