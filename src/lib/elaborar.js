// ============================================================
// ELABORACIÓN DE EMBUTIDOS / HAMBURGUESAS / SALAMES — lógica de negocio
// ============================================================
// Usada por el portal DESPOSTE (DesposteElaborar.jsx). Replica EXACTAMENTE
// las escrituras que hace el admin en Deposito.jsx (confirmarElaboracion*),
// para que historial, Control Semanal, Dashboard y stock queden idénticos
// sin importar desde dónde se cargue la elaboración:
//   - inserta en elaboraciones_embutidos
//   - descuenta la materia prima de stock_actual (con chequeo de error)
//   - suma el producto terminado a su bucket emb_*/hamb_* (verificado)
//   - registra la entrada informativa (destino='elaboracion', importe 0)
// Si se cambia algo acá o en Deposito.jsx, mantener los dos lados iguales.
// ============================================================
import { supabase } from './supabase'
import { fechaHoyARG } from './fechas'
import { redondearStock } from './stockHelpers'

const n = v => Number(v) || 0

// Nombre legible de cada tipo (mismas claves que el admin)
export const NOMBRE_EMBUTIDO = {
  chorizo_parrillero: 'Chorizo Parrillero',
  chorizo_saborizado: 'Chorizo Saborizado',
  chorizo_colorado: 'Chorizo Colorado',
  salchicha_parrillera: 'Salchicha Parrillera',
  morcilla: 'Morcilla',
  salame_comun: 'Salame Común',
  salame_rockeford: 'Salame Rockeford',
  salame_holanda: 'Salame Holanda',
  hamburguesa_carne: 'Hamburguesas de Carne',
  hamburguesa_pollo: 'Hamburguesas de Pollo',
  hamburguesa_cerdo: 'Hamburguesas de Cerdo',
}

// Bucket de stock PROPIO de cada producto terminado (migs 60/85)
export const BUCKET_EMBUTIDO = {
  chorizo_parrillero: 'emb_chorizo_parrillero',
  chorizo_saborizado: 'emb_chorizo_saborizado',
  chorizo_colorado: 'emb_chorizo_colorado',
  salchicha_parrillera: 'emb_salchicha_parrillera',
  morcilla: 'emb_morcilla',
  salame_comun: 'emb_salame_comun',
  salame_rockeford: 'emb_salame_rockeford',
  salame_holanda: 'emb_salame_holanda',
}
export const BUCKET_HAMBURGUESA = {
  hamburguesa_carne: 'hamb_carne',
  hamburguesa_pollo: 'hamb_pollo',
  hamburguesa_cerdo: 'hamb_cerdo',
}
// De dónde sale la materia prima de las hamburguesas de carne/pollo
// (las de cerdo usan las piezas elegidas)
export const ORIGEN_HAMBURGUESA = {
  hamburguesa_carne: { bucket: 'bovino_corte', label: '🥩 Carne bovina (kg) — descuenta de Bovino Cortes' },
  hamburguesa_pollo: { bucket: 'pollo', label: '🐔 Supremas B (kg) — descuenta del stock de Pollo' },
}

// Piezas de cerdo que se pueden usar como materia prima
export const PIEZAS_MATERIA_PRIMA = [
  { key: 'cerdo_pierna', nombre: 'Pierna' },
  { key: 'cerdo_paleta', nombre: 'Paleta' },
  { key: 'cerdo_parrillero', nombre: 'Carnaza / Parrillero' },
  { key: 'cerdo_pechito', nombre: 'Pechito' },
  { key: 'cerdo_matambre', nombre: 'Matambre' },
  { key: 'cerdo_carre', nombre: 'Carré' },
  { key: 'cerdo_bondiola', nombre: 'Bondiola' },
  { key: 'cerdo_tocino', nombre: 'Tocino' },
]

// ── Stock helpers (mismo patrón anti-error que Deposito.jsx) ──
async function actualizarStock(tipo, kg) {
  const { data, error: errSel } = await supabase.from('stock_actual').select('*').eq('tipo', tipo).maybeSingle()
  if (errSel) return { error: errSel }
  if (data) {
    const { error } = await supabase.from('stock_actual')
      .update({ kg_disponible: redondearStock((data.kg_disponible || 0) + kg) })
      .eq('tipo', tipo)
    return { error: error || null }
  }
  const { error } = await supabase.from('stock_actual').insert({ tipo, kg_disponible: redondearStock(kg) })
  return { error: error || null }
}

// Suma kg a un bucket y VERIFICA con un re-read que efectivamente subió.
async function sumarStockVerificado(tipo, kg) {
  const { data: antes } = await supabase.from('stock_actual').select('kg_disponible').eq('tipo', tipo).maybeSingle()
  const esperado = (n(antes?.kg_disponible)) + kg
  const { error } = await actualizarStock(tipo, kg)
  if (error) throw new Error(`No se sumó al stock ${tipo}: ${error.message}`)
  const { data: despues } = await supabase.from('stock_actual').select('kg_disponible').eq('tipo', tipo).maybeSingle()
  if (Math.abs((n(despues?.kg_disponible)) - esperado) > 0.01) {
    throw new Error(`El stock ${tipo} no se actualizó correctamente. Esperado: ${esperado.toFixed(2)} kg. Avisá al admin (Ajuste Stock).`)
  }
}

async function descontarPiezas(piezasUsadas) {
  for (const p of piezasUsadas) {
    if (p.kg > 0) {
      const { error } = await actualizarStock(p.tipo, -p.kg)
      if (error) throw new Error(`No se descontó ${p.tipo}: ${error.message}`)
    }
  }
}

// Entrada informativa: la elaboración aparece junto a las compras en
// "Entradas registradas", el Dashboard y el Control Semanal. Importe 0,
// NO toca stock (eso ya se hizo antes).
async function registrarEntradaInformativa({ fecha, tipo, descripcion, kg }) {
  const { error } = await supabase.from('entradas_deposito').insert({
    fecha, tipo,
    proveedor_nombre: 'Elaboración propia',
    descripcion,
    kg, kg_real: kg,
    merma_pct: 0, precio_kg: 0, importe: 0,
    destino: 'elaboracion',
    cantidad: 1,
  })
  if (error) console.warn('No se pudo registrar la entrada de la elaboración:', error.message)
}

// ── ELABORAR EMBUTIDOS (chorizos / salchicha / morcilla) ──
// piezas: { cerdo_pierna: kg, ... } · pesoReal: { chorizo_parrillero: kg, ... }
// kgRetazos descuenta de 'cerdo_cabeza' (retazos de cerdo, igual que el admin).
// Devuelve { kgFinal, detalle } o tira Error.
export async function registrarElaboracionEmbutido({ fecha = fechaHoyARG(), piezas, kgRetazos = 0, pesoReal, notas = '' }) {
  const piezasUsadas = Object.entries(piezas || {})
    .map(([tipo, v]) => ({ tipo, kg: n(v) }))
    .filter(p => p.kg > 0)
  const kgCerdo = piezasUsadas.reduce((s, p) => s + p.kg, 0)
  if (kgCerdo === 0) throw new Error('Ingresá al menos una pieza de cerdo')

  const productosFinales = Object.entries(pesoReal || {})
    .map(([tipo, v]) => ({ tipo, kg: n(v) }))
    .filter(p => p.kg > 0)
  const kgFinal = parseFloat(productosFinales.reduce((s, p) => s + p.kg, 0).toFixed(2))
  if (kgFinal === 0) throw new Error('Cargá el peso real de al menos un producto terminado')

  const kgTotal = kgCerdo + n(kgRetazos)
  const pctFinal = kgTotal > 0 ? parseFloat(((kgFinal / kgTotal - 1) * 100).toFixed(2)) : 0

  const { error: errElab } = await supabase.from('elaboraciones_embutidos').insert({
    fecha, tipo: 'embutido', tipo_embutido: productosFinales[0].tipo,
    piezas_usadas: piezasUsadas,
    kg_carne_cerdo: kgCerdo,
    kg_carne_bovina: n(kgRetazos),
    kg_elaborado: kgTotal, pct_aumento: pctFinal,
    // legacy: comunes/saborizados se siguen llenando para los reportes viejos
    kg_comunes: n(pesoReal?.chorizo_parrillero) || null,
    kg_saborizados: n(pesoReal?.chorizo_saborizado) || null,
    productos_finales: productosFinales,
    kg_final: kgFinal, maduracion_completa: true, notas,
  })
  if (errElab) throw new Error(`No se guardó la elaboración: ${errElab.message}`)

  await descontarPiezas(piezasUsadas)
  if (n(kgRetazos) > 0) {
    const { error } = await actualizarStock('cerdo_cabeza', -n(kgRetazos))
    if (error) throw new Error(`No se descontó retazos cerdo (cabezas): ${error.message}`)
  }
  for (const p of productosFinales) {
    await sumarStockVerificado(BUCKET_EMBUTIDO[p.tipo] || 'embutido', p.kg)
  }

  const detalle = productosFinales.map(p => `${NOMBRE_EMBUTIDO[p.tipo] || p.tipo}: ${p.kg.toFixed(1)} kg`).join(' · ')
  await registrarEntradaInformativa({
    fecha, tipo: 'embutido',
    descripcion: `${productosFinales.map(p => `${NOMBRE_EMBUTIDO[p.tipo] || p.tipo} ${p.kg.toFixed(1)} kg`).join(' + ')} elaborado (${kgCerdo.toFixed(1)} kg cerdo${n(kgRetazos) > 0 ? ` + ${n(kgRetazos).toFixed(1)} kg retazos` : ''})`,
    kg: kgFinal,
  })
  return { kgFinal, detalle }
}

// ── ELABORAR HAMBURGUESAS (carne / pollo / cerdo) ──
// tipo: 'hamburguesa_carne'|'hamburguesa_pollo'|'hamburguesa_cerdo'
// Para cerdo: piezasCerdo {tipo: kg}. Para carne/pollo: kgOrigen del bucket fijo.
export async function registrarElaboracionHamburguesa({ fecha = fechaHoyARG(), tipo, piezasCerdo, kgOrigen, kgFinal, notas = '' }) {
  const esCerdo = tipo === 'hamburguesa_cerdo'
  const piezasUsadas = esCerdo
    ? Object.entries(piezasCerdo || {}).map(([t, v]) => ({ tipo: t, kg: n(v) })).filter(p => p.kg > 0)
    : [{ tipo: ORIGEN_HAMBURGUESA[tipo].bucket, kg: n(kgOrigen) }]
  const kgOrig = piezasUsadas.reduce((s, p) => s + p.kg, 0)
  if (kgOrig <= 0) throw new Error(esCerdo ? 'Ingresá al menos una pieza de cerdo' : 'Ingresá los kg de materia prima que se usaron')
  const kgFin = n(kgFinal)
  if (kgFin <= 0) throw new Error('Ingresá los kg de hamburguesas elaboradas (peso final)')

  const bucket = BUCKET_HAMBURGUESA[tipo]
  const pctFinal = parseFloat(((kgFin / kgOrig - 1) * 100).toFixed(2))
  const { error: errElab } = await supabase.from('elaboraciones_embutidos').insert({
    fecha, tipo: 'hamburguesa', tipo_embutido: tipo,
    piezas_usadas: piezasUsadas,
    kg_carne_cerdo: esCerdo ? kgOrig : 0,
    kg_carne_bovina: tipo === 'hamburguesa_carne' ? kgOrig : 0,
    kg_elaborado: kgOrig, pct_aumento: pctFinal,
    productos_finales: [{ tipo, kg: kgFin }],
    kg_final: kgFin, maduracion_completa: true, notas,
  })
  if (errElab) throw new Error(`No se guardó la elaboración: ${errElab.message}`)

  await descontarPiezas(piezasUsadas)
  await sumarStockVerificado(bucket, kgFin)
  await registrarEntradaInformativa({
    fecha, tipo: bucket,
    descripcion: `${NOMBRE_EMBUTIDO[tipo]} ${kgFin.toFixed(1)} kg elaboradas (de ${kgOrig.toFixed(1)} kg · ${pctFinal >= 0 ? '+' : ''}${pctFinal.toFixed(1)}%)`,
    kg: kgFin,
  })
  return { kgFinal: kgFin, pctFinal, kgOrigen: kgOrig }
}

// ── REGISTRAR SALAME (etapa 1: entra al secado, NO suma stock todavía) ──
// variedades: { salame_comun: kgNeto, salame_holanda: ..., salame_rockeford: ... }
// kgBovino descuenta de 'bovino_corte'; el queso no toca stock.
// Quesos desglosados (mig 133): kgQuesoHolanda y kgQuesoRockeford suman a la
// pasta cada uno por su lado; kg_queso guarda el total (compat). kgQueso
// queda como parámetro legacy por si algo viejo lo sigue pasando.
export async function registrarElaboracionSalame({ fecha = fechaHoyARG(), piezasCerdo, kgBovino = 0, kgQueso = 0, kgQuesoHolanda = 0, kgQuesoRockeford = 0, variedades, notas = '' }) {
  const piezasUsadas = Object.entries(piezasCerdo || {})
    .map(([tipo, v]) => ({ tipo, kg: n(v) }))
    .filter(p => p.kg > 0)
  const kgCerdo = piezasUsadas.reduce((s, p) => s + p.kg, 0)
  if (kgCerdo === 0) throw new Error('Ingresá al menos una pieza de cerdo')
  const vars = Object.entries(variedades || {})
    .map(([tipo, v]) => ({ tipo, kg_neto: n(v) }))
    .filter(v => v.kg_neto > 0)
  if (vars.length === 0) throw new Error('Cargá los kg de al menos una variedad de salame (común/holanda/rockeford)')

  const kgQuesoTotal = n(kgQueso) + n(kgQuesoHolanda) + n(kgQuesoRockeford)
  const kgTotal = kgCerdo + n(kgBovino) + kgQuesoTotal
  const { error: errElab } = await supabase.from('elaboraciones_embutidos').insert({
    fecha, tipo: 'salame', tipo_embutido: vars[0].tipo,
    piezas_usadas: piezasUsadas,
    kg_carne_cerdo: kgCerdo,
    kg_carne_bovina: n(kgBovino),
    kg_queso: kgQuesoTotal,
    kg_queso_holanda: n(kgQuesoHolanda),
    kg_queso_rockeford: n(kgQuesoRockeford),
    kg_elaborado: kgTotal, pct_aumento: 0,
    productos_finales: vars,
    kg_final: 0, maduracion_completa: false,
    fecha_fin_maduracion: null,
    notas,
  })
  if (errElab) throw new Error(`No se guardó la elaboración: ${errElab.message}`)

  await descontarPiezas(piezasUsadas)
  if (n(kgBovino) > 0) {
    const { error } = await actualizarStock('bovino_corte', -n(kgBovino))
    if (error) throw new Error(`No se descontó bovino_corte: ${error.message}`)
  }
  const detalle = vars.map(v => `${NOMBRE_EMBUTIDO[v.tipo] || v.tipo}: ${v.kg_neto.toFixed(1)} kg`).join(' · ')
  return { kgTotal, detalle }
}

// ── FINALIZAR SALAME (etapa 2: seco y pesado — recién acá suma al stock) ──
// elab: fila de elaboraciones_embutidos · finales: { [tipo]: kgFinal }
export async function finalizarMaduracionSalame(elab, finales) {
  const vars = Array.isArray(elab.productos_finales) && elab.productos_finales.length
    ? elab.productos_finales
    : [{ tipo: elab.tipo_embutido || 'salame_comun', kg_neto: n(elab.kg_elaborado) }]
  const finalizados = vars.map(v => ({
    tipo: v.tipo,
    kg_neto: n(v.kg_neto),
    kg_final: n(finales?.[v.tipo]),
  }))
  const totalFinal = finalizados.reduce((s, v) => s + (v.kg_final || 0), 0)
  if (!(totalFinal > 0)) throw new Error('Ingresá los kg finales (pesados secos) de al menos una variedad')

  for (const v of finalizados) {
    if (v.kg_final > 0) {
      await sumarStockVerificado(BUCKET_EMBUTIDO[v.tipo] || 'emb_salame_comun', v.kg_final)
    }
  }
  const pct = elab.kg_elaborado > 0 ? parseFloat(((totalFinal / elab.kg_elaborado - 1) * 100).toFixed(2)) : 0
  const { error: errUpd } = await supabase.from('elaboraciones_embutidos')
    .update({ kg_final: totalFinal, maduracion_completa: true, pct_aumento: pct, productos_finales: finalizados })
    .eq('id', elab.id)
  if (errUpd) throw new Error(`No se actualizó la elaboración: ${errUpd.message}`)

  const detalle = finalizados.filter(v => v.kg_final > 0)
    .map(v => `${NOMBRE_EMBUTIDO[v.tipo] || v.tipo}: ${v.kg_final.toFixed(1)} kg`).join(' · ')
  await registrarEntradaInformativa({
    fecha: fechaHoyARG(), tipo: 'embutido',
    descripcion: `Salame seco finalizado — ${detalle} (de ${n(elab.kg_elaborado).toFixed(1)} kg netos · merma ${pct.toFixed(1)}%)`,
    kg: totalFinal,
  })
  return { totalFinal, detalle }
}
