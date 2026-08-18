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

// ============================================================
// MÓDULOS DE UNA SUCURSAL
// ============================================================
// Una franquicia maneja su propio negocio con las mismas pantallas, pero no
// necesita todo: la facturación, el WhatsApp y los tableros de dirección son
// de la central. Lista definida por Fabricio (18/08/2026).
//
// Se aplica en las mismas dos capas que las restricciones por email:
//   1. Menú (AdminLayout, escritorio y celular)
//   2. Ruta (App.jsx) para el que entra tipeando la URL
//
// Ojo: esto es la PANTALLA. Que no puedan ver los datos de la central lo
// garantiza la base con RLS (supabase/93 y 94), no esta lista.
export const MODULOS_SUCURSAL = [
  '/admin/caja',          // vender al público
  '/admin/ventas',        // Ventas Cta/Cte — remitos a clientes con cuenta
  '/admin/deposito',      // ingresos, desposte, piezas, remitos, ajuste
  '/admin/precios',       // su lista (la carga a mano, respeta la del contrato)
  '/admin/presupuestos',
  '/admin/clientes',      // su propia cartera
  '/admin/proveedores',   // los suyos, con la central como uno más
  '/admin/sueldos',
  '/admin/gastos',
  '/admin/dashboard',
  '/admin/cierre',
]

// Fuera para la sucursal: Pedidos Mayoristas, WhatsApp, Etiquetas, Cheques,
// Facturación, Ejecutivo, Modo TV, Productividad y Auditoría.
export function moduloDeSucursal(ruta) {
  if (!ruta) return false
  return MODULOS_SUCURSAL.some(r => ruta.startsWith(r))
}
