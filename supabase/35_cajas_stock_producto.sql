-- ============================================================
-- MIGRACIÓN 35: cajas_stock con producto_id
-- ============================================================
-- Las cajas CB/PT vienen con contenidos específicos (Bola de Lomo,
-- Paleta con Chingolo, Cuadril Completo, etc). Para que el selector
-- de venta muestre SOLO las cajas del producto que el cliente pidió,
-- cada caja se vincula al producto correspondiente en la tabla precios.
--
-- Las cajas viejas que no tengan producto_id (legacy de migración 34)
-- aparecen en el selector como "genéricas" para no romper compatibilidad.
-- ============================================================

ALTER TABLE cajas_stock ADD COLUMN IF NOT EXISTS producto_id UUID;
COMMENT ON COLUMN cajas_stock.producto_id IS
'Producto de la tabla precios al que pertenece esta caja (ej. "Bola de Lomo Caja PT"). NULL para cajas legacy sin asignar.';

-- Índice para acelerar el selector "cajas disponibles de producto X"
CREATE INDEX IF NOT EXISTS idx_cajas_stock_producto_estado
  ON cajas_stock(producto_id, estado) WHERE estado = 'disponible';

-- ============================================================
-- VERIFICACIÓN: cuántas cajas hay y cuántas tienen producto asignado.
-- ============================================================
SELECT
  COUNT(*) AS total_cajas,
  COUNT(producto_id) AS con_producto_asignado,
  COUNT(*) - COUNT(producto_id) AS sin_producto_asignado,
  SUM(kg) FILTER (WHERE estado = 'disponible') AS kg_disponibles_total
FROM cajas_stock;
