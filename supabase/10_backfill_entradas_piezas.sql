-- ============================================================
-- 10_backfill_entradas_piezas.sql
-- Genera retroactivamente las filas en entradas_deposito que
-- corresponden a cada pieza de los despostes ya registrados,
-- para que aparezcan en el historial del Dashboard.
--
-- Es IDEMPOTENTE: si lo corr�s dos veces, no duplica datos.
-- Usa NOT EXISTS contra (desposte_id, destino='desposte', tipo).
-- ============================================================

-- 1) BACKFILL DESPOSTES DE CERDO (capones)
-- El piezas JSON tiene { nombre, kg, tipo_stock } por pieza.
INSERT INTO entradas_deposito
  (fecha, tipo, proveedor_nombre, descripcion,
   kg, kg_real, merma_pct, precio_kg, importe,
   destino, cantidad, desposte_id)
SELECT
  d.fecha,
  pieza->>'tipo_stock',
  ent.proveedor_nombre,
  (pieza->>'nombre') || ' de Cap�n #' || d.entrada_id ||
    ' (' || COALESCE(ent.descripcion, 'Cap�n') || ')',
  (pieza->>'kg')::numeric,
  (pieza->>'kg')::numeric,
  0, 0, 0,
  'desposte', 1, d.id
FROM despostes d
LEFT JOIN entradas_deposito ent ON ent.id = d.entrada_id
LEFT JOIN LATERAL jsonb_array_elements(d.piezas::jsonb) AS pieza ON TRUE
WHERE d.tipo_desposte = 'cerdo'
  AND (pieza->>'kg')::numeric > 0
  AND pieza->>'tipo_stock' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM entradas_deposito ed
     WHERE ed.desposte_id = d.id
       AND ed.destino = 'desposte'
       AND ed.tipo = pieza->>'tipo_stock'
  );

-- 2) BACKFILL DESPOSTES DE BOVINO A PIEZAS
-- El piezas JSON guarda nombre con 'tipo_stock' = 'bovino_pieza' (gen�rico).
-- Mapeamos el NOMBRE a un tipo granular para que el Dashboard lo agrupe.
INSERT INTO entradas_deposito
  (fecha, tipo, proveedor_nombre, descripcion,
   kg, kg_real, merma_pct, precio_kg, importe,
   destino, cantidad, desposte_id)
SELECT
  d.fecha,
  CASE pieza->>'nombre'
    WHEN 'Cuarto Pistola'         THEN 'pieza_cuarto_pistola'
    WHEN 'Costillar Completo'     THEN 'pieza_costillar'
    WHEN 'Cortito'                THEN 'pieza_cortito'
    WHEN 'Pierna'                 THEN 'pieza_pierna'
    WHEN 'Costeletal con Lomo'    THEN 'pieza_carre'
    WHEN 'Parrillero'             THEN 'pieza_parrillero'
    WHEN 'Paleta'                 THEN 'pieza_paleta'
    -- Nombres viejos (de antes de los Modelos A/B/C nuevos)
    WHEN 'Cuarto delantero'       THEN 'pieza_cuarto_pistola'
    WHEN 'Cuarto trasero'         THEN 'pieza_pierna'
    WHEN 'Costillar'              THEN 'pieza_costillar'
    WHEN 'Lomo'                   THEN 'pieza_carre'
    ELSE 'bovino_pieza'
  END AS tipo_granular,
  ent.proveedor_nombre,
  (pieza->>'nombre') || ' de MR #' || d.entrada_id ||
    ' (' || COALESCE(ent.descripcion, 'Media Res') || ')',
  (pieza->>'kg')::numeric,
  (pieza->>'kg')::numeric,
  0,
  COALESCE((pieza->>'precio_costo_kg')::numeric, ent.precio_kg, 0),
  0,
  'desposte', 1, d.id
FROM despostes d
LEFT JOIN entradas_deposito ent ON ent.id = d.entrada_id
LEFT JOIN LATERAL jsonb_array_elements(d.piezas::jsonb) AS pieza ON TRUE
WHERE d.tipo_desposte = 'piezas'
  AND (pieza->>'kg')::numeric > 0
  AND NOT EXISTS (
    SELECT 1 FROM entradas_deposito ed
     WHERE ed.desposte_id = d.id
       AND ed.destino = 'desposte'
       AND ed.tipo = (
         CASE pieza->>'nombre'
           WHEN 'Cuarto Pistola'         THEN 'pieza_cuarto_pistola'
           WHEN 'Costillar Completo'     THEN 'pieza_costillar'
           WHEN 'Cortito'                THEN 'pieza_cortito'
           WHEN 'Pierna'                 THEN 'pieza_pierna'
           WHEN 'Costeletal con Lomo'    THEN 'pieza_carre'
           WHEN 'Parrillero'             THEN 'pieza_parrillero'
           WHEN 'Paleta'                 THEN 'pieza_paleta'
           WHEN 'Cuarto delantero'       THEN 'pieza_cuarto_pistola'
           WHEN 'Cuarto trasero'         THEN 'pieza_pierna'
           WHEN 'Costillar'              THEN 'pieza_costillar'
           WHEN 'Lomo'                   THEN 'pieza_carre'
           ELSE 'bovino_pieza'
         END
       )
  );

-- ============================================================
-- Verificar qu� se gener�:
--   SELECT tipo, count(*), sum(kg)
--     FROM entradas_deposito
--    WHERE destino = 'desposte'
--    GROUP BY tipo ORDER BY tipo;
-- ============================================================
