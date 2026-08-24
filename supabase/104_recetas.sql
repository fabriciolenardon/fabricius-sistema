-- ============================================================
-- 104 — RECETAS DE ELABORADOS
-- ============================================================
-- Pedido de Fabricio (24/08/2026): las recetas que hoy están en un papel
-- pegado en la pared del depósito pasan al sistema, para que las vean
-- todos — la central, Monte Cristo y el sector Desposte — y para poder
-- corregirlas o agregar una nueva sin reimprimir el cartel.
--
-- LOS INGREDIENTES VAN EN JSONB, NO EN UNA TABLA APARTE
-- Una receta se lee y se guarda SIEMPRE entera: nadie consulta "todos los
-- usos de la pimienta". Con una tabla hija cada guardado sería un diff de
-- filas (alta/baja/orden) para no ganar nada. El array además conserva el
-- orden en que están escritos en el papel, que es como los usa el que
-- elabora.
--   [{ "nombre": "Sal", "cantidad": 160, "unidad": "g", "nota": null }, ...]
-- `cantidad` puede ser NULL: hay ingredientes que no son un número
-- ("1 cucharadita de té cada 10 kg") y van con la nota sola.
--
-- QUIÉN PUEDE QUÉ
-- Misma decisión que precios y mermas (mig 100): la fórmula es de la
-- central. Todos la LEEN, sólo la central la escribe — es lo que garantiza
-- que el chorizo de Monte Cristo sepa igual que el de Río Primero.
--
-- Idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1) LA TABLA
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recetas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        text NOT NULL,
  -- Para agrupar las tarjetas en la pantalla: hamburguesa | embutido | salame | otro
  categoria     text NOT NULL DEFAULT 'otro',
  -- A cuánta masa corresponden las cantidades. 1 = la receta es "por kilo".
  base_kg       numeric NOT NULL DEFAULT 1,
  -- Qué es esa base ("Carne vacuna", "Masa", "Carne"). Es el encabezado
  -- que el papel tiene arriba de todo.
  base_label    text NOT NULL DEFAULT 'Masa',
  ingredientes  jsonb NOT NULL DEFAULT '[]'::jsonb,
  notas         text,
  orden         int NOT NULL DEFAULT 0,
  activa        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recetas_orden_idx ON recetas (activa, orden, nombre);

-- Dos recetas con el mismo nombre son un error de carga, no una variante.
CREATE UNIQUE INDEX IF NOT EXISTS recetas_nombre_uq ON recetas (lower(nombre));


-- ------------------------------------------------------------
-- 2) RLS — todos leen, sólo la central escribe
-- ------------------------------------------------------------
-- `es_central()` (mig 100) NO alcanza solo: devuelve true para CUALQUIER
-- perfil con sucursal_id = 1, y el usuario del portal Desposte es uno de
-- ellos. Probado: con `es_central()` a secas, el sector Desposte podía
-- reescribir la fórmula. Va junto con `is_admin()` → sólo los admin de la
-- central. El desposte y Monte Cristo leen.
ALTER TABLE recetas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recetas_lectura ON recetas;
CREATE POLICY recetas_lectura ON recetas
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS recetas_escritura_central ON recetas;
CREATE POLICY recetas_escritura_central ON recetas
  FOR ALL TO authenticated
  USING (is_admin() AND es_central())
  WITH CHECK (is_admin() AND es_central());

-- `updated_at` a mano: el trigger genérico de la 92 no cubre esta tabla.
CREATE OR REPLACE FUNCTION recetas_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_recetas_touch ON recetas;
CREATE TRIGGER trg_recetas_touch BEFORE UPDATE ON recetas
  FOR EACH ROW EXECUTE FUNCTION recetas_touch();


-- ------------------------------------------------------------
-- 3) LAS RECETAS DE LOS CARTELES
-- ------------------------------------------------------------
-- ⚠️ TRANSCRIPCIÓN LITERAL de las fotos de los carteles del depósito
-- (24/08/2026). NO se corrigió ningún número, ni los que parecen raros:
--   · el parrillero dice 0,24 g de sal por kilo y el salame 0,30 g,
--     mientras que la hamburguesa lleva 160 g cada 10 kg = 16 g/kg.
--     Son ~60 veces menos. O los carteles del parrillero/salame están en
--     otra unidad, o tienen un error de tipeo arrastrado.
--   · "Vino 0,500 ml" casi seguro quiere decir 0,500 LITROS (500 ml).
-- Se cargan como están para que el sistema diga lo mismo que la pared, y
-- que sea Fabricio el que decida y corrija desde la pantalla — que es
-- justamente para lo que se hizo el módulo.
--
-- `ON CONFLICT DO NOTHING`: si la migración se corre de nuevo, no pisa lo
-- que ya se haya editado.
-- ------------------------------------------------------------

INSERT INTO recetas (nombre, categoria, base_kg, base_label, orden, notas, ingredientes) VALUES

('Hamburguesas de Carne Vacuna', 'hamburguesa', 10, 'Carne vacuna', 10, NULL, '[
  {"nombre": "Sal",          "cantidad": 160, "unidad": "g"},
  {"nombre": "Ajo en polvo", "cantidad": 25,  "unidad": "g"},
  {"nombre": "Pimienta",     "cantidad": 25,  "unidad": "g"},
  {"nombre": "Pan rallado",  "cantidad": 1,   "unidad": "kg"},
  {"nombre": "Huevos",       "cantidad": 20,  "unidad": "u"}
]'::jsonb),

('Chorizo Parrillero', 'embutido', 1, 'Masa', 20,
 'Cartel "PARRILLERO X KG": las cantidades son por kilo de masa.', '[
  {"nombre": "Especias surtidas", "cantidad": 0.2,  "unidad": "g"},
  {"nombre": "Sal",              "cantidad": 0.24, "unidad": "g"},
  {"nombre": "Pimienta",         "cantidad": 0.2,  "unidad": "g"},
  {"nombre": "Fijador",          "cantidad": 0.1,  "unidad": "g"},
  {"nombre": "Nuez moscada",     "cantidad": 0.1,  "unidad": "g"},
  {"nombre": "Tocino",           "cantidad": 0.10, "unidad": "g"},
  {"nombre": "Vino",             "cantidad": null, "unidad": null, "nota": "0,500 ml por cada 10 kg de masa"},
  {"nombre": "Clavo de olor",    "cantidad": null, "unidad": null, "nota": "10 unidades por cada 0,500 ml de vino"},
  {"nombre": "Ajo",              "cantidad": null, "unidad": null, "nota": "1 cabeza por cada 0,500 ml de vino"}
]'::jsonb),

('Salame Común', 'salame', 50, 'Carne', 30,
 'Fórmula de carnes. Los condimentos van en la receta "Salame — condimentos por kg".', '[
  {"nombre": "Carne de cerdo", "cantidad": 30, "unidad": "kg"},
  {"nombre": "Carne bovina",   "cantidad": 12, "unidad": "kg"},
  {"nombre": "Tocino",         "cantidad": 8,  "unidad": "kg"}
]'::jsonb),

('Salame Holanda', 'salame', 56, 'Carne', 40,
 'Fórmula de carnes. Los condimentos van en la receta "Salame — condimentos por kg".', '[
  {"nombre": "Carne de cerdo", "cantidad": 30, "unidad": "kg"},
  {"nombre": "Carne bovina",   "cantidad": 12, "unidad": "kg"},
  {"nombre": "Tocino",         "cantidad": 8,  "unidad": "kg"},
  {"nombre": "Queso holanda",  "cantidad": 6,  "unidad": "kg"}
]'::jsonb),

('Salame — condimentos por kg', 'salame', 1, 'Carne', 50,
 'Cartel "SALAME x kg". Vale para el Salame Común y para el Holanda.', '[
  {"nombre": "Sal",               "cantidad": 0.30, "unidad": "g"},
  {"nombre": "Pimienta",          "cantidad": 0.6,  "unidad": "g"},
  {"nombre": "Nuez moscada",      "cantidad": 0.1,  "unidad": "g"},
  {"nombre": "Especias surtidas", "cantidad": 0.2,  "unidad": "g"},
  {"nombre": "Sal Nitro",         "cantidad": null, "unidad": null, "nota": "1 cucharadita de té cada 10 kg"},
  {"nombre": "Vino",              "cantidad": null, "unidad": null, "nota": "1/4 cada 10 kg"},
  {"nombre": "Clavo de olor",     "cantidad": null, "unidad": null, "nota": "10 dientes cada 10 kg"},
  {"nombre": "Ajo",               "cantidad": null, "unidad": null, "nota": "1 cabeza cada 10 kg"},
  {"nombre": "Acelerante",        "cantidad": null, "unidad": null, "nota": "10 g cada 50 kg de carne"}
]'::jsonb)

ON CONFLICT DO NOTHING;


-- ------------------------------------------------------------
-- 4) VERIFICACIÓN
-- ------------------------------------------------------------
SELECT 'recetas cargadas' AS control, count(*)::text AS resultado FROM recetas
UNION ALL
SELECT 'ingredientes por receta',
       string_agg(nombre || ': ' || jsonb_array_length(ingredientes), ' · ' ORDER BY orden) FROM recetas
UNION ALL
SELECT 'policies', string_agg(policyname, ', ' ORDER BY policyname)
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'recetas';
