-- ============================================================
-- 112 — CONDIMENTOS DEL SALAME: por kilo, corregidos
-- ============================================================
-- Receta actualizada que pasó Fabricio (24/08/2026), por kilo de pasta:
--     Sal 0,030 · Pimienta 0,006 · Nuez moscada 0,001
--     Especias surtidas 0,002
--
-- MISMA ESCALA QUE EL PARRILLERO (mig 110) Y LAS MILANESAS (mig 111):
-- son KILOS y se guardan en gramos, que es la unidad en la que se pesa.
--     0,030 kg = 30 g de sal por kilo
-- Da exactamente 10 veces lo que decía el cartel viejo (0,30 / 0,6 / 0,1 /
-- 0,2), que es el mismo error de coma que tenía el del parrillero.
--
-- Y cierra contra el resto: el salame va a 30 g de sal por kilo y el chorizo
-- a 24 — el salame es más salado, como corresponde a un curado.
--
-- Los que van "cada 10 kg" (sal nitro, vino, clavo, ajo) y el acelerante
-- ("cada 50 kg") no son por kilo: quedan como estaban, en nota.
--
-- CON ESTA MIGRACIÓN QUEDAN CORREGIDAS TODAS LAS RECETAS POR KILO.
-- Lo único abierto es el TOCINO del parrillero, que no vino en su lista
-- actualizada y está marcado como pendiente en la tarjeta.
--
-- Idempotente.
-- ============================================================

UPDATE recetas SET
  notas = 'Cantidades por kilo de pasta. En el papel están en kilos (0,030) y acá van en gramos, que es lo que se pesa: 0,030 kg = 30 g. Vale para el Salame Común y para el Holanda y Rockefort: elegí arriba a cuál acompaña y los kilos salen solos. El resto no es por kilo: va por tanda.',
  ingredientes = '[
    {"nombre": "Sal",               "cantidad": 30, "unidad": "g"},
    {"nombre": "Pimienta",          "cantidad": 6,  "unidad": "g"},
    {"nombre": "Nuez moscada",      "cantidad": 1,  "unidad": "g"},
    {"nombre": "Especias surtidas", "cantidad": 2,  "unidad": "g"},
    {"nombre": "Sal Nitro",     "cantidad": null, "unidad": null, "nota": "1 cucharadita de té cada 10 kg"},
    {"nombre": "Vino",          "cantidad": null, "unidad": null, "nota": "1/4 cada 10 kg"},
    {"nombre": "Clavo de olor", "cantidad": null, "unidad": null, "nota": "10 dientes cada 10 kg"},
    {"nombre": "Ajo",           "cantidad": null, "unidad": null, "nota": "1 cabeza cada 10 kg"},
    {"nombre": "Acelerante",    "cantidad": null, "unidad": null, "nota": "10 g cada 50 kg de carne"}
  ]'::jsonb
WHERE lower(nombre) = lower('Condimentos para pasta de salame');


-- Verificación: por kilo y para las dos tandas reales de salame
-- (50 kg del común y 56 kg del holanda/rockefort).
SELECT n AS orden, i->>'nombre' AS ingrediente,
       (i->>'cantidad')::numeric      AS por_1kg,
       (i->>'cantidad')::numeric * 50 AS por_50kg,
       (i->>'cantidad')::numeric * 56 AS por_56kg,
       i->>'unidad' AS unidad, i->>'nota' AS nota
FROM recetas r, jsonb_array_elements(r.ingredientes) WITH ORDINALITY AS t(i, n)
WHERE lower(r.nombre) = lower('Condimentos para pasta de salame')
ORDER BY n;
