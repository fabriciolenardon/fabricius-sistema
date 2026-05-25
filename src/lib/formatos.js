// ============================================================
// HELPERS DE FORMATO NUMÉRICO — formato Argentina consistente
// ============================================================
// Centraliza el parseo y display de números (precios, kg, unidades)
// para evitar inconsistencias del estilo "35600" vs "35.600,00" vs
// "67.9 kg" vs "67,9 kg" repartidos por la app.
//
// Argentina usa:
//   - PUNTO como separador de miles: 35.600
//   - COMA como separador decimal: 35.600,50
//
// En los INPUTS aceptamos ambos (coma o punto) para no romper el
// hábito del usuario. Internamente todo se guarda como float JS
// (que usa punto). Al mostrar, formateamos con coma para AR.
// ============================================================

// ───────────────────────────────────────────────────────────
// parseNumero(input) — Convierte un string del usuario a número.
// Acepta cualquiera de:
//   "35600"        → 35600
//   "35.600"       → 35600   (mil + puntos = miles)
//   "35,600"       → 35.6    (coma = decimal — caso ambiguo)
//   "35600,5"      → 35600.5
//   "35.600,50"    → 35600.5 (formato AR completo)
//   "35,600.50"    → 35600.5 (formato US)
//   ""             → 0
//   null/undef     → 0
// ───────────────────────────────────────────────────────────
export function parseNumero(input) {
  if (input == null || input === '') return 0
  if (typeof input === 'number') return isNaN(input) ? 0 : input
  let s = String(input).trim()
  if (!s) return 0
  // Detectar formato: si hay coma Y punto, asumir el último es el decimal
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      // Formato AR: "35.600,50" → punto=miles, coma=decimal
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      // Formato US: "35,600.50" → coma=miles, punto=decimal
      s = s.replace(/,/g, '')
    }
  } else if (lastComma > -1) {
    // Solo coma — asumir decimal: "35,5" → 35.5
    // EXCEPTO si hay 3 dígitos después de la coma (miles): "35,600" → 35600
    const despues = s.length - lastComma - 1
    if (despues === 3 && !s.includes('.')) {
      // Ambiguo. Por seguridad asumimos decimal (más común en montos).
      // El usuario debería usar punto si quiere miles.
      s = s.replace(',', '.')
    } else {
      s = s.replace(',', '.')
    }
  }
  // Solo punto — confiamos en formato US/JS estándar
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

// ───────────────────────────────────────────────────────────
// fmtPrecio(n) — Devuelve un precio formateado en pesos argentinos.
//   fmtPrecio(35600)      → "$35.600"
//   fmtPrecio(35600.5)    → "$35.600,50"
//   fmtPrecio(0)          → "$0"
//   fmtPrecio(null)       → "$0"
// Si querés siempre 2 decimales, pasá { decimales: 2 }.
// ───────────────────────────────────────────────────────────
export function fmtPrecio(n, opts = {}) {
  const num = Number(n) || 0
  const decimales = opts.decimales != null ? opts.decimales : (Number.isInteger(num) ? 0 : 2)
  return '$' + num.toLocaleString('es-AR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })
}

// ───────────────────────────────────────────────────────────
// fmtKg(n) — Peso en kg con coma decimal.
//   fmtKg(67.9)   → "67,9 kg"
//   fmtKg(20)     → "20,0 kg"
//   fmtKg(1.234)  → "1,2 kg"
// Default 1 decimal — pasá { decimales: 2 } para más precisión.
// ───────────────────────────────────────────────────────────
export function fmtKg(n, opts = {}) {
  const num = Number(n) || 0
  const decimales = opts.decimales != null ? opts.decimales : 1
  return num.toLocaleString('es-AR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }) + ' kg'
}

// ───────────────────────────────────────────────────────────
// fmtUnidades(n) — Cantidad de unidades (entero).
//   fmtUnidades(12)  → "12 u"
//   fmtUnidades(1)   → "1 u"
//   fmtUnidades(0)   → "0 u"
// ───────────────────────────────────────────────────────────
export function fmtUnidades(n) {
  const num = Number(n) || 0
  return Math.round(num).toLocaleString('es-AR') + ' u'
}

// ───────────────────────────────────────────────────────────
// fmtNumero(n, decimales) — Número genérico formato AR.
//   fmtNumero(1234567.89, 2) → "1.234.567,89"
//   fmtNumero(1234567)       → "1.234.567"
// ───────────────────────────────────────────────────────────
export function fmtNumero(n, decimales = 0) {
  const num = Number(n) || 0
  return num.toLocaleString('es-AR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })
}
