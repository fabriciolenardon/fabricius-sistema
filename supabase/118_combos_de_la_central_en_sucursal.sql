-- ============================================================
-- 118 — LOS COMBOS DE LA CENTRAL SE VENDEN EN LAS SUCURSALES
-- ============================================================
-- La Caja de Monte Cristo no ofrecía ningún combo: los 8 bolsones están
-- cargados en la central y la restrictiva de aislamiento los ataba a su boca.
--
-- Un combo es un bolsón DE LA MARCA, con el precio armado por la central —
-- misma naturaleza que las recetas o la lista de precios. Así que se comparte:
-- toda boca ve los de la central, los vende, y no los toca.
--
-- Se parte por comando, igual que en `ofertas` y `precios_sucursal`: si fuera
-- una sola policy `FOR ALL`, achicar la escritura le sacaría también la
-- lectura y volveríamos al problema original.
--
-- CADA BOCA PUEDE ARMAR LOS SUYOS: un combo con su `sucursal_id` sólo lo ve
-- ella. No se le cierra la puerta, se le suman los de la central.
--
-- Idempotente.
-- ============================================================

DROP POLICY IF EXISTS sucursal_aislamiento ON combos_venta;
CREATE POLICY sucursal_aislamiento ON combos_venta
  AS RESTRICTIVE FOR SELECT TO public
  USING (is_cliente_mayorista() OR is_franquicia()
         OR sucursal_id = 1 OR sucursal_id = mi_sucursal());

DROP POLICY IF EXISTS combos_escritura ON combos_venta;
CREATE POLICY combos_escritura ON combos_venta
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (es_central() OR sucursal_id = mi_sucursal());

DROP POLICY IF EXISTS combos_edicion ON combos_venta;
CREATE POLICY combos_edicion ON combos_venta
  AS RESTRICTIVE FOR UPDATE TO public
  USING      (es_central() OR sucursal_id = mi_sucursal())
  WITH CHECK (es_central() OR sucursal_id = mi_sucursal());

DROP POLICY IF EXISTS combos_borrado ON combos_venta;
CREATE POLICY combos_borrado ON combos_venta
  AS RESTRICTIVE FOR DELETE TO public
  USING (es_central() OR sucursal_id = mi_sucursal());


-- Verificación
SELECT 'combos de la central' AS control, count(*)::text AS resultado
  FROM combos_venta WHERE sucursal_id = 1
UNION ALL
SELECT 'policies restrictivas de combos_venta', count(*)::text
  FROM pg_policies WHERE schemaname='public' AND tablename='combos_venta' AND permissive='RESTRICTIVE';
