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

// ============================================================
// CON QUÉ LISTAS VENDE CADA NEGOCIO
// ============================================================
// La central vende con las tres. Una SUCURSAL es una franquicia y vende con
// dos: Mayorista (rotiserías, restaurantes) y Minorista (el mostrador).
//
// "Carnicería" NO es una lista con la que ellos vendan: es la lista con la
// que la CENTRAL les vende A ELLOS. Mostrársela es confuso y peligroso — un
// empleado podría facturarle a un cliente al precio con el que la sucursal
// compra. Lo mismo con la lista "Franquicia": ellos SON la franquicia.
export function listasDeVenta(esSucursal) {
  return esSucursal ? [LISTAS.may, LISTAS.min] : [LISTAS.may, LISTAS.carn, LISTAS.min]
}

// Lista por defecto al dar de alta un cliente nuevo.
export function listaPorDefecto(esSucursal) {
  return esSucursal ? 'min' : 'carn'
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
