-- ============================================================
-- 123 — PLANILLAS DE RINDE (de donde sale la merma de cada producto)
-- ============================================================
-- Son las planillas de papel que usa la administración: entran X kg brutos
-- (una media res, un capón, una pierna, un parrillero), se pesa cada corte que
-- sale, y la diferencia es la merma.
--
-- Hasta ahora ese número se sacaba a mano y se tipeaba en "Mermas por
-- producto". Ahora la planilla lo calcula sola y la ÚLTIMA de cada destino
-- pisa el % en `config_sistema.merma_conversion`.
--
-- QUÉ CUENTA COMO MERMA (confirmado por Fabricio):
--   · Bovino (media res, pierna, parrillero): HUESOS y GRASA.
--   · Cerdo (capón): TOCINO, GRASA, HUESOS/PATAS/CUERO.
--   · RECORTES y CABEZA NO: se venden, suman al neto.
-- El renglón de merma se pesa igual (es el control de que la cuenta cierre),
-- pero no suma al neto vendible.
--
-- `destino_id` es a qué fila de Mermas por producto le escribe: el id del tipo
-- de media res, el nombre de la pieza, o 'capon'. Sin eso una planilla de
-- vaquillona le pisaría la merma al novillito.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS planillas_rinde (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha          date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date),
  sucursal_id    int  NOT NULL DEFAULT 1,
  tipo           text NOT NULL CHECK (tipo IN ('media_res','capon','pierna','parrillero')),
  destino_tipo   text NOT NULL CHECK (destino_tipo IN ('media_res','pieza','capon')),
  destino_id     text NOT NULL,
  destino_label  text,
  kg_bruto       numeric(12,3) NOT NULL CHECK (kg_bruto > 0),
  cortes         jsonb NOT NULL DEFAULT '[]'::jsonb,
  kg_neto        numeric(12,3) NOT NULL,
  kg_merma       numeric(12,3) NOT NULL,
  merma_pct      numeric(6,2)  NOT NULL,
  notas          text,
  creado_por     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE planillas_rinde IS
  'Planilla de rinde: kg brutos que entran y kg de cada corte que salen. El sistema saca la merma sola y con la ULTIMA planilla de cada destino actualiza config_sistema.merma_conversion.';
COMMENT ON COLUMN planillas_rinde.cortes IS
  'Renglones: [{nombre, kg, es_merma}]. es_merma=true (hueso, grasa, tocino, cuero) NO suma al neto vendible.';
COMMENT ON COLUMN planillas_rinde.destino_id IS
  'A qué fila de "Mermas por producto" le manda el %: id del tipo de media res, nombre de la pieza, o capon.';

CREATE INDEX IF NOT EXISTS idx_planillas_rinde_destino
  ON planillas_rinde (destino_tipo, destino_id, fecha DESC, created_at DESC);

ALTER TABLE planillas_rinde ENABLE ROW LEVEL SECURITY;

-- La merma la calcula LA CENTRAL para todas las bocas (es la regla que ya
-- muestra la pantalla de Mermas). Leer lo puede todo el mundo; escribir no.
-- `es_central()` SOLO NO ALCANZA: el usuario Desposte tiene sucursal_id=1 y no
-- tiene por qué reescribir los rindes — por eso va junto con is_admin().
DROP POLICY IF EXISTS planillas_rinde_lectura ON planillas_rinde;
CREATE POLICY planillas_rinde_lectura ON planillas_rinde
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS planillas_rinde_escritura ON planillas_rinde;
CREATE POLICY planillas_rinde_escritura ON planillas_rinde
  FOR ALL TO authenticated
  USING      (is_admin() AND es_central())
  WITH CHECK (is_admin() AND es_central());


-- El capón no tenía fila en "Mermas por producto". Se la creamos para que la
-- planilla tenga a dónde escribir. 30% es un arranque; la primera planilla que
-- se cargue lo pisa con el número real.
UPDATE config_sistema
   SET valor = jsonb_set(valor, '{capon}', to_jsonb(30), true)
 WHERE clave = 'merma_conversion'
   AND NOT (valor ? 'capon');


-- Verificación
SELECT 'planillas cargadas' AS control, count(*)::text AS resultado FROM planillas_rinde
UNION ALL
SELECT 'capon en merma_conversion',
       coalesce((SELECT (valor->>'capon') FROM config_sistema WHERE clave='merma_conversion'), 'FALTA')
UNION ALL
SELECT 'policies de la tabla', count(*)::text
  FROM pg_policies WHERE schemaname='public' AND tablename='planillas_rinde';
