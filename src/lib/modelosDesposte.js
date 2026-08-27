// ============================================================
// MODELOS DE DESPOSTE — definición central
// ============================================================
// Estos son los modelos predefinidos de desposte de una
// media res. Cada modelo corta las piezas en proporciones
// distintas. Cada pieza se carga a su PROPIO bucket de stock
// (pieza_pierna, pieza_cortito, etc.) — ya NO al genérico
// 'bovino_pieza' (deprecado). Ver PIEZA_BOVINA_A_STOCK abajo.
//
// IMPORTANTE: Esta definición debe coincidir con la usada
// en pages/admin/Deposito.jsx. Si modificás acá, sincronizar allá.
// ============================================================

// Bucket de stock_actual propio de cada pieza bovina (stock por pieza).
// Fuente de verdad única para desposte, venta, conversión y anulación.
export const PIEZA_BOVINA_A_STOCK = {
  'Cuarto Pistola': 'pieza_cuarto_pistola',
  'Cortito': 'pieza_cortito',
  'Costillar Completo': 'pieza_costillar',
  'Pierna': 'pieza_pierna',
  'Parrillero': 'pieza_parrillero',
  'Costeletal con Lomo': 'pieza_costeletal',
  'Paleta': 'pieza_paleta',
}
// Devuelve el bucket de una pieza por su nombre. Fallback al genérico solo
// si el nombre no se reconoce (no debería pasar con los modelos actuales).
export function bucketDePiezaBovina(nombre) {
  return PIEZA_BOVINA_A_STOCK[nombre] || 'bovino_pieza'
}

export const MODELOS_DESPOSTE = {
  A: {
    nombre: 'Cuarto Pistola + Costillar Completo + Cortito',
    icono: '🅰️',
    merma_desposte_pct: 0.03,
    piezas: [
      { nombre: 'Cuarto Pistola',    pct: 0.44, tipo_stock: 'pieza_cuarto_pistola', busqueda_precio: 'pistola' },
      { nombre: 'Cortito',           pct: 0.33, tipo_stock: 'pieza_cortito', busqueda_precio: 'cortito' },
      { nombre: 'Costillar Completo', pct: 0.20, tipo_stock: 'pieza_costillar', busqueda_precio: 'costilla' },
    ],
  },
  B: {
    nombre: 'Pierna + Costeletal con Lomo + Costillar Completo + Cortito',
    icono: '🅱️',
    merma_desposte_pct: 0.03,
    piezas: [
      { nombre: 'Pierna',             pct: 0.30, tipo_stock: 'pieza_pierna', busqueda_precio: 'pierna' },
      { nombre: 'Costeletal con Lomo', pct: 0.14, tipo_stock: 'pieza_costeletal', busqueda_precio: 'lomo' },
      { nombre: 'Cortito',            pct: 0.33, tipo_stock: 'pieza_cortito', busqueda_precio: 'cortito' },
      { nombre: 'Costillar Completo', pct: 0.20, tipo_stock: 'pieza_costillar', busqueda_precio: 'costilla' },
    ],
  },
  C: {
    nombre: 'Pierna + Parrillero + Cortito',
    icono: '🅲',
    merma_desposte_pct: 0.02,
    piezas: [
      { nombre: 'Pierna',     pct: 0.30, tipo_stock: 'pieza_pierna', busqueda_precio: 'pierna' },
      { nombre: 'Parrillero', pct: 0.35, tipo_stock: 'pieza_parrillero', busqueda_precio: 'parrillero' },
      { nombre: 'Cortito',    pct: 0.33, tipo_stock: 'pieza_cortito', busqueda_precio: 'cortito' },
    ],
  },
}

// ============================================================
// MERMA POR PRODUCTO (conversión a cortes)
// ============================================================
// % de merma enlazado a cada pieza / media res. Fuente de verdad:
// config_sistema.merma_conversion (editable desde Depósito). Estos
// son solo los DEFAULTS de fallback si la config no cargó todavía.
// Los % son enteros (porcentaje), no fracciones.
export const MERMA_PIEZA_DEFAULT = {
  'Pierna': 29,
  'Cortito': 27,
  'Costeletal con Lomo': 6,
  'Costillar Completo': 12,
  'Cuarto Pistola': 25,
  'Parrillero': 25,
  // 'Paleta' NO va acá (Fabricio, 27/08/2026): no es una pieza que salga del
  // desposte de una media res — sale junto con el cortito. Verificado en la
  // base: cero despostes, cero piezas físicas y cero kg del bucket en toda la
  // historia. Su rinde se saca con la planilla propia (sólo historial, para
  // saber a qué precio vender la paleta deshuesada). OJO: este default se
  // MEZCLA con la config guardada al cargar (spread), así que dejarla acá la
  // resucitaría aunque la mig 127 la saque de la base.
}
// Merma default para cualquier pieza sin % explícito.
export const MERMA_PIEZA_GENERICA = 25

// MERMA DE FRÍO — el agua y la sangre que pierde la carne después de la faena,
// en la cámara. No depende de cómo se desposte: ya se perdió.
//   · Desposte X KILO: se SUMA a la merma del tipo de animal. Un novillito
//     rinde 22% menos por hueso/grasa/recorte y otro 2,5% por frío → 24,5%.
//   · Desposte A PIEZAS: acá NO se configura ninguna merma de desposte, porque
//     se cargan los pesos finales de cada pieza y la merma sale sola de la
//     resta. El frío es el único descuento previo (define el kg neto contra el
//     que se compara lo pesado).
// Estaba hardcodeado como `* 0.975` en tres lugares.
export const MERMA_FRIO_DEFAULT = 2.5

export const MERMA_MEDIA_RES_DEFAULT = [
  { id: 'novillito',       label: 'Novillito (Nt)',       merma: 22 },
  { id: 'vaca_vaquillona', label: 'Vaca/Vaquillona (VQ)', merma: 28 },
]

// Lista de piezas de cerdo (capón) que se cargan al desposte
export const PIEZAS_CERDO = [
  { key: 'pierna',     nombre: 'Piernas (x2)',      stock: 'cerdo_pierna' },
  { key: 'carre',      nombre: 'Carrés (x2)',       stock: 'cerdo_carre' },
  { key: 'pechito',    nombre: 'Pechitos (x2)',     stock: 'cerdo_pechito' },
  { key: 'matambre',   nombre: 'Matambres (x2)',    stock: 'cerdo_matambre' },
  { key: 'paleta',     nombre: 'Paletas (x2)',      stock: 'cerdo_paleta' },
  { key: 'parrillero', nombre: 'Carnaza',           stock: 'cerdo_parrillero' },
  { key: 'huesos',     nombre: 'Huesos',            stock: 'cerdo_huesos' },
  { key: 'bondiola',   nombre: 'Bondiola s/hueso',  stock: 'cerdo_bondiola' },
  { key: 'tocino',     nombre: 'Tocino',            stock: 'cerdo_tocino' },
  { key: 'cuero',      nombre: 'Cuero',             stock: 'cerdo_cuero' },
  { key: 'cabeza',     nombre: 'Cabeza',            stock: 'cerdo_cabeza' },
]
