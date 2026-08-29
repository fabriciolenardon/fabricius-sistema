-- ============================================================
-- 132 — REMITOS: CADA BOCA CON SU PROPIA NUMERACIÓN
-- ============================================================
-- Fabricio (29/08/2026): en su historial el remito saltaba de 01977 a 01981
-- — los números del medio los había consumido Monte Cristo, porque `numero`
-- era un serial GLOBAL compartido por todas las bocas. Pidió numeración
-- separada: "cada local con su numeración".
--
-- CÓMO QUEDA
--   · Tabla contador `remitos_numeracion` (una fila por boca, con candado de
--     fila: dos despachos simultáneos de la misma boca se serializan solos).
--   · Cada boca CONTINÚA desde su número más alto ya emitido (central sigue
--     1985, 1986…; Monte Cristo 1983, 1984…). Nada retrocede, ningún número
--     histórico se toca, y nunca puede chocar con uno viejo.
--   · Una boca nueva (ej. Alvear, que todavía no remitó) arranca de 1.
--   · UNIQUE (sucursal_id, numero): la base garantiza que una boca no repita
--     número. (Con el serial global no había duplicados, así que el índice
--     entra limpio.)
--
-- MECÁNICA
--   · Se le saca el DEFAULT nextval a `numero`: si quedara, el default se
--     aplica ANTES de los triggers y el trigger no podría saber si el número
--     vino a mano o del serial. La secuencia vieja queda huérfana, no se
--     borra (por si algún entorno viejo la referencia).
--   · Trigger BEFORE INSERT `trg_zy_remito_numero_por_boca`: asigna el
--     próximo número de la boca cuando `numero` viene NULL. El nombre
--     importa: los BEFORE corren en orden alfabético y tiene que correr
--     DESPUÉS de `trg_set_sucursal_id` (mig 94, completa la boca) y puede
--     correr antes de `trg_zz_remito_no_duplicado` (no usa el número).
--   · Un INSERT que trae `numero` a mano (pruebas, reparaciones) se respeta,
--     y el contador se adelanta si hace falta para no pisarlo después.
--   · SECURITY DEFINER + RLS sin policies en el contador: solo el trigger lo
--     toca, nadie lo edita desde el cliente.
--
-- ⚠️ YA APLICADA: se corrió en la base el 29/08/2026 (probada antes con un
-- dry-run con rollback, que además cazó el único global). El archivo queda
-- como registro y es idempotente: correrla de nuevo no cambia nada.
--
-- Idempotente.
-- ============================================================

-- 1) El contador por boca, sembrado con el máximo actual de cada una.
CREATE TABLE IF NOT EXISTS remitos_numeracion (
  sucursal_id   int PRIMARY KEY REFERENCES sucursales(id),
  ultimo_numero int NOT NULL DEFAULT 0
);

INSERT INTO remitos_numeracion (sucursal_id, ultimo_numero)
SELECT s.id, COALESCE((SELECT max(r.numero) FROM remitos r WHERE r.sucursal_id = s.id), 0)
FROM sucursales s
ON CONFLICT (sucursal_id) DO NOTHING;

ALTER TABLE remitos_numeracion ENABLE ROW LEVEL SECURITY;

-- 2) Sin default global: el número lo pone el trigger, por boca.
ALTER TABLE remitos ALTER COLUMN numero DROP DEFAULT;

-- 3) La base garantiza que una boca no repite número. El único GLOBAL viejo
--    (remitos_numero_key, del serial original) se suelta: con numeración por
--    boca, el mismo número en dos bocas distintas es justamente lo esperado
--    (lo cazó el dry-run: Monte Cristo quería el 1983 y lo tenía la central).
CREATE UNIQUE INDEX IF NOT EXISTS remitos_boca_numero_uq
  ON remitos (sucursal_id, numero);
ALTER TABLE remitos DROP CONSTRAINT IF EXISTS remitos_numero_key;

-- 4) El trigger que numera.
CREATE OR REPLACE FUNCTION remito_numero_por_boca()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  -- Boca nueva sin fila de contador → se crea arrancando de su máximo real.
  INSERT INTO remitos_numeracion (sucursal_id, ultimo_numero)
  VALUES (NEW.sucursal_id,
          COALESCE((SELECT max(numero) FROM remitos WHERE sucursal_id = NEW.sucursal_id), 0))
  ON CONFLICT (sucursal_id) DO NOTHING;

  IF NEW.numero IS NOT NULL THEN
    -- Número puesto a mano: se respeta y el contador se adelanta si quedó atrás.
    UPDATE remitos_numeracion SET ultimo_numero = greatest(ultimo_numero, NEW.numero)
     WHERE sucursal_id = NEW.sucursal_id;
    RETURN NEW;
  END IF;

  -- El UPDATE bloquea la fila de la boca: dos despachos al mismo tiempo
  -- salen con números consecutivos, nunca repetidos.
  UPDATE remitos_numeracion SET ultimo_numero = ultimo_numero + 1
   WHERE sucursal_id = NEW.sucursal_id
   RETURNING ultimo_numero INTO n;

  NEW.numero := n;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_zy_remito_numero_por_boca ON remitos;
CREATE TRIGGER trg_zy_remito_numero_por_boca
  BEFORE INSERT ON remitos
  FOR EACH ROW EXECUTE FUNCTION remito_numero_por_boca();


-- ------------------------------------------------------------
-- VERIFICACIÓN
-- ------------------------------------------------------------
-- Contadores sembrados (esperado: central = su máximo, Monte Cristo = el
-- suyo, Alvear = 0 → su primer remito será el N° 00001):
SELECT rn.sucursal_id, s.nombre, rn.ultimo_numero
FROM remitos_numeracion rn JOIN sucursales s ON s.id = rn.sucursal_id
ORDER BY rn.sucursal_id;

-- Y que el default global ya no está (esperado: NULL):
SELECT column_default FROM information_schema.columns
WHERE table_name = 'remitos' AND column_name = 'numero';
