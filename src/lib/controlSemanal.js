// ============================================================
// CONTROL SEMANAL (lun → dom) — comprado vs vendido vs stock
// ============================================================
// Resumen de la semana por producto:
//   - COMPRADO (bruto): solo INGRESOS reales (destino DEPOSITO).
//   - VENDIDO: mayorista (salidas a clientes) + minorista (caja).
//             NO cuenta las conversiones internas (pieza→cortes) ni
//             las transferencias a la casa propia (MITRE).
//   - ELABORADO: embutidos hechos internamente (destino elaboracion).
//   - CONVERSIÓN interna a cortes (informativo, no es venta).
//   - STOCK que debería quedar al cierre: snapshot guardado del domingo
//     si existe; si no, el stock_actual en vivo.
// ============================================================
import { supabase } from './supabase'
import { kgPorUnidadDeProducto } from './stockHelpers'

const n = v => Number(v) || 0
const kgDe = e => n(e.kg_real ?? e.kg)

// Estas categorías se venden/manejan por UNIDAD / pack / bulto, no por kg.
// No entran al control de kilos (ni suman ni restan).
const SIN_KG = new Set(['almacen', 'bebidas', 'insumos'])

// Cajones: el campo `kg` guarda UNIDADES (cajones); los kg reales son
// unidades × kg_por_cajón (ej. cada cajón pesa 20 kg → "X20KG" en el nombre).
const CAJON = new Set(['pollo_cajon', 'rebozado_cajon'])
const kgRealCajon = (tipo, kg, ref) =>
  CAJON.has(tipo) ? n(kg) * (kgPorUnidadDeProducto(ref) || 1) : n(kg)

// Nombres lindos para los tipos técnicos.
export const NOMBRE_TIPO = {
  bovino_mr: 'Media res', bovino_corte: 'Bovino cortes', bovino_brosa: 'Brosas',
  cerdo: 'Cerdo (capones)', cerdo_corte: 'Cerdo cortes', cerdo_pieza: 'Cerdo piezas',
  cerdo_tocino: 'Cerdo tocino', cerdo_cabeza: 'Cerdo cabeza', cerdo_cuero: 'Cerdo cuero',
  cerdo_carre: 'Cerdo carré', cerdo_huesos: 'Cerdo huesos', cerdo_pierna: 'Cerdo pierna',
  cerdo_pechito: 'Cerdo pechito', cerdo_matambre: 'Cerdo matambre', cerdo_paleta: 'Cerdo paleta',
  cerdo_bondiola: 'Cerdo bondiola', cerdo_parrillero: 'Cerdo parrillero',
  pollo: 'Pollo', pollo_cajon: 'Pollo (cajón)',
  embutido: 'Embutidos', emb_chorizo_parrillero: 'Chorizo parrillero',
  emb_chorizo_colorado: 'Chorizo colorado', emb_chorizo_saborizado: 'Chorizo saborizado',
  emb_salchicha_parrillera: 'Salchicha parrillera', emb_salame_comun: 'Salame común',
  emb_salame_rockeford: 'Salame Rockefort', emb_salame_holanda: 'Salame Holanda', emb_morcilla: 'Morcilla',
  pieza_cortito: 'Cortitos', pieza_pierna: 'Piernas', pieza_entera: 'Piezas enteras',
  pieza_costillar: 'Costillar', pieza_costeletal: 'Costeletal', pieza_paleta: 'Paleta (pieza)',
  pieza_parrillero: 'Parrillero (pieza)', pieza_cuarto_pistola: 'Cuarto pistola',
  almacen: 'Almacén', bebidas: 'Bebidas', rebozado: 'Rebozados', insumos: 'Insumos',
  bovino_caja_cb: 'Caja CB', bovino_caja_pt: 'Caja PT', caja_cb: 'Caja CB', caja_pt: 'Caja PT', manual: 'Manual',
}
export const nombreTipo = t => NOMBRE_TIPO[t] || t || '—'

export async function calcularControlSemanal(desde, hasta) {
  const [{ data: ent }, { data: sal }, { data: vts }, { data: snap }, { data: stk }] = await Promise.all([
    supabase.from('entradas_deposito').select('tipo, kg, kg_real, destino').eq('eliminado', false).gte('fecha', desde).lte('fecha', hasta),
    supabase.from('salidas_deposito').select('tipo, kg, descripcion, cobro, lista, cliente_nombre').gte('fecha', desde).lte('fecha', hasta),
    supabase.from('ventas_minoristas').select('items').eq('origen', 'caja').gte('fecha', desde).lte('fecha', hasta),
    supabase.from('stock_snapshots').select('stock').eq('fecha', hasta).maybeSingle(),
    supabase.from('stock_actual').select('tipo, kg_disponible'),
  ])
  const entradas = ent || [], salidas = sal || [], ventas = vts || []

  // ── COMPRADO (bruto, solo INGRESOS) ──
  const compMap = new Map()
  for (const e of entradas) {
    if (e.destino === 'desposte' || e.destino === 'elaboracion') continue
    if (SIN_KG.has(e.tipo)) continue
    compMap.set(e.tipo, (compMap.get(e.tipo) || 0) + kgDe(e))
  }
  const comprado = [...compMap].map(([tipo, kg]) => ({ tipo, kg })).filter(x => x.kg > 0.01).sort((a, b) => b.kg - a.kg)

  // ── ELABORADO (interno) ──
  const elabMap = new Map()
  for (const e of entradas) if (e.destino === 'elaboracion') elabMap.set(e.tipo, (elabMap.get(e.tipo) || 0) + kgDe(e))
  const elaborado = [...elabMap].map(([tipo, kg]) => ({ tipo, kg })).filter(x => x.kg > 0.01).sort((a, b) => b.kg - a.kg)

  // ── VENDIDO (mayorista + minorista) ──
  const esInterno = s => s.cobro === 'interno' || s.lista === 'desposte'
  const esMitre = s => (s.cliente_nombre || '').toUpperCase().includes('MITRE')
  const vendMap = new Map() // categoria → { may, min }
  let conversionInterna = 0
  for (const s of salidas) {
    if (esInterno(s)) { conversionInterna += n(s.kg); continue }
    if (esMitre(s)) continue
    if (SIN_KG.has(s.tipo)) continue
    const c = vendMap.get(s.tipo) || { may: 0, min: 0 }
    c.may += kgRealCajon(s.tipo, s.kg, s.descripcion); vendMap.set(s.tipo, c)
  }
  for (const v of ventas) {
    const items = Array.isArray(v.items) ? v.items : []
    for (const it of items) {
      const cat = it.categoria || '(sin cat)'
      if (SIN_KG.has(cat)) continue
      const c = vendMap.get(cat) || { may: 0, min: 0 }
      c.min += kgRealCajon(cat, it.kg, it); vendMap.set(cat, c)
    }
  }
  const vendido = [...vendMap]
    .map(([categoria, v]) => ({ categoria, may: v.may, min: v.min, total: v.may + v.min }))
    .filter(x => x.total > 0.01).sort((a, b) => b.total - a.total)

  // ── STOCK que debería quedar ──
  const stockEnVivo = !snap
  const stockRaw = snap?.stock || (stk || []).map(r => ({ tipo: r.tipo, kg: n(r.kg_disponible) }))
  const stock = stockRaw.map(r => ({ tipo: r.tipo, kg: n(r.kg) }))
    .filter(r => Math.abs(r.kg) > 0.01 && !SIN_KG.has(r.tipo)).sort((a, b) => b.kg - a.kg)

  return { comprado, vendido, elaborado, conversionInterna, stock, stockEnVivo }
}

// Guarda (upsert por fecha) la foto del stock actual para una fecha de cierre.
export async function guardarSnapshotStock(fecha, creadoPor) {
  const { data: stk } = await supabase.from('stock_actual').select('tipo, kg_disponible')
  const stock = (stk || []).map(r => ({ tipo: r.tipo, kg: Number(r.kg_disponible) || 0 }))
  return supabase.from('stock_snapshots').upsert({ fecha, stock, creado_por: creadoPor || null }, { onConflict: 'fecha' })
}
