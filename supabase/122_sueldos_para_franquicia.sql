-- ============================================================
-- 122 — LA FRANQUICIA LIQUIDA SUS PROPIOS SUELDOS
-- ============================================================
-- Pedido de Fabricio (26/08/2026): que Alvear (Roxana) también tenga la
-- pantalla de Sueldos, como ya la tienen la central y Monte Cristo.
--
-- POR QUÉ NO ALCANZABA CON AGREGAR EL LINK
-- Las 4 tablas que usa Sueldos tienen hoy dos capas:
--   · PERMISIVA   `is_admin()`  → admin Y sucursal (is_admin incluye 'sucursal')
--   · RESTRICTIVA `is_cliente_mayorista() OR is_franquicia()
--                  OR sucursal_id = mi_sucursal()`
-- El rol `franquicia` NO pasa la permisiva, así que Roxana no lee ni una fila:
-- la pantalla le saldría vacía y cualquier alta le daría error de RLS.
--
-- Y OJO CON LA RESTRICTIVA
-- Esa capa lleva `OR is_franquicia()`, que para Roxana da TRUE en TODAS las
-- filas — es la válvula que usan los portales de cliente y franquicia en otras
-- tablas. O sea: la restrictiva NO la aísla. El aislamiento tiene que venir de
-- la policy nueva, y por eso lleva `sucursal_id = mi_sucursal()` adentro. Sin
-- esa condición, Roxana vería los sueldos de la central y de Monte Cristo.
--
-- CÓMO QUEDA
-- Permisiva nueva: `is_franquicia() AND sucursal_id = mi_sucursal()`.
-- Combinada con la restrictiva (que para ella es TRUE), el resultado es
-- exactamente sus propias filas — ni una de otra boca.
--
-- El `sucursal_id` al insertar lo pone solo el trigger `set_sucursal_id`
-- (BEFORE INSERT → `mi_sucursal()`), que corre ANTES del WITH CHECK.
--
-- meses_operativos va SOLO LECTURA: Sueldos lo lee para agrupar el historial
-- por mes operativo, pero abrir y cerrar meses se hace en Cierre, que la
-- franquicia no tiene.
--
-- No toca las policies existentes: agrega. La central y Monte Cristo siguen
-- igual.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- Las tres tablas que la franquicia escribe
-- ------------------------------------------------------------
DROP POLICY IF EXISTS franquicia_sus_empleados   ON empleados_sueldos;
CREATE POLICY franquicia_sus_empleados ON empleados_sueldos
  FOR ALL TO authenticated
  USING      (is_franquicia() AND sucursal_id = mi_sucursal())
  WITH CHECK (is_franquicia() AND sucursal_id = mi_sucursal());

DROP POLICY IF EXISTS franquicia_sus_liquidaciones ON liquidaciones_sueldos;
CREATE POLICY franquicia_sus_liquidaciones ON liquidaciones_sueldos
  FOR ALL TO authenticated
  USING      (is_franquicia() AND sucursal_id = mi_sucursal())
  WITH CHECK (is_franquicia() AND sucursal_id = mi_sucursal());

DROP POLICY IF EXISTS franquicia_sus_conceptos ON conceptos_sueldos;
CREATE POLICY franquicia_sus_conceptos ON conceptos_sueldos
  FOR ALL TO authenticated
  USING      (is_franquicia() AND sucursal_id = mi_sucursal())
  WITH CHECK (is_franquicia() AND sucursal_id = mi_sucursal());

-- ------------------------------------------------------------
-- El calendario del mes operativo: sólo lectura
-- ------------------------------------------------------------
DROP POLICY IF EXISTS franquicia_ve_sus_meses ON meses_operativos;
CREATE POLICY franquicia_ve_sus_meses ON meses_operativos
  FOR SELECT TO authenticated
  USING (is_franquicia() AND sucursal_id = mi_sucursal());
