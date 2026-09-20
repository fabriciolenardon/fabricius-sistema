-- ============================================================
-- 152 — `flujo_deposito` al realtime
-- ============================================================
-- El badge de despostes pendientes (menú Operación › Depósito y la barra del
-- módulo) lo cuenta el hook useFlujoNotificaciones: hace un SELECT al montar
-- y después espera los avisos de realtime para subir y bajar el número.
--
-- La tabla nunca estuvo en la publicación, así que esos avisos no llegaban:
-- el contador quedaba clavado en el número del arranque. Al aprobar los
-- despostes el 20/09/2026 la base quedó en CERO pendientes y la pantalla
-- seguía mostrando 3 hasta recargar. Por lo mismo, un desposte nuevo tampoco
-- hacía sonar el beep ni disparaba la notificación del sistema.
--
-- El hook además se arregló para RECONTAR con un SELECT en cada cambio en vez
-- de sumar y restar de a uno con payload.old: la REPLICA IDENTITY de esta
-- tabla es la default, así que el "antes" sólo trae el id y el estado
-- anterior viene vacío. Por eso acá no hace falta REPLICA IDENTITY FULL.
--
-- Idempotente.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'flujo_deposito'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.flujo_deposito;
  END IF;
END $$;

-- Verificación: tiene que dar 1.
SELECT 'flujo_deposito en realtime' AS control, count(*)::text AS resultado
  FROM pg_publication_tables
  WHERE pubname='supabase_realtime' AND tablename='flujo_deposito';
