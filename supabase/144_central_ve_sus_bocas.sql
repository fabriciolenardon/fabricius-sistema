-- ============================================================
-- 144 — El CEO puede leer los datos de sus bocas
-- ============================================================
-- SÍNTOMA: en Dirección → Ejecutivo → Sucursales, Monte Cristo no
-- aparecía. Tampoco en la franja de bocas del panel de la TV. Los datos
-- están en la base (se ven con permisos de servicio), pero el navegador
-- no los recibía.
--
-- CAUSA: la política RESTRICTIVE `sucursal_aislamiento`:
--
--   is_cliente_mayorista() OR is_franquicia() OR sucursal_id = mi_sucursal()
--
-- Una restrictiva se aplica con AND sobre todas las permisivas, así que
-- ser admin no alcanza: a un usuario de la central (mi_sucursal() = 1) la
-- base le devuelve SOLO las filas de la sucursal 1. La política está
-- pensada para que la franquicia no vea a la central, y de paso dejó
-- ciega a la central sobre sus propias bocas.
--
-- QUIÉN GANA ACCESO: SOLO el CEO (Fabricio Lenardon,
-- cc59fc4b-ff6d-4322-bbfc-0de5728ccfe0). Ni Ariel ni Giuliana, que son
-- los otros dos rol='admin'; ni la Cajera ni el Sector Desposte, que
-- también son de la sucursal 1.
--
-- Es el mismo criterio que ya usa el sistema en src/lib/permisos.js: los
-- tres admin NO son equivalentes, y el panel Ejecutivo donde vive esta
-- pantalla ya está cerrado con <SoloCEO> en App.jsx. Esto hace que la
-- BASE respete la misma regla que la pantalla: sin esto la restricción
-- era solo visual.
--
-- Por eso tampoco se reusa es_central(), que da TRUE para cualquiera de
-- la sucursal 1 (el usuario Desposte incluido).
--
-- QUIÉN NO CAMBIA: Monte Cristo y Alvear siguen viendo solo lo suyo. La
-- condición nueva es un OR que solo puede dar TRUE para un único usuario.
--
-- Las restrictivas se REESCRIBEN (drop + create), no se suman: dos
-- restrictivas sobre la misma tabla se combinan con AND y el resultado
-- sería más cerrado, no más abierto.
-- ============================================================

-- ── La condición: un solo usuario ───────────────────────────────────
create or replace function public.es_ceo()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth.uid() = 'cc59fc4b-ff6d-4322-bbfc-0de5728ccfe0'::uuid
$$;

comment on function public.es_ceo() is
  'TRUE solo para el dueño (Fabricio Lenardon). Espejo en la base de esCEO() de src/lib/permisos.js: los tres rol=admin no son equivalentes. Si alguna vez se recrea la cuenta, hay que actualizar este uuid igual que CEO_USER_ID en permisos.js.';

-- ── Ventas del mostrador ────────────────────────────────────────────
drop policy if exists sucursal_aislamiento on public.ventas_minoristas;
create policy sucursal_aislamiento on public.ventas_minoristas
  as restrictive for all to public
  using (
    is_cliente_mayorista() or is_franquicia()
    or sucursal_id = mi_sucursal()
    or es_ceo()
  );

-- ── Remitos (la venta mayorista de cada boca) ───────────────────────
drop policy if exists sucursal_aislamiento on public.remitos;
create policy sucursal_aislamiento on public.remitos
  as restrictive for all to public
  using (
    is_cliente_mayorista() or is_franquicia()
    or sucursal_id = mi_sucursal()
    or es_ceo()
  );

-- ── Meses operativos ────────────────────────────────────────────────
-- Sin esto no se puede leer el mes propio de Monte Cristo, que es
-- justamente con el que hay que medir a esa boca.
drop policy if exists sucursal_aislamiento on public.meses_operativos;
create policy sucursal_aislamiento on public.meses_operativos
  as restrictive for all to public
  using (
    is_cliente_mayorista() or is_franquicia()
    or sucursal_id = mi_sucursal()
    or es_ceo()
  );

-- ── Control ─────────────────────────────────────────────────────────
-- Después de correr esto, en Dirección → Ejecutivo → Sucursales tiene que
-- aparecer MONTE CRISTO además de la casa central, y en el panel de la TV
-- la franja 🏪 BOCAS con las dos.
--
-- Para ver cómo quedaron las políticas:
--   select tablename, policyname, permissive, qual
--   from pg_policies
--   where tablename in ('ventas_minoristas','remitos','meses_operativos')
--     and permissive = 'RESTRICTIVE';
--
-- Para confirmar que alcanza a un solo usuario:
--   select id, nombre, rol from profiles
--   where id = 'cc59fc4b-ff6d-4322-bbfc-0de5728ccfe0';
