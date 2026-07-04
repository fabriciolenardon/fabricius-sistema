// ============================================================
// Módulos restringidos por usuario (además del rol).
// El rol admin da acceso a todo; acá se VEDAN módulos puntuales
// a usuarios puntuales, por email. Se aplica en dos capas:
//   1. Menú (desktop y mobile): el módulo no aparece.
//   2. Ruta (App.jsx): si entra por URL directa, lo manda al Dashboard.
// ============================================================

export const MODULOS_RESTRINGIDOS = {
  // Giuliana Frontera (secretaría): de Dirección solo ve Dashboard.
  'fabriciuscarnicerias@gmail.com': ['/admin/cierre', '/admin/auditoria'],
}

// ¿Este email tiene vedada esta ruta? Compara por prefijo para cubrir
// querystrings o subrutas (/admin/cierre?tab=mes).
export function rutaRestringida(email, ruta) {
  if (!email || !ruta) return false
  return (MODULOS_RESTRINGIDOS[email] || []).some(r => ruta.startsWith(r))
}
