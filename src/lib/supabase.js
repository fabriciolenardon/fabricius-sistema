import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Faltan variables de entorno VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY. ' +
    'Copiá .env.example a .env y completá los valores de tu proyecto Supabase.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey)

// ── Trae TODAS las filas de una consulta, paginando de a 1000 ──────────────
// Supabase/PostgREST corta las respuestas en 1000 filas por defecto, así que
// cualquier historial que supere las 1000 filas quedaría truncado en silencio.
// Esto pagina con .range() hasta agotar. `makeQuery` debe DEVOLVER una consulta
// NUEVA en cada llamada (para poder aplicarle .range()).
//   const { data } = await fetchAllRows(() =>
//     supabase.from('movimientos_ctacte').select('*').eq('cliente_id', id))
export async function fetchAllRows(makeQuery) {
  const PAGE = 1000
  let all = [], from = 0
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
