-- ============================================================
-- 106 — RECETAS: milanesas de carne/cerdo y de pollo
-- ============================================================
-- Las pasó Fabricio el 24/08/2026, tal cual:
--
--   Milanesa carne y cerdo        Milanesa pollo
--   0,65 g x kg de carne          0,75 g x kg de pechuga
--   0,500 lts de agua             0,500 lts de agua
--
-- DOS COSAS QUE SE DECIDIERON LEYENDO CÓMO ESTÁ ESCRITO
--
-- 1. EL AGUA NO ESCALA. El "x kg" está sólo en el condimento; el agua va
--    suelta. Así que el condimento se carga como cantidad (escala con el
--    kilaje) y el agua como NOTA de cantidad fija.
--    Es la opción segura de las dos: si el agua fuera por kilo y no escala,
--    se ve en pantalla y se corrige; si fuera por tanda y la escaláramos,
--    a 20 kg diría 10 litros y se arruina la preparación sin que nadie lo
--    note. Ante la duda, no multiplicar.
--
-- 2. EL CONDIMENTO NO TIENE NOMBRE en el papel. Se carga como "Condimento
--    para milanesa" para que la fila exista y se pueda renombrar desde la
--    pantalla en dos clics.
--
-- ⚠️ Igual que el parrillero (0,24 g de sal x kg) y el salame (0,30 g), estos
-- gramos son llamativamente chicos contra la hamburguesa (16 g/kg). Se cargan
-- LITERALES, sin corregir, y queda pendiente que Fabricio defina la unidad.
--
-- Idempotente.
-- ============================================================

INSERT INTO recetas (nombre, categoria, rol, base_kg, base_label, orden, notas, ingredientes) VALUES

('Milanesas de Carne o Cerdo', 'milanesa', 'formula', 1, 'Carne', 60,
 'La misma para carne vacuna y para cerdo. El agua es cantidad fija de la preparación: no se multiplica con los kilos.', '[
  {"nombre": "Condimento para milanesa", "cantidad": 0.65, "unidad": "g"},
  {"nombre": "Agua",                     "cantidad": null, "unidad": null, "nota": "0,500 lts"}
]'::jsonb),

('Milanesas de Pollo', 'milanesa', 'formula', 1, 'Pechuga', 70,
 'El agua es cantidad fija de la preparación: no se multiplica con los kilos.', '[
  {"nombre": "Condimento para milanesa", "cantidad": 0.75, "unidad": "g"},
  {"nombre": "Agua",                     "cantidad": null, "unidad": null, "nota": "0,500 lts"}
]'::jsonb)

ON CONFLICT DO NOTHING;


-- Verificación
SELECT nombre, categoria, base_kg, base_label, jsonb_array_length(ingredientes) AS ingredientes
FROM recetas WHERE activa ORDER BY orden;
