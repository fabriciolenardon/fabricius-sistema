-- ============================================================
-- MIGRACIÓN 33: kg_por_unidad en precios
-- ============================================================
-- Para productos que se venden por UNIDAD (cajones de pollo,
-- cajones de rebozado) necesitamos saber cuántos kg pesa cada
-- unidad para descontar correctamente del stock del producto base.
--
-- Ej: producto "Cajón Suprema B 20kg", categoría 'pollo_cajon',
--     kg_por_unidad = 20. Al vender 3 cajones, el stock de 'pollo'
--     baja 60 kg.
--
-- Antes el sistema parseaba el nombre buscando "X20KG" — frágil
-- si el nombre cambia. Ahora es un campo explícito en precios.
-- El parseo del nombre queda como fallback por compatibilidad.
-- ============================================================

ALTER TABLE precios ADD COLUMN IF NOT EXISTS kg_por_unidad NUMERIC;

COMMENT ON COLUMN precios.kg_por_unidad IS
'Peso en kg de cada unidad para productos vendidos por cajón / unidad. NULL si no aplica (productos por kg). Se usa al descontar stock del producto base (ej: pollo, rebozado).';

-- ============================================================
-- BACKFILL: mejor-esfuerzo de parseo de nombres existentes
-- ============================================================
-- Para productos con categoría pollo_cajon o rebozado_cajon que
-- todavía no tienen kg_por_unidad, intentamos extraer el número
-- del nombre buscando patrones tipo "X20KG", "X14KG", "20 KG", etc.
-- ============================================================

UPDATE precios
SET kg_por_unidad = (
  -- Match "X20KG", "X20 KG", "X 20 KG", "X 20KG" — captura el número
  SELECT (regexp_matches(UPPER(nombre), 'X\s*(\d+(?:[.,]\d+)?)\s*KG', 'i'))[1]::numeric
)
WHERE categoria IN ('pollo_cajon', 'rebozado_cajon', 'bovino_caja_cb', 'bovino_caja_pt')
  AND kg_por_unidad IS NULL
  AND UPPER(nombre) ~ 'X\s*\d+(?:[.,]\d+)?\s*KG';

-- Segundo intento: patrón genérico "N KG" o "NKG" (sin la X)
UPDATE precios
SET kg_por_unidad = (
  SELECT (regexp_matches(UPPER(nombre), '(\d+(?:[.,]\d+)?)\s*KG', 'i'))[1]::numeric
)
WHERE categoria IN ('pollo_cajon', 'rebozado_cajon', 'bovino_caja_cb', 'bovino_caja_pt')
  AND kg_por_unidad IS NULL
  AND UPPER(nombre) ~ '\d+(?:[.,]\d+)?\s*KG';

-- ============================================================
-- VERIFICACIÓN: cuántos productos quedaron con kg_por_unidad cargado
-- vs cuántos quedaron en NULL (el admin tendrá que cargarlos manualmente
-- desde Precios después de aplicar la migración).
-- ============================================================
SELECT categoria,
       COUNT(*) AS total,
       COUNT(kg_por_unidad) AS con_kg_por_unidad,
       COUNT(*) - COUNT(kg_por_unidad) AS pendientes
FROM precios
WHERE categoria IN ('pollo_cajon', 'rebozado_cajon', 'bovino_caja_cb', 'bovino_caja_pt')
GROUP BY categoria
ORDER BY categoria;
