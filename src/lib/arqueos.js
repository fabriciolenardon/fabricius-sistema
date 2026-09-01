// ============================================================
// ARQUEOS — cuál es el cierre de caja que vale para cada día
// ============================================================
// Un mismo día puede tener VARIOS arqueos guardados:
//   · se rehace el cierre porque faltó cargar una venta, o
//   · un doble clic deja dos (29/07/2026: dos arqueos separados por 7
//     segundos, el segundo en $0 y con un faltante fantasma de $314.027).
//
// Regla de Fabricio (01/09/2026): vale SIEMPRE EL ÚLTIMO cierre cargado
// de ese día. Los anteriores NO se borran: siguen en el historial de
// Arqueo para el control del dueño (ver quién retocó un cierre), pero no
// se suman de nuevo en los totales.
//
// Ojo con dos cosas:
//  1. Se agrupa por fecha + sucursal_id. La central ve los arqueos de
//     TODAS las bocas (política is_admin de la RLS), y quedarse con "el
//     último del día" a secas borraría de los totales el cierre de una
//     boca entera.
//  2. El desempate es por hora y, si empatan, por id (el insert más
//     nuevo) — los duplicados por doble clic comparten el minuto.
// ============================================================

function esPosterior(a, b) {
  const ha = String(a?.hora || ''), hb = String(b?.hora || '')
  if (ha !== hb) return ha > hb
  return (Number(a?.id) || 0) > (Number(b?.id) || 0)
}

// Devuelve un solo arqueo por día y por boca: el último cargado.
export function ultimoArqueoPorDia(arqueos = []) {
  const porDia = new Map()
  for (const a of arqueos) {
    if (!a?.fecha) continue
    const key = `${a.fecha}|${a.sucursal_id ?? ''}`
    const previo = porDia.get(key)
    if (!previo || esPosterior(a, previo)) porDia.set(key, a)
  }
  return [...porDia.values()]
}

// ids de los arqueos que quedaron REEMPLAZADOS por uno posterior del
// mismo día y boca. El historial los marca para que se vea de un vistazo
// cuál es el que cuenta y cuál quedó pisado.
export function idsArqueosReemplazados(arqueos = []) {
  const vigentes = new Set(ultimoArqueoPorDia(arqueos).map(a => a.id))
  return new Set(arqueos.filter(a => a?.fecha && !vigentes.has(a.id)).map(a => a.id))
}
