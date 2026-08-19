-- ============================================================
-- 96 — `precios_sucursal` al realtime
-- ============================================================
-- La Caja se suscribe por realtime a `precios` para tomar una actualización
-- sin recargar la página: así la cajera nunca vende con un precio viejo.
--
-- Una sucursal no carga sus precios en el catálogo sino en `precios_sucursal`
-- (migración 92). Sin sumar esa tabla a la publicación, su propia
-- actualización de precio no le llegaría al mostrador hasta refrescar.
--
-- NOTA DE DISEÑO — por qué NO hay una vista acá:
-- La idea original era renombrar `precios` y dejar una vista en su lugar, para
-- que las 51 lecturas del código siguieran funcionando sin tocarlas. No se
-- puede: `precios` está en esta misma publicación, y una VISTA no puede estar
-- en una publicación de replicación. La Caja habría dejado de enterarse de los
-- cambios de precio. La resolución vive en el código: lib/preciosSucursal.js.
--
-- Idempotente.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'precios_sucursal'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.precios_sucursal;
  END IF;
END $$;

-- Verificación: tiene que dar 1.
SELECT 'precios_sucursal en realtime' AS control, count(*)::text AS resultado
  FROM pg_publication_tables
  WHERE pubname='supabase_realtime' AND tablename='precios_sucursal';
