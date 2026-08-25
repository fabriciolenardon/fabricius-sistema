-- ============================================================
-- 119 — EL CAMBIO DE UN COMBO LLEGA SOLO A LA CAJA
-- ============================================================
-- El combo YA es una sola fila que comparten todas las bocas (mig 118): si la
-- central le cambia el precio, esa ES la fila que lee Monte Cristo. No hay
-- nada que copiar ni sincronizar.
--
-- Lo que faltaba es que el cambio LLEGUE A UNA PANTALLA ABIERTA. La Caja ya
-- escuchaba `combos_venta` por realtime desde que se armó el módulo...
--
--     .on('postgres_changes', { ..., table: 'combos_venta' }, debouncedReload)
--
-- ...pero la tabla NUNCA se agregó a la publicación `supabase_realtime`, así
-- que Postgres no emitía nada y ese listener era una línea muerta. El combo
-- viejo se seguía vendiendo hasta que alguien recargaba la página.
--
-- OJO: esto estaba roto para la central también, no sólo para la franquicia.
-- No se notó porque el que cambia el precio no es el que está parado en la
-- caja.
--
-- REPLICA IDENTITY FULL porque el editor BORRA de verdad (`.delete()`), y con
-- la identidad default un DELETE viaja sólo con el id: la RLS no puede
-- evaluar a quién le corresponde y el evento no se entrega. Con FULL viaja la
-- fila entera. En `precios` sería caro; acá la tabla tiene 8 filas.
--
-- Idempotente.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'combos_venta'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE combos_venta;
  END IF;
END $$;

ALTER TABLE combos_venta REPLICA IDENTITY FULL;


-- Verificación: combos_venta tiene que quedar igual que sus hermanas.
SELECT c.relname AS tabla,
       CASE c.relreplident WHEN 'd' THEN 'default (solo PK)'
                           WHEN 'f' THEN 'full (fila entera)'
                           ELSE c.relreplident::text END AS replica_identity,
       CASE WHEN pt.tablename IS NULL THEN '❌ NO esta en realtime'
            ELSE '✅ en realtime' END AS publicacion
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
LEFT JOIN pg_publication_tables pt
       ON pt.tablename = c.relname AND pt.pubname = 'supabase_realtime'
WHERE c.relname IN ('combos_venta', 'precios', 'precios_sucursal', 'ofertas')
ORDER BY c.relname;
