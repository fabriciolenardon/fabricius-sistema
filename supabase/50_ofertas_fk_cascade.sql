-- Borrar un producto de precios fallaba en silencio cuando estaba en una oferta:
-- la FK ofertas.precio_id -> precios no tenía ON DELETE, así que el DELETE se
-- rechazaba y el front (que no chequeaba el error) parecía no hacer nada.
-- Ahora al borrar un producto se borran sus ofertas en cascada.
ALTER TABLE ofertas DROP CONSTRAINT IF EXISTS ofertas_precio_id_fkey;
ALTER TABLE ofertas ADD CONSTRAINT ofertas_precio_id_fkey
  FOREIGN KEY (precio_id) REFERENCES precios(id) ON DELETE CASCADE;
