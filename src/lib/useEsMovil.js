import { useState, useEffect } from 'react'

// ¿Estamos en un celular? (ancho < breakpoint, default 768px). Reacciona al
// resize / rotación de pantalla. Sirve para apilar grillas o cambiar layouts
// que, al estar con estilos inline, no pueden usar media queries de CSS.
export function useEsMovil(breakpoint = 768) {
  const [esMovil, setEsMovil] = useState(() => {
    try { return window.innerWidth < breakpoint } catch { return false }
  })
  useEffect(() => {
    const f = () => setEsMovil(window.innerWidth < breakpoint)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [breakpoint])
  return esMovil
}
