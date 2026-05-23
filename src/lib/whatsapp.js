// ============================================================
// WhatsApp helper — usa wa.me (sin API, sin tokens)
// ============================================================
// Abre WhatsApp Web/App con número y mensaje pre-cargado.
// NO envía info a servicios externos. El usuario aprieta "Enviar"
// manualmente en su WhatsApp. Respeta privacidad.
// ============================================================

// Limpia un número para el formato wa.me: solo dígitos, sin signo +
// Acepta: "351 555-1234", "+5493515551234", "351-15-555-1234"
// Devuelve: "5493515551234" (asume Argentina si tiene 10 dígitos)
export function limpiarNumero(numero) {
  if (!numero) return ''
  let n = String(numero).replace(/[^\d]/g, '')
  // Si arranca con 0, sacarlo
  if (n.startsWith('0')) n = n.slice(1)
  // Si tiene 10 dígitos (formato AR sin 9), asumir Argentina y agregar 549
  if (n.length === 10) n = '549' + n
  // Si tiene 11 dígitos y arranca con 15, removerlo y poner 549
  else if (n.length === 11 && n.startsWith('15')) n = '549' + n.slice(2)
  // Si tiene 12-13 dígitos y arranca con 54, asumir que ya tiene código país
  else if (n.length >= 11 && n.startsWith('54')) {
    // Asegurarse que tenga el 9 después del 54 para móviles
    if (!n.startsWith('549')) n = '549' + n.slice(2)
  }
  return n
}

// Abre WhatsApp con número + mensaje. numero puede ir vacío para elegir contacto.
export function enviarWhatsapp(numero, mensaje) {
  const num = limpiarNumero(numero)
  const texto = encodeURIComponent(mensaje || '')
  const url = num
    ? `https://wa.me/${num}?text=${texto}`
    : `https://wa.me/?text=${texto}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

// Variante: copia al clipboard si no se quiere abrir Whats
export async function copiarMensaje(mensaje) {
  try {
    await navigator.clipboard.writeText(mensaje)
    return true
  } catch {
    return false
  }
}

// Helper de format para precios y kg que usamos seguido en mensajes
export const fmtArs = n => '$' + Math.round(Math.abs(Number(n) || 0)).toLocaleString('es-AR')
export const fmtKg  = n => (Number(n) || 0).toFixed(2) + ' kg'
