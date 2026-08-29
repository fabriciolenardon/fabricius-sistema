import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ErrorBoundary from './components/ErrorBoundary'
import App from './App'
import './index.css'

// Un deploy purga los chunks del deploy anterior: una pestaña abierta de antes
// pide un chunk viejo, Vite avisa con este evento y recargamos para traer el
// index.html nuevo (con los hashes nuevos). Mismo guard que el ErrorBoundary
// (a lo sumo una auto-recarga por minuto) para no entrar en loop si el
// problema no es el deploy sino la red.
window.addEventListener('vite:preloadError', (e) => {
  try {
    const ultima = Number(sessionStorage.getItem('fabricius_chunk_reload') || 0)
    if (Date.now() - ultima < 60 * 1000) return // que el error siga su curso → lo agarra el ErrorBoundary
    sessionStorage.setItem('fabricius_chunk_reload', String(Date.now()))
  } catch { return }
  e.preventDefault()
  window.location.reload()
})

// El watchdog de index.html marca que recargó por arranque fallido; si
// llegamos hasta acá el bundle cargó bien → limpiar la marca para que una
// próxima pantalla gris (otro deploy, otro día, misma pestaña) pueda volver
// a auto-recargarse.
try { sessionStorage.removeItem('fabricius_boot_reload') } catch { /* no-op */ }

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
)
