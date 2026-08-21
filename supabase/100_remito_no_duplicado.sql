-- ============================================================
-- 100 — RED CONTRA EL REMITO DUPLICADO, DEL LADO DE LA BASE
-- ============================================================
-- El doble click ya está tapado en la pantalla (PR #342: el candado se prende
-- antes de cualquier consulta). Pero esa protección vive en el navegador, y
-- por lo tanto no cubre:
--   · dos pestañas abiertas o dos personas despachando al mismo cliente
--   · un reintento de la red que reenvía el mismo pedido
--   · una versión vieja del sistema cacheada en la compu del local
--     (ya pasó con el CSV de la balanza: Chrome se aferra a lo viejo)
--
-- Esta es la red de abajo: aunque el pedido llegue dos veces, la base guarda
-- UNO solo.
--
-- QUÉ CUENTA COMO DUPLICADO
-- Mismo negocio, mismo cliente, misma fecha y mismo total, dentro de una
-- ventana de 20 SEGUNDOS. Se eligió así mirando los 14 pares reales que había
-- en la base: TODOS estaban entre 0,2 y 1,3 segundos. Ninguno pasaba de 4.
--
-- Los 20 segundos son a propósito: NO bloquean una re-emisión de verdad. Si
-- el cliente vuelve al rato y se le hace otro remito por el mismo importe,
-- entra sin problema. Solo se corta lo que es físicamente imposible que sea
-- una segunda venta real.
--
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION remito_no_duplicado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  gemelo record;
BEGIN
  SELECT r.numero, r.created_at INTO gemelo
  FROM remitos r
  WHERE COALESCE(r.eliminado, false) = false
    AND r.sucursal_id = NEW.sucursal_id
    AND r.fecha = NEW.fecha
    AND abs(COALESCE(r.total, 0) - COALESCE(NEW.total, 0)) < 0.01
    -- Mismo cliente: por id si está registrado, si no por nombre. El
    -- `IS NOT DISTINCT FROM` es para que dos NULL se consideren iguales.
    AND COALESCE(r.cliente_id::text, r.cliente_nombre)
        IS NOT DISTINCT FROM COALESCE(NEW.cliente_id::text, NEW.cliente_nombre)
    AND r.created_at > now() - interval '20 seconds'
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Ya se emitió el remito N° % hace unos segundos, por el mismo importe y al mismo cliente. Si de verdad querés hacer otro igual, esperá 20 segundos.',
      lpad(gemelo.numero::text, 5, '0');
  END IF;

  RETURN NEW;
END $$;

-- ⚠️ EL NOMBRE IMPORTA — arranca con `trg_zz` a propósito.
-- Postgres dispara los triggers BEFORE de una tabla en ORDEN ALFABÉTICO por
-- nombre. `trg_set_sucursal_id` (migración 94) es el que completa
-- `NEW.sucursal_id`, que quedó sin DEFAULT. Si este chequeo se llamara
-- `trg_remito_no_duplicado` correría ANTES, con `NEW.sucursal_id` todavía en
-- NULL, y la comparación `r.sucursal_id = NEW.sucursal_id` daría NULL: no
-- encontraría al gemelo y dejaría pasar el duplicado.
-- Verificado: con ese nombre el duplicado ENTRABA igual.
DROP TRIGGER IF EXISTS trg_remito_no_duplicado ON remitos;
DROP TRIGGER IF EXISTS trg_zz_remito_no_duplicado ON remitos;
CREATE TRIGGER trg_zz_remito_no_duplicado
  BEFORE INSERT ON remitos
  FOR EACH ROW EXECUTE FUNCTION remito_no_duplicado();


-- ------------------------------------------------------------
-- VERIFICACIÓN
-- ------------------------------------------------------------
SELECT 'trigger instalado' AS control,
       count(*)::text AS resultado
  FROM pg_trigger WHERE tgname = 'trg_remito_no_duplicado' AND NOT tgisinternal;

-- Esperado: 1
--
-- Para probarlo a mano (y descartarlo):
--   begin;
--   insert into remitos (fecha, cliente_nombre, total, items, numero)
--   values (current_date, '__prueba', 1000, '[]'::jsonb, 99991);
--   insert into remitos (fecha, cliente_nombre, total, items, numero)
--   values (current_date, '__prueba', 1000, '[]'::jsonb, 99992);  -- ← debe fallar
--   rollback;
