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
