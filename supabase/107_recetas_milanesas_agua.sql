-- ============================================================
-- 107 — MILANESAS: el agua SÍ es por kilo
-- ============================================================
-- En la 106 el agua quedó como cantidad fija que no escala, porque en el
-- papel el "x kg" estaba escrito sólo en el condimento. Fabricio lo aclaró
-- (24/08/2026): el medio litro es POR KILO de carne.
--
-- Se carga como 0,5 l con cantidad real, así escala con el kilaje:
--   1 kg  → 0,500 l        10 kg → 5 l        40 kg → 20 l
--
-- Va en LITROS y no en 500 ml a propósito: escalado a 40 kg, "20 l" se lee
-- de un vistazo y "20.000 ml" no.
--
-- Idempotente.
-- ============================================================

UPDATE recetas SET
  notas = 'La misma para carne vacuna y para cerdo.',
  ingredientes = '[
    {"nombre": "Condimento para milanesa", "cantidad": 0.65, "unidad": "g"},
    {"nombre": "Agua",                     "cantidad": 0.5,  "unidad": "l"}
  ]'::jsonb
WHERE lower(nombre) = lower('Milanesas de Carne o Cerdo');

UPDATE recetas SET
  notas = NULL,
  ingredientes = '[
    {"nombre": "Condimento para milanesa", "cantidad": 0.75, "unidad": "g"},
    {"nombre": "Agua",                     "cantidad": 0.5,  "unidad": "l"}
  ]'::jsonb
WHERE lower(nombre) = lower('Milanesas de Pollo');


-- Verificación: las dos con agua numérica (y por lo tanto escalable).
SELECT nombre, base_kg, base_label,
       i->>'nombre' AS ingrediente, i->>'cantidad' AS cantidad, i->>'unidad' AS unidad
FROM recetas, jsonb_array_elements(ingredientes) i
WHERE categoria = 'milanesa' AND activa
ORDER BY orden, i->>'nombre';
