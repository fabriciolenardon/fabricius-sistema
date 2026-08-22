// ============================================================
// CLAVE DE CAJA — la que autoriza eliminar una compra
// ============================================================
// Cada negocio tiene la suya (la central y cada franquicia) y sólo el DUEÑO
// puede cambiarla: el CEO en la central, el usuario de la sucursal en su boca.
// Mismo criterio que el ajuste de stock (`puedeAjustarStock`).
//
// La clave NO se lee nunca desde la app: la tabla `claves_operativas` tiene
// RLS con CERO policies (mig 102). Todo pasa por estas tres funciones, que en
// la base son SECURITY DEFINER:
//   set_clave_caja       define/cambia la de mi boca (valida que sea el dueño)
//   hay_clave_caja       ¿ya está configurada? (no devuelve la clave)
//   verificar_clave_caja compara la tipeada y devuelve true/false
//
// Mientras una boca no tenga clave configurada, el sistema deja eliminar como
// hasta ahora y avisa que hay que configurarla — así el día que se aplica esto
// nadie queda sin poder trabajar.
// ============================================================
import { supabase } from './supabase'

export async function hayClaveCaja() {
  const { data, error } = await supabase.rpc('hay_clave_caja')
  if (error) {
    console.warn('No se pudo consultar la clave de caja:', error.message)
    return false
  }
  return !!data
}

export async function verificarClaveCaja(clave) {
  const { data, error } = await supabase.rpc('verificar_clave_caja', { p_clave: String(clave || '') })
  if (error) {
    console.warn('No se pudo verificar la clave de caja:', error.message)
    return false
  }
  return !!data
}

// Devuelve { error } — el error viene con el texto de la base ("Solo el dueño
// del negocio puede cambiar la clave de caja", "al menos 4 caracteres"…).
export async function setClaveCaja(clave, quien) {
  const { error } = await supabase.rpc('set_clave_caja', {
    p_clave: String(clave || ''),
    p_quien: quien || null,
  })
  return { error }
}
