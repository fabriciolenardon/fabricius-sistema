-- ============================================================
-- 136 — MONTE CRISTO DEJA DE ELABORAR MILANESAS
-- ============================================================
-- Da marcha atrás a la migración 99. Fabricio (01/09/2026): la franquicia no
-- va a elaborar milanesas más, así que las vende como la CENTRAL — descontando
-- la materia prima directo al venderlas, sin paso de elaboración:
--
--   MILANESA COMUN / DE NALGA / DE PECETO  → bovino_corte  (genérico)
--   MILANESA DE PECHUGA                    → pollo         (genérico)
--   MILANESA DE CERDO x kg                 → cerdo_pierna
--
-- Las tres primeras y la de pechuga NO necesitan `stock_origen`: con el
-- catálogo en NULL, la venta descuenta por CATEGORÍA (bovino_corte → el bucket
-- bovino_corte, pollo → pollo; ver mapearStockTipo en src/lib/anularVenta.js).
-- La de cerdo sí lo tiene en el catálogo, apuntando a cerdo_pierna. O sea:
-- alcanza con sacarle a la sucursal el override que la mig 99 le puso.
--
-- El módulo de elaboración NO se borró: quedó apagado con un interruptor en
-- Deposito.jsx (MILANESAS_ELABORACION_ACTIVA = false). Para volver atrás,
-- poner ese flag en true y correr de nuevo la mig 99.
--
-- Los buckets mila_* se DEJAN en stock_actual (en cero) para no romper el
-- historial de elaboraciones ya cargadas y para que el módulo pueda volver
-- sin recrearlos. El único que tenía kilos era mila_carne, y vuelven a
-- bovino_corte, que es de donde habían salido.
--
-- Idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1) DEVOLVER LOS KILOS QUE QUEDARON EN LOS BUCKETS DE MILANESA
-- ------------------------------------------------------------
-- Son mercadería real: si se dejan ahí, con el módulo apagado no los ve ni
-- los vende nadie. Vuelven al bucket de donde salieron.
UPDATE stock_actual SET kg_disponible = kg_disponible + COALESCE(
  (SELECT kg_disponible FROM stock_actual WHERE sucursal_id = 3 AND tipo = 'mila_carne'), 0)
WHERE sucursal_id = 3 AND tipo = 'bovino_corte';

UPDATE stock_actual SET kg_disponible = kg_disponible + COALESCE(
  (SELECT kg_disponible FROM stock_actual WHERE sucursal_id = 3 AND tipo = 'mila_pollo'), 0)
WHERE sucursal_id = 3 AND tipo = 'pollo';

UPDATE stock_actual SET kg_disponible = kg_disponible + COALESCE(
  (SELECT kg_disponible FROM stock_actual WHERE sucursal_id = 3 AND tipo = 'mila_cerdo'), 0)
WHERE sucursal_id = 3 AND tipo = 'cerdo_pierna';

UPDATE stock_actual SET kg_disponible = 0
WHERE sucursal_id = 3 AND tipo IN ('mila_carne', 'mila_cerdo', 'mila_pollo');


-- ------------------------------------------------------------
-- 2) SACAR EL OVERRIDE: QUE LA SUCURSAL DESCUENTE COMO LA CENTRAL
-- ------------------------------------------------------------
UPDATE precios_sucursal ps SET stock_origen = NULL
FROM precios p
WHERE ps.precio_id = p.id AND ps.sucursal_id = 3
  AND ps.stock_origen LIKE 'mila\_%';


-- ------------------------------------------------------------
-- 3) VERIFICACIÓN
-- ------------------------------------------------------------
SELECT 'milanesas con override propio (debe ser 0)' AS control, count(*)::text AS resultado
  FROM precios_sucursal WHERE sucursal_id = 3 AND stock_origen LIKE 'mila\_%'
UNION ALL
SELECT 'buckets mila_* de Monte Cristo (deben estar en 0)',
       COALESCE(string_agg(tipo || '=' || kg_disponible, ' · ' ORDER BY tipo), 'sin filas')
  FROM stock_actual WHERE sucursal_id = 3 AND tipo LIKE 'mila\_%'
UNION ALL
SELECT 'de qué descuenta cada milanesa en Monte Cristo',
       string_agg(p.nombre || ' → ' || COALESCE(ps.stock_origen, p.stock_origen, 'por categoría: ' || p.categoria), ' · ' ORDER BY p.nombre)
  FROM precios p
  LEFT JOIN precios_sucursal ps ON ps.precio_id = p.id AND ps.sucursal_id = 3
  WHERE p.nombre ILIKE '%MILANESA%';
