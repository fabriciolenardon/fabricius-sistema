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

// ¿Este usuario es el dueño? Recibe el profile y/o el user de Supabase Auth.
export function esCEO(profile, user) {
  const id = profile?.id || user?.id
  if (id && id === CEO_USER_ID) return true
  const email = String(user?.email || '').trim().toLowerCase()
  return !!email && email === CEO_EMAIL
}
