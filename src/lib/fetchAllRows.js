// ============================================================
// fetchAllRows — pagina una consulta de a 1000 filas
// ============================================================
// Supabase/PostgREST corta TODA respuesta en 1000 filas por defecto. Cualquier
// `supabase.from(...).select(...)` sin .range()/paginación que después se sume o
// cuente en el cliente subdeclara el total EN SILENCIO apenas el período pasa de
// 1000 filas. Ya pasó de verdad: el Dashboard Ejecutivo mostraba saldo mensual
// negativo falso porque las salidas del mes (1122 filas) se cortaban en 1000
// (PR #170).
//
// Uso: pasar una FÁBRICA que devuelva una consulta NUEVA en cada llamada, para
// poder aplicarle .range() sin reusar un builder ya consumido:
//
//   const { data } = await fetchAllRows(() =>
//     supabase.from('salidas_deposito').select('total').gte('fecha', a).lte('fecha', b))
//
// Devuelve { data, error } — compatible tanto con los consumidores que sólo leen
// `.data` como con los que hacen `if (error) throw error`. Si una página falla,
// corta y devuelve lo acumulado junto con el error.
export async function fetchAllRows(makeQuery) {
  const PAGE = 1000
  let all = []
  let from = 0
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1)
    if (error) return { data: all, error }
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return { data: all, error: null }
}
