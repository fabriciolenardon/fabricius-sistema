-- ============================================================
-- 108 — MILANESAS DE CARNE/CERDO: el condimento es 0,0650 g por kilo
-- ============================================================
-- Corrección de Fabricio (24/08/2026): el condimento de la milanesa de
-- carne y cerdo va 0,0650 g por kilo, no 0,65 como se había cargado en la
-- 106 leyendo el papel.
--
-- ⚠️ QUEDA UNA INCONSISTENCIA A LA VISTA, a propósito sin tocar:
--   Milanesas de Carne o Cerdo → 0,0650 g/kg
--   Milanesas de Pollo         → 0,7500 g/kg   ← 11 veces más
-- Fabricio corrigió sólo la de carne. Si las dos estaban escritas en la
-- misma escala, la de pollo debería quedar en 0,0750. No se cambia por
-- nuestra cuenta: es una receta de producción y el número lo define él.
--
-- Idempotente.
-- ============================================================

UPDATE recetas SET
  ingredientes = '[
    {"nombre": "Condimento para milanesa", "cantidad": 0.065, "unidad": "g"},
    {"nombre": "Agua",                     "cantidad": 0.5,   "unidad": "l"}
  ]'::jsonb
WHERE lower(nombre) = lower('Milanesas de Carne o Cerdo');


-- Verificación: las dos milanesas, una al lado de la otra.
SELECT r.nombre,
       i->>'nombre'   AS ingrediente,
       i->>'cantidad' AS por_kilo,
       i->>'unidad'   AS unidad
FROM recetas r, jsonb_array_elements(r.ingredientes) i
WHERE r.categoria = 'milanesa' AND r.activa
ORDER BY r.orden, i->>'nombre';
