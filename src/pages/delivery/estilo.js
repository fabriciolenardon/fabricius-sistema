// ============================================================
// Estilo de la app pública de delivery (/pedir)
// ============================================================
// Es la cara que ve el PÚBLICO, no el sistema: fondo claro, tinta casi
// negra y el dorado de la marca. El index.css global está pensado para el
// sistema (fondo oscuro, inputs al 100% con fondo oscuro), así que acá
// cada control trae su fondo y su color explícitos.
// ============================================================
import { useEffect } from 'react'

export const C = {
  bg: '#FFFFFF',
  ink: '#1B1714',
  muted: '#5F5650',
  line: '#DDD5CA',
  soft: '#F6F2EC',
  gold: '#C9973A',
  goldText: '#8A5E17',
  aviso: '#FBF3E4',
  avisoInk: '#4A3B22',
  verde: '#23683F',
  rojo: '#B42318',
}

export const F = {
  display: "'Bricolage Grotesque', 'DM Sans', sans-serif",
  body: "'Manrope', 'DM Sans', system-ui, sans-serif",
}

export const input = {
  width: '100%', height: 48, padding: '0 14px', border: `1px solid ${C.line}`, borderRadius: 12,
  background: '#FFFFFF', color: C.ink, fontFamily: F.body, fontSize: 16, boxSizing: 'border-box',
}

export const btnPrimario = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', minHeight: 56,
  border: 0, borderRadius: 14, background: C.ink, color: '#FFFFFF', fontFamily: F.body, fontWeight: 700,
  fontSize: 17, cursor: 'pointer', textDecoration: 'none',
}

export const btnSecundario = {
  ...btnPrimario, background: '#FFFFFF', color: C.ink, border: `1px solid ${C.ink}`, minHeight: 48, fontSize: 15,
}

// Pone la página en modo "app del cliente": fondo claro, tipografías,
// manifest propio (para que "Agregar a inicio" instale Fabricius Delivery
// y no el sistema) y el título de la pestaña. Lo deshace al salir.
export function useModoDelivery(titulo = 'Fabricius Delivery') {
  useEffect(() => {
    const prevBg = document.body.style.background
    const prevColor = document.body.style.color
    const prevTitle = document.title
    document.body.style.background = C.bg
    document.body.style.color = C.ink
    document.title = titulo

    const font = document.createElement('link')
    font.rel = 'stylesheet'
    font.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Manrope:wght@400;500;600;700;800&display=swap'
    document.head.appendChild(font)

    const manifest = document.querySelector('link[rel="manifest"]')
    const prevManifest = manifest?.getAttribute('href')
    if (manifest) manifest.setAttribute('href', '/manifest-delivery.json')
    const theme = document.querySelector('meta[name="theme-color"]')
    const prevTheme = theme?.getAttribute('content')
    if (theme) theme.setAttribute('content', C.ink)

    return () => {
      document.body.style.background = prevBg
      document.body.style.color = prevColor
      document.title = prevTitle
      font.remove()
      if (manifest && prevManifest) manifest.setAttribute('href', prevManifest)
      if (theme && prevTheme) theme.setAttribute('content', prevTheme)
    }
  }, [titulo])
}

// localStorage puede no estar (modo privado de iOS): nunca romper por eso.
export function leerLS(clave, porDefecto) {
  try { const v = localStorage.getItem(clave); return v ? JSON.parse(v) : porDefecto } catch { return porDefecto }
}
export function guardarLS(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)) } catch { /* sin storage: sigue andando */ }
}
