// ============================================================
// CUIT — Validación con dígito verificador
// ============================================================
// El CUIT en Argentina tiene 11 dígitos: XX-XXXXXXXX-X
// Los primeros 2 son el tipo (20/23/24/27 personas; 30/33/34 empresas)
// Los siguientes 8 son DNI o número correlativo, y el último es
// un dígito verificador calculado con módulo 11.
// ============================================================

const MULT = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

// Devuelve true si el CUIT es válido (formato y dígito verificador)
export function esCuitValido(cuit) {
  if (!cuit) return false
  const limpio = String(cuit).replace(/[-\s.]/g, '')
  if (!/^\d{11}$/.test(limpio)) return false

  const digitos = limpio.split('').map(Number)
  const verificador = digitos[10]
  let suma = 0
  for (let i = 0; i < 10; i++) suma += digitos[i] * MULT[i]
  const resto = suma % 11
  let esperado = 11 - resto
  if (esperado === 11) esperado = 0
  if (esperado === 10) esperado = 9 // regla especial AFIP
  return esperado === verificador
}

// Formatea un CUIT (con o sin guiones) a "XX-XXXXXXXX-X"
export function formatearCuit(cuit) {
  if (!cuit) return ''
  const limpio = String(cuit).replace(/[-\s.]/g, '')
  if (limpio.length !== 11) return cuit
  return `${limpio.slice(0, 2)}-${limpio.slice(2, 10)}-${limpio.slice(10)}`
}

// Devuelve true si solo está bien el FORMATO (11 dígitos), sin validar verificador.
// Útil para mostrar feedback en tiempo real mientras tipean.
export function tieneFormatoCuit(cuit) {
  if (!cuit) return false
  return /^\d{11}$/.test(String(cuit).replace(/[-\s.]/g, ''))
}
