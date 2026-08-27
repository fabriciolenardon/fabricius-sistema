-- ============================================================
-- 125 — EL CAPÓN NO LLEVA MERMA CONFIGURADA
-- ============================================================
-- La mig 123 le creó una fila `capon` en `merma_conversion` para que la
-- planilla de rinde tuviera a dónde escribir. Ya no corresponde.
--
-- Regla de Fabricio (26/08/2026): al despostar un capón se pesa PIEZA POR
-- PIEZA (Depósito → Desposte Cerdo), así que su merma es MEDIDA en cada
-- animal, no estimada de una muestra. Los otros productos no tienen esa
-- trazabilidad y por eso sí llevan un % configurado.
--
-- Dejar un % de capón ahí sería un número muerto que alguien podría creerse,
-- y encima podría pisarle a lo que se pesó de verdad.
--
-- LA PLANILLA DE CAPÓN SIGUE EXISTIENDO: saca el rinde y lo deja en el
-- historial (tabla `planillas_rinde`), pero no ajusta ningún %.
--
-- Idempotente.
-- ============================================================

UPDATE config_sistema
   SET valor = valor - 'capon'
 WHERE clave = 'merma_conversion' AND valor ? 'capon';


-- Verificación
SELECT 'capon en merma_conversion' AS control,
       coalesce((SELECT valor->>'capon' FROM config_sistema WHERE clave = 'merma_conversion'),
                'ya no está (correcto)') AS resultado
UNION ALL
SELECT 'claves que quedan',
       (SELECT string_agg(k, ' · ' ORDER BY k)
          FROM config_sistema c, jsonb_object_keys(c.valor) k
         WHERE c.clave = 'merma_conversion')
UNION ALL
SELECT 'planillas de capón en el historial',
       (SELECT count(*)::text FROM planillas_rinde WHERE tipo = 'capon');
