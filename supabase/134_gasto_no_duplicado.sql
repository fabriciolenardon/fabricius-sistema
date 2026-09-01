-- ============================================================
-- 134 — RED CONTRA EL GASTO DUPLICADO POR DOBLE CLICK
-- ============================================================
-- Fabricio (01/09/2026): al cargar los gastos de la semana del 24-30/08 se
-- colaron CUATRO duplicados por doble click, $441.859 de más que le comían
-- la ganancia del cierre:
--     GASTO SECADORA $308.000      → 12:19:35 y 12:19:47  (12 segundos)
--     BOLETA MITRE Y CENTRO $98.859 → 15:04:10 y 15:05:26 (76 segundos)
--     GASTO (socio) $20.000        → 12:19:02 y 12:20:08  (66 segundos)
--     GASTO (socio) $15.000        → 12:22:30 y 12:22:41  (11 segundos)
--
-- Misma idea que `remito_no_duplicado` (mig 100), pero con una ventana MÁS
-- LARGA: los remitos duplicados nacían de un doble click de milisegundos,
-- acá los repetidos van de 11 a 76 segundos porque el que carga vuelve a
-- apretar creyendo que no guardó. Se toman 120 SEGUNDOS mirando los cuatro
-- casos reales (el peor fue de 76s).
--
-- QUÉ CUENTA COMO DUPLICADO
-- Misma boca, misma fecha, mismo tipo, mismo monto y misma descripción,
-- dentro de 2 minutos. Dos gastos legítimamente iguales el mismo día (dos
-- viáticos de $20.000, por ejemplo) SIGUEN ENTRANDO: solo hay que esperar
-- los 2 minutos, y el mensaje de error lo explica.
--
-- Se hace en la BASE y no solo en la pantalla porque el candado del
-- navegador no cubre dos pestañas, un reintento de red ni una versión
-- cacheada del sistema (misma lección que la mig 100).
--
-- ⚠️ YA APLICADA: se corrió en la base el 01/09/2026 junto con el borrado de
-- los 4 duplicados. El archivo queda como registro. Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION gasto_no_duplicado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  gemelo record;
BEGIN
  SELECT g.monto, g.created_at INTO gemelo
  FROM gastos g
  WHERE g.sucursal_id IS NOT DISTINCT FROM NEW.sucursal_id
    AND g.fecha = NEW.fecha
    AND g.tipo IS NOT DISTINCT FROM NEW.tipo
    AND abs(COALESCE(g.monto, 0) - COALESCE(NEW.monto, 0)) < 0.01
    AND upper(trim(COALESCE(g.descripcion, ''))) = upper(trim(COALESCE(NEW.descripcion, '')))
    AND g.created_at > now() - interval '120 seconds'
  ORDER BY g.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Ya cargaste este gasto hace unos segundos: % por $%. Si de verdad son DOS gastos distintos por el mismo importe, esperá 2 minutos y volvé a cargarlo.',
      COALESCE(NEW.descripcion, '(sin descripción)'),
      to_char(NEW.monto, 'FM999G999G999D00');
  END IF;

  RETURN NEW;
END $$;

-- `trg_zz_` a propósito: los BEFORE corren en orden alfabético y
-- `trg_set_sucursal_id` (mig 94) tiene que completar NEW.sucursal_id ANTES,
-- si no la comparación por boca daría NULL y dejaría pasar el duplicado
-- (misma trampa que documenta la mig 100).
DROP TRIGGER IF EXISTS trg_zz_gasto_no_duplicado ON gastos;
CREATE TRIGGER trg_zz_gasto_no_duplicado
  BEFORE INSERT ON gastos
  FOR EACH ROW EXECUTE FUNCTION gasto_no_duplicado();


-- ------------------------------------------------------------
-- VERIFICACIÓN
-- ------------------------------------------------------------
SELECT 'trigger instalado' AS control, count(*)::text AS resultado
  FROM pg_trigger WHERE tgname = 'trg_zz_gasto_no_duplicado' AND NOT tgisinternal;
-- Esperado: 1
