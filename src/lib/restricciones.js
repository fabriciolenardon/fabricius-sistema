// ============================================================
// Módulos restringidos por usuario (además del rol).
// El rol admin da acceso a todo; acá se VEDAN módulos puntuales
// a usuarios puntuales, por email. Se aplica en dos capas:
//   1. Menú (desktop y mobile): el módulo no aparece.
//   2. Ruta (App.jsx): si entra por URL directa, lo manda al Dashboard.
// ============================================================

export const MODULOS_RESTRINGIDOS = {
  // Giuliana Frontera (secretaría): de Dirección solo ve Productividad
  // (pedido Fabricio 06/08/2026 — antes también veía el Dashboard).
  'fabriciuscarnicerias@gmail.com': ['/admin/cierre', '/admin/auditoria', '/admin/dashboard'],
}

// ¿Este email tiene vedada esta ruta? Compara por prefijo para cubrir
// querystrings o subrutas (/admin/cierre?tab=mes).
export function rutaRestringida(email, ruta) {
  if (!email || !ruta) return false
  return (MODULOS_RESTRINGIDOS[email] || []).some(r => ruta.startsWith(r))
}

// Ruta "home" del admin según sus restricciones: el sistema por defecto manda
// a /admin/dashboard (login, redirects, módulos vedados); si el usuario tiene
// vedado el Dashboard, su inicio pasa a ser Productividad. Evita el loop de
// redirigir un módulo vedado hacia otro módulo vedado.
export function rutaInicio(email) {
  return rutaRestringida(email, '/admin/dashboard') ? '/admin/productividad' : '/admin/dashboard'
}
