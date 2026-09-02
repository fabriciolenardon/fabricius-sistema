// ============================================================
// ANIMALITOS — lechón, cabrito y cordero (mig 137)
// ============================================================
// Se compran y se venden ENTEROS, y cada animal pesa distinto. Por eso cada
// uno es una fila en `animalitos_stock` con su código visible (LE-001) y su
// peso, igual que las medias res y las cajas bovinas.
//
// El stock agregado en kilos vive en stock_actual.animal_* — es el espejo que
// mira el Dashboard. La fuente de verdad de qué hay en la cámara es la tabla:
// si alguna vez discrepan, manda la lista de animales.
// ============================================================
import { supabase } from './supabase'
import { redondearStock } from './stockHelpers'
import { registrarCompraDesdeEntrada, revertirCompraDeEntrada } from './ctaProveedores'

export const ANIMALITOS = [
  { id: 'lechon',  label: 'Lechón',  emoji: '🐖', bucket: 'animal_lechon',  prefijo: 'LE', kgMin: 3,  kgMax: 25 },
  { id: 'cabrito', label: 'Cabrito', emoji: '🐐', bucket: 'animal_cabrito', prefijo: 'CA', kgMin: 3,  kgMax: 20 },
  { id: 'cordero', label: 'Cordero', emoji: '🐑', bucket: 'animal_cordero', prefijo: 'CO', kgMin: 4,  kgMax: 30 },
]

export const BUCKETS_ANIMALITOS = ANIMALITOS.map(a => a.bucket)

export const animalito = id => ANIMALITOS.find(a => a.id === id) || null
export const bucketDe = id => animalito(id)?.bucket || null
export const labelDe = id => { const a = animalito(id); return a ? `${a.emoji} ${a.label}` : id }

// Suma (o resta, con kg negativo) al bucket agregado. Mismo helper que usa
// Depósito: la fila la crea la migración, pero si falta se inserta.
async function moverStock(bucket, kg) {
  const { data, error: errSel } = await supabase.from('stock_actual')
    .select('kg_disponible').eq('tipo', bucket).maybeSingle()
  if (errSel) return { error: errSel }
  if (data) {
    // Ojo: los numeric de Supabase llegan como STRING.
    const { error } = await supabase.from('stock_actual')
      .update({ kg_disponible: redondearStock((Number(data.kg_disponible) || 0) + kg) })
      .eq('tipo', bucket)
    return { error: error || null }
  }
  const { error } = await supabase.from('stock_actual')
    .insert({ tipo: bucket, kg_disponible: redondearStock(kg) })
  return { error: error || null }
}

// ── INGRESO ─────────────────────────────────────────────────
// Una compra de animalitos vive, como toda compra, en las TRES tablas:
// entradas_deposito (stock) + compras_proveedores (dashboard) + la cuenta
// corriente del proveedor. Además crea una fila por animal.
export async function ingresarAnimalitos({ tipo, proveedor, fecha, pesos, precioKg }) {
  const a = animalito(tipo)
  if (!a) return { error: 'Elegí qué animalito estás ingresando' }
  if (!proveedor) return { error: 'Elegí el proveedor' }
  const kgs = (pesos || []).filter(k => k > 0)
  if (!kgs.length) return { error: 'Cargá el peso de cada animal' }
  if (!(precioKg > 0)) return { error: 'Cargá el precio por kilo — no se puede ingresar sin precio' }

  const kgTotal = kgs.reduce((s, k) => s + k, 0)
  const importe = kgTotal * precioKg
  const descripcion = kgs.length > 1 ? `${a.label} ×${kgs.length}` : a.label

  const { data: entrada, error: errEnt } = await supabase.from('entradas_deposito').insert({
    fecha, tipo: a.bucket, proveedor_nombre: proveedor, descripcion,
    kg: kgTotal, kg_real: kgTotal, merma_pct: 0,
    precio_kg: precioKg, importe, destino: 'DEPOSITO', cantidad: kgs.length,
  }).select().single()
  if (errEnt) return { error: errEnt.message }

  const { error: errAnim } = await supabase.from('animalitos_stock').insert(
    kgs.map(kg => ({
      tipo, kg, proveedor_origen: proveedor, fecha_ingreso: fecha,
      precio_costo_kg: precioKg, entrada_id: entrada.id, estado: 'disponible',
    }))
  )
  if (errAnim) return { error: `La entrada se registró pero los animales no: ${errAnim.message}` }

  const { error: errStock } = await moverStock(a.bucket, kgTotal)
  if (errStock) return { error: `No se pudo sumar al stock: ${errStock.message}` }

  await supabase.from('compras_proveedores').insert({
    fecha, proveedor_nombre: proveedor, producto: descripcion,
    kg: kgTotal, importe, entrada_id: entrada.id,
  })
  await registrarCompraDesdeEntrada({
    proveedorNombre: proveedor, fecha, importe, descripcion, entradaId: entrada.id,
  })

  return { ok: true, cantidad: kgs.length, kgTotal, importe, entradaId: entrada.id }
}

// ── SALIDA ──────────────────────────────────────────────────
// Se vende entero: se pesa (el peso de acá es el definitivo) y se cobra por
// kilo. NO toca la cuenta corriente del cliente — eso se carga por Caja o por
// remito como cualquier otra venta.
export async function venderAnimalito(animal, { fecha, cliente, precioVentaKg, kgFinal, notas }) {
  if (!animal?.id) return { error: 'Animal inválido' }
  if (animal.estado !== 'disponible') return { error: `${animal.codigo} ya no está disponible` }
  const kg = kgFinal > 0 ? kgFinal : Number(animal.kg) || 0
  // El .eq('estado','disponible') + .select() es el candado: si alguien lo
  // vendió desde otra pantalla, no vuelve ninguna fila y NO se descuenta el
  // stock dos veces (el update sin select no da error con 0 filas).
  const { data: tocadas, error } = await supabase.from('animalitos_stock').update({
    estado: 'vendido', fecha_salida: fecha, cliente_nombre: cliente || null,
    precio_venta_kg: precioVentaKg || null,
    total_venta: precioVentaKg ? kg * precioVentaKg : null,
    kg, notas_salida: notas || null, updated_at: new Date().toISOString(),
  }).eq('id', animal.id).eq('estado', 'disponible').select('id')
  if (error) return { error: error.message }
  if (!tocadas?.length) return { error: `${animal.codigo} ya lo dieron de baja desde otra pantalla — refrescá la lista` }
  // Descuenta el peso REAL de salida del bucket.
  const { error: errStock } = await moverStock(bucketDe(animal.tipo), -kg)
  if (errStock) return { error: `Se marcó vendido pero el stock no bajó: ${errStock.message}` }
  return { ok: true, kg }
}

// Deshacer una venta (se cargó mal o volvió): vuelve a disponible con su peso
// y devuelve los kilos al bucket.
export async function revertirVentaAnimalito(animal) {
  if (animal?.estado !== 'vendido') return { error: 'Ese animal no figura como vendido' }
  const kg = Number(animal.kg) || 0
  const { data: tocadas, error } = await supabase.from('animalitos_stock').update({
    estado: 'disponible', fecha_salida: null, cliente_nombre: null,
    precio_venta_kg: null, total_venta: null, notas_salida: null,
    updated_at: new Date().toISOString(),
  }).eq('id', animal.id).eq('estado', 'vendido').select('id')
  if (error) return { error: error.message }
  if (!tocadas?.length) return { error: `${animal.codigo} ya no figura como vendido — refrescá la lista` }
  const { error: errStock } = await moverStock(bucketDe(animal.tipo), kg)
  if (errStock) return { error: `Volvió a disponible pero el stock no subió: ${errStock.message}` }
  return { ok: true }
}

// ── ANULAR UN INGRESO ───────────────────────────────────────
// Revierte la compra entera: los animales, el bucket y las tres tablas de la
// compra. Solo si NINGUNO de los animales se vendió todavía.
export async function anularIngresoAnimalitos(entradaId) {
  const { data: animales, error } = await supabase.from('animalitos_stock')
    .select('*').eq('entrada_id', entradaId)
  if (error) return { error: error.message }
  const vendidos = (animales || []).filter(a => a.estado === 'vendido')
  if (vendidos.length) {
    return { error: `No se puede anular: ${vendidos.map(a => a.codigo).join(', ')} ya se vendió. Revertí esa venta primero.` }
  }
  const tipo = (animales || []).find(a => a.estado !== 'anulado')?.tipo

  // Igual que en la venta: se descuenta del stock lo que ESTE anulado cambió,
  // no lo que se leyó recién. Si otro lo anuló antes, no vuelve nada y el
  // stock no baja dos veces.
  const { data: anuladas, error: errUpd } = await supabase.from('animalitos_stock')
    .update({ estado: 'anulado', updated_at: new Date().toISOString() })
    .eq('entrada_id', entradaId).neq('estado', 'anulado').select('kg')
  if (errUpd) return { error: errUpd.message }
  const kgAnulados = (anuladas || []).reduce((s, a) => s + (Number(a.kg) || 0), 0)

  if (tipo && kgAnulados > 0) {
    const { error: errStock } = await moverStock(bucketDe(tipo), -kgAnulados)
    if (errStock) return { error: `Animales anulados pero el stock no bajó: ${errStock.message}` }
  }

  await supabase.from('entradas_deposito').update({ eliminado: true }).eq('id', entradaId)
  await supabase.from('compras_proveedores').delete().eq('entrada_id', entradaId)
  await revertirCompraDeEntrada(entradaId)
  return { ok: true, cantidad: (anuladas || []).length, kgTotal: kgAnulados }
}
