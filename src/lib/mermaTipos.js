// ============================================================
// TIPOS DE MEDIA RES Y SU MERMA — central + propios de cada boca
// ============================================================
// La CENTRAL define los tipos en `config_sistema.merma_conversion`. Esa fila
// es una sola para todo el sistema (la tabla tiene PRIMARY KEY (clave)), así
// que la franquicia lee exactamente el mismo % que puso Fabricio y no lo puede
// tocar: las policies de config_sistema exigen es_central() para escribir.
// Si la central cambia un %, la sucursal lo tiene en la próxima carga, sin
// sincronizar nada.
//
// Lo que sí puede hacer una boca es AGREGAR tipos suyos —una media res que
// compra ella y la central no maneja— con su propio %. Esos viven en
// `merma_tipos_sucursal` (mig 138) y se suman a los heredados.
//
// El PRECIO no vive acá: el costo del kilo sale del precio de compra de cada
// entrada, que ya es propio de cada boca. Con la misma merma, a la sucursal le
// queda un costo por kilo más alto que a la central, porque le recompra más
// caro — y así tiene que ser.
// ============================================================
import { supabase } from './supabase'

// Mismo criterio de slug que usa el editor de la central, para que un tipo
// propio se comporte igual que uno heredado en el desposte y en los rindes.
export const slugTipo = label => String(label || '').trim().toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

// Los tipos propios de MI boca (la RLS ya filtra por sucursal).
export async function cargarTiposPropios() {
  const { data, error } = await supabase.from('merma_tipos_sucursal')
    .select('id, tipo_id, label, merma').order('label')
  if (error) return []
  return (data || []).map(t => ({
    // `merma` viene numeric → STRING. Number() antes de cualquier cuenta.
    id: t.tipo_id, label: t.label, merma: Number(t.merma) || 0,
    propio: true, filaId: t.id,
  }))
}

// La lista completa que ve una boca: primero los de la central (heredados, no
// editables) y después los propios. Si un tipo propio repite el id de uno
// heredado, gana el heredado — la central manda.
export function combinarTipos(deLaCentral, propios) {
  const centrales = (deLaCentral || []).map(m => ({
    id: m.id, label: m.label, merma: Number(m.merma) || 0, propio: false,
  }))
  const ids = new Set(centrales.map(c => c.id))
  return [...centrales, ...(propios || []).filter(p => !ids.has(p.id))]
}

export async function guardarTipoPropio({ filaId, label, merma }) {
  const nombre = String(label || '').trim()
  if (!nombre) return { error: 'Poné el nombre del tipo de media res' }
  const pct = Number(String(merma).replace(',', '.'))
  if (!Number.isFinite(pct) || pct < 0 || pct > 90) {
    return { error: 'El % de merma tiene que ser un número entre 0 y 90' }
  }
  const fila = { tipo_id: slugTipo(nombre), label: nombre, merma: pct, updated_at: new Date().toISOString() }
  const q = filaId
    ? supabase.from('merma_tipos_sucursal').update(fila).eq('id', filaId).select('id')
    : supabase.from('merma_tipos_sucursal').insert(fila).select('id')
  const { data, error } = await q
  // Con RLS bloqueando, Supabase devuelve error null y CERO filas: hay que
  // mirar las filas, no el error, o se festeja un guardado que no pasó.
  if (error) {
    return { error: /duplicate key/i.test(error.message)
      ? `Ya tenés un tipo que se llama "${nombre}"`
      : error.message }
  }
  if (!data || data.length === 0) return { error: 'La base rechazó el cambio (permisos).' }
  return { ok: true, id: data[0].id }
}

export async function eliminarTipoPropio(filaId) {
  const { data, error } = await supabase.from('merma_tipos_sucursal')
    .delete().eq('id', filaId).select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'La base rechazó el borrado (permisos).' }
  return { ok: true }
}

// Actualiza el % de un tipo PROPIO desde una planilla de rinde. Devuelve
// `false` si ese tipo no es propio de la boca (entonces es de la central y el
// caller tiene que ir por config_sistema, que le va a rebotar si no es la
// central — es a propósito: el % de la central lo define la central).
export async function actualizarMermaPropia(tipoId, pct) {
  const { data, error } = await supabase.from('merma_tipos_sucursal')
    .update({ merma: pct, updated_at: new Date().toISOString() })
    .eq('tipo_id', tipoId).select('id')
  if (error || !data || data.length === 0) return false
  return true
}
