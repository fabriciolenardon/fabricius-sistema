-- ============================================================
-- 111 — MILANESAS: el ingrediente es SUSTI, y son gramos
-- ============================================================
-- Receta que pasó Fabricio (24/08/2026):
--     Milanesa ternera y cerdo x kg     Milanesa pollo x kg
--     Susti 0.065                       Susti 0.075
--     Agua 0.500 lts                    Agua 0.500 lts
--
-- 1. EL INGREDIENTE TIENE NOMBRE: "Susti". En la 106 se había cargado como
--    "Condimento para milanesa" porque el papel no lo decía.
--
-- 2. MISMA ESCALA QUE EL PARRILLERO (mig 110): el 0,065 son KILOS, no
--    gramos → 65 g por kilo de carne. Y acá hay una comprobación que no
--    dependía de nosotros: el Susti es un extensor que se hidrata, y
--    65 g con 500 ml de agua da una relación ~1:7,7, que es exactamente
--    la de hidratación del producto. Leído como 0,065 g (65 mg) no
--    hidrataría nada.
--    Se guardan en gramos porque es la unidad en la que se pesa.
--
-- 3. La de carne pasa a llamarse "Milanesas de Ternera y Cerdo".
--
-- Con esto quedan corregidas todas las recetas por kilo salvo el SALAME
-- (sal 0,30 / pimienta 0,6 / nuez moscada 0,1 / especias 0,2), que sigue
-- con los números del cartel viejo.
--
-- Idempotente.
-- ============================================================

UPDATE recetas SET
  nombre     = 'Milanesas de Ternera y Cerdo',
  base_label = 'Carne',
  notas      = 'Por kilo de carne. En el papel el Susti está en kilos (0,065) y acá va en gramos, que es lo que se pesa: 0,065 kg = 65 g.',
  ingredientes = '[
    {"nombre": "Susti", "cantidad": 65,  "unidad": "g"},
    {"nombre": "Agua",  "cantidad": 0.5, "unidad": "l"}
  ]'::jsonb
WHERE lower(nombre) = lower('Milanesas de Carne o Cerdo');

UPDATE recetas SET
  base_label = 'Pechuga',
  notas      = 'Por kilo de pechuga. En el papel el Susti está en kilos (0,075) y acá va en gramos, que es lo que se pesa: 0,075 kg = 75 g.',
  ingredientes = '[
    {"nombre": "Susti", "cantidad": 75,  "unidad": "g"},
    {"nombre": "Agua",  "cantidad": 0.5, "unidad": "l"}
  ]'::jsonb
WHERE lower(nombre) = lower('Milanesas de Pollo');


-- Verificación: por kilo y escalado a 10 y 40 kg.
SELECT r.nombre, r.base_label, i->>'nombre' AS ingrediente,
       (i->>'cantidad')::numeric      AS por_1kg,
       (i->>'cantidad')::numeric * 10 AS por_10kg,
       (i->>'cantidad')::numeric * 40 AS por_40kg,
       i->>'unidad' AS unidad
FROM recetas r, jsonb_array_elements(r.ingredientes) i
WHERE r.categoria = 'milanesa' AND r.activa
ORDER BY r.orden, i->>'nombre' DESC;
