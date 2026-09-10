-- ============================================================
-- 148 — es_ceo() nunca devuelve NULL
-- ============================================================
-- Sin sesión, auth.uid() es NULL y la comparación devolvía NULL en vez de
-- false. El gate de la RPC (`if not es_ceo() then raise`) NO cortaba: en
-- SQL `not null` es null, y un IF con null no entra al then.
--
-- Con coalesce devuelve false y el gate corta siempre que no sea el dueño.
-- Verificado: llamar ejecutivo_sucursales() sin sesión ahora tira
-- "Solo el dueño puede ver el resumen de las bocas".
-- ============================================================
create or replace function public.es_ceo()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(auth.uid() = 'cc59fc4b-ff6d-4322-bbfc-0de5728ccfe0'::uuid, false)
$$;

-- APLICADA el 10/09/2026.
