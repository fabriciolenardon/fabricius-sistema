// ============================================================
// DECODIFICADOR EAN-13 - Balanza Cuora Max
// ============================================================
// La balanza Cuora Max imprime códigos EAN-13 configurables.
// Formato general: PREFIJO(n) + PLU(n) + CAMPO(n) + CHECK(1) = 13
//
// Modos soportados (definidos por config.tipo):
//   1) "peso"          → campo = peso en gramos    (divide por 1000)
//      Ej: "2" + PLU(5) + gramos(6)        + check   Tope: 999,99 kg
//
//   2) "precio"        → campo = precio en centavos (divide por 100)
//      Ej: "2" + PLU(5) + centavos(6)      + check   Tope: $9.999,99
//
//   3) "precio_pesos"  → campo = importe en pesos enteros (sin centavos)
//      Ej: "2" + PLU(6) + pesos(5)         + check   Tope: $99.999
//      ESTE ES EL FORMATO REAL CON QUE FABRICIUS CONFIGURÓ SU BALANZA
//      (verificado con tickets reales el 2026-05-22)
// ============================================================

export function calcEAN13Check(digits12) {
  if (digits12.length !== 12) throw new Error('EAN-13 requiere 12 dígitos antes del check')
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const d = parseInt(digits12[i], 10)
    sum += (i % 2 === 0) ? d : d * 3
  }
  return (10 - (sum % 10)) % 10
}

export function validarEAN13(codigo) {
  if (!/^\d{13}$/.test(codigo)) return false
  const calc = calcEAN13Check(codigo.slice(0, 12))
  return calc === parseInt(codigo[12], 10)
}

export function generarEAN13(digits12) {
  if (!/^\d{12}$/.test(digits12)) throw new Error('Se requieren 12 dígitos numéricos')
  return digits12 + calcEAN13Check(digits12)
}

export function generarEAN13Balanza(config, plu, valor = 0) {
  const prefijo = String(config.prefijo || '2')
  const pluStr = String(plu || 0).padStart(config.plu_digitos || 5, '0')
  const valorStr = String(valor || 0).padStart(config.campo_digitos || 5, '0')
  const base = prefijo + pluStr + valorStr
  if (base.length !== 12) {
    throw new Error(`Configuración inválida: el total es ${base.length} dígitos, debe ser 12`)
  }
  return generarEAN13(base)
}

export function decodificarEANBalanza(codigo, config = {}) {
  if (!codigo) return null
  const clean = String(codigo).trim()
  if (!/^\d{13}$/.test(clean)) return null

  const prefijo = String(config.prefijo || '2')
  const pluDig = config.plu_digitos || 5
  const tipo = config.tipo || 'peso'
  const campoDig = config.campo_digitos || 6

  if (!clean.startsWith(prefijo)) {
    return { error: 'prefijo_invalido', prefijo_esperado: prefijo, raw: clean }
  }

  if (!validarEAN13(clean)) {
    return { error: 'checksum_invalido', raw: clean }
  }

  const inicio = prefijo.length
  const plu = parseInt(clean.slice(inicio, inicio + pluDig), 10)
  const valor = parseInt(clean.slice(inicio + pluDig, inicio + pluDig + campoDig), 10)

  if (tipo === 'peso') {
    return { plu, peso_kg: valor / 1000, peso_gramos: valor, raw: clean }
  } else if (tipo === 'precio_pesos') {
    return { plu, precio: valor, precio_pesos: valor, raw: clean }
  } else {
    return { plu, precio: valor / 100, precio_centavos: valor, raw: clean }
  }
}

export function esCodigoBalanza(codigo, config = {}) {
  if (!codigo) return false
  const clean = String(codigo).trim()
  const prefijo = String(config.prefijo || '2')
  return /^\d{13}$/.test(clean) && clean.startsWith(prefijo)
}
