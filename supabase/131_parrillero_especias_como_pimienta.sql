-- ============================================================
-- 131 — CHORIZO PARRILLERO: las especias surtidas van como la pimienta
-- ============================================================
-- Fabricio (28/08/2026): "la proporción de las especias surtidas va en la
-- misma proporción que la pimienta". Estaban en 24 g/kg (igualadas a la sal
-- por la lectura de la lista del 24/08, mig 110); pasan a 2 g/kg como la
-- pimienta. En una tanda de 50 kg: antes 1.200 g, ahora 100 g.
--
-- ⚠️ YA APLICADA: este cambio se corrió directo en la base el 28/08/2026
-- (lo pidió Fabricio en el momento). El archivo queda como registro y es
-- idempotente: correrla de nuevo no cambia nada.
-- ============================================================

UPDATE recetas SET
  ingredientes = (
    SELECT jsonb_agg(
      CASE WHEN i->>'nombre' = 'Especias surtidas'
           THEN jsonb_set(i, '{cantidad}', '2'::jsonb)
           ELSE i END
      ORDER BY n)
    FROM jsonb_array_elements(ingredientes) WITH ORDINALITY AS t(i, n)
  )
WHERE lower(nombre) = lower('Chorizo Parrillero');


-- Verificación: especias surtidas debe decir 2 g (por kilo), igual que la
-- pimienta; el resto queda como estaba.
SELECT i->>'nombre' AS ingrediente, (i->>'cantidad')::numeric AS por_1kg,
       (i->>'cantidad')::numeric * 50 AS por_50kg, i->>'unidad' AS unidad
FROM recetas r, jsonb_array_elements(r.ingredientes) WITH ORDINALITY AS t(i, n)
WHERE lower(r.nombre) = lower('Chorizo Parrillero')
ORDER BY n;
