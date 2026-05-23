// ============================================================
// LogoFabricius — muestra el logo si existe, sino el texto
// ============================================================
// El usuario debe guardar el archivo como `public/logo.png`
// (o .jpg, .svg, .webp — cambiar la ruta abajo si usa otra extensión).
// Si la imagen no carga (404 o cualquier error), automáticamente
// hace fallback al texto "🥩 FABRICIUS".
// ============================================================
import { useState } from 'react'

export default function LogoFabricius({
  size = 'medium',  // 'small' | 'medium' | 'large'
  src = '/logo.png',
  invertido = false, // si la imagen es para fondo claro pero queremos verla en fondo oscuro
}) {
  const [error, setError] = useState(false)

  const altos = { small: 28, medium: 42, large: 80 }
  const alto = altos[size] || 42

  if (error || !src) {
    // Fallback: texto con estilo de marca
    return (
      <div style={{
        fontFamily: "'Bebas Neue', cursive",
        fontSize: size === 'large' ? 36 : size === 'small' ? 18 : 22,
        color: 'var(--gold)',
        letterSpacing: size === 'large' ? 4 : 2,
        whiteSpace: 'nowrap',
      }}>
        🥩 FABRICIUS
      </div>
    )
  }

  return (
    <img
      src={src}
      alt="Carnicerías Fabricius"
      onError={() => setError(true)}
      style={{
        height: alto,
        width: 'auto',
        maxWidth: '100%',
        display: 'block',
        filter: invertido ? 'invert(1)' : 'none',
        objectFit: 'contain',
      }}
    />
  )
}
