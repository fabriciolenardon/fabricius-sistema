-- ============================================================
-- 130 — EL PORTAL DESPOSTE CARGA LAS PLANILLAS DE RINDE
-- ============================================================
-- Pedido de Fabricio (28/08/2026): el rinde se hace EN el desposte — ellos
-- pesan cada pieza — así que la carga va donde está la balanza. Hasta ahora
-- la escritura de `planillas_rinde` exigía is_admin() (mig 123) y el usuario
-- desposte@fabricius.com no lo es.
--
-- QUÉ SE LE ABRE (y nada más):
--   · CREAR planillas de rinde. No editar ni borrar: borrar sigue siendo del
--     CEO (el botón ni le aparece en pantalla, y la base tampoco lo deja).
--   · Actualizar SOLO la fila `merma_conversion` de config_sistema — es lo
--     que hace la regla "la última planilla manda el %". Ninguna otra clave:
--     verificado impersonándolo, un UPDATE al resto de config devuelve 0
--     filas.
--
-- `is_desposte() AND es_central()`: el helper de rol ya existía, y es_central
-- va de cinturón por si algún día una sucursal tiene su propio usuario de
-- desposte — las planillas son de la central.
--
-- Idempotente.
-- ============================================================

DROP POLICY IF EXISTS planillas_rinde_desposte_insert ON planillas_rinde;
CREATE POLICY planillas_rinde_desposte_insert ON planillas_rinde
  FOR INSERT TO authenticated
  WITH CHECK (is_desposte() AND es_central());

DROP POLICY IF EXISTS config_merma_desposte ON config_sistema;
CREATE POLICY config_merma_desposte ON config_sistema
  FOR UPDATE TO authenticated
  USING (is_desposte() AND clave = 'merma_conversion')
  WITH CHECK (is_desposte() AND clave = 'merma_conversion');


-- Verificación
SELECT policyname, cmd FROM pg_policies
 WHERE tablename IN ('planillas_rinde', 'config_sistema')
   AND policyname IN ('planillas_rinde_desposte_insert', 'config_merma_desposte');
