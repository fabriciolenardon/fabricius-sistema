-- ============================================================
-- 127 — LA PALETA SALE DE MERMAS POR PRODUCTO + PLANILLA DE CUARTO PISTOLA
-- ============================================================
-- Fabricio (27/08/2026): la paleta NO es una pieza que salga del desposte de
-- una media res — sale junto con el cortito. Verificado en la base antes de
-- tocar: CERO despostes, CERO piezas físicas y CERO kg del bucket en toda la
-- historia. Su % configurado (25) era un número muerto que alguien podría
-- creerse.
--
-- La paleta conserva su PLANILLA de rinde, pero como la del capón: sólo saca
-- el rinde y lo guarda en el historial, para saber a qué precio vender la
-- paleta deshuesada. No le manda el % a ningún lado.
--
-- OJO: sacarla de acá no alcanza — `MERMA_PIEZA_DEFAULT` (modelosDesposte.js)
-- se mezcla con esta config al cargar la pantalla, así que también se la sacó
-- de ahí o resucitaba sola.
--
-- Además: la planilla "Pierna / Cuarto" se separa en dos. Pierna queda sola y
-- el CUARTO PISTOLA pasa a tener su propia planilla (esa SÍ ajusta su pieza).
--
-- Idempotente.
-- ============================================================

UPDATE config_sistema
   SET valor = jsonb_set(valor, '{piezas}', (valor->'piezas') - 'Paleta')
 WHERE clave = 'merma_conversion' AND (valor->'piezas') ? 'Paleta';

ALTER TABLE planillas_rinde DROP CONSTRAINT IF EXISTS planillas_rinde_tipo_check;
ALTER TABLE planillas_rinde ADD CONSTRAINT planillas_rinde_tipo_check
  CHECK (tipo IN ('media_res','capon','pierna','parrillero',
                  'cortito','carre_lomo','costillar','cuarto_pistola','paleta'));


-- Verificación
SELECT 'piezas que quedan (sin Paleta)' AS control,
       (SELECT string_agg(k, ' · ') FROM config_sistema c, jsonb_object_keys(c.valor->'piezas') k
         WHERE c.clave = 'merma_conversion') AS resultado
UNION ALL
SELECT 'check de tipo',
       (SELECT pg_get_constraintdef(oid) FROM pg_constraint
         WHERE conrelid = 'planillas_rinde'::regclass AND conname = 'planillas_rinde_tipo_check');
