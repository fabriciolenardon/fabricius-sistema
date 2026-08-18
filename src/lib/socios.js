// ============================================================
// SOCIOS — los dueños de cada negocio
// ============================================================
// Antes estaban escritos a mano en tres lugares (el widget del Dashboard, el
// selector y los topes de Gastos, y el aviso de WhatsApp). Con una sola
// carnicería alcanzaba; con dos no, porque Monte Cristo abrió el sistema y le
// aparecieron los socios de la central.
//
// Ahora viven en la tabla `socios`, una fila por dueño y por sucursal. La base
// ya aísla sola (migración 98), así que cada negocio ve los suyos y nada más.
// ============================================================
import { supabase } from './supabase'

// Clave interna a partir del nombre: es lo que se guarda en `gastos.socio`,
// así que tiene que ser estable y sin caracteres raros.
// "Pamela Tissera" → "pamela_tissera"
export function claveDeNombre(nombre) {
  return String(nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // saca acentos
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

// Cómo lo saluda el sistema: el apodo si lo cargó, si no el primer nombre.
export function comoLoLlamamos(socio) {
  if (!socio) return ''
  const apodo = String(socio.apodo || '').trim()
  if (apodo) return apodo
  return String(socio.nombre || '').trim().split(/\s+/)[0] || ''
}

export async function cargarSocios() {
  // Sin filtro por sucursal: lo pone el RLS. Si se filtrara acá y alguien se
  // olvidara, se verían los socios del otro negocio.
  const { data, error } = await supabase
    .from('socios').select('*').eq('activo', true)
    .order('orden').order('created_at')
  if (error) {
    console.warn('No se pudieron leer los socios:', error.message)
    return []
  }
  return data || []
}

export function socioPrincipal(socios) {
  if (!Array.isArray(socios) || socios.length === 0) return null
  return socios.find(s => s.es_principal) || socios[0]
}

// Crea o actualiza un socio. `sucursal_id` no se manda: lo pone el trigger.
export async function guardarSocio(socio) {
  const nombre = String(socio.nombre || '').trim()
  if (!nombre) return { error: new Error('Poné el nombre del dueño.') }

  const fila = {
    nombre,
    apodo: String(socio.apodo || '').trim() || null,
    porcentaje: Number(socio.porcentaje) || 0,
    tope_mensual: socio.tope_mensual === '' || socio.tope_mensual == null ? null : Number(socio.tope_mensual),
    es_principal: !!socio.es_principal,
    orden: Number(socio.orden) || 0,
  }

  if (socio.id) {
    const { error } = await supabase.from('socios').update(fila).eq('id', socio.id)
    return { error: error || null }
  }
  // La clave sale del nombre y NO se toca más: los gastos ya cargados apuntan
  // a ella. Por eso al editar un socio existente no se recalcula.
  const { error } = await supabase.from('socios').insert({ ...fila, clave: claveDeNombre(nombre) })
  return { error: error || null }
}

// Solo puede haber un principal por sucursal (índice único en la base), así
// que primero se baja al que estaba y después se sube el nuevo.
export async function marcarPrincipal(socios, id) {
  const anterior = (socios || []).find(s => s.es_principal && s.id !== id)
  if (anterior) await supabase.from('socios').update({ es_principal: false }).eq('id', anterior.id)
  const { error } = await supabase.from('socios').update({ es_principal: true }).eq('id', id)
  return { error: error || null }
}

// Baja lógica: los gastos históricos siguen apuntando a su clave, así que
// borrar la fila dejaría esos gastos sin dueño. Se desactiva y listo.
export async function desactivarSocio(id) {
  const { error } = await supabase.from('socios').update({ activo: false, es_principal: false }).eq('id', id)
  return { error: error || null }
}

// Tope total del negocio + si el control está prendido. Vive en la fila de la
// sucursal (no en config_sistema, que todavía es una sola para todos).
export async function cargarTopeNegocio(sucursalId) {
  if (!sucursalId) return { total: null, activo: false }
  const { data } = await supabase.from('sucursales')
    .select('tope_gastos_total, tope_gastos_activo').eq('id', sucursalId).maybeSingle()
  return { total: data?.tope_gastos_total ?? null, activo: !!data?.tope_gastos_activo }
}

export async function guardarTopeNegocio(sucursalId, { total, activo }) {
  const { error } = await supabase.from('sucursales').update({
    tope_gastos_total: total === '' || total == null ? null : Number(total),
    tope_gastos_activo: !!activo,
  }).eq('id', sucursalId)
  return { error: error || null }
}
