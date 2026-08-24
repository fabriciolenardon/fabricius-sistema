// ============================================================
// HISTORIAL DE MERMAS POR SEMANA (lun → dom)
// ============================================================
// Cuántos kilos se pierden en cada transformación de la semana y
// cuánta plata son esos kilos. Cinco categorías:
//
//   1. medias_kilo  — media res despostada a cortes POR KILO
//   2. medias_pieza — media res despostada A PIEZAS
//   3. piezas       — pieza BOVINA convertida a cortes
//   4. capones      — capón de cerdo despostado
//   5. elaborados   — embutidos + hamburguesas (subcategorías aparte)
//
// ── LAS PIEZAS DE CERDO NO LLEVAN MERMA ─────────────────────
// Regla de Fabricio (23/08/2026). La pierna, la paleta, el carré, etc.
// se venden tal como salen del capón: no se las vuelve a romper con un
// % encima. Su única merma es la del capón, que ya se cuenta en la
// categoría 4. Por eso la categoría 3 es solo BOVINA — y hay un filtro
// explícito para que una pieza de cerdo no entre ahí ni por accidente.
//
// ── MEDIDA vs CALCULADA ─────────────────────────────────────
// La distinción más importante del informe. No todas las mermas
// valen lo mismo como dato:
//
//   · MEDIDA: se pesó cada cosa que salió y la merma es la resta.
//     Es la verdad. Aplica al desposte A PIEZAS y al de CAPONES
//     (y a los elaborados, que se pesan al final).
//   · CALCULADA: nadie pesó nada; el sistema aplicó el % de la
//     config. Aplica al desposte POR KILO y a la conversión de
//     piezas. Si el % está mal cargado, el número miente y no hay
//     forma de saberlo desde acá.
//
// Cada fila viene con `medida: true|false` para poder mostrarlo.
//
// ── DE DÓNDE SALE CADA NÚMERO ───────────────────────────────
// Todo vive en `despostes` (los cuatro tipos se distinguen por
// `tipo_desposte`) y en `elaboraciones_embutidos`. La plata sale
// del `precio_kg` de la entrada de origen (`entrada_id`), que es
// lo que se pagó por ese kilo.
//
// OJO con el desposte POR KILO: hasta el 22/08/2026 se guardaba
// sin la merma de frío (22% en vez de 24,5%) — ver PR #348. Por
// eso el % del animal y el de frío se DEDUCEN de lo guardado en
// cada fila en vez de recalcularse con la config de hoy: así una
// semana vieja sigue mostrando lo que realmente se aplicó.
// ============================================================
import { supabase, fetchAllRows } from './supabase'
import { MERMA_MEDIA_RES_DEFAULT, MERMA_PIEZA_DEFAULT, MERMA_PIEZA_GENERICA } from './modelosDesposte'

const n = v => Number(v) || 0
const r2 = v => Math.round(v * 100) / 100

// Los cuatro tipos de desposte, mapeados a su categoría.
// 'bovino' es un tipo viejo (mayo/2026) que se comportaba como el de por kilo.
const CATEGORIA_DE_DESPOSTE = {
  kilo: 'medias_kilo',
  bovino: 'medias_kilo',
  piezas: 'medias_pieza',
  pieza_kilo: 'piezas',
  cerdo: 'capones',
}

export const LABEL_CATEGORIA = {
  medias_kilo: 'Medias reses → cortes por kilo',
  medias_pieza: 'Medias reses → piezas',
  piezas: 'Piezas bovinas → cortes',
  capones: 'Capones de cerdo',
  elaborados: 'Elaborados',
}

export const ORDEN_CATEGORIAS = ['medias_kilo', 'medias_pieza', 'piezas', 'capones', 'elaborados']

// Suma los kg realmente pesados que salieron de un desposte.
const kgSalida = d => (Array.isArray(d.piezas) ? d.piezas : []).reduce((s, p) => s + n(p.kg), 0)

// ¿Es una pieza de cerdo? Los nombres de las piezas bovinas son un set
// cerrado (los modelos A/B/C); cualquier otra cosa que suene a cerdo queda
// afuera de la categoría de piezas. Ver la regla en la cabecera.
const PIEZAS_BOVINAS = new Set(['Pierna', 'Cortito', 'Costeletal con Lomo', 'Costillar Completo', 'Cuarto Pistola', 'Parrillero', 'Paleta'])
function esPiezaDeCerdo(nombre) {
  if (!nombre) return false
  if (PIEZAS_BOVINAS.has(nombre)) return false
  return /cerdo|cap[oó]n|bondiola|carr[eé]|pechito|matambre|tocino|cuero/i.test(nombre)
}

// Nombre legible de la pieza/animal de cada fila.
function etiquetaDesposte(d, categoria) {
  if (categoria === 'piezas') return (d.piezas?.[0]?.nombre) || 'Pieza bovina'
  if (categoria === 'capones') return 'Capón'
  const tipos = { novillito: 'Novillito (Nt)', vaca_vaquillona: 'Vaca/Vaquillona (VQ)', novillo: 'Novillo', ternera: 'Ternera', bovino: 'Bovino' }
  return tipos[d.tipo_animal] || d.tipo_animal || 'Media res'
}

// ── Desglose del % en "animal + frío" ───────────────────────
// El desposte por kilo aplica el % del tipo de animal MÁS el de frío,
// pero en la fila queda guardado sumado. Para poder mostrar
// "22% Nt + 2,5% frío" se busca el % del animal en la config y el
// resto se atribuye al frío. Si la resta da ~0 la fila es vieja
// (anterior al PR #348) y no llevaba frío: se informa como tal.
function desglosarPct(pctTotal, tipoAnimal, mermaConfig) {
  const lista = mermaConfig?.media_res?.length ? mermaConfig.media_res : MERMA_MEDIA_RES_DEFAULT
  const delAnimal = lista.find(m => m.id === tipoAnimal)
  if (!delAnimal) return { animal: pctTotal, frio: 0, conocido: false }
  const animal = n(delAnimal.merma)
  const frio = r2(pctTotal - animal)
  // Si lo guardado no se parece a "animal + algo chico", no inventamos
  // un desglose: se muestra el total y listo.
  if (frio < -0.01 || frio > 15) return { animal: pctTotal, frio: 0, conocido: false }
  return { animal, frio: Math.max(0, frio), conocido: true }
}

// ── Costo por kilo de los insumos de elaboración ────────────
// Las piezas de cerdo entran al stock SIN precio (las entradas del
// desposte van con precio_kg 0), así que no hay un costo por pieza
// que leer. Se usa lo que se pagó por el animal entero en el período:
// cada kilo de pierna salió de un capón que costó $X/kg.
// Es una aproximación y la pantalla lo dice.
function costoInsumoElaboracion(tipo, precios) {
  if (!tipo) return precios.cerdo
  if (tipo.startsWith('cerdo')) return precios.cerdo
  if (tipo.startsWith('pollo')) return precios.pollo
  return precios.bovino
}

/**
 * Calcula el historial de mermas de un período (normalmente lun → dom).
 * Devuelve { categorias, totales, avisos }.
 */
export async function calcularMermasPeriodo(desde, hasta, mermaConfig = {}) {
  const [{ data: despostes, error: e1 }, { data: elaboraciones, error: e2 }] = await Promise.all([
    fetchAllRows(() => supabase.from('despostes')
      .select('id, fecha, entrada_id, tipo_desposte, tipo_animal, modelo, kg_media_res, merma_pct, kg_neto, piezas')
      .gte('fecha', desde).lte('fecha', hasta).order('fecha')),
    fetchAllRows(() => supabase.from('elaboraciones_embutidos')
      .select('id, fecha, tipo, tipo_embutido, piezas_usadas, kg_carne_cerdo, kg_carne_bovina, kg_queso, kg_elaborado, kg_final, productos_finales')
      .gte('fecha', desde).lte('fecha', hasta).order('fecha')),
  ])
  if (e1) throw e1
  if (e2) throw e2

  // Precio de compra de cada desposte: el de su entrada de origen.
  const entradaIds = [...new Set((despostes || []).map(d => d.entrada_id).filter(Boolean))]
  const precioPorEntrada = {}
  if (entradaIds.length > 0) {
    // De a 200 ids por request: un `.in()` con cientos de UUID revienta
    // el largo de la URL y Supabase devuelve 414.
    for (let i = 0; i < entradaIds.length; i += 200) {
      const { data } = await supabase.from('entradas_deposito')
        .select('id, precio_kg').in('id', entradaIds.slice(i, i + 200))
      for (const e of (data || [])) precioPorEntrada[e.id] = n(e.precio_kg)
    }
  }

  // Precio de referencia por animal para costear los elaborados.
  const preciosRef = await preciosDeReferencia(desde, hasta)

  const categorias = {}
  for (const c of ORDEN_CATEGORIAS) {
    categorias[c] = { id: c, label: LABEL_CATEGORIA[c], filas: [], subgrupos: null, total: filaVacia() }
  }

  // ── Los cuatro tipos de desposte ──────────────────────────
  for (const d of (despostes || [])) {
    const cat = CATEGORIA_DE_DESPOSTE[d.tipo_desposte]
    if (!cat) continue
    // Las piezas de cerdo no llevan merma propia (ver cabecera). Hoy nunca
    // pasan por esta conversión, pero si alguna vez pasan, no inventamos una.
    if (cat === 'piezas' && esPiezaDeCerdo(d.piezas?.[0]?.nombre)) continue
    const kgEntra = n(d.kg_media_res)
    // Medida (se pesó lo que salió) vs calculada (se aplicó un %).
    const medida = cat === 'medias_pieza' || cat === 'capones'
    const kgSale = medida ? kgSalida(d) : n(d.kg_neto)
    const kgMerma = r2(kgEntra - kgSale)
    const precioKg = precioPorEntrada[d.entrada_id] || 0
    const fila = {
      id: d.id,
      fecha: d.fecha,
      etiqueta: etiquetaDesposte(d, cat),
      detalle: cat === 'medias_pieza' ? `Modelo ${d.modelo} · ${(d.piezas || []).length} piezas` : null,
      kgEntra,
      kgSale: r2(kgSale),
      kgMerma,
      pct: kgEntra > 0 ? r2((kgMerma / kgEntra) * 100) : 0,
      precioKg,
      // Lo que termina costando el kilo vendible: la misma plata repartida
      // entre menos kilos. Ver el comentario de totalizar().
      precioReal: kgSale > 0 ? Math.round((kgEntra * precioKg) / kgSale) : 0,
      costo: Math.round(kgMerma * precioKg),
      medida,
    }
    if (cat === 'medias_kilo') fila.desglose = desglosarPct(n(d.merma_pct), d.tipo_animal, mermaConfig)
    if (cat === 'piezas') fila.pctConfig = pctDePieza(fila.etiqueta, mermaConfig)
    categorias[cat].filas.push(fila)
  }

  // ── Elaborados: embutidos y hamburguesas ──────────────────
  const subgrupos = {
    embutidos: { id: 'embutidos', label: 'Embutidos', filas: [], total: filaVacia() },
    hamburguesas: { id: 'hamburguesas', label: 'Hamburguesas', filas: [], total: filaVacia() },
  }
  for (const el of (elaboraciones || [])) {
    const esHamb = el.tipo === 'hamburguesa'
    const g = esHamb ? subgrupos.hamburguesas : subgrupos.embutidos
    const kgEntra = n(el.kg_elaborado)
    const kgSale = n(el.kg_final)
    const kgMerma = r2(kgEntra - kgSale)
    const precioKg = costoPonderadoElaboracion(el, preciosRef)
    g.filas.push({
      id: el.id,
      fecha: el.fecha,
      etiqueta: nombreElaboracion(el),
      detalle: (el.productos_finales || []).map(p => `${nombreProducto(p.tipo)} ${r2(n(p.kg))} kg`).join(' + ') || null,
      kgEntra,
      kgSale,
      kgMerma,
      pct: kgEntra > 0 ? r2((kgMerma / kgEntra) * 100) : 0,
      precioKg,
      precioReal: kgSale > 0 ? Math.round((kgEntra * precioKg) / kgSale) : 0,
      // Una elaboración que RINDE (hamburguesas: +23%) no es plata perdida.
      // El costo solo cuenta cuando se perdieron kilos de verdad.
      costo: kgMerma > 0 ? Math.round(kgMerma * precioKg) : 0,
      medida: true,
      rinde: kgMerma < 0,
    })
  }
  subgrupos.embutidos.total = totalizar(subgrupos.embutidos.filas)
  subgrupos.hamburguesas.total = totalizar(subgrupos.hamburguesas.filas)
  categorias.elaborados.subgrupos = [subgrupos.embutidos, subgrupos.hamburguesas]
  categorias.elaborados.filas = [...subgrupos.embutidos.filas, ...subgrupos.hamburguesas.filas]

  for (const c of ORDEN_CATEGORIAS) categorias[c].total = totalizar(categorias[c].filas)

  const lista = ORDEN_CATEGORIAS.map(c => categorias[c])
  const totales = totalizar(lista.flatMap(c => c.filas))

  return { categorias: lista, totales, avisos: avisosDelPeriodo(lista, precioPorEntrada, despostes) }
}

function filaVacia() {
  return { kgEntra: 0, kgSale: 0, kgMerma: 0, pct: 0, costo: 0, n: 0, precioIngreso: 0, precioReal: 0 }
}

// ── COSTO REAL POR KILO ─────────────────────────────────────
// La plata que se pagó no cambia con la merma; lo que cambia es entre
// cuántos kilos se reparte. Si entran 100 kg a $10.000 y salen 78
// vendibles, esos $1.000.000 se reparten entre 78 kg → $12.821/kg.
//
//   costo real = precio de compra ÷ (1 − merma)     ✅
//   costo real = precio de compra × (1 + merma)     ❌ subdeclara
//
// Con 22% de merma la diferencia es $12.821 contra $12.200: $621 por
// kilo que no estarían en el costo. Es la misma cuenta que ya hace el
// desposte al costear los cortes (Deposito.jsx: precio_kg / (1 - merma)).
//
// Acá se calcula sobre los totales (plata total ÷ kilos vendibles), que
// da lo mismo y además pondera solo con las filas que tienen precio:
// una fila sin precio de compra hundiría el promedio a la mitad.
function totalizar(filas) {
  const t = filas.reduce((a, f) => {
    const conPrecio = f.precioKg > 0
    return {
      kgEntra: a.kgEntra + f.kgEntra,
      kgSale: a.kgSale + f.kgSale,
      kgMerma: a.kgMerma + f.kgMerma,
      costo: a.costo + f.costo,
      n: a.n + 1,
      // Denominadores del costo real: solo lo que tiene precio conocido.
      pagado: a.pagado + (conPrecio ? f.kgEntra * f.precioKg : 0),
      kgEntraPag: a.kgEntraPag + (conPrecio ? f.kgEntra : 0),
      kgSalePag: a.kgSalePag + (conPrecio ? f.kgSale : 0),
    }
  }, { kgEntra: 0, kgSale: 0, kgMerma: 0, costo: 0, n: 0, pagado: 0, kgEntraPag: 0, kgSalePag: 0 })
  return {
    kgEntra: r2(t.kgEntra),
    kgSale: r2(t.kgSale),
    kgMerma: r2(t.kgMerma),
    pct: t.kgEntra > 0 ? r2((t.kgMerma / t.kgEntra) * 100) : 0,
    costo: Math.round(t.costo),
    n: t.n,
    // $ por kilo de merma: cuánto cuesta, en promedio, cada kilo que se pierde.
    costoPorKg: t.kgMerma > 0 ? Math.round(t.costo / t.kgMerma) : 0,
    // Lo que se pagó por kilo al comprar.
    precioIngreso: t.kgEntraPag > 0 ? Math.round(t.pagado / t.kgEntraPag) : 0,
    // Lo que termina costando cada kilo VENDIBLE, ya con la merma encima.
    precioReal: t.kgSalePag > 0 ? Math.round(t.pagado / t.kgSalePag) : 0,
  }
}

function pctDePieza(nombre, mermaConfig) {
  const tabla = { ...MERMA_PIEZA_DEFAULT, ...(mermaConfig?.piezas || {}) }
  return n(tabla[nombre]) || MERMA_PIEZA_GENERICA
}

const NOMBRE_ELAB = {
  chorizo_parrillero: 'Chorizo parrillero', chorizo_colorado: 'Chorizo colorado',
  chorizo_saborizado: 'Chorizo saborizado', salchicha_parrillera: 'Salchicha parrillera',
  salame_comun: 'Salame común', salame_rockeford: 'Salame Rockefort', salame_holanda: 'Salame Holanda',
  morcilla: 'Morcilla', hamburguesa_carne: 'Hamburguesas de carne',
  hamburguesa_pollo: 'Hamburguesas de pollo', hamburguesa_cerdo: 'Hamburguesas de cerdo',
}
const nombreProducto = t => NOMBRE_ELAB[t] || t || '—'
const nombreElaboracion = el => NOMBRE_ELAB[el.tipo_embutido] || el.tipo_embutido || el.tipo || 'Elaboración'

// Costo/kg de una elaboración: promedio ponderado por los kilos de cada
// insumo que entró (piezas de cerdo/pollo + retazos bovinos).
function costoPonderadoElaboracion(el, precios) {
  const partes = [
    ...(Array.isArray(el.piezas_usadas) ? el.piezas_usadas : []).map(p => ({ kg: n(p.kg), precio: costoInsumoElaboracion(p.tipo, precios) })),
    { kg: n(el.kg_carne_bovina), precio: precios.bovino },
  ].filter(p => p.kg > 0)
  const kg = partes.reduce((s, p) => s + p.kg, 0)
  if (kg <= 0) return 0
  return Math.round(partes.reduce((s, p) => s + p.kg * p.precio, 0) / kg)
}

// Precio de compra promedio del período por animal. Si la semana no tuvo
// compras de algo, se abre la ventana a 90 días para no costear en $0.
async function preciosDeReferencia(desde, hasta) {
  const promedio = async (tipo, d, h) => {
    const { data } = await supabase.from('entradas_deposito')
      .select('kg, kg_real, precio_kg').eq('tipo', tipo).eq('eliminado', false)
      .gt('precio_kg', 0).gte('fecha', d).lte('fecha', h)
    const filas = data || []
    const kg = filas.reduce((s, e) => s + n(e.kg_real ?? e.kg), 0)
    if (kg <= 0) return 0
    return Math.round(filas.reduce((s, e) => s + n(e.kg_real ?? e.kg) * n(e.precio_kg), 0) / kg)
  }
  const atras = new Date(desde + 'T12:00'); atras.setDate(atras.getDate() - 90)
  const desde90 = atras.toISOString().slice(0, 10)
  const [cerdo, pollo, bovino] = await Promise.all([
    promedio('cerdo', desde, hasta).then(v => v || promedio('cerdo', desde90, hasta)),
    promedio('pollo', desde, hasta).then(v => v || promedio('pollo', desde90, hasta)),
    promedio('bovino_mr', desde, hasta).then(v => v || promedio('bovino_mr', desde90, hasta)),
  ])
  return { cerdo, pollo, bovino }
}

// Cosas que el informe tiene que aclarar en vez de dejar pasar en silencio.
function avisosDelPeriodo(categorias, precioPorEntrada, despostes) {
  const avisos = []
  const sinPrecio = (despostes || []).filter(d => !precioPorEntrada[d.entrada_id])
  if (sinPrecio.length > 0) {
    avisos.push(`${sinPrecio.length} desposte(s) sin precio de compra en su entrada: sus kilos de merma suman, pero cuestan $0.`)
  }
  const kiloSinFrio = (categorias.find(c => c.id === 'medias_kilo')?.filas || [])
    .filter(f => f.desglose?.conocido && f.desglose.frio === 0)
  if (kiloSinFrio.length > 0) {
    avisos.push(`${kiloSinFrio.length} media(s) res se despostaron sin merma de frío (registros anteriores al 22/08/2026): su merma está subdeclarada ~2,5%.`)
  }
  return avisos
}
