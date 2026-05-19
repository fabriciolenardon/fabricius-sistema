-- ============================================================
-- 11_backfill_piezas_stock.sql
-- Genera filas en piezas_stock para los despostes bovinos
-- (tipo_desposte='piezas') que ya estaban registrados antes de
-- que estuviera la l�gica de Fase 1. As� aparecen como
-- "disponibles" en la pesta�a Piezas y en Despachos (Fase 4).
--
-- Es IDEMPOTENTE: no duplica si lo corr�s dos veces (chequea
-- por desposte_id + tipo_pieza + kg).
-- ============================================================

INSERT INTO piezas_stock
  (desposte_id, entrada_id, tipo_pieza, tipo_stock, kg,
   precio_costo_kg, fecha_ingreso,
   proveedor_origen, descripcion_origen, modelo_desposte, estado)
SELECT
  d.id,
  d.entrada_id,
  pieza->>'nombre',
  COALESCE(pieza->>'tipo_stock', 'bovino_pieza'),
  (pieza->>'kg')::numeric,
  COALESCE((pieza->>'precio_costo_kg')::numeric, ent.precio_kg, NULL),
  d.fecha,
  ent.proveedor_nombre,
  COALESCE(ent.descripcion, 'Media Res') ||
    ' (' || COALESCE(ent.kg_real::text, ent.kg::text, '?') || ' kg)',
  d.modelo,
  'disponible'
FROM despostes d
LEFT JOIN entradas_deposito ent ON ent.id = d.entrada_id
LEFT JOIN LATERAL jsonb_array_elements(d.piezas::jsonb) AS pieza ON TRUE
WHERE d.tipo_desposte = 'piezas'
  AND (pieza->>'kg')::numeric > 0
  AND NOT EXISTS (
    SELECT 1 FROM piezas_stock ps
     WHERE ps.desposte_id = d.id
       AND ps.tipo_pieza = pieza->>'nombre'
       AND ps.kg = (pieza->>'kg')::numeric
  );

-- ============================================================
-- Verificar qu� qued�:
--   SELECT tipo_pieza, count(*) AS cant, sum(kg) AS kg_total, estado
--     FROM piezas_stock
--    GROUP BY tipo_pieza, estado
--    ORDER BY tipo_pieza, estado;
-- ============================================================
