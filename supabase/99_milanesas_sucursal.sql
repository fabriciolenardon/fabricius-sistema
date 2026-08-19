-- ============================================================
-- 99 — MILANESAS CON STOCK PROPIO (trazabilidad de la sucursal)
-- ============================================================
-- La franquicia elabora milanesas de las tres: carne, cerdo y pollo. Pesa los
-- kg de materia prima que usa y carga los kg de milanesas que salieron (con el
-- rebozado suelen salir MÁS kilos de los que entraron). Cada tipo pasa a tener
-- su propio stock, igual que las hamburguesas (mig 85) y los embutidos (60):
--
--   Carne  → descuenta `bovino_corte`                    → suma `mila_carne`
--   Cerdo  → descuenta `cerdo_pierna` o `cerdo_carre`    → suma `mila_cerdo`
--            (solo esas dos piezas se usan para milanesa)
--   Pollo  → descuenta `pollo`                           → suma `mila_pollo`
--
-- ------------------------------------------------------------
-- EL PROBLEMA QUE RESUELVE ESTA MIGRACIÓN
-- ------------------------------------------------------------
-- Hoy la CENTRAL vende milanesas descontando directo la materia prima:
-- "MILANESA COMUN" descuenta `bovino_corte`, "MILANESA DE CERDO x kg"
-- descuenta `cerdo_pierna`. No hay paso de elaboración. Fabricio quiere
-- mantener esa trazabilidad en Río Primero y que la franquicia use la nueva.
--
-- Pero `precios.stock_origen` vive en el CATÁLOGO, que es uno solo y
-- compartido. Si lo cambiáramos a `mila_carne`, la central también dejaría de
-- descontar bovino_corte de golpe y su stock de milanesas quedaría en negativo
-- (nunca elabora, solo vende).
--
-- SOLUCIÓN: `precios_sucursal.stock_origen`, un override POR SUCURSAL.
--   NULL  → usa el del catálogo (lo que hace la central hoy)
--   valor → esa sucursal descuenta de otro bucket
--
-- Sigue siendo la central la que decide el override (la sucursal no puede
-- tocar `stock_origen`, que es justo lo que protege al depósito de descontar
-- del bucket equivocado). Es el mismo criterio de la mig 92, con una vuelta
-- más de precisión.
--
-- Idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1) EL OVERRIDE POR SUCURSAL
-- ------------------------------------------------------------
ALTER TABLE precios_sucursal ADD COLUMN IF NOT EXISTS stock_origen text;

COMMENT ON COLUMN precios_sucursal.stock_origen IS
  'De qué bucket descuenta este producto EN ESTA SUCURSAL. NULL = el del catálogo (precios.stock_origen). Lo define la central, no la sucursal.';


-- ------------------------------------------------------------
-- 2) LOS BUCKETS DE MILANESAS PARA MONTE CRISTO
-- ------------------------------------------------------------
-- Arrancan en 0 y se llenan cuando elaboren. Se crean explícitamente para que
-- aparezcan en el panel aunque todavía no hayan elaborado nada.
INSERT INTO stock_actual (tipo, kg_disponible, sucursal_id)
VALUES ('mila_carne', 0, 3), ('mila_cerdo', 0, 3), ('mila_pollo', 0, 3)
ON CONFLICT (sucursal_id, tipo) DO NOTHING;


-- ------------------------------------------------------------
-- 3) QUE LAS MILANESAS DE LA SUCURSAL DESCUENTEN DE SU PROPIO STOCK
-- ------------------------------------------------------------
-- Solo para la sucursal 3. La central sigue igual que siempre.
UPDATE precios_sucursal ps SET stock_origen = 'mila_carne'
FROM precios p
WHERE ps.precio_id = p.id AND ps.sucursal_id = 3
  AND p.categoria = 'bovino_corte' AND p.nombre ILIKE '%MILANESA%';

UPDATE precios_sucursal ps SET stock_origen = 'mila_pollo'
FROM precios p
WHERE ps.precio_id = p.id AND ps.sucursal_id = 3
  AND p.categoria = 'pollo' AND p.nombre ILIKE '%MILANESA%';

UPDATE precios_sucursal ps SET stock_origen = 'mila_cerdo'
FROM precios p
WHERE ps.precio_id = p.id AND ps.sucursal_id = 3
  AND p.categoria IN ('cerdo_corte', 'cerdo_pieza') AND p.nombre ILIKE '%MILANESA%';


-- ------------------------------------------------------------
-- 4) VERIFICACIÓN
-- ------------------------------------------------------------
SELECT 'buckets de milanesa de Monte Cristo' AS control,
       string_agg(tipo || '=' || kg_disponible, ' · ' ORDER BY tipo) AS resultado
  FROM stock_actual WHERE sucursal_id = 3 AND tipo LIKE 'mila\_%'
UNION ALL
SELECT 'productos con origen propio en la sucursal',
       string_agg(p.nombre || ' → ' || ps.stock_origen, ' · ' ORDER BY p.nombre)
  FROM precios_sucursal ps JOIN precios p ON p.id = ps.precio_id
  WHERE ps.sucursal_id = 3 AND ps.stock_origen IS NOT NULL
UNION ALL
SELECT 'la central NO se tocó (debe ser 0)', count(*)::text
  FROM precios_sucursal WHERE sucursal_id = 1 AND stock_origen IS NOT NULL;

-- Esperado:
--   buckets de milanesa ....... mila_carne=0 · mila_cerdo=0 · mila_pollo=0
--   productos con origen propio  las 5 milanesas, cada una a su bucket
--   la central NO se tocó ..... 0
