-- =====================================================================
-- 139 — PLANILLAS DE RINDE: que cada boca vea las suyas
-- =====================================================================
-- La policy de lectura era `USING (true)`: CUALQUIER usuario logueado leía
-- todas las planillas, incluidos los clientes mayoristas que entran al portal.
-- No hay precios ahí, pero sí los kilos y el rinde de cada desposte de la
-- casa — información que no tiene por qué salir del negocio.
--
-- La escritura ya estaba bien (sólo es_central()), así que esto no cambia
-- quién puede cargar una planilla: sólo quién la lee.
--
-- La central sigue viéndolas todas, para poder controlar las de las bocas.
-- Un cliente mayorista tiene sucursal_id NULL, y `NULL = mi_sucursal()` no es
-- TRUE, así que deja de ver cualquier fila.
-- =====================================================================

DROP POLICY IF EXISTS planillas_rinde_lectura ON planillas_rinde;
CREATE POLICY planillas_rinde_lectura ON planillas_rinde
  FOR SELECT USING (sucursal_id = mi_sucursal() OR es_central());

COMMENT ON TABLE planillas_rinde IS
  'Planillas de rinde por desposte. Cada boca ve las suyas; la central ve todas. Sólo la central puede cargarlas.';
