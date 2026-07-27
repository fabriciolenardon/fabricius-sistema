-- ============================================================
-- 89: STOCK INDIVIDUAL POR PRODUCTO DE BROSAS
-- ============================================================
-- Cada brosa (chinchulín, hígado, mondongo, etc.) pasa a tener su
-- bucket propio en stock_actual — mismo modelo que embutidos (mig 60)
-- y hamburguesas (mig 85): la entrada de depósito suma al bucket del
-- producto elegido y la venta (caja / mayorista) lo descuenta vía
-- precios.stock_origen. Así el Ajuste de Stock muestra cada brosa por
-- separado y el conteo físico se carga individualmente.
--
-- El bucket genérico 'bovino_brosa' QUEDA como legacy (conserva los kg
-- acumulados hasta hoy): después de aplicar esta migración, repartir
-- esos kg entre los buckets nuevos con un conteo físico en
-- Depósito → Ajuste Stock (cargar cada brosa y dejar el genérico en 0).
--
-- Idempotente: se puede correr más de una vez.
-- ============================================================

-- Buckets nuevos en stock_actual (arrancan en 0)
INSERT INTO stock_actual (tipo, kg_disponible)
SELECT v.t, 0 FROM (VALUES
  ('brosa_chinchulin'),
  ('brosa_corazon'),
  ('brosa_entrana'),
  ('brosa_higado'),
  ('brosa_lengua'),
  ('brosa_molleja'),
  ('brosa_mondongo'),
  ('brosa_rabo'),
  ('brosa_rinon'),
  ('brosa_sesos'),
  ('brosa_tripa_gorda')
) AS v(t)
WHERE NOT EXISTS (SELECT 1 FROM stock_actual s WHERE s.tipo = v.t);

-- Enlazar cada producto de la lista de precios con su bucket propio.
-- (La caja, el ticket manual y las salidas mayoristas priorizan
-- stock_origen sobre la categoría — igual que cerdo_* y emb_*.)
UPDATE precios SET stock_origen = 'brosa_chinchulin'  WHERE categoria = 'bovino_brosa' AND nombre ILIKE 'CHINCHULIN%';
UPDATE precios SET stock_origen = 'brosa_corazon'     WHERE categoria = 'bovino_brosa' AND nombre ILIKE 'CORAZ%';
UPDATE precios SET stock_origen = 'brosa_entrana'     WHERE categoria = 'bovino_brosa' AND nombre ILIKE 'ENTRA%';
UPDATE precios SET stock_origen = 'brosa_higado'      WHERE categoria = 'bovino_brosa' AND nombre ILIKE '%GADO%';
UPDATE precios SET stock_origen = 'brosa_lengua'      WHERE categoria = 'bovino_brosa' AND nombre ILIKE 'LENGUA%';
UPDATE precios SET stock_origen = 'brosa_molleja'     WHERE categoria = 'bovino_brosa' AND nombre ILIKE 'MOLLEJA%';
UPDATE precios SET stock_origen = 'brosa_mondongo'    WHERE categoria = 'bovino_brosa' AND nombre ILIKE 'MONDONGO%';
UPDATE precios SET stock_origen = 'brosa_rabo'        WHERE categoria = 'bovino_brosa' AND nombre ILIKE 'RABO%';
UPDATE precios SET stock_origen = 'brosa_rinon'       WHERE categoria = 'bovino_brosa' AND nombre ILIKE 'RI%ON%';
UPDATE precios SET stock_origen = 'brosa_sesos'       WHERE categoria = 'bovino_brosa' AND nombre ILIKE 'SESOS%';
UPDATE precios SET stock_origen = 'brosa_tripa_gorda' WHERE categoria = 'bovino_brosa' AND nombre ILIKE 'TRIPA%';

-- Control: no debería quedar ninguna brosa sin bucket. Si esta consulta
-- devuelve filas, asignarles el stock_origen a mano en Precios → Admin
-- (el selector ahora lista los buckets brosa_*).
SELECT id, nombre FROM precios
WHERE categoria = 'bovino_brosa' AND stock_origen IS NULL AND NOT stock_no_aplica;
