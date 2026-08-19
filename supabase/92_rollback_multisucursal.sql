-- ============================================================
-- 92 ROLLBACK — deshacer los cimientos multi-sucursal
-- ============================================================
-- NO CORRER salvo que la 92 haya salido mal y haya que volver al estado
-- anterior. Deja la base exactamente como estaba antes de la 92.
--
-- SEGURO DE CORRER MIENTRAS MONTE CRISTO NO OPERE. Si ya cargaron datos
-- con sucursal_id = 3, esto los deja sin la marca de a quién pertenecen y
-- se mezclan con los de la central — irreversible. El chequeo de abajo
-- aborta solo si detecta que eso pasó.
-- ============================================================


-- ------------------------------------------------------------
-- 0) FRENO DE MANO
-- ------------------------------------------------------------
-- Si alguna tabla ya tiene filas fuera de la central, no seguir.
DO $$
DECLARE
  t text;
  n bigint;
  total bigint := 0;
  tablas text[] := ARRAY[
    'stock_actual', 'medias_stock', 'piezas_stock', 'cajas_stock',
    'entradas_deposito', 'salidas_deposito', 'despostes',
    'elaboraciones_embutidos', 'stock_snapshots',
    'ventas_minoristas', 'arqueos_caja',
    'clientes', 'movimientos_ctacte', 'remitos', 'presupuestos',
    'ofertas', 'combos_venta',
    'proveedores', 'movimientos_proveedores', 'compras_proveedores',
    'pagos_proveedores',
    'gastos', 'empleados_sueldos', 'liquidaciones_sueldos', 'conceptos_sueldos',
    'cierres_semanales', 'meses_operativos',
    'auditoria_log'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE sucursal_id <> 1', t) INTO n;
    total := total + n;
  END LOOP;

  IF total > 0 THEN
    RAISE EXCEPTION
      'ABORTADO: hay % filas de una sucursal que no es la central. Revertir ahora las mezclaría con las de Río Primero. Revisar a mano antes de seguir.', total;
  END IF;
END $$;


-- ------------------------------------------------------------
-- 1) Volver el UNIQUE de stock_actual a como estaba
-- ------------------------------------------------------------
ALTER TABLE stock_actual DROP CONSTRAINT IF EXISTS stock_actual_sucursal_tipo_key;
ALTER TABLE stock_actual DROP CONSTRAINT IF EXISTS stock_actual_tipo_key;
ALTER TABLE stock_actual ADD CONSTRAINT stock_actual_tipo_key UNIQUE (tipo);


-- ------------------------------------------------------------
-- 2) Sacar precios_sucursal
-- ------------------------------------------------------------
DROP TABLE IF EXISTS precios_sucursal;


-- ------------------------------------------------------------
-- 3) Sacar sucursal_id de las 28 tablas + config_sistema
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'stock_actual', 'medias_stock', 'piezas_stock', 'cajas_stock',
    'entradas_deposito', 'salidas_deposito', 'despostes',
    'elaboraciones_embutidos', 'stock_snapshots',
    'ventas_minoristas', 'arqueos_caja',
    'clientes', 'movimientos_ctacte', 'remitos', 'presupuestos',
    'ofertas', 'combos_venta',
    'proveedores', 'movimientos_proveedores', 'compras_proveedores',
    'pagos_proveedores',
    'gastos', 'empleados_sueldos', 'liquidaciones_sueldos', 'conceptos_sueldos',
    'cierres_semanales', 'meses_operativos',
    'auditoria_log',
    'config_sistema'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_sucursal_id_fkey');
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS sucursal_id', t);
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- 4) Soltar la FK de profiles y vaciar sucursales
-- ------------------------------------------------------------
-- `profiles.sucursal_id` NO se borra: existía desde antes de la 92, con el
-- valor 2 colgado del perfil de Roxana. Se deja igual que estaba.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_sucursal_id_fkey;

DELETE FROM sucursales WHERE id IN (1, 2, 3);
SELECT setval('sucursales_id_seq', 1, false);


-- ------------------------------------------------------------
-- 5) Verificación
-- ------------------------------------------------------------
SELECT 'tablas con sucursal_id' AS control, count(*)::text AS resultado
  FROM information_schema.columns
  WHERE table_schema = 'public' AND column_name = 'sucursal_id'
UNION ALL
SELECT 'filas en sucursales', count(*)::text FROM sucursales
UNION ALL
SELECT 'unique de stock_actual', pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conname = 'stock_actual_tipo_key';

-- Esperado:
--   tablas con sucursal_id ... 1  (solo profiles, como antes)
--   filas en sucursales ...... 0
--   unique de stock_actual ... UNIQUE (tipo)
