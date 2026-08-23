-- ============================================================
-- 103 — LAS OFERTAS LAS MANEJA LA CENTRAL, Y ELIGE A QUIÉN
-- ============================================================
-- Decisión de Fabricio (21/08/2026):
--   · Él arma la oferta desde su sistema y ELIGE en qué sucursales corre
--     (la central, Monte Cristo, Alvear, o varias a la vez).
--   · Dura lo que él prescriba, igual que hoy.
--   · La sucursal NO puede desactivarla ni tocarla.
--   · Pero SÍ puede crear ofertas propias para su boca.
--
-- CÓMO, SIN REESCRIBIR CÓMO SE APLICAN
-- Se sigue guardando UNA FILA POR SUCURSAL. Una oferta para la central y
-- Monte Cristo son dos filas con el mismo `grupo_id`. Así la Caja, el remito
-- y el asistente siguen leyendo `ofertas` filtrado por RLS exactamente como
-- hasta ahora: cero cambios en cómo se aplica una oferta a una venta.
--
--   grupo_id → une las filas de la misma oferta, para prender/apagar todas
--              juntas y mostrarlas como una sola en la lista
--   origen   → 'central' o 'sucursal'. Es lo que decide quién puede tocarla.
--
-- Idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1) LAS DOS COLUMNAS
-- ------------------------------------------------------------
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS origen   text NOT NULL DEFAULT 'central';
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS grupo_id uuid;

-- Las que ya existen son todas de la central, cada una su propio grupo.
UPDATE ofertas SET grupo_id = id WHERE grupo_id IS NULL;

CREATE INDEX IF NOT EXISTS ofertas_grupo_idx ON ofertas (grupo_id);


-- ------------------------------------------------------------
-- 2) EL ORIGEN LO DECIDE QUIÉN LA CREA, NO EL FORMULARIO
-- ------------------------------------------------------------
-- No se confía en lo que mande el cliente: si la crea un usuario de sucursal,
-- queda 'sucursal' aunque el payload diga otra cosa. Si no, 'central'.
-- Esto es lo que sostiene el candado del punto 4.
--
-- Se llama `trg_zz_` por lo mismo de siempre: los triggers BEFORE corren en
-- orden alfabético y `trg_set_sucursal_id` (mig 94) tiene que correr antes.
CREATE OR REPLACE FUNCTION oferta_marcar_origen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.origen := CASE WHEN COALESCE(mi_sucursal(), 1) = 1 THEN 'central' ELSE 'sucursal' END;
  IF NEW.grupo_id IS NULL THEN NEW.grupo_id := NEW.id; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_zz_oferta_origen ON ofertas;
CREATE TRIGGER trg_zz_oferta_origen
  BEFORE INSERT ON ofertas
  FOR EACH ROW EXECUTE FUNCTION oferta_marcar_origen();


-- ------------------------------------------------------------
-- 3) QUE LA CENTRAL PUEDA ESCRIBIR OFERTAS DE OTRA BOCA
-- ------------------------------------------------------------
-- La restrictiva de la mig 93 exige `sucursal_id = mi_sucursal()` también al
-- escribir. Con eso, la central NO podría crear una oferta para Monte Cristo
-- (sucursal_id = 3): el INSERT le rebotaría.
--
-- `ofertas` es la excepción DELIBERADA al aislamiento: es la única tabla que
-- la central gobierna cruzando bocas, porque así lo pidió el negocio. El
-- aislamiento sigue en pie para la sucursal, que solo ve y toca lo suyo.
DROP POLICY IF EXISTS sucursal_aislamiento ON ofertas;
CREATE POLICY sucursal_aislamiento ON ofertas
  AS RESTRICTIVE FOR ALL TO public
  USING      (is_cliente_mayorista() OR is_franquicia() OR COALESCE(mi_sucursal(), 1) = 1 OR sucursal_id = mi_sucursal())
  WITH CHECK (is_cliente_mayorista() OR is_franquicia() OR COALESCE(mi_sucursal(), 1) = 1 OR sucursal_id = mi_sucursal());


-- ------------------------------------------------------------
-- 4) EL CANDADO: LA SUCURSAL NO TOCA LAS DE LA CENTRAL
-- ------------------------------------------------------------
-- Van SEPARADAS por comando a propósito. Si fuera una sola restrictiva `FOR
-- ALL`, también recortaría el SELECT y la sucursal no podría ni VER la oferta
-- de la central — que es justo lo que tiene que aplicar en su Caja.
DROP POLICY IF EXISTS oferta_central_intocable_upd ON ofertas;
CREATE POLICY oferta_central_intocable_upd ON ofertas
  AS RESTRICTIVE FOR UPDATE TO public
  USING (COALESCE(mi_sucursal(), 1) = 1 OR origen = 'sucursal');

DROP POLICY IF EXISTS oferta_central_intocable_del ON ofertas;
CREATE POLICY oferta_central_intocable_del ON ofertas
  AS RESTRICTIVE FOR DELETE TO public
  USING (COALESCE(mi_sucursal(), 1) = 1 OR origen = 'sucursal');


-- ------------------------------------------------------------
-- 5) VERIFICACIÓN
-- ------------------------------------------------------------
SELECT 'ofertas sin grupo_id (debe ser 0)' AS control, count(*)::text AS resultado
  FROM ofertas WHERE grupo_id IS NULL
UNION ALL
SELECT 'origenes cargados', string_agg(DISTINCT origen, ', ') FROM ofertas
UNION ALL
SELECT 'policies de ofertas', string_agg(policyname, ', ' ORDER BY policyname)
  FROM pg_policies WHERE schemaname='public' AND tablename='ofertas'
UNION ALL
SELECT 'trigger de origen', count(*)::text FROM pg_trigger
  WHERE tgname='trg_zz_oferta_origen' AND NOT tgisinternal;
