// ============================================================
// FORMATO DEL CÓDIGO DE BARRAS DE LA BALANZA — por sucursal
// ============================================================
// El formato vive en config_sistema.clave='ean13_formato'. Esa tabla
// tiene PK sobre `clave` sola: hay UNA fila para toda la empresa. Pero
// cada boca tiene su propia balanza física y se reconfiguran en momentos
// distintos (Río Primero un día, Monte Cristo cuando se pueda), así que
// el modo tiene que poder diferir por sucursal SIN migrar la tabla.
//
// Solución: la fila global guarda el default y, opcionalmente, un mapa
// `por_sucursal` con los overrides:
//
//   { tipo: 'precio_pesos', prefijo: '2', plu_digitos: 6, campo_digitos: 5,
//     por_sucursal: { "2": { tipo: 'peso' } } }
//
// Así Monte Cristo (sucursal 2) puede estar en modo peso mientras la
// central sigue en importe, y ninguna de las dos lee mal.
//
// ── LOS DOS MODOS ───────────────────────────────────────────────────
// 'precio_pesos' (histórico): la etiqueta trae el IMPORTE ya calculado
//   por la balanza. La Caja deriva los kg dividiendo por el precio del
//   sistema, así que el precio se cancela y termina cobrando lo que dice
//   la etiqueta. Obliga a tener balanza y sistema con los MISMOS precios.
// 'peso': la etiqueta trae los GRAMOS reales. La Caja usa el precio del
//   sistema para cobrar → actualizar un precio en el sistema alcanza, la
//   balanza no se toca nunca más por precios.
// ============================================================

export const MODOS_BALANZA = {
  precio_pesos: {
    label: 'Importe (lo que hay hoy)',
    resumen: 'La etiqueta trae el importe calculado por la balanza. Los precios de la balanza y del sistema TIENEN que coincidir.',
    campoQendra: 'I (importe)',
  },
  peso: {
    label: 'Peso en gramos',
    resumen: 'La etiqueta trae los gramos. El precio lo pone el sistema: cambiás un precio y ya cobra bien, sin tocar la balanza.',
    campoQendra: 'C (peso)',
  },
}

// Config por defecto si todavía no hay fila en config_sistema.
export const FORMATO_DEFAULT = {
  prefijo: '2', plu_digitos: 6, campo_digitos: 5, tipo: 'precio_pesos',
}

// Formato efectivo para una sucursal: su override si lo tiene, sino el global.
// `valor` es config_sistema.valor tal cual viene de la base.
export function resolverFormatoEAN(valor, sucursalId) {
  const base = { ...FORMATO_DEFAULT, ...(valor || {}) }
  delete base.por_sucursal
  const override = valor?.por_sucursal?.[String(sucursalId)]
  return override ? { ...base, ...override } : base
}

// Devuelve el `valor` completo con el modo de UNA sucursal cambiado, listo
// para guardar. No pisa el default global ni el modo de la otra boca.
export function conModoDeSucursal(valor, sucursalId, tipo) {
  const actual = { ...FORMATO_DEFAULT, ...(valor || {}) }
  const porSucursal = { ...(actual.por_sucursal || {}) }
  porSucursal[String(sucursalId)] = { tipo }
  return { ...actual, por_sucursal: porSucursal }
}

// Texto del patrón para mostrarlo en pantalla y poder compararlo con lo que
// está cargado en Qendra (Configuración → Códigos de barras).
export function patronLegible(formato) {
  const f = { ...FORMATO_DEFAULT, ...(formato || {}) }
  const campo = f.tipo === 'peso' ? 'C' : 'I'
  return `${f.prefijo} + ${'P'.repeat(f.plu_digitos)} + ${campo.repeat(f.campo_digitos)} + verificador`
}
