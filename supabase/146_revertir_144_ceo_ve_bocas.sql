-- ============================================================
-- 146 — Revierte la 144. El aislamiento por sucursal vuelve como estaba.
-- ============================================================
-- QUÉ PASÓ: la 144 le abrió al CEO ventas_minoristas / remitos /
-- meses_operativos de TODAS las bocas, para que la pantalla Sucursales
-- pudiera mostrar a Monte Cristo.
--
-- EFECTO COLATERAL QUE NO VI: más de 30 consultas del sistema leen esas
-- tablas SIN filtrar por sucursal, porque hasta ahora la RLS lo hacía por
-- ellas. Al abrirla, todas esas pantallas pasaron a sumar las dos bocas
-- para el CEO — y sin ningún error a la vista, solo números más grandes.
--
-- Lo detectó Fabricio mirando su cierre: "caja minorista hizo 14 millones,
-- ¿no está inflado?". Estaba:
--
--   central       $ 5.686.532,43  (171 tickets)
--   Monte Cristo  $ 9.121.460,77  (495 tickets)
--   ─────────────────────────────
--   el Cierre     $14.807.993,20   ← exacto
--
-- Afectaba a Cierre, Dashboard, Reportes, Caja, Arqueo, Productividad,
-- PlanillaBlangino, AlertasAnomalias y las tools de Iris.
--
-- POR QUÉ SE REVIERTE EN VEZ DE PARCHEAR: son 30+ consultas en 12 archivos.
-- Filtrarlas una por una es la vía equivocada — con que se escape una, el
-- número queda mal para siempre y nadie se entera. La RLS es justamente lo
-- que garantiza que cada pantalla vea lo suyo sin que cada consulta tenga
-- que acordarse. Se restaura esa garantía.
--
-- CÓMO SIGUE: la pantalla Sucursales lee los datos de las otras bocas por
-- una RPC `security definer` que devuelve SOLO totales agregados (venta,
-- kilos, tickets por boca). Los totales no sirven para reconstruir ninguna
-- venta y no abren las tablas a nadie.
--
-- es_ceo() queda creada a propósito: no molesta y la usa la RPC.
-- ============================================================

drop policy if exists sucursal_aislamiento on public.ventas_minoristas;
create policy sucursal_aislamiento on public.ventas_minoristas
  as restrictive for all to public
  using (
    is_cliente_mayorista() or is_franquicia()
    or sucursal_id = mi_sucursal()
  );

drop policy if exists sucursal_aislamiento on public.remitos;
create policy sucursal_aislamiento on public.remitos
  as restrictive for all to public
  using (
    is_cliente_mayorista() or is_franquicia()
    or sucursal_id = mi_sucursal()
  );

drop policy if exists sucursal_aislamiento on public.meses_operativos;
create policy sucursal_aislamiento on public.meses_operativos
  as restrictive for all to public
  using (
    is_cliente_mayorista() or is_franquicia()
    or sucursal_id = mi_sucursal()
  );

-- APLICADA el 10/09/2026.
--
-- Control:
--   select tablename, qual from pg_policies
--   where tablename in ('ventas_minoristas','remitos','meses_operativos')
--     and permissive = 'RESTRICTIVE';
-- Ninguna debe mencionar es_ceo().
