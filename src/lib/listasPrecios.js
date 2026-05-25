// ============================================================
// HELPER DE LISTAS DE PRECIOS — mapping cliente → lista
// ============================================================
// Centraliza el mapping entre el código en cliente.lista_precios y
//   - el campo de la tabla precios a usar
//   - la etiqueta visible al usuario
//   - el color del badge
//
// Antes este mapping estaba duplicado inline en ~5 archivos. Si se
// agrega una lista nueva (o se cambia el wording), tocar acá.
// ============================================================

export const LISTAS = {
  may: {
    codigo: 'may',
    label: 'Mayorista',
    labelEmoji: '🟡 Mayorista',
    campo: 'precio_mayorista',
    color: '#ffd17a',
    bg: '#2a2010',
  },
  carn: {
    codigo: 'carn',
    label: 'Carnicería',
    labelEmoji: '🔴 Carnicería',
    campo: 'precio_carniceria',
    color: '#ff8b8b',
    bg: '#2a1010',
  },
  min: {
    codigo: 'min',
    label: 'Minorista',
    labelEmoji: '🟢 Minorista',
    campo: 'precio_minorista',
    color: '#7dff7d',
    bg: '#102a10',
  },
}

// Devuelve la config de la lista del cliente. Si el código es desconocido
// (data legacy mal cargada), defaultea a 'carn' para no romper la UI.
export function getLista(codigo) {
  return LISTAS[codigo] || LISTAS.carn
}

// Devuelve el campo de la tabla precios que corresponde a la lista del cliente
// Ej: getCampoPrecio('min') === 'precio_minorista'
export function getCampoPrecio(codigo) {
  return getLista(codigo).campo
}

// Devuelve la etiqueta visible (con emoji) para el badge UI
export function getEtiquetaLista(codigo) {
  return getLista(codigo).labelEmoji
}
