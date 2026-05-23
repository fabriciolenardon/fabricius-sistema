// ============================================================
// MODELOS DE DESPOSTE — definición central
// ============================================================
// Estos son los modelos predefinidos de desposte de una
// media res. Cada modelo corta las piezas en proporciones
// distintas. Las piezas se cargan a stock como 'bovino_pieza'.
//
// IMPORTANTE: Esta definición debe coincidir con la usada
// en pages/admin/Deposito.jsx. Si modificás acá, sincronizar allá.
// ============================================================

export const MODELOS_DESPOSTE = {
  A: {
    nombre: 'Cuarto Pistola + Costillar Completo + Cortito',
    icono: '🅰️',
    merma_desposte_pct: 0.03,
    piezas: [
      { nombre: 'Cuarto Pistola',    pct: 0.44, tipo_stock: 'bovino_pieza', busqueda_precio: 'pistola' },
      { nombre: 'Cortito',           pct: 0.33, tipo_stock: 'bovino_pieza', busqueda_precio: 'cortito' },
      { nombre: 'Costillar Completo', pct: 0.20, tipo_stock: 'bovino_pieza', busqueda_precio: 'costilla' },
    ],
  },
  B: {
    nombre: 'Pierna + Costeletal con Lomo + Costillar Completo + Cortito',
    icono: '🅱️',
    merma_desposte_pct: 0.03,
    piezas: [
      { nombre: 'Pierna',             pct: 0.30, tipo_stock: 'bovino_pieza', busqueda_precio: 'pierna' },
      { nombre: 'Costeletal con Lomo', pct: 0.14, tipo_stock: 'bovino_pieza', busqueda_precio: 'lomo' },
      { nombre: 'Cortito',            pct: 0.33, tipo_stock: 'bovino_pieza', busqueda_precio: 'cortito' },
      { nombre: 'Costillar Completo', pct: 0.20, tipo_stock: 'bovino_pieza', busqueda_precio: 'costilla' },
    ],
  },
  C: {
    nombre: 'Pierna + Parrillero + Cortito',
    icono: '🅲',
    merma_desposte_pct: 0.02,
    piezas: [
      { nombre: 'Pierna',     pct: 0.30, tipo_stock: 'bovino_pieza', busqueda_precio: 'pierna' },
      { nombre: 'Parrillero', pct: 0.35, tipo_stock: 'bovino_pieza', busqueda_precio: 'parrillero' },
      { nombre: 'Cortito',    pct: 0.33, tipo_stock: 'bovino_pieza', busqueda_precio: 'cortito' },
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
