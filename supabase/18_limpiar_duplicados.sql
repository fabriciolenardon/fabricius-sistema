-- ============================================================
-- MIGRACIÓN 18: Limpieza de productos duplicados en `precios`
-- ============================================================
-- Contexto: la migración 14 insertó 75 productos del PDF como nuevos
-- porque su nombre completo no matcheaba exactamente con los que ya
-- existían en la tabla. Resultado: hay productos en pares (el viejo
-- sin PLU con precio, el nuevo con PLU).
--
-- Esta migración detecta duplicados por similitud de nombre y aplica:
--   DELETE  → si el viejo NO tiene ventas ni pedidos asociados
--   RENAME  → a "ZZ_DUPLICADO - ..." si SÍ tiene historial
--             (preserva integridad referencial con ventas_minoristas
--              y pedidos, que guardan producto_id dentro de JSONB)
--
-- Solo afecta a productos sin codigo_balanza (PLU NULL). Los productos
-- con PLU 1-106 (los oficiales del PDF) NO se tocan.
--
-- Toda la lógica va en un solo statement porque Supabase SQL Editor no
-- mantiene tablas temporales entre statements.
-- ============================================================

with
sin_plu as (
  select id,
         nombre,
         upper(regexp_replace(trim(nombre), '\s+', ' ', 'g')) as nn
  from precios
  where codigo_balanza is null
),
con_plu as (
  select id,
         nombre,
         codigo_balanza,
         upper(regexp_replace(trim(nombre), '\s+', ' ', 'g')) as nn
  from precios
  where codigo_balanza between 1 and 106
),
matches as (
  select distinct on (sp.id)
    sp.id   as id_viejo,
    sp.nombre as nombre_viejo,
    cp.codigo_balanza as plu,
    cp.nombre as nombre_nuevo
  from sin_plu sp
  join con_plu cp
    on cp.nn = sp.nn
    or cp.nn like sp.nn || '-%'
    or cp.nn like sp.nn || ' %'
    or cp.nn like sp.nn || '/%'
  order by sp.id, length(cp.nn)
),
ids_en_ventas as (
  select distinct (item->>'producto_id') as pid
  from ventas_minoristas, jsonb_array_elements(items) item
  where item->>'producto_id' is not null
),
ids_en_pedidos as (
  select distinct (item->>'producto_id') as pid
  from pedidos, jsonb_array_elements(items) item
  where item->>'producto_id' is not null
),
ids_referenciados as (
  select pid from ids_en_ventas
  union
  select pid from ids_en_pedidos
),
plan as (
  select
    m.id_viejo,
    m.nombre_viejo,
    m.plu,
    case
      when ir.pid is not null then 'RENAME'
      else 'DELETE'
    end as accion
  from matches m
  left join ids_referenciados ir on ir.pid = m.id_viejo::text
),
renames as (
  update precios
  set nombre = 'ZZ_DUPLICADO - ' || nombre,
      updated_at = now()
  where id in (select id_viejo from plan where accion = 'RENAME')
  returning id
),
deletes as (
  delete from precios
  where id in (select id_viejo from plan where accion = 'DELETE')
  returning id
)
select
  (select count(*) from renames) as renombrados_zz_duplicado,
  (select count(*) from deletes) as eliminados,
  (select count(*) from plan)    as duplicados_detectados;
