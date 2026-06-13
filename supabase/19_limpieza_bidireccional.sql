-- ============================================================
-- MIGRACIÓN 19: Limpieza inteligente bidireccional de duplicados
-- ============================================================
-- Detecta pares de productos duplicados con matching BIDIRECCIONAL:
--   - viejo ⊂ nuevo  (ej: "JAMON CUADRADO"  ⊂ "JAMON CUADRADO-BOLA DE LOMO...")
--   - nuevo ⊂ viejo  (ej: "ASADO VENTANA"   ⊂ "ASADO VENTANA (LINEA DORADA)")
--   - igualdad exacta tras normalizar mayúsculas/espacios
--
-- Regla de decisión: SE QUEDA EL DE NOMBRE MÁS LARGO. Si el ganador no tiene
-- PLU asignado, se le migra el PLU del perdedor. Después se elimina (o renombra
-- a "ZZ_DUPLICADO" si tiene historial en ventas/pedidos) el perdedor.
--
-- Esta regla resuelve los dos patrones observados:
--   - PDF tiene el nombre más completo  → se queda el del PDF (con su PLU)
--   - Sistema tiene el nombre con "(LINEA DORADA)" o anotaciones → se queda
--     el del sistema y recibe el PLU del PDF
--
-- Se usa una tabla PERSISTENTE (_temp_limpieza_19) para mantener el plan entre
-- statements, porque Supabase SQL Editor no preserva tablas temporales.
-- ============================================================

-- PASO 1: borrar tabla del plan si quedó de una corrida anterior
drop table if exists _temp_limpieza_19;

-- PASO 2: armar el plan completo en una tabla persistente
create table _temp_limpieza_19 as
with
todos as (
  select id,
         nombre,
         codigo_balanza,
         upper(regexp_replace(trim(nombre), '\s+', ' ', 'g')) as nn,
         length(upper(regexp_replace(trim(nombre), '\s+', ' ', 'g'))) as len_nn
  from precios
  where nombre not like 'ZZ_%'
),
pares as (
  select
    a.id as id_a, a.nombre as nombre_a, a.codigo_balanza as plu_a, a.len_nn as len_a,
    b.id as id_b, b.nombre as nombre_b, b.codigo_balanza as plu_b, b.len_nn as len_b
  from todos a
  join todos b on a.id < b.id  -- evitar pares espejo (A-B y B-A)
  where (
    -- exactamente iguales tras normalizar
    a.nn = b.nn
    -- a es subcadena al inicio de b (con separador)
    or b.nn like a.nn || '-%' or b.nn like a.nn || ' %' or b.nn like a.nn || '/%' or b.nn like a.nn || ' (%'
    -- b es subcadena al inicio de a
    or a.nn like b.nn || '-%' or a.nn like b.nn || ' %' or a.nn like b.nn || '/%' or a.nn like b.nn || ' (%'
  )
  -- al menos uno tiene que tener PLU (los demás duplicados los ignoramos)
  and (a.codigo_balanza is not null or b.codigo_balanza is not null)
  -- no fusionar dos productos que AMBOS tengan PLU (son PLUs distintos legítimos)
  and not (a.codigo_balanza is not null and b.codigo_balanza is not null)
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
)
select
  -- Ganador: el de nombre más largo
  case when p.len_a >= p.len_b then p.id_a else p.id_b end as id_ganador,
  case when p.len_a >= p.len_b then p.nombre_a else p.nombre_b end as nombre_ganador,
  case when p.len_a >= p.len_b then p.plu_a else p.plu_b end as plu_ganador,
  -- Perdedor: el otro
  case when p.len_a >= p.len_b then p.id_b else p.id_a end as id_perdedor,
  case when p.len_a >= p.len_b then p.nombre_b else p.nombre_a end as nombre_perdedor,
  case when p.len_a >= p.len_b then p.plu_b else p.plu_a end as plu_perdedor,
  -- ¿El perdedor tiene historial? Decide si DELETE o RENAME
  case
    when ir.pid is not null then 'RENAME'
    else 'DELETE'
  end as accion_perdedor
from pares p
left join ids_referenciados ir
  on ir.pid = (case when p.len_a >= p.len_b then p.id_b else p.id_a end)::text;

-- PASO 3: mostrar el plan para ver qué va a pasar
select id_ganador, nombre_ganador, plu_ganador,
       id_perdedor, nombre_perdedor, plu_perdedor,
       accion_perdedor
from _temp_limpieza_19
order by coalesce(plu_ganador, plu_perdedor);

-- PASO 4: quitar el PLU del perdedor (en los casos donde el ganador no tiene PLU)
-- Es necesario antes de asignarlo al ganador por el unique constraint.
update precios
set codigo_balanza = null
where id in (
  select id_perdedor from _temp_limpieza_19
  where plu_ganador is null and plu_perdedor is not null
);

-- PASO 5: asignar el PLU liberado al ganador
update precios p
set codigo_balanza = pl.plu_perdedor,
    updated_at = now()
from _temp_limpieza_19 pl
where p.id = pl.id_ganador
  and pl.plu_ganador is null
  and pl.plu_perdedor is not null;

-- PASO 6: renombrar perdedores con historial (no se pueden borrar)
update precios
set nombre = 'ZZ_DUPLICADO - ' || nombre,
    updated_at = now()
where id in (
  select id_perdedor from _temp_limpieza_19 where accion_perdedor = 'RENAME'
);

-- PASO 7: borrar perdedores sin historial (limpieza definitiva)
delete from precios
where id in (
  select id_perdedor from _temp_limpieza_19 where accion_perdedor = 'DELETE'
);

-- PASO 8: reporte final
select
  (select count(*) from _temp_limpieza_19 where plu_ganador is null and plu_perdedor is not null) as plus_migrados,
  (select count(*) from _temp_limpieza_19 where accion_perdedor = 'RENAME') as renombrados,
  (select count(*) from _temp_limpieza_19 where accion_perdedor = 'DELETE') as eliminados,
  (select count(*) from _temp_limpieza_19) as duplicados_procesados;

-- PASO 9: limpiar tabla de trabajo
drop table _temp_limpieza_19;
