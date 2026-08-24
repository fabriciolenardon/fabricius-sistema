-- ============================================================
-- 105 — RECETAS: correcciones de Fabricio + recetas de condimentos
-- ============================================================
-- Correcciones sobre la carga de la mig 104 (24/08/2026):
--
-- 1. LA BASE DE LOS SALAMES ES 30 kg, NO EL TOTAL.
--    En la 104 puse base_kg = 50 y 56, que es lo que SALE, no la base.
--    La receta está escrita "por 30 kg de carne de cerdo" y de ahí salen
--    50 kg (común) o 56 kg (holanda). La base es el ancla del multiplicador;
--    el total lo calcula la pantalla sumando todo.
--
--    Para que esa suma cierre, la carne de cerdo sale de la lista de
--    ingredientes y pasa a ser la BASE — igual que en la hamburguesa, donde
--    los 10 kg de carne vacuna son la base y no un ingrediente más. Si
--    quedara en los dos lados se contaría dos veces:
--        30 (base) + 12 bovina + 8 tocino          = 50 kg  ✅
--        30 (base) + 30 cerdo + 12 + 8             = 80 kg  ❌
--
-- 2. "Salame Holanda" pasa a llamarse "Salame Holanda y Rockefort":
--    es la misma fórmula para los dos.
--
-- 3. La hamburguesa es la MISMA para carne, cerdo y pollo. Se renombra
--    para que no parezca que hay que inventar una por animal.
--
-- 4. LOS CONDIMENTOS NO SON UNA RECETA SUELTA. Son los condimentos DE la
--    pasta de salame. Se marcan con `rol = 'condimentos'` y la pantalla
--    les da un selector: se elige a qué salame acompañan y los kilos se
--    toman del TOTAL de ese salame, en vez de tener que copiarlos a mano.
--
-- Idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1) EL ROL DE CADA RECETA
-- ------------------------------------------------------------
-- 'formula'    → receta completa, con su base propia (el default)
-- 'condimentos'→ acompaña a una fórmula; sus kilos salen del total de ella
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS rol text NOT NULL DEFAULT 'formula';


-- ------------------------------------------------------------
-- 2) LAS CORRECCIONES
-- ------------------------------------------------------------

-- Hamburguesas: una sola receta para los tres animales.
UPDATE recetas SET
  nombre     = 'Hamburguesas de Carne, Cerdo o Pollo',
  base_label = 'Carne',
  notas      = 'La misma fórmula para las tres: carne vacuna, cerdo o pollo.'
WHERE lower(nombre) = lower('Hamburguesas de Carne Vacuna');

-- Salame Común: base 30 kg de cerdo → salen 50 kg de pasta.
UPDATE recetas SET
  base_kg      = 30,
  base_label   = 'Carne de cerdo',
  notas        = 'Fórmula de carnes: de 30 kg de cerdo salen 50 kg de pasta. Los condimentos van en su propia receta.',
  ingredientes = '[
    {"nombre": "Carne bovina", "cantidad": 12, "unidad": "kg"},
    {"nombre": "Tocino",       "cantidad": 8,  "unidad": "kg"}
  ]'::jsonb
WHERE lower(nombre) = lower('Salame Común');

-- Salame Holanda y Rockefort: base 30 kg de cerdo → salen 56 kg de pasta.
UPDATE recetas SET
  nombre       = 'Salame Holanda y Rockefort',
  base_kg      = 30,
  base_label   = 'Carne de cerdo',
  notas        = 'Fórmula de carnes: de 30 kg de cerdo salen 56 kg de pasta. Misma receta para el Holanda y el Rockefort. Los condimentos van en su propia receta.',
  ingredientes = '[
    {"nombre": "Carne bovina",  "cantidad": 12, "unidad": "kg"},
    {"nombre": "Tocino",        "cantidad": 8,  "unidad": "kg"},
    {"nombre": "Queso holanda", "cantidad": 6,  "unidad": "kg"}
  ]'::jsonb
WHERE lower(nombre) = lower('Salame Holanda');

-- Condimentos: pasan a ser rol='condimentos' y se calculan por kilo de PASTA
-- (no de carne), que es lo que el selector va a traer del salame elegido.
UPDATE recetas SET
  nombre     = 'Condimentos para pasta de salame',
  rol        = 'condimentos',
  base_kg    = 1,
  base_label = 'Pasta',
  notas      = 'Cartel "SALAME x kg". Vale para el Salame Común y para el Holanda y Rockefort: elegí arriba a cuál acompaña y los kilos salen solos.'
WHERE lower(nombre) = lower('Salame — condimentos por kg');


-- ------------------------------------------------------------
-- 3) VERIFICACIÓN
-- ------------------------------------------------------------
-- El total tiene que dar 11,21 / 50 / 56 / 1.
SELECT nombre, rol, base_kg,
       round(base_kg + coalesce((
         SELECT sum(CASE lower(i->>'unidad')
                      WHEN 'kg' THEN (i->>'cantidad')::numeric
                      WHEN 'g'  THEN (i->>'cantidad')::numeric / 1000
                      ELSE 0 END)
         FROM jsonb_array_elements(ingredientes) i
         WHERE i->>'cantidad' IS NOT NULL), 0), 2) AS total_kg,
       jsonb_array_length(ingredientes) AS ingredientes
FROM recetas WHERE activa ORDER BY orden;
