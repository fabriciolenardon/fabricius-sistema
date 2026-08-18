-- ============================================================
-- 95 — MULTI-SUCURSAL: los únicos que faltaban (etapa 3b)
-- ============================================================
-- La 92 dejó dos constraints sin `sucursal_id` a propósito, porque el código
-- hace `upsert` con `onConflict` sobre ellos y los dos cambios tienen que
-- viajar juntos. Este es ese momento: la migración va con su PR de código.
--
-- POR QUÉ URGE stock_snapshots
-- El cierre semanal guarda una foto del stock con `upsert ... on conflict
-- (fecha)`. Con la constraint vieja, el día que Monte Cristo cierre su semana
-- su foto tiene la MISMA fecha que la de la central → el upsert no inserta,
-- PISA la de Río Primero. Se perdería el respaldo del cierre de la central sin
-- que nadie se entere hasta querer auditar la semana.
--
-- conceptos_sueldos es menos grave (los ids de empleado ya son distintos) pero
-- va por el mismo criterio: la clave del negocio incluye de qué negocio es.
--
-- Idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1) stock_snapshots — una foto por sucursal y por fecha
-- ------------------------------------------------------------
ALTER TABLE stock_snapshots DROP CONSTRAINT IF EXISTS stock_snapshots_fecha_key;
ALTER TABLE stock_snapshots DROP CONSTRAINT IF EXISTS stock_snapshots_sucursal_fecha_key;
ALTER TABLE stock_snapshots
  ADD CONSTRAINT stock_snapshots_sucursal_fecha_key UNIQUE (sucursal_id, fecha);


-- ------------------------------------------------------------
-- 2) conceptos_sueldos — aguinaldo y vacaciones por sucursal
-- ------------------------------------------------------------
ALTER TABLE conceptos_sueldos DROP CONSTRAINT IF EXISTS conceptos_sueldos_mes_empleado_id_tipo_key;
ALTER TABLE conceptos_sueldos DROP CONSTRAINT IF EXISTS conceptos_sueldos_sucursal_mes_empleado_tipo_key;
ALTER TABLE conceptos_sueldos
  ADD CONSTRAINT conceptos_sueldos_sucursal_mes_empleado_tipo_key
  UNIQUE (sucursal_id, mes, empleado_id, tipo);


-- ------------------------------------------------------------
-- 3) VERIFICACIÓN
-- ------------------------------------------------------------
-- El upsert de la app no manda `sucursal_id`: lo completa el trigger
-- `trg_set_sucursal_id` (migración 94), que corre ANTES de que Postgres
-- resuelva el ON CONFLICT. Por eso el conflicto se evalúa ya con la sucursal
-- puesta y cada negocio pisa solamente su propia fila.
-- ------------------------------------------------------------

SELECT 'unico de stock_snapshots' AS control, pg_get_constraintdef(oid) AS resultado
  FROM pg_constraint WHERE conname='stock_snapshots_sucursal_fecha_key'
UNION ALL
SELECT 'unico de conceptos_sueldos', pg_get_constraintdef(oid)
  FROM pg_constraint WHERE conname='conceptos_sueldos_sucursal_mes_empleado_tipo_key'
UNION ALL
SELECT 'quedo el unico viejo de fecha', count(*)::text FROM pg_constraint
  WHERE conname='stock_snapshots_fecha_key';

-- Esperado:
--   unico de stock_snapshots ....... UNIQUE (sucursal_id, fecha)
--   unico de conceptos_sueldos ..... UNIQUE (sucursal_id, mes, empleado_id, tipo)
--   quedo el unico viejo de fecha .. 0


-- ============================================================
-- SIGUE PENDIENTE: config_sistema
-- ============================================================
-- Es el tercero de la lista de la 92 y NO se toca acá. Su PK es `clave`, y
-- cambiarla obliga a rehacer también las 8 lecturas del código, que son
-- `.eq('clave', X).maybeSingle()` — y `maybeSingle()` TIRA ERROR apenas haya
-- dos filas con la misma clave.
--
-- No corre apuro: de las 5 claves, 3 son de la central igual (promo_mundial,
-- ean13_formato, tope_gastos_socios) y las otras 2 (caja_config,
-- merma_conversion) hoy las comparten. El costo mientras tanto es que el
-- ticket de Monte Cristo lleva los datos de Río Primero y que la merma de
-- conversión es la de la central. Molesto, no peligroso.
--
-- Cuando se haga, la forma es UNIQUE NULLS NOT DISTINCT (clave, sucursal_id)
-- —Postgres 17 lo soporta— con NULL = "vale para todas", más un helper que
-- resuelva "la fila de mi sucursal, y si no hay, la global".
-- ============================================================
