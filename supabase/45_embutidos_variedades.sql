-- =====================================================
-- MIGRACION 45: VARIEDADES EN ELABORACIÓN DE EMBUTIDOS
-- =====================================================
-- De una misma pasta se separan variedades (parrilleros
-- comunes y saborizados). Guardamos el peso REAL embutido
-- de cada variedad; el TOTAL ELABORADO permite calcular la
-- merma automáticamente (kg carne total vs total embutido).
-- =====================================================

ALTER TABLE elaboraciones_embutidos
  ADD COLUMN IF NOT EXISTS kg_comunes     NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS kg_saborizados NUMERIC(10,2);

COMMENT ON COLUMN elaboraciones_embutidos.kg_comunes IS 'Kg de parrilleros comunes ya embutidos (peso real).';
COMMENT ON COLUMN elaboraciones_embutidos.kg_saborizados IS 'Kg de parrilleros saborizados ya embutidos (peso real).';
