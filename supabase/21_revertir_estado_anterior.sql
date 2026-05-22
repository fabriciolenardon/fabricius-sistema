-- ============================================================
-- MIGRACIÓN 21: REVERTIR todo al estado anterior
-- ============================================================
-- Fabri quiere volver al estado que tenía antes de la migración 14:
--   - SIN productos duplicados (los 75 que la 14 insertó del PDF)
--   - SIN PLU asignado a ningún producto (los 1-106 deben quedar libres)
--   - CON sus productos originales del sistema intactos, con sus precios
--
-- Lógica:
--   1. Identificar productos con codigo_balanza 1-106 que tengan un primo
--      sin PLU con nombre similar (esos son los que yo inserté → BORRAR).
--   2. Para los productos con codigo_balanza 1-106 que NO tienen primo
--      similar (son productos del sistema que solo recibieron PLU) →
--      DESASIGNAR el PLU (set null), conservar el producto.
--
-- Resultado final: ningún producto con codigo_balanza 1-106. Fabri va a
-- asignar los PLU manualmente desde la UI de Precios cuando quiera.
--
-- ⚠️  ATENCIÓN: los precios que la migración 17 cargó en productos del
-- sistema (los 31 actualizados) quedan, no se pueden revertir sin backup.
-- Si esos precios son los correctos (porque vienen del PDF), no hay
-- problema. Si no, hay que revisarlos a mano después.
-- ============================================================

with
con_plu as (
  select id, nombre,
         upper(regexp_replace(trim(nombre), '\s+', ' ', 'g')) as nn
  from precios
  where codigo_balanza between 1 and 106
),
sin_plu as (
  select id, nombre,
         upper(regexp_replace(trim(nombre), '\s+', ' ', 'g')) as nn
  from precios
  where codigo_balanza is null
    and nombre not like 'ZZ_%'
),
-- IDs de productos con PLU que TIENEN duplicado en los sin-PLU
ids_duplicados_a_borrar as (
  select distinct cp.id
  from con_plu cp
  join sin_plu sp on (
    cp.nn = sp.nn
    or cp.nn like sp.nn || '-%' or cp.nn like sp.nn || ' %' or cp.nn like sp.nn || '/%' or cp.nn like sp.nn || ' (%'
    or sp.nn like cp.nn || '-%' or sp.nn like cp.nn || ' %' or sp.nn like cp.nn || '/%' or sp.nn like cp.nn || ' (%'
  )
),
-- Desasignar PLU a los productos del sistema (con PLU pero sin duplicado)
desligar as (
  update precios
  set codigo_balanza = null, updated_at = now()
  where codigo_balanza between 1 and 106
    and id not in (select id from ids_duplicados_a_borrar)
  returning id
),
-- Borrar los duplicados (los que yo inserté con la mig 14)
borrar as (
  delete from precios
  where id in (select id from ids_duplicados_a_borrar)
  returning id
)
select
  (select count(*) from desligar)                                      as plus_desasignados,
  (select count(*) from borrar)                                        as duplicados_borrados,
  (select count(*) from precios where codigo_balanza between 1 and 106) as deberia_ser_cero;
