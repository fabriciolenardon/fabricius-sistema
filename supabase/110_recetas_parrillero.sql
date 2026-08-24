-- ============================================================
-- 110 — CHORIZO PARRILLERO: los condimentos por kilo, corregidos
-- ============================================================
-- Receta actualizada que pasó Fabricio (24/08/2026), por kilo de masa:
--     Sal 0,024 · Pimienta 0,002 · Especias surtidas 0,024
--     Fijador 0,001 · Nuez moscada 0,001
--
-- SE GUARDAN EN GRAMOS, Y ESE 0,024 SON KILOS
-- Los números vienen sin unidad, pero sólo cierran leídos como kilos:
--   0,024 kg = 24 g de sal por kilo → la cifra de manual para chorizo, y
--   coherente con la hamburguesa (16 g/kg).
--   0,024 g  = 24 MILIGRAMOS por kilo → no se puede ni pesar.
-- Se guardan convertidos a gramos porque es la unidad en la que se pesa:
-- "24 g" es accionable, "0,024 kg" obliga a hacer la cuenta en la mesada.
--
-- Esto explica de paso los carteles viejos: el que decía "Sal 0,24gr" tenía
-- mal la coma Y la unidad. Quedan por revisar con el mismo criterio los
-- gramos del SALAME (sal 0,30 / pimienta 0,6 / nuez moscada 0,1 /
-- especias 0,2) y los de las MILANESAS.
--
-- ⚠️ EL TOCINO QUEDA PENDIENTE: estaba en la receta vieja (0,10) pero no
-- vino en la lista actualizada. No se borra ni se convierte por nuestra
-- cuenta — queda como nota visible en la tarjeta hasta que Fabricio diga.
--
-- Idempotente.
-- ============================================================

UPDATE recetas SET
  notas = 'Cantidades por kilo de masa. En el papel están en kilos (0,024) y acá van en gramos, que es lo que se pesa: 0,024 kg = 24 g. El vino, el clavo y el ajo no son por kilo: van por tanda.',
  ingredientes = '[
    {"nombre": "Sal",               "cantidad": 24, "unidad": "g"},
    {"nombre": "Pimienta",          "cantidad": 2,  "unidad": "g"},
    {"nombre": "Especias surtidas", "cantidad": 24, "unidad": "g"},
    {"nombre": "Fijador",           "cantidad": 1,  "unidad": "g"},
    {"nombre": "Nuez moscada",      "cantidad": 1,  "unidad": "g"},
    {"nombre": "Tocino",            "cantidad": null, "unidad": null, "nota": "PENDIENTE: no vino en la lista actualizada. Antes decía 0,10 (= 100 g/kg con el mismo criterio)."},
    {"nombre": "Vino",              "cantidad": null, "unidad": null, "nota": "0,500 lts por cada 10 kg de masa"},
    {"nombre": "Clavo de olor",     "cantidad": null, "unidad": null, "nota": "10 unidades por cada 0,500 lts de vino"},
    {"nombre": "Ajo",               "cantidad": null, "unidad": null, "nota": "1 cabeza por cada 0,500 lts de vino"}
  ]'::jsonb
WHERE lower(nombre) = lower('Chorizo Parrillero');


-- Verificación: por kilo y por tanda de 100 kg.
SELECT n AS orden, i->>'nombre' AS ingrediente,
       (i->>'cantidad')::numeric       AS por_1kg,
       (i->>'cantidad')::numeric * 100 AS por_100kg,
       i->>'unidad' AS unidad, i->>'nota' AS nota
FROM recetas r, jsonb_array_elements(r.ingredientes) WITH ORDINALITY AS t(i, n)
WHERE lower(r.nombre) = lower('Chorizo Parrillero')
ORDER BY n;
