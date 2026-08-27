-- ============================================================
-- 129 — LA BASE NORMALIZA LOS MEDIOS DE PAGO DE TODA VENTA MINORISTA
-- ============================================================
-- Regla (la misma del PR #417 y de las reparaciones del 27/08/2026):
--   · transferencia y débito no pueden superar el total (no hay vuelto con
--     tarjeta ni con transferencia)
--   · el efectivo se guarda NETO: lo que queda en el cajón (total − débito −
--     transferencia), no el billete entregado
--
-- La pantalla ya lo frena, pero UNA PESTAÑA VIEJA CORRE CÓDIGO VIEJO: el fix
-- de la coma estaba deployado hacía un día y la caja de Monte Cristo siguió
-- escribiendo débitos inflados ($996.030 en una venta de $9.960) porque
-- nunca refrescó. Este trigger es la red que ningún navegador puede esquivar.
--
-- NORMALIZA en vez de RECHAZAR a propósito: rechazar perdería la venta (y el
-- stock ya debitado del lado del cliente); acomodar el desglose conserva la
-- venta con el total intacto. Tolerancia de $1 por centavos de redondeo.
--
-- Probado con rollback: débito inflado (996030 → 9960.30), billete entregado
-- (20000 → 7761.60) y un pago mixto sano que NO se toca.
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION normalizar_pagos_venta() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  t numeric := coalesce(NEW.total, 0);
  ef numeric := coalesce(NEW.efectivo, 0);
  db numeric := coalesce(NEW.debito, 0);
  tr numeric := coalesce(NEW.transferencia, 0);
BEGIN
  IF ef + db + tr > t + 1 THEN
    tr := least(tr, t);
    db := least(db, greatest(t - tr, 0));
    NEW.transferencia := tr;
    NEW.debito := db;
    NEW.efectivo := CASE WHEN ef > 0 THEN greatest(t - db - tr, 0) ELSE 0 END;
  END IF;
  RETURN NEW;
END $$;

-- trg_zz_: los BEFORE corren en orden alfabético y éste va al final,
-- después de trg_set_sucursal_id (convención de la casa).
DROP TRIGGER IF EXISTS trg_zz_normalizar_pagos ON ventas_minoristas;
CREATE TRIGGER trg_zz_normalizar_pagos
  BEFORE INSERT OR UPDATE OF efectivo, debito, transferencia, total
  ON ventas_minoristas
  FOR EACH ROW EXECUTE FUNCTION normalizar_pagos_venta();


-- Verificación
SELECT tgname AS trigger_instalado
  FROM pg_trigger
 WHERE tgrelid = 'ventas_minoristas'::regclass AND tgname = 'trg_zz_normalizar_pagos';
