-- ============================================================
-- 97 — Monte Cristo arranca con la lista de la central
-- ============================================================
-- Pedido de Fabricio: que la sucursal NO empiece con la lista vacía, sino con
-- exactamente los precios que ya tiene cargados el sistema. Así abren
-- vendiendo igual que Río Primero desde el minuto cero.
--
-- QUÉ COPIA Y QUÉ NO
-- Copia las dos listas que usa una sucursal: minorista y mayorista. NO copia
-- `precio_carniceria` — esa es la lista de la central para venderles A ELLOS,
-- no una lista con la que ellos vendan.
--
-- Los PLU no se copian porque NO HACE FALTA: `codigo_balanza` vive en
-- `precios`, que es el catálogo COMPARTIDO. Monte Cristo ya tiene los mismos
-- 128 PLU que Río Primero, con los mismos números, sin hacer nada. Es
-- justamente lo que se buscaba al dejar el catálogo del lado de la central.
--
-- OJO — ES UNA FOTO, NO UN ESPEJO
-- A partir de acá las dos listas viven separadas: cuando la central actualice
-- un precio, Monte Cristo NO lo hereda solo. Tienen que cargarlo ellos, que es
-- exactamente el acuerdo (respetan la lista por contrato, la cargan a mano).
--
-- Idempotente: `ON CONFLICT DO NOTHING` — si ya cargaron un precio propio,
-- volver a correr esto NO se lo pisa.
-- ============================================================

INSERT INTO precios_sucursal (sucursal_id, precio_id, precio_minorista, precio_mayorista)
SELECT 3, p.id, p.precio_minorista, p.precio_mayorista
FROM precios p
ON CONFLICT (sucursal_id, precio_id) DO NOTHING;


-- ------------------------------------------------------------
-- VERIFICACIÓN
-- ------------------------------------------------------------
SELECT 'productos del catalogo' AS control, count(*)::text AS resultado FROM precios
UNION ALL
SELECT 'precios sembrados a Monte Cristo', count(*)::text FROM precios_sucursal WHERE sucursal_id = 3
UNION ALL
SELECT 'diferencias contra la central', count(*)::text
  FROM precios p JOIN precios_sucursal ps ON ps.precio_id = p.id AND ps.sucursal_id = 3
  WHERE p.precio_minorista IS DISTINCT FROM ps.precio_minorista
     OR p.precio_mayorista IS DISTINCT FROM ps.precio_mayorista
UNION ALL
SELECT 'PLU que comparten (catalogo)', count(*)::text FROM precios WHERE codigo_balanza IS NOT NULL;

-- Esperado:
--   productos del catalogo ............ 245
--   precios sembrados a Monte Cristo .. 245
--   diferencias contra la central ..... 0     ← arrancan idénticos
--   PLU que comparten (catalogo) ...... 128   ← los mismos, sin copiar nada
