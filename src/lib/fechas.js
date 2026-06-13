// ============================================================
// HELPERS DE FECHA — siempre en hora local Argentina
// ============================================================
// Bug histórico: usar `new Date().toISOString().split('T')[0]`
// devuelve la fecha en UTC. Para la carnicería (Río Primero,
// Córdoba, UTC-3) eso significa que cualquier venta hecha entre
// las 21:00 ARG y las 00:00 ARG quedaba con la fecha del día
// siguiente. Resultado: Dashboard e Historial mostraban totales
// distintos para "hoy".
//
// Estos helpers usan Intl.DateTimeFormat con la zona horaria
// fija de Argentina, que respeta horario de verano si llegara
// a aplicarse y es robusto independientemente del navegador.
// ============================================================

const TZ_ARG = 'America/Argentina/Cordoba'

// Devuelve YYYY-MM-DD según el reloj de Argentina (ej: '2026-05-23').
// Aceptá un Date opcional para calcular fechas relativas (ayer, etc).
export function fechaHoyARG(date = new Date()) {
  // Intl con 'en-CA' devuelve formato YYYY-MM-DD listo para Postgres
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_ARG,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

// Devuelve HH:MM:SS según el reloj de Argentina (ej: '21:10:57').
export function horaHoyARG(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ_ARG, hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date)
}

// Devuelve la hora (0-23) según el reloj de Argentina.
// Útil para decidir turno mañana/tarde sin depender del reloj del SO.
export function horaNumARG(date = new Date()) {
  return Number(horaHoyARG(date).slice(0, 2))
}

// Devuelve la fecha de N días atrás (o adelante si N negativo) en ARG.
// Ej: fechaRelativaARG(-1) → fecha de ayer en ARG.
export function fechaRelativaARG(diasOffset, base = new Date()) {
  const d = new Date(base)
  d.setDate(d.getDate() + diasOffset)
  return fechaHoyARG(d)
}

// True si una fecha 'YYYY-MM-DD' es posterior a hoy (reloj ARG).
// Para validar formularios de carga manual: una compra/venta con fecha
// futura es siempre un error de tipeo (ej: remito cargado el 4/6 con
// fecha 25/6). Comparación lexicográfica, válida para el formato ISO.
export function esFechaFutura(fecha) {
  return !!fecha && fecha > fechaHoyARG()
}
