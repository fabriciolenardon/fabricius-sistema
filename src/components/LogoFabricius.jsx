// ============================================================
// LogoFabricius — muestra el logo si existe, sino el texto
// ============================================================
// Variantes:
//   variant="header"  → /logo.png       (horizontal SAS — header)
//   variant="full"    → /logo-full.png  (circular toro — login/desposte)
// Si la imagen no carga, fallback automático al texto.
// ============================================================
import { useState } from 'react'

const FUENTES = {
  header: '/logo.png',
  full:   '/logo-full.png',
}

export default function LogoFabricius({
  variant = 'header',
  size = 'medium',
  src,
  invertido = false,
}) {
  const [error, setError] = useState(false)

  const altos = {
    small:  variant === 'full' ? 60  : 32,
    medium: variant === 'full' ? 110 : 44,
    large:  variant === 'full' ? 220 : 60,
  }
  const alto = altos[size] || 44

  const fuente = src || FUENTES[variant] || FUENTES.header

  if (error || !fuente) {
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
      src={fuente}
      alt="Carnicerías Fabricius SAS"
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
