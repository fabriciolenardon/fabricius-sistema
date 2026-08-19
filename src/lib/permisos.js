// ============================================================
// PERMISOS ESPECIALES — más finos que el rol
// ============================================================
// Ariel, Giuliana y Fabricio son los tres `rol='admin'`, así que el
// rol NO alcanza para distinguirlos. Acá viven los permisos que son
// exclusivos del DUEÑO (CEO), no de "cualquier admin".
//
// Hoy el único permiso de este tipo es el AJUSTE DE STOCK (pedido de
// Fabricio 14/08/2026): corregir a mano el stock reescribe la única
// fuente de verdad del depósito y borra el rastro de qué pasó, así
// que la decisión es del dueño. El resto del módulo Depósito (cargar
// ingresos, despostar, remitos) lo siguen usando todos los admin.
//
// Para dar/quitar el permiso: tocar SOLO las constantes de abajo.
// Se matchea por id de usuario Y por email (cualquiera de los dos
// alcanza) para que siga funcionando si alguna vez se recrea la
// cuenta con el mismo mail, o si cambia el mail del mismo usuario.
// ============================================================

export const CEO_USER_ID = 'cc59fc4b-ff6d-4322-bbfc-0de5728ccfe0'
export const CEO_EMAIL = 'fabriciolenardon@gmail.com'

// La central es la sucursal 1 (Río Primero). Ver supabase/92.
export const SUCURSAL_CENTRAL = 1

// ¿Este usuario es el dueño? Recibe el profile y/o el user de Supabase Auth.
export function esCEO(profile, user) {
  const id = profile?.id || user?.id
  if (id && id === CEO_USER_ID) return true
  const email = String(user?.email || '').trim().toLowerCase()
  return !!email && email === CEO_EMAIL
}

// ¿Es personal de una sucursal (no de la central)? El rol `sucursal` maneja
// su propio negocio: mismo sistema, sus datos. La base ya lo aísla sola
// (policies de supabase/93); esto es solo para la pantalla.
export function esSucursal(profile) {
  return profile?.rol === 'sucursal'
}

// ¿Quién puede tocar el Ajuste de Stock?
// Reescribir el stock a mano borra el rastro de qué pasó, así que es del
// DUEÑO del negocio — no de cualquier admin. Con una sola carnicería eso
// era Fabricio y punto; ahora el dueño de Monte Cristo tiene la misma
// potestad sobre SU depósito (la base ya no lo deja tocar el ajeno).
export function puedeAjustarStock(profile, user) {
  return esCEO(profile, user) || esSucursal(profile)
}
