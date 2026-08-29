-- ============================================================
-- 133 — SALAMES: EL QUESO SE DESGLOSA EN HOLANDA Y ROCKEFORD
-- ============================================================
-- Fabricio (29/08/2026): en Elaborar Salames quiere cargar POR SEPARADO los
-- kilos de Queso Holanda y de Queso Rockeford que entran a la pasta (los dos
-- suman a la materia prima). Antes había un solo campo de queso (kg_queso),
-- que encima solo aparecía si ya habías cargado kg frescos del Holanda — y
-- la pasta se carga primero, así que en la práctica no se veía nunca.
--
-- `kg_queso` NO se toca: sigue existiendo y desde ahora guarda la SUMA de
-- los dos (compatibilidad con historial, mermas y elaboraciones viejas).
-- El desglose vive en las dos columnas nuevas. El queso no descuenta stock
-- (no hay bucket de queso), igual que siempre.
--
-- ⚠️ YA APLICADA: se corrió en la base el 29/08/2026. El archivo queda como
-- registro. Idempotente.
-- ============================================================

ALTER TABLE elaboraciones_embutidos ADD COLUMN IF NOT EXISTS kg_queso_holanda numeric DEFAULT 0;
ALTER TABLE elaboraciones_embutidos ADD COLUMN IF NOT EXISTS kg_queso_rockeford numeric DEFAULT 0;

-- Verificación:
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'elaboraciones_embutidos' AND column_name LIKE 'kg_queso%'
ORDER BY column_name;
