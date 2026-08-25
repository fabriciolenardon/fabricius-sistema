-- ============================================================
-- 116 — EN UNA SUCURSAL, LA OFERTA NO APLICA A "CARNICERÍA"
-- ============================================================
-- La lista CARNICERÍA es con la que la CENTRAL le vende a las carnicerías.
-- Una sucursal no la tiene: vende minorista y mayorista.
--
-- Al habilitar una oferta en Monte Cristo (PR #392) la fila se clonaba tal
-- cual, así que llegaba con `aplica_carniceria = true` y en su pantalla salía
-- el chip 🔴 Carn de una lista que no existe en su boca.
--
-- ⚠️ SÓLO SE TOCA CARNICERÍA. Mayorista y minorista quedan como cada boca las
-- elija — eso fue explícito de Fabricio y ya se revirtió una vez (mig 115).
-- No volver a meterle mano a esos dos.
--
-- Va como trigger y no sólo en la pantalla porque las ofertas de una sucursal
-- las crea la CENTRAL eligiendo bocas (mig 103) y también el botón de sumar
-- boca: son dos caminos distintos y los dos tienen que quedar bien.
--
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION oferta_sin_carniceria_en_sucursal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(NEW.sucursal_id, 1) <> 1 THEN
    NEW.aplica_carniceria := false;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_zz_oferta_sin_carniceria ON ofertas;
CREATE TRIGGER trg_zz_oferta_sin_carniceria
  BEFORE INSERT OR UPDATE ON ofertas
  FOR EACH ROW EXECUTE FUNCTION oferta_sin_carniceria_en_sucursal();

-- Las 4 que ya se le habían pasado a Monte Cristo.
UPDATE ofertas SET aplica_carniceria = false
WHERE coalesce(sucursal_id, 1) <> 1 AND aplica_carniceria IS DISTINCT FROM false;


-- ------------------------------------------------------------
-- VERIFICACIÓN
-- ------------------------------------------------------------
SELECT 'ofertas de sucursal con carniceria (debe ser 0)' AS control, count(*)::text AS resultado
  FROM ofertas WHERE coalesce(sucursal_id,1) <> 1 AND aplica_carniceria
UNION ALL
SELECT 'ofertas de la central con carniceria (no se tocan)', count(*)::text
  FROM ofertas WHERE coalesce(sucursal_id,1) = 1 AND aplica_carniceria AND activa
UNION ALL
SELECT 'ofertas de sucursal con mayorista (se respetan)', count(*)::text
  FROM ofertas WHERE coalesce(sucursal_id,1) <> 1 AND aplica_mayorista AND activa;
