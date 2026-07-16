-- ============================================================
-- 85: ELABORACIÓN DE HAMBURGUESAS + STOCK PROPIO
-- ============================================================
-- Nuevo módulo "Elaborar hamburguesas" en Depósito → Elaborar
-- (mismo modelo que embutidos, mig 60): cada tipo tiene su bucket
-- propio en stock_actual; la elaboración suma acá y la venta lo
-- descuenta vía precios.stock_origen.
--
--   hamb_carne → Hamburguesas de carne (origen: bovino_corte)
--   hamb_pollo → Hamburguesas de pollo (origen: supremas B → bucket 'pollo')
--   hamb_cerdo → Hamburguesas de cerdo (origen: piezas de cerdo elegidas)
--
-- Las elaboraciones se registran en elaboraciones_embutidos con
-- tipo = 'hamburguesa' (no hace falta ALTER: tipo es varchar libre).
-- Idempotente: se puede correr más de una vez.
-- ============================================================

-- Buckets nuevos en stock_actual (arrancan en 0)
INSERT INTO stock_actual (tipo, kg_disponible)
SELECT v.t, 0 FROM (VALUES
  ('hamb_carne'),
  ('hamb_pollo'),
  ('hamb_cerdo')
) AS v(t)
WHERE NOT EXISTS (SELECT 1 FROM stock_actual s WHERE s.tipo = v.t);

-- Ventas: los productos de hamburguesa descuentan su propio bucket
-- (la caja y las salidas mayoristas priorizan stock_origen sobre la
-- categoría). Incluye las rellenas: salen de la misma masa elaborada.
UPDATE precios SET stock_origen = 'hamb_carne'
  WHERE categoria = 'bovino_corte' AND nombre ILIKE 'HAMBURGUESA DE CARNE%';
UPDATE precios SET stock_origen = 'hamb_pollo'
  WHERE categoria = 'pollo' AND (nombre ILIKE 'Hamburguesa de Pollo%' OR nombre ILIKE 'Hamburguesa Rellena%');
-- La de cerdo hoy descuenta carnaza (cerdo_parrillero); pasa al bucket propio
UPDATE precios SET stock_origen = 'hamb_cerdo'
  WHERE categoria = 'cerdo_corte' AND nombre ILIKE 'Hamburguesa de cerdo%';
