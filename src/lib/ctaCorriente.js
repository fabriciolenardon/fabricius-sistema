// ============================================================
// CUENTA CORRIENTE — saldo del cliente como FUNCIÓN del ledger
// ============================================================
// La fuente de verdad del saldo de un cliente es su ledger
// `movimientos_ctacte`:  saldo = Σdebe − Σhaber.
//
// Antes el saldo se mantenía sumando/restando "a mano" en cada operación
// (crear/editar/anular remito, registrar/anular pago). Eso es frágil:
//   - las columnas `numeric` de Supabase pueden volver como STRING → `"179953" + 73500`
//     concatena en vez de sumar;
//   - editar un remito que NO es el último no recalculaba el saldo acumulado de los
//     movimientos posteriores → quedaban desincronizados;
//   - si una de las actualizaciones se salteaba, el saldo cacheado quedaba mal para
//     siempre (caso real 15/06: RENZO FORNERIS figuraba debiendo $179.953 cuando
//     debía $253.453 — el sistema subdeclaraba la deuda).
//
// `recomputarSaldoCliente` recalcula TODO desde el ledger: el acumulado de cada
// movimiento (en orden) y el saldo cacheado del cliente. Es idempotente y solo
// escribe las filas que cambian, así que es barato cuando el ledger ya está sano
// (un alta normal solo toca la última fila). Llamarlo DESPUÉS de cada operación que
// toque el ledger, en vez de ajustar el saldo a mano.
import { supabase, fetchAllRows } from './supabase'

export async function recomputarSaldoCliente(clienteId) {
  if (!clienteId) return 0
  // fetchAllRows: pagina de a 1000. Sin esto, un cliente con +1000 movimientos
  // recalcularía el saldo MAL (Supabase corta en 1000) — y el saldo de cta cte
  // es la fuente de verdad de quién/cuánto debe. NUNCA truncar acá.
  const { data: movs, error } = await fetchAllRows(() => supabase
    .from('movimientos_ctacte')
    .select('id, debe, haber, saldo, created_at, fecha')
    .eq('cliente_id', clienteId))
  if (error) { console.warn('recomputarSaldoCliente:', error.message); return null }

  // Orden cronológico estable: como se fueron creando (created_at), fecha desempata.
  const lista = (movs || []).slice().sort((a, b) => {
    const ca = String(a.created_at || ''), cb = String(b.created_at || '')
    if (ca !== cb) return ca < cb ? -1 : 1
    return String(a.fecha || '') < String(b.fecha || '') ? -1 : 1
  })

  let acc = 0
  for (const m of lista) {
    acc += (Number(m.debe) || 0) - (Number(m.haber) || 0)
    if ((Number(m.saldo) || 0) !== acc) {
      await supabase.from('movimientos_ctacte').update({ saldo: acc }).eq('id', m.id)
    }
  }
  await supabase.from('clientes').update({ saldo: acc }).eq('id', clienteId)
  return acc
}

// Devuelve los movimientos con el saldo corriente calculado EN ORDEN DE FECHA
// (no de carga). Así la columna "saldo" cierra bien al leerla por fecha, aunque
// haya remitos back-dated (cargados días después con fecha vieja). SOLO LECTURA:
// no toca la base; agrega un campo `saldoCalc` a cada movimiento. Devuelve la
// lista del MÁS NUEVO al más viejo (para mostrar).
export function conSaldoCorriente(movs) {
  const asc = [...(movs || [])].sort((a, b) => {
    const fa = String(a.fecha || ''), fb = String(b.fecha || '')
    if (fa !== fb) return fa < fb ? -1 : 1
    const ca = String(a.created_at || ''), cb = String(b.created_at || '')
    if (ca !== cb) return ca < cb ? -1 : 1
    return (a.id || 0) - (b.id || 0)
  })
  let acc = 0
  asc.forEach(m => { acc += (Number(m.debe) || 0) - (Number(m.haber) || 0); m.saldoCalc = acc })
  return asc.reverse()
}
