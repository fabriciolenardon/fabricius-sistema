-- ============================================================
-- MIGRACIÓN 40: backfill de piezas bovinas compradas DIRECTO
-- ============================================================
-- Las piezas que se compran directo al frigorífico (pierna, cortito,
-- etc., tipo pieza_* en entradas_deposito) sumaban al stock agregado
-- pero NO creaban fila en piezas_stock → no aparecían en la pestaña
-- Depósito > Piezas (que lista piezas_stock).
--
-- El código ya se corrigió (EntradaForm crea la fila a partir de ahora).
-- Esta migración backfillea las compras directas que ya estaban cargadas
-- y que no tenían su fila. Excluye:
--   - piezas que salen del desposte de medias reses ("... de MR #...")
--     → esas tienen su propia fila por el flujo de desposte
--   - piezas de capón ("... de Capón ...")
--   - las que ya tienen fila en piezas_stock
--
-- Idempotente: el NOT EXISTS evita duplicar si se corre de nuevo.
-- ============================================================

INSERT INTO piezas_stock
  (entrada_id, tipo_pieza, tipo_stock, kg, precio_costo_kg, fecha_ingreso, proveedor_origen, descripcion_origen, estado)
SELECT
  e.id,
  CASE e.tipo
    WHEN 'pieza_pierna' THEN 'Pierna'
    WHEN 'pieza_cuarto_pistola' THEN 'Cuarto Pistola'
    WHEN 'pieza_costillar' THEN 'Costillar Completo'
    WHEN 'pieza_cortito' THEN 'Cortito'
    WHEN 'pieza_carre' THEN 'Carré'
    WHEN 'pieza_paleta' THEN 'Paleta'
    WHEN 'pieza_parrillero' THEN 'Parrillero'
    ELSE e.tipo
  END,
  e.tipo,
  COALESCE(e.kg_real, e.kg),
  NULLIF(e.precio_kg, 0),
  e.fecha,
  e.proveedor_nombre,
  COALESCE(NULLIF(e.descripcion, ''), 'Pieza'),
  'disponible'
FROM entradas_deposito e
WHERE e.tipo IN ('pieza_pierna','pieza_cuarto_pistola','pieza_costillar','pieza_cortito','pieza_carre','pieza_paleta','pieza_parrillero')
  AND e.fecha >= '2026-05-18'
  AND e.despostada = false
  AND COALESCE(e.descripcion,'') NOT ILIKE '%de MR%'
  AND COALESCE(e.descripcion,'') NOT ILIKE '%de Cap%'
  AND NOT EXISTS (SELECT 1 FROM piezas_stock ps WHERE ps.entrada_id = e.id);
