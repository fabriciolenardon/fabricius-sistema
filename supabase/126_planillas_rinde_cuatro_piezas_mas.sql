-- ============================================================
-- 126 — CUATRO PLANILLAS DE RINDE MÁS
-- ============================================================
-- Pedido de Fabricio (27/08/2026): agregar a Planillas de rinde el CORTITO,
-- el CARRÉ CON LOMO, el COSTILLAR COMPLETO y la PALETA ENTERA BOVINA. Los
-- cortes de cada una los carga él (y quedan recordados de la última planilla
-- guardada — ver cargarHistorial en PlanillasRinde.jsx).
--
-- Las cuatro apuntan a piezas que YA existen en Mermas por producto:
--   cortito    → Cortito
--   carre_lomo → Costeletal con Lomo  («carré con lomo» es como le dice él)
--   costillar  → Costillar Completo
--   paleta     → Paleta
--
-- Sólo hay que ampliar el CHECK de `tipo`; el resto es pantalla.
-- Idempotente.
-- ============================================================

ALTER TABLE planillas_rinde DROP CONSTRAINT IF EXISTS planillas_rinde_tipo_check;
ALTER TABLE planillas_rinde ADD CONSTRAINT planillas_rinde_tipo_check
  CHECK (tipo IN ('media_res','capon','pierna','parrillero',
                  'cortito','carre_lomo','costillar','paleta'));


-- Verificación
SELECT conname, pg_get_constraintdef(oid) AS definicion
  FROM pg_constraint
 WHERE conrelid = 'planillas_rinde'::regclass AND conname = 'planillas_rinde_tipo_check';
