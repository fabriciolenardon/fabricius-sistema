-- ============================================================
-- 109 — MILANESA DE POLLO: el condimento es 0,0750 g por kilo
-- ============================================================
-- Cierra la inconsistencia que quedó abierta en la 108: ahí se corrigió la
-- milanesa de carne a 0,0650 g/kg y la de pollo quedó en 0,7500 — 11 veces
-- más para el mismo tipo de producto. Fabricio confirmó que las dos estaban
-- en la misma escala, así que la de pollo baja a 0,0750.
--
-- Las dos milanesas quedan proporcionadas entre sí (0,065 / 0,075), que era
-- la relación original del papel (0,65 / 0,75) diez veces más chica.
--
-- Idempotente.
-- ============================================================

UPDATE recetas SET
  ingredientes = '[
    {"nombre": "Condimento para milanesa", "cantidad": 0.075, "unidad": "g"},
    {"nombre": "Agua",                     "cantidad": 0.5,   "unidad": "l"}
  ]'::jsonb
WHERE lower(nombre) = lower('Milanesas de Pollo');


-- Verificación: las dos milanesas a 1, 10 y 40 kg.
SELECT r.nombre,
       i->>'nombre'                     AS ingrediente,
       (i->>'cantidad')::numeric        AS por_1kg,
       (i->>'cantidad')::numeric * 10   AS por_10kg,
       (i->>'cantidad')::numeric * 40   AS por_40kg,
       i->>'unidad'                     AS unidad
FROM recetas r, jsonb_array_elements(r.ingredientes) i
WHERE r.categoria = 'milanesa' AND r.activa
ORDER BY r.orden, i->>'nombre';
