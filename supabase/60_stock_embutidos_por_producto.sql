-- ============================================================
-- 60: STOCK DE EMBUTIDOS POR PRODUCTO
-- ============================================================
-- Hasta ahora toda la elaboración propia caía en un único bucket
-- 'embutido' de stock_actual. Se desglosa por producto terminado
-- (modelo "cerdo piezas": un bucket por producto, las ventas lo
-- descuentan vía precios.stock_origen).
--
--   emb_chorizo_parrillero  → CHORIZO (parrillero común)
--   emb_chorizo_saborizado  → CHORIZO SABORIZADO
--   emb_salchicha_parrillera→ Salchicha Parrillera x kg
--   emb_salame              → Salame Casero (env. y sin env.; los 3
--                             tipos de elaboración comparten bucket)
--
-- El bucket 'embutido' QUEDA para los comprados / sin clasificar
-- (morcilla, jamón crudo, etc.) y conserva su saldo actual; si parte
-- de ese saldo es elaboración propia vieja, se redistribuye a mano
-- desde Depósito → Ajuste Stock. Los tableros muestran como total de
-- embutidos la suma de 'embutido' + 'emb_%'.
-- Idempotente: se puede correr más de una vez.
-- ============================================================

-- Desglose de productos terminados de cada elaboración:
-- [{"tipo":"chorizo_parrillero","kg":80.5}, ...]
ALTER TABLE elaboraciones_embutidos
  ADD COLUMN IF NOT EXISTS productos_finales jsonb;

-- Buckets nuevos en stock_actual (arrancan en 0)
INSERT INTO stock_actual (tipo, kg_disponible)
SELECT v.t, 0 FROM (VALUES
  ('emb_chorizo_parrillero'),
  ('emb_chorizo_saborizado'),
  ('emb_salchicha_parrillera'),
  ('emb_salame')
) AS v(t)
WHERE NOT EXISTS (SELECT 1 FROM stock_actual s WHERE s.tipo = v.t);

-- Ventas: cada producto de elaboración propia descuenta su propio bucket
-- (la caja y las salidas mayoristas priorizan stock_origen sobre la categoría)
UPDATE precios SET stock_origen = 'emb_chorizo_parrillero'
  WHERE categoria = 'embutido' AND nombre = 'CHORIZO';
UPDATE precios SET stock_origen = 'emb_chorizo_saborizado'
  WHERE categoria = 'embutido' AND nombre = 'CHORIZO SABORIZADO';
UPDATE precios SET stock_origen = 'emb_salchicha_parrillera'
  WHERE categoria = 'embutido' AND nombre ILIKE 'Salchicha Parrillera%';
UPDATE precios SET stock_origen = 'emb_salame'
  WHERE categoria = 'embutido' AND nombre ILIKE 'Salame Casero%';
