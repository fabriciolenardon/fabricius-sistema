-- ============================================================
-- MIGRACIÓN 36: precios.vende_por_pieza
-- ============================================================
-- Algunos productos de categoría bovino_pieza se venden como pieza
-- ENTERA (cada pieza tiene su peso individual y se elige del stock,
-- como ya hacemos con cajas CB/PT). Otros se venden por kg (pieza
-- ya despostada en cortes que se pesan a la balanza).
--
-- Para distinguir, agregamos un flag que el admin marca en /admin/precios:
--   - TRUE  → al venderse en Caja o Mayorista, abre el selector de
--             piezas_stock individuales
--   - FALSE → flujo normal por kg (input de cantidad libre)
--
-- Las cajas CB/PT NO necesitan este flag — la categoría ya las
-- identifica unívocamente como ventas por unidad individual.
-- ============================================================

ALTER TABLE precios ADD COLUMN IF NOT EXISTS vende_por_pieza BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN precios.vende_por_pieza IS
'Si TRUE, el producto se vende eligiendo una pieza específica del stock individual (piezas_stock). Cada pieza tiene su propio peso. Si FALSE, se vende por kg (cantidad libre).';

-- Índice para acelerar queries del estilo "productos que venden por pieza"
CREATE INDEX IF NOT EXISTS idx_precios_vende_por_pieza
  ON precios(vende_por_pieza) WHERE vende_por_pieza = TRUE;

-- ============================================================
-- VERIFICACIÓN: cuántos productos quedaron marcados (debería ser 0
-- en una primera migración — el admin tiene que activar el flag uno
-- por uno desde /admin/precios).
-- ============================================================
SELECT
  COUNT(*) FILTER (WHERE vende_por_pieza = TRUE) AS productos_por_pieza,
  COUNT(*) FILTER (WHERE categoria = 'bovino_pieza') AS productos_bovino_pieza_total
FROM precios;
