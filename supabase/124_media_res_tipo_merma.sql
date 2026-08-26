-- ============================================================
-- 124 — EL TIPO DE MERMA SE ELIGE AL INGRESAR LA MEDIA RES
-- ============================================================
-- Antes la clasificación (Novillito, Vaca/Vaquillona, o los A-1/B-2 que se
-- agreguen) se elegía RECIÉN AL DESPOSTAR: con la media ya en cámara, días
-- después, y sin nadie que se acordara de qué animal era. Si se erraba, se le
-- descontaba al lote la merma de otro tipo de animal.
--
-- Ahora se elige AL INGRESARLA —que es cuando se la está mirando— y el
-- desposte a kilo la lee de acá y aplica esa merma sola.
--
-- Va en `entradas_deposito` porque ES la fila que se elige al despostar a
-- kilo (confirmarDesposteKilo trabaja sobre la entrada, no sobre medias_stock).
-- Se copia igual a `medias_stock` para la trazabilidad de la media individual.
--
-- NULL = entrada vieja o no bovina: el desposte pregunta como siempre. Nada se
-- rompe hacia atrás.
--
-- Idempotente.
-- ============================================================

ALTER TABLE entradas_deposito ADD COLUMN IF NOT EXISTS merma_tipo_id text;
ALTER TABLE medias_stock      ADD COLUMN IF NOT EXISTS merma_tipo_id text;

COMMENT ON COLUMN entradas_deposito.merma_tipo_id IS
  'Tipo de media res a efectos de MERMA (id de config_sistema.merma_conversion.media_res). Se elige al ingresarla y el desposte a kilo lo toma solo. NULL = entrada vieja o no bovino: el desposte pregunta.';
COMMENT ON COLUMN medias_stock.merma_tipo_id IS
  'Copia del tipo de merma de la entrada, para trazabilidad de la media individual.';

CREATE INDEX IF NOT EXISTS idx_entradas_merma_tipo
  ON entradas_deposito (merma_tipo_id) WHERE merma_tipo_id IS NOT NULL;


-- Verificación
SELECT 'entradas ya clasificadas' AS control, count(*)::text AS resultado
  FROM entradas_deposito WHERE merma_tipo_id IS NOT NULL
UNION ALL
SELECT 'medias sin despostar (van a pedir el tipo a mano)',
       count(*)::text FROM entradas_deposito
 WHERE tipo = 'bovino_mr' AND coalesce(despostada,false) = false
   AND coalesce(eliminado,false) = false
UNION ALL
SELECT 'clasificaciones disponibles hoy',
       coalesce((SELECT string_agg(m->>'label', ' · ')
                   FROM config_sistema c, jsonb_array_elements(c.valor->'media_res') m
                  WHERE c.clave = 'merma_conversion'), '(ninguna)');
